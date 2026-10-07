-- Allow the acquisition cost editor to change a purchase invoice's currency
-- (sets the transaction-scoped override the lock trigger requires + audits it).
CREATE OR REPLACE FUNCTION public.set_container_acquisition_costs(
  _container_id uuid,
  _purchase numeric,
  _transport numeric,
  _transport_vendor text,
  _offloading numeric,
  _offloading_vendor text,
  _currency text,
  _reason text,
  _purchase_currency text DEFAULT NULL,
  _transport_currency text DEFAULT NULL,
  _offloading_currency text DEFAULT NULL,
  _purchase_fx numeric DEFAULT NULL,
  _transport_fx numeric DEFAULT NULL,
  _offloading_fx numeric DEFAULT NULL,
  _transport_supplier_id uuid DEFAULT NULL,
  _offloading_supplier_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _org uuid := current_org_id();
  _cur text := upper(COALESCE(NULLIF(btrim(COALESCE(_currency,'')),''),'USD'));
  _why text := btrim(COALESCE(_reason,''));
  _cnum text; _owner text;
  _tvendor text; _ovendor text;
  _result jsonb := '{}'::jsonb;
  _kinds text[] := ARRAY['purchase','acquisition_transport','acquisition_crane_offloading'];
  _k text; _target numeric; _vendor text; _kcur text;
  _inv RECORD; _delta numeric; _outcome text; _new_po uuid;
  _manual numeric; _rate numeric; _base numeric; _src text; _fx jsonb;
  _orgcur text; _touched uuid;
BEGIN
  IF _container_id IS NULL THEN RAISE EXCEPTION 'Container is required'; END IF;
  IF _why = '' THEN RAISE EXCEPTION 'A reason is required'; END IF;
  IF NOT (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'org_owner') OR public.is_platform_admin()) THEN
    RAISE EXCEPTION 'Only admins can edit acquisition costs';
  END IF;

  SELECT container_number, owner INTO _cnum, _owner
    FROM public.containers WHERE id = _container_id AND organization_id = _org;
  IF _cnum IS NULL THEN RAISE EXCEPTION 'Container not found in this organization'; END IF;

  SELECT upper(COALESCE(currency,'USD')) INTO _orgcur FROM public.organizations WHERE id = _org;
  _orgcur := COALESCE(_orgcur,'USD');

  -- supplier pickers win over free text
  _tvendor := btrim(COALESCE(_transport_vendor,''));
  _ovendor := btrim(COALESCE(_offloading_vendor,''));
  IF _transport_supplier_id IS NOT NULL THEN
    SELECT name INTO _tvendor FROM public.suppliers WHERE id = _transport_supplier_id AND organization_id = _org;
    _tvendor := btrim(COALESCE(_tvendor, btrim(COALESCE(_transport_vendor,''))));
  END IF;
  IF _offloading_supplier_id IS NOT NULL THEN
    SELECT name INTO _ovendor FROM public.suppliers WHERE id = _offloading_supplier_id AND organization_id = _org;
    _ovendor := btrim(COALESCE(_ovendor, btrim(COALESCE(_offloading_vendor,''))));
  END IF;

  FOREACH _k IN ARRAY _kinds LOOP
    _target := ROUND(GREATEST(COALESCE(
                 CASE _k WHEN 'purchase' THEN _purchase
                         WHEN 'acquisition_transport' THEN _transport
                         ELSE _offloading END, 0), 0), 2);
    _vendor := btrim(COALESCE(
                 CASE _k WHEN 'purchase' THEN _owner
                         WHEN 'acquisition_transport' THEN _tvendor
                         ELSE _ovendor END, ''));
    _kcur := upper(COALESCE(NULLIF(btrim(COALESCE(
                 CASE _k WHEN 'purchase' THEN _purchase_currency
                         WHEN 'acquisition_transport' THEN _transport_currency
                         ELSE _offloading_currency END, '')),''), _cur));
    _manual := NULLIF(CASE _k WHEN 'purchase' THEN _purchase_fx
                              WHEN 'acquisition_transport' THEN _transport_fx
                              ELSE _offloading_fx END, 0);
    IF _manual IS NOT NULL AND _manual <= 0 THEN _manual := NULL; END IF;
    _outcome := 'unchanged'; _touched := NULL;

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
          PERFORM public.acquire_container_from_owner(_container_id, _target, _kcur, 'acquisition_cost_edit', _cnum);
          _outcome := 'created';
        ELSE
          _new_po := public.record_container_service_invoice(
            _container_id, _vendor, _target, _kcur,
            CASE WHEN _k = 'acquisition_transport' THEN 'transport' ELSE 'crane_offloading' END,
            _cnum);
          _outcome := CASE WHEN _new_po IS NULL THEN 'skipped' ELSE 'created' END;
        END IF;
        SELECT si.id INTO _touched
          FROM public.supplier_invoices si
         WHERE si.organization_id = _org AND si.container_id = _container_id AND si.reason = _k
           AND lower(si.status) NOT IN ('cancelled','void','credited')
         ORDER BY si.created_at DESC LIMIT 1;
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
      ELSIF ROUND(_delta,2) <> 0 OR upper(COALESCE(_inv.currency,'')) <> _kcur
            OR (_manual IS NOT NULL AND ROUND(COALESCE(_inv.fx_rate,0),6) <> ROUND(_manual,6)) THEN
        IF upper(COALESCE(_inv.currency,'')) <> _kcur THEN
          IF lower(COALESCE(_inv.status,'')) IN ('paid','cancelled','void','credited') THEN
            RAISE EXCEPTION 'Invoice % is % — its currency can no longer be changed. Cancel it and raise a new one.',
              _inv.invoice_number, lower(COALESCE(_inv.status,''));
          END IF;
          -- The lock trigger on supplier_invoices forbids currency changes unless
          -- this transaction-scoped flag is set; audit the change like the
          -- dedicated override RPC does.
          PERFORM set_config('app.currency_override', 'true', true);
          INSERT INTO public.invoice_currency_audit (
            organization_id, invoice_kind, invoice_id, from_currency, to_currency, reason, changed_by)
          VALUES (_org, 'purchase', _inv.id, upper(COALESCE(_inv.currency,'')), _kcur,
                  'Acquisition cost edit — ' || _cnum || ': ' || _why, auth.uid());
        END IF;
        UPDATE public.supplier_invoices
           SET subtotal = _target, total_amount = _target, currency = _kcur, updated_at = now()
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
          'supplier_invoices', _inv.id, _org, _kcur);
        _outcome := 'adjusted';
      END IF;

      IF _outcome <> 'unchanged' THEN
        _touched := _inv.id;
        INSERT INTO public.finance_audit_log (organization_id, actor_user_id, entity_type, entity_id, entity_ref, action, summary, before_data, after_data)
        VALUES (_org, auth.uid(), 'supplier_invoices', _inv.id, _inv.invoice_number,
          'container_acquisition_cost_edit',
          jsonb_build_object('container_id', _container_id, 'container_number', _cnum,
            'component', _k, 'reason', _why, 'outcome', _outcome),
          jsonb_build_object('total_amount', _inv.total_amount, 'currency', _inv.currency, 'status', _inv.status),
          jsonb_build_object('total_amount', _target, 'currency', _kcur));
      END IF;
    END IF;

    -- valuation: manual rate wins, otherwise fall back to the rate table
    IF _touched IS NOT NULL AND _target > 0 THEN
      IF _kcur = _orgcur THEN
        _rate := 1; _src := 'auto';
      ELSIF _manual IS NOT NULL THEN
        _rate := _manual; _src := 'manual';
      ELSE
        _fx := public.get_fx_rate_detail(_org, _kcur, _orgcur, CURRENT_DATE);
        _rate := NULLIF((_fx->>'rate')::numeric, 0);
        _src := 'auto';
      END IF;

      IF _rate IS NOT NULL THEN
        _base := ROUND(_target * _rate, 2);
        UPDATE public.supplier_invoices
           SET fx_rate = _rate, base_amount = _base, fx_rate_source = _src, updated_at = now()
         WHERE id = _touched;
        UPDATE public.accounting_transactions SET fx_rate = _rate
         WHERE organization_id = _org AND reference_type = 'supplier_invoices' AND reference_id = _touched;

        IF _src = 'manual' THEN
          INSERT INTO public.finance_audit_log (
            organization_id, actor_user_id, actor_email, entity_type, entity_id, entity_ref,
            action, summary, after_data)
          VALUES (_org, auth.uid(), COALESCE(auth.jwt() ->> 'email','system'),
            'supplier_invoices', _touched, _cnum, 'container_acquisition_manual_fx',
            jsonb_build_object('container_id', _container_id, 'container_number', _cnum,
              'component', _k, 'outcome', 'manual_rate', 'reason', _why,
              'fx_rate', _rate, 'base_currency', _orgcur),
            jsonb_build_object('total_amount', _target, 'currency', _kcur,
              'fx_rate', _rate, 'base_amount', _base));
        END IF;
      END IF;
    END IF;

    _result := _result || jsonb_build_object(_k, jsonb_build_object(
      'amount', _target, 'outcome', _outcome, 'currency', _kcur,
      'fx_rate', CASE WHEN _touched IS NULL THEN NULL ELSE _rate END,
      'fx_rate_source', CASE WHEN _touched IS NULL THEN NULL ELSE _src END));
  END LOOP;

  UPDATE public.containers
     SET acquisition_cost = ROUND(GREATEST(COALESCE(_purchase,0),0),2),
         transport_cost = ROUND(GREATEST(COALESCE(_transport,0),0),2),
         offloading_cost = ROUND(GREATEST(COALESCE(_offloading,0),0),2),
         transport_vendor = NULLIF(_tvendor,''),
         offloading_vendor = NULLIF(_ovendor,''),
         acquisition_currency = upper(COALESCE(NULLIF(btrim(COALESCE(_purchase_currency,'')),''), _cur)),
         transport_currency = upper(COALESCE(NULLIF(btrim(COALESCE(_transport_currency,'')),''), _cur)),
         offloading_currency = upper(COALESCE(NULLIF(btrim(COALESCE(_offloading_currency,'')),''), _cur))
   WHERE id = _container_id AND organization_id = _org;

  INSERT INTO public.finance_audit_log (organization_id, actor_user_id, entity_type, entity_id, entity_ref, action, summary)
  VALUES (_org, auth.uid(), 'containers', _container_id, _cnum, 'container_acquisition_cost_edit',
    jsonb_build_object('reason', _why, 'currency', _cur, 'components', _result));

  RETURN _result;
END
$function$;