
-- 1. Add handling fee to tariffs (optional)
ALTER TABLE public.tariffs
  ADD COLUMN IF NOT EXISTS handling_fee numeric NOT NULL DEFAULT 0;

-- 2. Helper: find or create a customer for a container's owner (text)
CREATE OR REPLACE FUNCTION public.find_or_create_customer_by_name(_org uuid, _name text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _cid uuid;
  _org_currency text;
BEGIN
  IF _name IS NULL OR length(btrim(_name)) = 0 THEN
    RETURN NULL;
  END IF;
  SELECT id INTO _cid
  FROM public.customers
  WHERE organization_id = _org
    AND lower(btrim(company_name)) = lower(btrim(_name))
  LIMIT 1;
  IF _cid IS NOT NULL THEN RETURN _cid; END IF;

  SELECT currency INTO _org_currency FROM public.organizations WHERE id = _org;
  INSERT INTO public.customers (organization_id, company_name, customer_type, currency, is_active, created_by)
  VALUES (_org, btrim(_name), 'company', COALESCE(_org_currency, 'USD'), true, auth.uid())
  RETURNING id INTO _cid;
  RETURN _cid;
END;
$$;

-- 3. Main RPC
CREATE OR REPLACE FUNCTION public.bill_repatriation_to_owner(_repatriation_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _rep record;
  _c   record;
  _org uuid;
  _owner text;
  _customer_id uuid;
  _customer_currency text;
  _currency text;

  _gate_in_amt numeric := 0;
  _storage_amt numeric := 0;
  _handling_amt numeric := 0;
  _repat_amt numeric := 0;

  _dwell_days int := 0;
  _billable_days int := 0;
  _rate_per_day numeric := 0;
  _free_days int := 0;
  _gate_out_at timestamptz;

  _tariff record;
  _invoice_id uuid;
  _existing_invoice uuid;
  _invoice_number text;
  _subtotal numeric := 0;
BEGIN
  SELECT * INTO _rep FROM public.repatriations WHERE id = _repatriation_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'repatriation_not_found'; END IF;

  _org := _rep.organization_id;

  -- Role check
  IF NOT (
    public.is_platform_admin()
    OR public.has_role(auth.uid(),'admin'::app_role)
    OR public.has_role(auth.uid(),'yard_operator'::app_role)
    OR public.has_role(auth.uid(),'gate_clerk'::app_role)
  ) THEN
    RAISE EXCEPTION 'forbidden_role';
  END IF;

  IF _rep.container_id IS NULL THEN
    RAISE EXCEPTION 'repatriation_no_container';
  END IF;

  SELECT * INTO _c FROM public.containers WHERE id = _rep.container_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'container_not_found'; END IF;

  _owner := btrim(COALESCE(_c.owner, ''));
  IF _owner = '' THEN
    RAISE EXCEPTION 'repatriation_owner_missing';
  END IF;

  -- Idempotent check by deterministic invoice number
  _invoice_number := 'REP-' || _rep.repatriation_number;
  SELECT id INTO _existing_invoice FROM public.invoices
    WHERE organization_id = _org AND invoice_number = _invoice_number
    LIMIT 1;
  IF _existing_invoice IS NOT NULL THEN
    RAISE EXCEPTION 'repatriation_already_invoiced';
  END IF;

  -- Resolve customer & currency
  _customer_id := public.find_or_create_customer_by_name(_org, _owner);
  SELECT currency INTO _customer_currency FROM public.customers WHERE id = _customer_id;
  _currency := COALESCE(NULLIF(btrim(_customer_currency),''),
                        (SELECT currency FROM public.organizations WHERE id = _org),
                        'USD');

  -- Lookup active tariff row (size + category + height class)
  SELECT t.* INTO _tariff
  FROM public.tariffs t
  WHERE t.organization_id = _org
    AND t.is_active = true
    AND t.container_size = _c.size::text
    AND t.container_category = _c.category::text
    AND (t.container_category <> 'dry' OR t.height_class::text = COALESCE(_c.height_class::text, 'LC'))
  ORDER BY t.updated_at DESC
  LIMIT 1;

  -- 1. Gate-in fee
  IF _tariff.id IS NOT NULL THEN
    _gate_in_amt := COALESCE(_tariff.gate_in_fee, 0);
    _handling_amt := COALESCE(_tariff.handling_fee, 0);
    _rate_per_day := COALESCE(_tariff.rate_per_day, 0);
    _free_days   := COALESCE(_tariff.free_days, 0);
  END IF;

  -- 2. Storage / dwell
  _gate_out_at := COALESCE(_rep.dispatched_at, _c.gate_out_at, now());
  IF _c.gate_in_at IS NOT NULL AND _gate_out_at IS NOT NULL AND _rate_per_day > 0 THEN
    _dwell_days := GREATEST(0, CEIL(EXTRACT(EPOCH FROM (_gate_out_at - _c.gate_in_at)) / 86400.0)::int);
    _billable_days := GREATEST(0, _dwell_days - _free_days);
    _storage_amt := _rate_per_day * _billable_days;
  END IF;

  -- 4. Repat fee (from repatriations.charge_amount)
  _repat_amt := COALESCE(_rep.charge_amount, 0);

  _subtotal := _gate_in_amt + _storage_amt + _handling_amt + _repat_amt;
  IF _subtotal <= 0 THEN
    RAISE EXCEPTION 'repatriation_nothing_to_bill';
  END IF;

  -- Insert invoice header
  INSERT INTO public.invoices (
    invoice_number, customer_name, container_id, invoice_type,
    subtotal, tax_rate, tax_amount, total_amount, currency, status,
    created_by, organization_id, source_eir_id, notes
  ) VALUES (
    _invoice_number, _owner, _c.id, 'other',
    _subtotal, 0, 0, _subtotal, _currency, 'draft',
    auth.uid(), _org, _rep.eir_id,
    'Repatriation invoice for ' || _rep.repatriation_number
  ) RETURNING id INTO _invoice_id;

  -- Insert line items (skip zero-value lines)
  IF _gate_in_amt > 0 THEN
    INSERT INTO public.invoice_line_items (invoice_id, description, quantity, unit_price, total_price, charge_type, organization_id)
    VALUES (_invoice_id, 'Gate-in fee – ' || _c.container_number, 1, _gate_in_amt, _gate_in_amt, 'gate_fee', _org);
  END IF;
  IF _storage_amt > 0 THEN
    INSERT INTO public.invoice_line_items (invoice_id, description, quantity, unit_price, total_price, charge_type, organization_id, period_from, period_to)
    VALUES (_invoice_id,
            'Storage – ' || _c.container_number || ' (' || _billable_days || ' billable days, ' || _dwell_days || ' dwell)',
            _billable_days, _rate_per_day, _storage_amt, 'storage', _org, _c.gate_in_at, _gate_out_at);
  END IF;
  IF _handling_amt > 0 THEN
    INSERT INTO public.invoice_line_items (invoice_id, description, quantity, unit_price, total_price, charge_type, organization_id)
    VALUES (_invoice_id, 'Handling – ' || _c.container_number, 1, _handling_amt, _handling_amt, 'handling', _org);
  END IF;
  IF _repat_amt > 0 THEN
    INSERT INTO public.invoice_line_items (invoice_id, description, quantity, unit_price, total_price, charge_type, organization_id)
    VALUES (_invoice_id, 'Repatriation fee – ' || _rep.repatriation_number, 1, _repat_amt, _repat_amt, 'other', _org);
  END IF;

  PERFORM public.log_org_event(_org, 'repatriation_invoiced',
    jsonb_build_object(
      'invoice_id', _invoice_id,
      'invoice_number', _invoice_number,
      'repatriation_id', _repatriation_id,
      'repatriation_number', _rep.repatriation_number,
      'container_id', _c.id,
      'container_number', _c.container_number,
      'owner', _owner,
      'currency', _currency,
      'total', _subtotal,
      'gate_in', _gate_in_amt,
      'storage', _storage_amt,
      'storage_days', _billable_days,
      'handling', _handling_amt,
      'repat_fee', _repat_amt
    ));

  RETURN _invoice_id;
END;
$$;

-- 4. Preview function (read-only) so the UI can show computed lines before completion
CREATE OR REPLACE FUNCTION public.preview_repatriation_bill(_repatriation_id uuid)
RETURNS TABLE(gate_in numeric, storage numeric, storage_days int, handling numeric, repat_fee numeric, currency text, owner text, already_invoiced boolean)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _rep record; _c record; _tariff record;
  _org uuid; _owner text;
  _currency text; _customer_currency text;
  _rate numeric := 0; _free int := 0;
  _dwell int := 0; _billable int := 0;
  _gate_out_at timestamptz;
  _existing uuid;
BEGIN
  SELECT * INTO _rep FROM public.repatriations WHERE id = _repatriation_id;
  IF NOT FOUND THEN RETURN; END IF;
  _org := _rep.organization_id;
  IF _rep.container_id IS NULL THEN RETURN; END IF;
  SELECT * INTO _c FROM public.containers WHERE id = _rep.container_id;
  IF NOT FOUND THEN RETURN; END IF;
  _owner := btrim(COALESCE(_c.owner,''));

  SELECT c.currency INTO _customer_currency FROM public.customers c
    WHERE c.organization_id = _org AND lower(btrim(c.company_name)) = lower(_owner)
    LIMIT 1;
  _currency := COALESCE(NULLIF(_customer_currency,''),
                        (SELECT o.currency FROM public.organizations o WHERE o.id = _org),
                        'USD');

  SELECT t.* INTO _tariff
  FROM public.tariffs t
  WHERE t.organization_id = _org AND t.is_active = true
    AND t.container_size = _c.size::text AND t.container_category = _c.category::text
    AND (t.container_category <> 'dry' OR t.height_class::text = COALESCE(_c.height_class::text,'LC'))
  ORDER BY t.updated_at DESC LIMIT 1;

  _rate := COALESCE(_tariff.rate_per_day, 0);
  _free := COALESCE(_tariff.free_days, 0);
  _gate_out_at := COALESCE(_rep.dispatched_at, _c.gate_out_at, now());
  IF _c.gate_in_at IS NOT NULL AND _rate > 0 THEN
    _dwell := GREATEST(0, CEIL(EXTRACT(EPOCH FROM (_gate_out_at - _c.gate_in_at)) / 86400.0)::int);
    _billable := GREATEST(0, _dwell - _free);
  END IF;

  SELECT id INTO _existing FROM public.invoices
    WHERE organization_id = _org AND invoice_number = 'REP-' || _rep.repatriation_number LIMIT 1;

  RETURN QUERY SELECT
    COALESCE(_tariff.gate_in_fee, 0)::numeric,
    (_rate * _billable)::numeric,
    _billable,
    COALESCE(_tariff.handling_fee, 0)::numeric,
    COALESCE(_rep.charge_amount, 0)::numeric,
    _currency,
    _owner,
    (_existing IS NOT NULL);
END;
$$;

GRANT EXECUTE ON FUNCTION public.bill_repatriation_to_owner(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.preview_repatriation_bill(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.find_or_create_customer_by_name(uuid, text) TO authenticated;
