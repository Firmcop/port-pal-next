CREATE OR REPLACE FUNCTION public.set_container_acquisition_costs(
  _container_id uuid,
  _purchase numeric,
  _transport numeric,
  _transport_vendor text,
  _offloading numeric,
  _offloading_vendor text,
  _currency text,
  _reason text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _org uuid := current_org_id();
  _cur text := upper(COALESCE(NULLIF(btrim(COALESCE(_currency,'')),''),'USD'));
  _why text := btrim(COALESCE(_reason,''));
  _cnum text; _owner text;
  _result jsonb := '{}'::jsonb;
  _kinds text[] := ARRAY['purchase','acquisition_transport','acquisition_crane_offloading'];
  _k text; _target numeric; _vendor text;
  _inv RECORD; _delta numeric; _outcome text; _new_po uuid;
BEGIN
  IF _container_id IS NULL THEN RAISE EXCEPTION 'Container is required'; END IF;
  IF _why = '' THEN RAISE EXCEPTION 'A reason is required'; END IF;
  IF NOT (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'org_owner') OR public.is_platform_admin()) THEN
    RAISE EXCEPTION 'Only admins can edit acquisition costs';
  END IF;

  SELECT container_number, owner INTO _cnum, _owner
    FROM public.containers WHERE id = _container_id AND organization_id = _org;
  IF _cnum IS NULL THEN RAISE EXCEPTION 'Container not found in this organization'; END IF;

  FOREACH _k IN ARRAY _kinds LOOP
    _target := ROUND(GREATEST(COALESCE(
                 CASE _k WHEN 'purchase' THEN _purchase
                         WHEN 'acquisition_transport' THEN _transport
                         ELSE _offloading END, 0), 0), 2);
    _vendor := btrim(COALESCE(
                 CASE _k WHEN 'purchase' THEN _owner
                         WHEN 'acquisition_transport' THEN _transport_vendor
                         ELSE _offloading_vendor END, ''));
    _outcome := 'unchanged';

    SELECT si.* INTO _inv
      FROM public.supplier_invoices si
     WHERE si.organization_id = _org
       AND si.container_id = _container_id
       AND si.reason = _k
       AND lower(si.status) NOT IN ('cancelled','void','credited')
     ORDER BY si.created_at DESC LIMIT 1;

    IF NOT FOUND THEN
      IF _target > 0 AND _vendor <> '' THEN
        IF _k = 'purchase' THEN
          PERFORM public.acquire_container_from_owner(_container_id, _target, _cur, 'acquisition_cost_edit', _cnum);
          _outcome := 'created';
        ELSE
          _new_po := public.record_container_service_invoice(
            _container_id, _vendor, _target, _cur,
            CASE WHEN _k = 'acquisition_transport' THEN 'transport' ELSE 'crane_offloading' END,
            _cnum);
          _outcome := CASE WHEN _new_po IS NULL THEN 'skipped' ELSE 'created' END;
        END IF;
      END IF;
    ELSE
      _delta := _target - COALESCE(_inv.total_amount,0);
      IF _target <= 0 THEN
        UPDATE public.supplier_invoices SET status = 'cancelled', updated_at = now()
          WHERE id = _inv.id;
        INSERT INTO public.accounting_transactions (
          transaction_number, account_type, category, description,
          debit_amount, credit_amount, reference_type, reference_id, organization_id, currency)
        VALUES ('TXN-APADJ-' || substr(replace(gen_random_uuid()::text,'-',''),1,10),
          'liability','container_acquisition_payable',
          'Acquisition cost cancelled — ' || _cnum || ' (' || _inv.invoice_number || '): ' || _why,
          COALESCE(_inv.total_amount,0), 0, 'supplier_invoices', _inv.id, _org, _inv.currency);
        _outcome := 'cancelled';
      ELSIF ROUND(_delta,2) <> 0 THEN
        UPDATE public.supplier_invoices
           SET subtotal = _target, total_amount = _target, updated_at = now()
         WHERE id = _inv.id;
        UPDATE public.supplier_invoice_lines
           SET unit_price = _target, line_total = _target, quantity = 1
         WHERE invoice_id = _inv.id;
        IF _inv.purchase_order_id IS NOT NULL THEN
          UPDATE public.purchase_orders SET total_cost = _target WHERE id = _inv.purchase_order_id;
          UPDATE public.po_items SET unit_price = _target, total_cost = _target, quantity = 1
           WHERE po_id = _inv.purchase_order_id;
        END IF;
        INSERT INTO public.accounting_transactions (
          transaction_number, account_type, category, description,
          debit_amount, credit_amount, reference_type, reference_id, organization_id, currency)
        VALUES ('TXN-APADJ-' || substr(replace(gen_random_uuid()::text,'-',''),1,10),
          'liability','container_acquisition_payable',
          'Acquisition cost adjustment — ' || _cnum || ' (' || _inv.invoice_number || '): ' || _why,
          CASE WHEN _delta < 0 THEN -_delta ELSE 0 END,
          CASE WHEN _delta > 0 THEN _delta ELSE 0 END,
          'supplier_invoices', _inv.id, _org, _inv.currency);
        _outcome := 'adjusted';
      END IF;

      IF _outcome <> 'unchanged' THEN
        INSERT INTO public.finance_audit_log (organization_id, actor_user_id, entity_type, entity_id, entity_ref, action, summary, before_data, after_data)
        VALUES (_org, auth.uid(), 'supplier_invoices', _inv.id, _inv.invoice_number,
          'container_acquisition_cost_edit',
          jsonb_build_object('container_id', _container_id, 'container_number', _cnum,
            'component', _k, 'reason', _why, 'outcome', _outcome),
          jsonb_build_object('total_amount', _inv.total_amount, 'currency', _inv.currency, 'status', _inv.status),
          jsonb_build_object('total_amount', _target, 'currency', _inv.currency));
      END IF;
    END IF;

    _result := _result || jsonb_build_object(_k, jsonb_build_object('amount', _target, 'outcome', _outcome));
  END LOOP;

  UPDATE public.containers
     SET acquisition_cost = ROUND(GREATEST(COALESCE(_purchase,0),0),2),
         transport_cost = ROUND(GREATEST(COALESCE(_transport,0),0),2),
         offloading_cost = ROUND(GREATEST(COALESCE(_offloading,0),0),2),
         transport_vendor = NULLIF(btrim(COALESCE(_transport_vendor,'')),''),
         offloading_vendor = NULLIF(btrim(COALESCE(_offloading_vendor,'')),''),
         acquisition_currency = _cur
   WHERE id = _container_id AND organization_id = _org;

  INSERT INTO public.finance_audit_log (organization_id, actor_user_id, entity_type, entity_id, entity_ref, action, summary)
  VALUES (_org, auth.uid(), 'containers', _container_id, _cnum, 'container_acquisition_cost_edit',
    jsonb_build_object('reason', _why, 'currency', _cur, 'components', _result));

  RETURN _result;
END $function$;

REVOKE ALL ON FUNCTION public.set_container_acquisition_costs(uuid,numeric,numeric,text,numeric,text,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_container_acquisition_costs(uuid,numeric,numeric,text,numeric,text,text,text) TO authenticated;