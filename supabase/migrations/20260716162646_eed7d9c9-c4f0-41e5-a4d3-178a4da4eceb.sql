
-- Multi-currency + multi-party support for logistics transport orders
ALTER TABLE public.logistics_transport_orders
  ADD COLUMN IF NOT EXISTS fx_rate numeric(18,8),
  ADD COLUMN IF NOT EXISTS container_owner_customer_id uuid REFERENCES public.customers(id),
  ADD COLUMN IF NOT EXISTS container_owner_charge numeric(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS container_owner_currency text,
  ADD COLUMN IF NOT EXISTS container_owner_fx_rate numeric(18,8),
  ADD COLUMN IF NOT EXISTS container_owner_invoice_id uuid REFERENCES public.invoices(id),
  ADD COLUMN IF NOT EXISTS container_owner_notes text;

-- Require at least one party (backfill-safe: existing rows keep customer_id)
ALTER TABLE public.logistics_transport_orders
  DROP CONSTRAINT IF EXISTS logistics_transport_orders_party_chk;
ALTER TABLE public.logistics_transport_orders
  ADD CONSTRAINT logistics_transport_orders_party_chk
  CHECK (customer_id IS NOT NULL OR container_owner_customer_id IS NOT NULL);

-- Default fx_rate to 1 for backfill so existing reports keep working
UPDATE public.logistics_transport_orders SET fx_rate = 1 WHERE fx_rate IS NULL;

CREATE INDEX IF NOT EXISTS idx_lto_owner ON public.logistics_transport_orders(container_owner_customer_id);

-- Extend revenue trigger to also react to owner invoice
CREATE OR REPLACE FUNCTION public.log_order_invoice_revenue()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE _inv_id uuid; _inv_total numeric; _inv_currency text; _trip record; _n int; _share numeric;
  _inv_ids uuid[];
BEGIN
  _inv_ids := ARRAY[]::uuid[];
  IF NEW.deposit_invoice_id IS NOT NULL AND (TG_OP='INSERT' OR NEW.deposit_invoice_id IS DISTINCT FROM OLD.deposit_invoice_id) THEN
    _inv_ids := _inv_ids || NEW.deposit_invoice_id;
  END IF;
  IF NEW.balance_invoice_id IS NOT NULL AND (TG_OP='INSERT' OR NEW.balance_invoice_id IS DISTINCT FROM OLD.balance_invoice_id) THEN
    _inv_ids := _inv_ids || NEW.balance_invoice_id;
  END IF;
  IF NEW.invoice_id IS NOT NULL AND (TG_OP='INSERT' OR NEW.invoice_id IS DISTINCT FROM OLD.invoice_id) THEN
    _inv_ids := _inv_ids || NEW.invoice_id;
  END IF;
  IF NEW.container_owner_invoice_id IS NOT NULL AND (TG_OP='INSERT' OR NEW.container_owner_invoice_id IS DISTINCT FROM OLD.container_owner_invoice_id) THEN
    _inv_ids := _inv_ids || NEW.container_owner_invoice_id;
  END IF;

  FOREACH _inv_id IN ARRAY _inv_ids LOOP
    SELECT total_amount, currency INTO _inv_total, _inv_currency FROM invoices WHERE id=_inv_id;
    SELECT COUNT(DISTINCT trip_id) INTO _n FROM logistics_trip_legs WHERE transport_order_id=NEW.id;
    IF COALESCE(_n,0) > 0 AND COALESCE(_inv_total,0) > 0 THEN
      _share := _inv_total / _n;
      FOR _trip IN SELECT DISTINCT trip_id FROM logistics_trip_legs WHERE transport_order_id=NEW.id LOOP
        IF NOT EXISTS (SELECT 1 FROM logistics_trip_revenue
                       WHERE trip_id=_trip.trip_id AND invoice_id=_inv_id AND transport_order_id=NEW.id) THEN
          INSERT INTO logistics_trip_revenue(organization_id, trip_id, transport_order_id, amount, currency, invoice_id)
          VALUES (NEW.organization_id, _trip.trip_id, NEW.id, _share, _inv_currency, _inv_id);
        END IF;
      END LOOP;
    END IF;
  END LOOP;
  RETURN NEW;
END $$;

REVOKE ALL ON FUNCTION public.log_order_invoice_revenue() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.log_order_invoice_revenue() TO service_role;

DROP TRIGGER IF EXISTS trg_log_order_invoice_revenue ON public.logistics_transport_orders;
CREATE TRIGGER trg_log_order_invoice_revenue
AFTER INSERT OR UPDATE OF deposit_invoice_id, balance_invoice_id, invoice_id, container_owner_invoice_id
ON public.logistics_transport_orders
FOR EACH ROW EXECUTE FUNCTION public.log_order_invoice_revenue();

-- New: invoice the container owner for a single order
CREATE OR REPLACE FUNCTION public.logistics_invoice_container_owner(_order_id uuid)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  _o logistics_transport_orders%ROWTYPE;
  _c customers%ROWTYPE;
  _inv_id uuid;
  _curr text;
  _amt numeric(14,2);
BEGIN
  SELECT * INTO _o FROM logistics_transport_orders WHERE id=_order_id AND organization_id=current_org_id();
  IF _o.id IS NULL THEN RAISE EXCEPTION 'order_not_found'; END IF;
  IF _o.container_owner_customer_id IS NULL THEN RAISE EXCEPTION 'no_container_owner_on_order'; END IF;
  IF _o.container_owner_invoice_id IS NOT NULL THEN RAISE EXCEPTION 'owner_already_invoiced'; END IF;
  _amt := COALESCE(_o.container_owner_charge, 0);
  IF _amt <= 0 THEN RAISE EXCEPTION 'owner_charge_must_be_positive'; END IF;

  SELECT * INTO _c FROM customers WHERE id=_o.container_owner_customer_id;
  _curr := COALESCE(_o.container_owner_currency, _o.currency);

  INSERT INTO invoices(
    organization_id, invoice_number, customer_name, customer_reference,
    invoice_type, subtotal, tax_rate, tax_amount, total_amount, currency,
    status, issued_at, due_at, notes
  ) VALUES (
    current_org_id(),
    'LOG-OWN-' || to_char(now(),'YYMMDD-HH24MISS'),
    _c.company_name, _c.id::text, 'other',
    _amt, 0, 0, _amt, COALESCE(_curr,'USD'),
    'issued', now(), now() + interval '30 days',
    'Container owner charge — order ' || _o.ref
  ) RETURNING id INTO _inv_id;

  UPDATE logistics_transport_orders
    SET container_owner_invoice_id=_inv_id, updated_at=now()
  WHERE id=_order_id;

  RETURN _inv_id;
END $$;

REVOKE ALL ON FUNCTION public.logistics_invoice_container_owner(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.logistics_invoice_container_owner(uuid) TO authenticated, service_role;

-- Batch billing: currency-aware overload (existing 3-arg signature preserved)
CREATE OR REPLACE FUNCTION public.logistics_run_batch_billing(
  _customer_id uuid, _from date, _to date, _currency text
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  _customer customers%ROWTYPE;
  _total numeric(14,2) := 0;
  _invoice_id uuid;
  _curr text := UPPER(_currency);
BEGIN
  SELECT * INTO _customer FROM customers WHERE id=_customer_id AND organization_id=current_org_id();
  IF _customer.id IS NULL THEN RAISE EXCEPTION 'customer_not_found'; END IF;

  SELECT COALESCE(SUM(quoted_price),0) INTO _total
  FROM logistics_transport_orders
  WHERE organization_id=current_org_id()
    AND customer_id=_customer_id
    AND UPPER(COALESCE(currency,'USD'))=_curr
    AND status='delivered'
    AND invoice_id IS NULL
    AND service_date BETWEEN _from AND _to;

  IF _total <= 0 THEN RAISE EXCEPTION 'nothing_to_invoice'; END IF;

  INSERT INTO invoices(
    organization_id, invoice_number, customer_name, customer_reference,
    invoice_type, subtotal, tax_rate, tax_amount, total_amount, currency,
    status, issued_at, due_at, notes
  ) VALUES (
    current_org_id(),
    'LOG-BATCH-' || to_char(now(),'YYMMDD-HH24MISS'),
    _customer.company_name, _customer.id::text, 'other',
    _total, 0, 0, _total, _curr,
    'issued', now(), now() + interval '30 days',
    'Logistics batch billing ' || _from || ' → ' || _to || ' (' || _curr || ')'
  ) RETURNING id INTO _invoice_id;

  UPDATE logistics_transport_orders
    SET invoice_id=_invoice_id, status='invoiced', updated_at=now()
  WHERE organization_id=current_org_id()
    AND customer_id=_customer_id
    AND UPPER(COALESCE(currency,'USD'))=_curr
    AND status='delivered'
    AND invoice_id IS NULL
    AND service_date BETWEEN _from AND _to;

  INSERT INTO logistics_trip_revenue(organization_id, trip_id, transport_order_id, amount, currency, invoice_id)
  SELECT DISTINCT current_org_id(), l.trip_id, o.id, o.quoted_price, o.currency, _invoice_id
  FROM logistics_transport_orders o
  JOIN logistics_trip_legs l ON l.transport_order_id=o.id
  WHERE o.invoice_id=_invoice_id;

  RETURN _invoice_id;
END $$;

REVOKE ALL ON FUNCTION public.logistics_run_batch_billing(uuid,date,date,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.logistics_run_batch_billing(uuid,date,date,text) TO authenticated, service_role;
