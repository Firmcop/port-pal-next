-- Update owner billing to honour repat-level handling and name the route
CREATE OR REPLACE FUNCTION public.bill_repatriation_to_owner(_repatriation_id uuid)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  _rep record; _c record; _org uuid; _owner text;
  _customer_id uuid; _customer_currency text; _currency text;
  _gate_in_amt numeric := 0; _storage_amt numeric := 0;
  _handling_amt numeric := 0; _repat_amt numeric := 0;
  _dwell_days int := 0; _billable_days int := 0;
  _rate_per_day numeric := 0; _free_days int := 0;
  _gate_out_at timestamptz;
  _tariff record; _invoice_id uuid; _existing_invoice uuid;
  _invoice_number text; _subtotal numeric := 0;
  _route text;
BEGIN
  SELECT * INTO _rep FROM public.repatriations WHERE id = _repatriation_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'repatriation_not_found'; END IF;
  _org := _rep.organization_id;

  IF NOT (
    public.is_platform_admin()
    OR public.has_role(auth.uid(),'admin'::app_role)
    OR public.has_role(auth.uid(),'yard_operator'::app_role)
    OR public.has_role(auth.uid(),'gate_clerk'::app_role)
  ) THEN
    RAISE EXCEPTION 'forbidden_role';
  END IF;

  IF _rep.container_id IS NULL THEN RAISE EXCEPTION 'repatriation_no_container'; END IF;
  SELECT * INTO _c FROM public.containers WHERE id = _rep.container_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'container_not_found'; END IF;

  _owner := btrim(COALESCE(_c.owner, ''));
  IF _owner = '' THEN RAISE EXCEPTION 'repatriation_owner_missing'; END IF;

  _invoice_number := 'REP-' || _rep.repatriation_number;
  SELECT id INTO _existing_invoice FROM public.invoices
    WHERE organization_id = _org AND invoice_number = _invoice_number LIMIT 1;
  IF _existing_invoice IS NOT NULL THEN RAISE EXCEPTION 'repatriation_already_invoiced'; END IF;

  _customer_id := public.find_or_create_customer_by_name(_org, _owner);
  SELECT currency INTO _customer_currency FROM public.customers WHERE id = _customer_id;
  _currency := COALESCE(NULLIF(btrim(_customer_currency),''),
                        (SELECT currency FROM public.organizations WHERE id = _org), 'USD');

  SELECT t.* INTO _tariff
  FROM public.tariffs t
  WHERE t.organization_id = _org AND t.is_active = true
    AND t.container_size = _c.size::text AND t.container_category = _c.category::text
    AND (t.container_category <> 'dry' OR t.height_class::text = COALESCE(_c.height_class::text,'LC'))
  ORDER BY t.updated_at DESC LIMIT 1;

  IF _tariff.id IS NOT NULL THEN
    _gate_in_amt := COALESCE(_tariff.gate_in_fee, 0);
    _rate_per_day := COALESCE(_tariff.rate_per_day, 0);
    _free_days := COALESCE(_tariff.free_days, 0);
  END IF;
  _handling_amt := COALESCE(_rep.handling_amount, _tariff.handling_fee, 0);

  _gate_out_at := COALESCE(_rep.dispatched_at, _c.gate_out_at, now());
  IF _c.gate_in_at IS NOT NULL AND _gate_out_at IS NOT NULL AND _rate_per_day > 0 THEN
    _dwell_days := GREATEST(0, CEIL(EXTRACT(EPOCH FROM (_gate_out_at - _c.gate_in_at)) / 86400.0)::int);
    _billable_days := GREATEST(0, _dwell_days - _free_days);
    _storage_amt := _rate_per_day * _billable_days;
  END IF;

  _repat_amt := COALESCE(_rep.charge_amount, 0);
  _route := NULLIF(btrim(COALESCE(_rep.origin,'') || CASE WHEN COALESCE(_rep.origin,'') <> '' THEN ' → ' ELSE '' END || COALESCE(_rep.destination,'')), '');

  _subtotal := _gate_in_amt + _storage_amt + _handling_amt + _repat_amt;
  IF _subtotal <= 0 THEN RAISE EXCEPTION 'repatriation_nothing_to_bill'; END IF;

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
    VALUES (_invoice_id, 'Repat handling – ' || _c.container_number, 1, _handling_amt, _handling_amt, 'handling', _org);
  END IF;
  IF _repat_amt > 0 THEN
    INSERT INTO public.invoice_line_items (invoice_id, description, quantity, unit_price, total_price, charge_type, organization_id)
    VALUES (_invoice_id,
            'Repatriation transport' || COALESCE(' – ' || _route, '') || ' (' || _rep.repatriation_number || ')',
            1, _repat_amt, _repat_amt, 'other', _org);
  END IF;

  PERFORM public.log_org_event(_org, 'repatriation_invoiced',
    jsonb_build_object('invoice_id', _invoice_id, 'invoice_number', _invoice_number,
      'repatriation_id', _repatriation_id, 'repatriation_number', _rep.repatriation_number,
      'container_id', _c.id, 'container_number', _c.container_number, 'owner', _owner,
      'currency', _currency, 'total', _subtotal, 'gate_in', _gate_in_amt,
      'storage', _storage_amt, 'storage_days', _billable_days,
      'handling', _handling_amt, 'repat_fee', _repat_amt, 'route', _route));

  RETURN _invoice_id;
END;
$function$;

-- Apply a rate card to a repatriation
CREATE OR REPLACE FUNCTION public.apply_repat_rate_card(
  _repatriation_id uuid, _rate_card_id uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  _rep record; _card record; _size text;
BEGIN
  SELECT * INTO _rep FROM public.repatriations WHERE id = _repatriation_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'repatriation_not_found'; END IF;
  IF NOT (public.is_platform_admin()
          OR (_rep.organization_id = public.current_org_id()
              AND (public.has_role(auth.uid(),'admin'::app_role)
                   OR public.has_role(auth.uid(),'yard_operator'::app_role)))) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  SELECT c.size::text INTO _size FROM public.containers c WHERE c.id = _rep.container_id;

  IF _rate_card_id IS NOT NULL THEN
    SELECT * INTO _card FROM public.repat_rate_cards
      WHERE id = _rate_card_id AND organization_id = _rep.organization_id;
  ELSE
    SELECT rc.* INTO _card FROM public.repat_rate_cards rc
    WHERE rc.organization_id = _rep.organization_id AND rc.is_active
      AND rc.container_size = COALESCE(_size, rc.container_size)
      AND lower(btrim(rc.destination)) = lower(btrim(COALESCE(_rep.destination,'')))
      AND (NULLIF(btrim(COALESCE(_rep.origin,'')),'') IS NULL
           OR lower(btrim(rc.origin)) = lower(btrim(_rep.origin)))
      AND (rc.shipping_line IS NULL
           OR lower(btrim(rc.shipping_line)) = lower(btrim(COALESCE(_rep.shipping_line,''))))
      AND rc.effective_from <= CURRENT_DATE
      AND (rc.effective_to IS NULL OR rc.effective_to >= CURRENT_DATE)
    ORDER BY (rc.shipping_line IS NOT NULL) DESC, rc.effective_from DESC
    LIMIT 1;
  END IF;

  IF _card.id IS NULL THEN RAISE EXCEPTION 'repat_rate_card_not_found'; END IF;

  UPDATE public.repatriations
     SET rate_card_id = _card.id,
         charge_amount = _card.rate_amount,
         handling_amount = _card.handling_fee,
         origin = COALESCE(NULLIF(btrim(origin),''), _card.origin)
   WHERE id = _repatriation_id;

  RETURN _card.id;
END;
$$;

REVOKE ALL ON FUNCTION public.apply_repat_rate_card(uuid,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.apply_repat_rate_card(uuid,uuid) TO authenticated, service_role;

-- Set execution mode (own truck / subcontracted)
CREATE OR REPLACE FUNCTION public.set_repatriation_execution(
  _repatriation_id uuid,
  _mode text,
  _carrier_id uuid DEFAULT NULL,
  _carrier_cost numeric DEFAULT 0,
  _trip_id uuid DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  _rep record; _rev numeric;
BEGIN
  IF _mode NOT IN ('own_truck','subcontracted') THEN RAISE EXCEPTION 'invalid_execution_mode'; END IF;
  SELECT * INTO _rep FROM public.repatriations WHERE id = _repatriation_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'repatriation_not_found'; END IF;
  IF NOT (public.is_platform_admin()
          OR (_rep.organization_id = public.current_org_id()
              AND (public.has_role(auth.uid(),'admin'::app_role)
                   OR public.has_role(auth.uid(),'yard_operator'::app_role)))) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  IF _mode = 'subcontracted' AND _carrier_id IS NULL THEN
    RAISE EXCEPTION 'carrier_required';
  END IF;

  UPDATE public.repatriations
     SET execution_mode = _mode,
         carrier_id = CASE WHEN _mode = 'subcontracted' THEN _carrier_id ELSE NULL END,
         carrier_cost = CASE WHEN _mode = 'subcontracted' THEN COALESCE(_carrier_cost,0) ELSE 0 END,
         trip_id = CASE WHEN _mode = 'own_truck' THEN _trip_id ELSE NULL END
   WHERE id = _repatriation_id;

  -- Own truck: make sure the repat revenue sits on the trip for cost sharing
  IF _mode = 'own_truck' AND _trip_id IS NOT NULL THEN
    _rev := COALESCE(_rep.charge_amount,0) + COALESCE(_rep.handling_amount,0);
    IF _rev > 0 AND NOT EXISTS (
      SELECT 1 FROM public.logistics_trip_revenue r
      WHERE r.trip_id = _trip_id AND r.transport_order_id IS NULL
    ) THEN
      INSERT INTO public.logistics_trip_revenue (organization_id, trip_id, amount)
      VALUES (_rep.organization_id, _trip_id, _rev);
    END IF;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.set_repatriation_execution(uuid,text,uuid,numeric,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_repatriation_execution(uuid,text,uuid,numeric,uuid) TO authenticated, service_role;