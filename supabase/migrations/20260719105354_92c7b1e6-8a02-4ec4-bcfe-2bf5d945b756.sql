
-- EIR: transport details + new release purposes + indemnity
ALTER TABLE public.eir_records
  ADD COLUMN IF NOT EXISTS origin_location text,
  ADD COLUMN IF NOT EXISTS nominated_depot text,
  ADD COLUMN IF NOT EXISTS truck_plate text,
  ADD COLUMN IF NOT EXISTS driver_name text,
  ADD COLUMN IF NOT EXISTS driver_phone text,
  ADD COLUMN IF NOT EXISTS transporter_company text,
  ADD COLUMN IF NOT EXISTS transporter_indemnity_signed boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS transporter_indemnity_signed_at timestamptz,
  ADD COLUMN IF NOT EXISTS transporter_indemnity_signer text;

-- Container Sales: link to customer registry for currency + party integrity
ALTER TABLE public.container_sales
  ADD COLUMN IF NOT EXISTS customer_id uuid REFERENCES public.customers(id);

-- Backfill customer_id from buyer_name (case-insensitive) within org.
UPDATE public.container_sales cs
   SET customer_id = c.id
  FROM public.customers c
 WHERE cs.customer_id IS NULL
   AND c.organization_id = cs.organization_id
   AND lower(btrim(c.company_name)) = lower(btrim(cs.buyer_name));

-- Currency stamping trigger: when a customer is linked, prefer their currency.
CREATE OR REPLACE FUNCTION public.set_container_sale_currency_from_customer()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
DECLARE _cur text;
BEGIN
  IF NEW.customer_id IS NOT NULL THEN
    SELECT NULLIF(btrim(currency),'') INTO _cur FROM public.customers WHERE id = NEW.customer_id;
    IF _cur IS NOT NULL THEN
      NEW.currency := _cur;
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_container_sale_currency_from_customer ON public.container_sales;
CREATE TRIGGER trg_container_sale_currency_from_customer
BEFORE INSERT OR UPDATE OF customer_id ON public.container_sales
FOR EACH ROW EXECUTE FUNCTION public.set_container_sale_currency_from_customer();

-- Backfill: restamp currency for sales that have a linked customer with a currency.
UPDATE public.container_sales cs
   SET currency = c.currency
  FROM public.customers c
 WHERE cs.customer_id = c.id
   AND NULLIF(btrim(c.currency),'') IS NOT NULL
   AND cs.status <> 'sold'
   AND (cs.currency IS NULL OR cs.currency <> c.currency);

-- Repat: one-shot RPC to restamp currency on a draft REP-* invoice from the owner registry.
CREATE OR REPLACE FUNCTION public.restamp_repatriation_invoice_currency(_repatriation_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _org uuid;
  _rep record;
  _owner text;
  _new_cur text;
  _inv record;
BEGIN
  SELECT * INTO _rep FROM public.repatriations WHERE id = _repatriation_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'repatriation_not_found'; END IF;
  _org := _rep.organization_id;

  IF NOT (public.is_platform_admin()
       OR public.has_role(auth.uid(),'admin'::app_role)
       OR public.has_role(auth.uid(),'org_owner'::app_role)) THEN
    RAISE EXCEPTION 'forbidden_role';
  END IF;

  SELECT owner INTO _owner FROM public.containers WHERE id = _rep.container_id;
  IF _owner IS NULL OR btrim(_owner) = '' THEN
    RAISE EXCEPTION 'owner_missing';
  END IF;

  -- Prefer customer currency; fall back to supplier; then org default.
  SELECT NULLIF(btrim(currency),'') INTO _new_cur
    FROM public.customers
   WHERE organization_id = _org AND lower(btrim(company_name)) = lower(btrim(_owner))
   LIMIT 1;

  IF _new_cur IS NULL THEN
    SELECT NULLIF(btrim(currency),'') INTO _new_cur
      FROM public.suppliers
     WHERE organization_id = _org AND lower(btrim(name)) = lower(btrim(_owner))
     LIMIT 1;
  END IF;

  IF _new_cur IS NULL THEN
    SELECT currency INTO _new_cur FROM public.organizations WHERE id = _org;
  END IF;

  SELECT * INTO _inv FROM public.invoices
   WHERE organization_id = _org AND invoice_number = 'REP-' || _rep.repatriation_number
   LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'invoice_not_found'; END IF;
  IF _inv.status <> 'draft' THEN RAISE EXCEPTION 'invoice_not_draft'; END IF;

  UPDATE public.invoices SET currency = _new_cur WHERE id = _inv.id;
  RETURN _new_cur;
END $$;

REVOKE ALL ON FUNCTION public.restamp_repatriation_invoice_currency(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.restamp_repatriation_invoice_currency(uuid) TO authenticated;
