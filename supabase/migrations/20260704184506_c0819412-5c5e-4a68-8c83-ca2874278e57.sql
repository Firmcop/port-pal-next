
-- ==========================================================================
-- 1. Currency decimal precision reference
-- ==========================================================================
CREATE TABLE IF NOT EXISTS public.currency_minor_units (
  code text PRIMARY KEY,
  digits int NOT NULL DEFAULT 2
);

GRANT SELECT ON public.currency_minor_units TO authenticated, anon;
GRANT ALL ON public.currency_minor_units TO service_role;

ALTER TABLE public.currency_minor_units ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "currency_minor_units_read" ON public.currency_minor_units;
CREATE POLICY "currency_minor_units_read"
  ON public.currency_minor_units FOR SELECT
  TO authenticated, anon USING (true);

INSERT INTO public.currency_minor_units (code, digits) VALUES
  ('JPY',0),('KRW',0),('VND',0),('CLP',0),('ISK',0),('HUF',0),('TWD',0),('UGX',0),('RWF',0),
  ('BHD',3),('KWD',3),('OMR',3),('JOD',3),('TND',3)
ON CONFLICT (code) DO NOTHING;

CREATE OR REPLACE FUNCTION public.currency_digits(_code text)
RETURNS int
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT digits FROM public.currency_minor_units WHERE code = upper(_code)),
    2
  );
$$;
REVOKE EXECUTE ON FUNCTION public.currency_digits(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.currency_digits(text) TO authenticated, service_role;

-- ==========================================================================
-- 2. Audit table for currency overrides
-- ==========================================================================
CREATE TABLE public.invoice_currency_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  invoice_kind text NOT NULL CHECK (invoice_kind IN ('sales','purchase')),
  invoice_id uuid NOT NULL,
  from_currency text,
  to_currency text NOT NULL,
  reason text NOT NULL,
  changed_by uuid,
  changed_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.invoice_currency_audit TO authenticated;
GRANT ALL ON public.invoice_currency_audit TO service_role;

ALTER TABLE public.invoice_currency_audit ENABLE ROW LEVEL SECURITY;

CREATE POLICY "invoice_currency_audit_select_org"
  ON public.invoice_currency_audit FOR SELECT
  TO authenticated
  USING (organization_id = public.current_org_id() OR public.is_platform_admin());

-- No INSERT/UPDATE/DELETE policies — rows are only written by the RPC below (SECURITY DEFINER).

CREATE INDEX idx_invoice_currency_audit_invoice ON public.invoice_currency_audit(invoice_id);
CREATE INDEX idx_invoice_currency_audit_org ON public.invoice_currency_audit(organization_id);

-- ==========================================================================
-- 3. Lock trigger: currency is immutable unless override GUC is set
-- ==========================================================================
CREATE OR REPLACE FUNCTION public.lock_invoice_currency()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.currency IS NOT NULL
     AND NEW.currency IS DISTINCT FROM OLD.currency
     AND COALESCE(current_setting('app.currency_override', true), '') <> 'true'
  THEN
    RAISE EXCEPTION 'invoice_currency_locked — use override_invoice_currency() to change it';
  END IF;
  RETURN NEW;
END $$;
REVOKE EXECUTE ON FUNCTION public.lock_invoice_currency() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS lock_invoice_currency_trg ON public.invoices;
CREATE TRIGGER lock_invoice_currency_trg
  BEFORE UPDATE ON public.invoices
  FOR EACH ROW EXECUTE FUNCTION public.lock_invoice_currency();

DROP TRIGGER IF EXISTS lock_invoice_currency_trg ON public.supplier_invoices;
CREATE TRIGGER lock_invoice_currency_trg
  BEFORE UPDATE ON public.supplier_invoices
  FOR EACH ROW EXECUTE FUNCTION public.lock_invoice_currency();

-- ==========================================================================
-- 4. Totals validation trigger: subtotal + tax_amount == total_amount (rounded)
-- ==========================================================================
CREATE OR REPLACE FUNCTION public.check_invoice_totals()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE _d int;
BEGIN
  _d := public.currency_digits(NEW.currency);
  IF round(COALESCE(NEW.subtotal,0) + COALESCE(NEW.tax_amount,0), _d)
     <> round(COALESCE(NEW.total_amount,0), _d) THEN
    RAISE EXCEPTION 'invoice_totals_mismatch: subtotal (%) + tax (%) != total (%) in % (digits=%)',
      NEW.subtotal, NEW.tax_amount, NEW.total_amount, NEW.currency, _d;
  END IF;
  RETURN NEW;
END $$;
REVOKE EXECUTE ON FUNCTION public.check_invoice_totals() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS check_invoice_totals_trg ON public.invoices;
CREATE TRIGGER check_invoice_totals_trg
  BEFORE INSERT OR UPDATE OF subtotal, tax_amount, total_amount, currency ON public.invoices
  FOR EACH ROW EXECUTE FUNCTION public.check_invoice_totals();

DROP TRIGGER IF EXISTS check_invoice_totals_trg ON public.supplier_invoices;
CREATE TRIGGER check_invoice_totals_trg
  BEFORE INSERT OR UPDATE OF subtotal, tax_amount, total_amount, currency ON public.supplier_invoices
  FOR EACH ROW EXECUTE FUNCTION public.check_invoice_totals();

-- ==========================================================================
-- 5. Admin-only override RPC (writes audit row + updates invoice)
-- ==========================================================================
CREATE OR REPLACE FUNCTION public.override_invoice_currency(
  _kind text,
  _invoice_id uuid,
  _new_currency text,
  _reason text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _org uuid;
  _from text;
  _status text;
  _uid uuid := auth.uid();
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  IF _kind NOT IN ('sales','purchase') THEN RAISE EXCEPTION 'invalid_kind'; END IF;
  IF _new_currency IS NULL OR length(btrim(_new_currency)) < 3 THEN
    RAISE EXCEPTION 'invalid_currency_code';
  END IF;
  IF _reason IS NULL OR length(btrim(_reason)) < 5 THEN
    RAISE EXCEPTION 'reason_required (min 5 chars)';
  END IF;

  IF _kind = 'sales' THEN
    SELECT organization_id, currency, status::text INTO _org, _from, _status
      FROM public.invoices WHERE id = _invoice_id;
  ELSE
    SELECT organization_id, currency, status INTO _org, _from, _status
      FROM public.supplier_invoices WHERE id = _invoice_id;
  END IF;

  IF _org IS NULL THEN RAISE EXCEPTION 'invoice_not_found'; END IF;

  IF NOT (public.is_platform_admin()
          OR public.has_role(_uid, 'admin'::app_role)
          OR public.has_role(_uid, 'org_owner'::app_role)) THEN
    RAISE EXCEPTION 'forbidden — admin/owner only';
  END IF;

  IF _status IN ('paid','cancelled','credited','void') THEN
    RAISE EXCEPTION 'invoice_locked (status=%)', _status;
  END IF;

  -- Allow the lock trigger to permit this currency change for this transaction only.
  PERFORM set_config('app.currency_override', 'true', true);

  IF _kind = 'sales' THEN
    UPDATE public.invoices SET currency = upper(btrim(_new_currency)) WHERE id = _invoice_id;
  ELSE
    UPDATE public.supplier_invoices SET currency = upper(btrim(_new_currency)) WHERE id = _invoice_id;
  END IF;

  INSERT INTO public.invoice_currency_audit
    (organization_id, invoice_kind, invoice_id, from_currency, to_currency, reason, changed_by)
  VALUES
    (_org, _kind, _invoice_id, _from, upper(btrim(_new_currency)), btrim(_reason), _uid);
END $$;

REVOKE EXECUTE ON FUNCTION public.override_invoice_currency(text, uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.override_invoice_currency(text, uuid, text, text) TO authenticated, service_role;
