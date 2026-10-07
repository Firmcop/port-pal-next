
-- 1. Backfill + NOT NULL on parties
UPDATE public.customers c
   SET currency = COALESCE(NULLIF(btrim(c.currency),''),
                           (SELECT currency FROM public.organizations o WHERE o.id = c.organization_id),
                           'USD')
 WHERE c.currency IS NULL OR btrim(c.currency) = '';

UPDATE public.suppliers s
   SET currency = COALESCE(NULLIF(btrim(s.currency),''),
                           (SELECT currency FROM public.organizations o WHERE o.id = s.organization_id),
                           'USD')
 WHERE s.currency IS NULL OR btrim(s.currency) = '';

ALTER TABLE public.customers  ALTER COLUMN currency SET NOT NULL;
ALTER TABLE public.suppliers  ALTER COLUMN currency SET NOT NULL;

-- 2. Unified party currency trigger
CREATE OR REPLACE FUNCTION public.set_currency_from_party()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _j jsonb := to_jsonb(NEW);
  _c text;
  _org uuid;
BEGIN
  IF (_j ? 'currency') AND (_j->>'currency') IS NOT NULL AND btrim(_j->>'currency') <> '' THEN
    RETURN NEW;
  END IF;

  IF (_j ? 'organization_id') THEN
    _org := NULLIF(_j->>'organization_id','')::uuid;
  END IF;

  IF (_j ? 'customer_id') AND (_j->>'customer_id') IS NOT NULL THEN
    SELECT currency INTO _c FROM public.customers WHERE id = (_j->>'customer_id')::uuid;
  ELSIF (_j ? 'supplier_id') AND (_j->>'supplier_id') IS NOT NULL THEN
    SELECT currency INTO _c FROM public.suppliers WHERE id = (_j->>'supplier_id')::uuid;
  ELSIF (_j ? 'invoice_id') AND (_j->>'invoice_id') IS NOT NULL THEN
    SELECT currency INTO _c FROM public.invoices WHERE id = (_j->>'invoice_id')::uuid;
  END IF;

  IF (_c IS NULL OR btrim(_c) = '') AND _org IS NOT NULL THEN
    SELECT currency INTO _c FROM public.organizations WHERE id = _org;
  END IF;

  IF _c IS NULL OR btrim(_c) = '' THEN
    RAISE EXCEPTION 'party_currency_required'
      USING HINT = 'Set a currency on the customer or supplier record before creating this transaction.';
  END IF;

  NEW := jsonb_populate_record(NEW, jsonb_build_object('currency', upper(btrim(_c))));
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.set_currency_from_party() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.set_currency_from_party() TO authenticated, service_role;

DROP TRIGGER IF EXISTS a_set_currency_from_party_trg ON public.invoices;
CREATE TRIGGER a_set_currency_from_party_trg BEFORE INSERT ON public.invoices
  FOR EACH ROW EXECUTE FUNCTION public.set_currency_from_party();

DROP TRIGGER IF EXISTS a_set_currency_from_party_trg ON public.supplier_invoices;
CREATE TRIGGER a_set_currency_from_party_trg BEFORE INSERT ON public.supplier_invoices
  FOR EACH ROW EXECUTE FUNCTION public.set_currency_from_party();

DROP TRIGGER IF EXISTS a_set_currency_from_party_trg ON public.lease_agreements;
CREATE TRIGGER a_set_currency_from_party_trg BEFORE INSERT ON public.lease_agreements
  FOR EACH ROW EXECUTE FUNCTION public.set_currency_from_party();

DROP TRIGGER IF EXISTS a_set_currency_from_party_trg ON public.lease_quotations;
CREATE TRIGGER a_set_currency_from_party_trg BEFORE INSERT ON public.lease_quotations
  FOR EACH ROW EXECUTE FUNCTION public.set_currency_from_party();

DROP TRIGGER IF EXISTS a_set_currency_from_party_trg ON public.logistics_transport_orders;
CREATE TRIGGER a_set_currency_from_party_trg BEFORE INSERT ON public.logistics_transport_orders
  FOR EACH ROW EXECUTE FUNCTION public.set_currency_from_party();

DROP TRIGGER IF EXISTS a_set_currency_from_party_trg ON public.payments;
CREATE TRIGGER a_set_currency_from_party_trg BEFORE INSERT ON public.payments
  FOR EACH ROW EXECUTE FUNCTION public.set_currency_from_party();

DROP TRIGGER IF EXISTS a_set_currency_from_customer_trg ON public.invoices;
DROP TRIGGER IF EXISTS a_set_currency_from_supplier_trg ON public.supplier_invoices;

-- 3. Preview + restamp
CREATE OR REPLACE FUNCTION public.preview_party_currency_impact(
  _party_kind text, _party_id uuid, _new_currency text
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE _res jsonb; _new text := upper(btrim(_new_currency));
BEGIN
  IF _party_kind = 'customer' THEN
    SELECT jsonb_build_object(
      'invoices_draft',         (SELECT count(*) FROM invoices WHERE customer_id=_party_id AND status='draft' AND currency <> _new),
      'invoices_locked',        (SELECT count(*) FROM invoices WHERE customer_id=_party_id AND status<>'draft' AND currency <> _new),
      'lease_quotations_draft', (SELECT count(*) FROM lease_quotations WHERE customer_id=_party_id AND status='draft' AND currency <> _new),
      'lease_agreements_draft', (SELECT count(*) FROM lease_agreements WHERE customer_id=_party_id AND status IN ('draft','pending') AND currency <> _new),
      'transport_orders_draft', (SELECT count(*) FROM logistics_transport_orders WHERE customer_id=_party_id AND status IN ('draft','quoted') AND currency <> _new)
    ) INTO _res;
  ELSIF _party_kind = 'supplier' THEN
    SELECT jsonb_build_object(
      'supplier_invoices_draft',  (SELECT count(*) FROM supplier_invoices WHERE supplier_id=_party_id AND status='draft' AND currency <> _new),
      'supplier_invoices_locked', (SELECT count(*) FROM supplier_invoices WHERE supplier_id=_party_id AND status<>'draft' AND currency <> _new)
    ) INTO _res;
  ELSE
    RAISE EXCEPTION 'unknown_party_kind';
  END IF;
  RETURN _res;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.preview_party_currency_impact(text,uuid,text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.preview_party_currency_impact(text,uuid,text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.restamp_party_drafts()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE _new text := upper(btrim(NEW.currency));
BEGIN
  PERFORM set_config('app.currency_override', 'true', true);

  IF TG_TABLE_NAME = 'customers' THEN
    UPDATE public.invoices SET currency = _new
      WHERE customer_id = NEW.id AND status = 'draft' AND currency <> _new;
    UPDATE public.lease_quotations SET currency = _new
      WHERE customer_id = NEW.id AND status = 'draft' AND currency <> _new;
    UPDATE public.lease_agreements SET currency = _new
      WHERE customer_id = NEW.id AND status IN ('draft','pending') AND currency <> _new;
    UPDATE public.logistics_transport_orders SET currency = _new
      WHERE customer_id = NEW.id AND status IN ('draft','quoted') AND currency <> _new;
  ELSIF TG_TABLE_NAME = 'suppliers' THEN
    UPDATE public.supplier_invoices SET currency = _new
      WHERE supplier_id = NEW.id AND status = 'draft' AND currency <> _new;
  END IF;

  PERFORM set_config('app.currency_override', '', true);
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.restamp_party_drafts() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.restamp_party_drafts() TO authenticated, service_role;

DROP TRIGGER IF EXISTS restamp_customer_drafts_trg ON public.customers;
CREATE TRIGGER restamp_customer_drafts_trg
  AFTER UPDATE OF currency ON public.customers
  FOR EACH ROW WHEN (OLD.currency IS DISTINCT FROM NEW.currency)
  EXECUTE FUNCTION public.restamp_party_drafts();

DROP TRIGGER IF EXISTS restamp_supplier_drafts_trg ON public.suppliers;
CREATE TRIGGER restamp_supplier_drafts_trg
  AFTER UPDATE OF currency ON public.suppliers
  FOR EACH ROW WHEN (OLD.currency IS DISTINCT FROM NEW.currency)
  EXECUTE FUNCTION public.restamp_party_drafts();
