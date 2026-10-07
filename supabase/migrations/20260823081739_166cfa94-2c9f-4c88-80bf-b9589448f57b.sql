ALTER TABLE public.supplier_invoices
  ADD COLUMN IF NOT EXISTS fx_rate_source text NOT NULL DEFAULT 'auto';

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'supplier_invoices_fx_rate_source_chk') THEN
    ALTER TABLE public.supplier_invoices
      ADD CONSTRAINT supplier_invoices_fx_rate_source_chk CHECK (fx_rate_source IN ('auto','manual'));
  END IF;
END $$;

-- ------------------------------------------------------------------ preview
CREATE OR REPLACE FUNCTION public.preview_container_acquisition_costs(
  _container_id uuid,
  _purchase numeric DEFAULT 0,
  _purchase_currency text DEFAULT NULL,
  _transport numeric DEFAULT 0,
  _transport_vendor text DEFAULT NULL,
  _transport_currency text DEFAULT NULL,
  _offloading numeric DEFAULT 0,
  _offloading_vendor text DEFAULT NULL,
  _offloading_currency text DEFAULT NULL,
  _purchase_fx numeric DEFAULT NULL,
  _transport_fx numeric DEFAULT NULL,
  _offloading_fx numeric DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _org uuid := current_org_id();
  _orgcur text;
  _cnum text; _owner text; _cstatus text;
  _kinds text[] := ARRAY['purchase','acquisition_transport','acquisition_crane_offloading'];
  _k text; _target numeric; _vendor text; _kcur text;
  _inv RECORD; _delta numeric; _action text; _ledger text;
  _components jsonb := '[]'::jsonb;
  _blockers jsonb := '[]'::jsonb;
  _warnings jsonb := '[]'::jsonb;
  _fx jsonb; _rate numeric; _fxdate date; _base numeric;
  _manual numeric; _src text;
BEGIN
  IF _container_id IS NULL THEN RAISE EXCEPTION 'Container is required'; END IF;

  SELECT upper(COALESCE(currency,'USD')) INTO _orgcur FROM public.organizations WHERE id = _org;
  _orgcur := COALESCE(_orgcur,'USD');

  SELECT container_number, owner, status::text INTO _cnum, _owner, _cstatus
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
    _kcur := upper(COALESCE(NULLIF(btrim(COALESCE(
                 CASE _k WHEN 'purchase' THEN _purchase_currency
                         WHEN 'acquisition_transport' THEN _transport_currency
                         ELSE _offloading_currency END, '')),''), _orgcur));
    _manual := NULLIF(CASE _k WHEN 'purchase' THEN _purchase_fx
                              WHEN 'acquisition_transport' THEN _transport_fx
                              ELSE _offloading_fx END, 0);
    IF _manual IS NOT NULL AND _manual < 0 THEN _manual := NULL; END IF;

    SELECT si.* INTO _inv
      FROM public.supplier_invoices si
     WHERE si.organization_id = _org
       AND si.container_id = _container_id
       AND si.reason = _k
       AND lower(si.status) NOT IN ('cancelled','void','credited')
     ORDER BY si.created_at DESC LIMIT 1;

    _action := 'unchanged'; _ledger := NULL; _delta := 0;
    _rate := NULL; _fxdate := NULL; _base := NULL; _src := NULL;

    IF _inv.id IS NULL THEN
      IF _target > 0 THEN
        _action := 'create';
        _delta := _target;
        _ledger := 'Payable increase ' || _kcur || ' ' || to_char(_target,'FM999999990.00');
      END IF;
    ELSE
      _delta := _target - COALESCE(_inv.total_amount,0);
      IF _target <= 0 THEN
        _action := 'cancel';
        _ledger := 'Payable reversal ' || COALESCE(_inv.currency,_kcur) || ' ' || to_char(COALESCE(_inv.total_amount,0),'FM999999990.00');
      ELSIF ROUND(_delta,2) <> 0 OR upper(COALESCE(_inv.currency,'')) <> _kcur
            OR (_manual IS NOT NULL AND ROUND(COALESCE(_inv.fx_rate,0),6) <> ROUND(_manual,6)) THEN
        _action := 'adjust';
        _ledger := CASE WHEN _delta >= 0 THEN 'Payable increase ' ELSE 'Payable decrease ' END
                   || _kcur || ' ' || to_char(abs(_delta),'FM999999990.00');
      END IF;
    END IF;

    IF _target > 0 AND _vendor = '' THEN
      IF _k = 'purchase' THEN
        _blockers := _blockers || jsonb_build_object('component', _k, 'code','missing_owner',
          'message','The container has no registered owner, so the seller invoice cannot be raised.',
          'fix','Set the container owner on the container record, then retry.');
      ELSE
        _blockers := _blockers || jsonb_build_object('component', _k, 'code','missing_vendor',
          'message','An amount is set but no vendor is named.',
          'fix','Pick the vendor from the supplier list, or create the supplier from the same field.');
      END IF;
    END IF;

    IF _target > 0 THEN
      IF _kcur = _orgcur THEN
        _rate := 1; _fxdate := CURRENT_DATE; _base := _target; _src := 'auto';
      ELSIF _manual IS NOT NULL THEN
        _rate := _manual; _fxdate := CURRENT_DATE; _base := ROUND(_target * _manual, 2); _src := 'manual';
      ELSE
        _fx := public.get_fx_rate_detail(_org, _kcur, _orgcur, CURRENT_DATE);
        _rate := NULLIF((_fx->>'rate')::numeric, 0);
        _fxdate := NULLIF(_fx->>'as_of_date','')::date;
        _src := 'auto';
        IF _rate IS NULL THEN
          _blockers := _blockers || jsonb_build_object('component', _k, 'code','missing_fx_rate',
            'message','No exchange rate for ' || _kcur || ' to ' || _orgcur || ' today.',
            'fix','Type the actual rate you used in the Exchange rate field, or add the ' || _kcur || ' to ' || _orgcur || ' rate under Finance -> FX Rates.');
        ELSE
          _base := ROUND(_target * _rate, 2);
        END IF;
      END IF;
    END IF;

    IF _inv.id IS NOT NULL AND COALESCE(_inv.paid_amount,0) > 0 AND _target < COALESCE(_inv.paid_amount,0) THEN
      _blockers := _blockers || jsonb_build_object('component', _k, 'code','below_paid_amount',
        'message', _inv.invoice_number || ' already has ' || COALESCE(_inv.paid_amount,0)::text || ' ' || COALESCE(_inv.currency,_kcur) || ' paid.',
        'fix','Raise a credit note or refund against the invoice instead of lowering it below the amount paid.');
    END IF;

    IF _action <> 'unchanged' AND _cstatus IN ('sold','converted','in_conversion') THEN
      _warnings := _warnings || jsonb_build_object('component', _k, 'code','container_consumed',
        'message','This container is ' || replace(_cstatus,'_',' ') || '; the cost may already be carried into a sale or conversion job.',
        'fix','Confirm the job or sale margin is re-checked after saving.');
    END IF;

    IF _action = 'cancel' AND EXISTS (
      SELECT 1 FROM public.edi_exports e WHERE e.supplier_invoice_id = _inv.id
    ) THEN
      _warnings := _warnings || jsonb_build_object('component', _k, 'code','edi_exported',
        'message', _inv.invoice_number || ' has already been exported over EDI.',
        'fix','Re-send the corrected EDI export after saving.');
    END IF;

    _components := _components || jsonb_build_object(
      'component', _k,
      'action', _action,
      'vendor', NULLIF(_vendor,''),
      'currency', _kcur,
      'invoice_id', _inv.id,
      'invoice_number', _inv.invoice_number,
      'invoice_status', _inv.status,
      'paid_amount', COALESCE(_inv.paid_amount,0),
      'old_amount', COALESCE(_inv.total_amount,0),
      'old_currency', _inv.currency,
      'new_amount', _target,
      'delta', ROUND(_delta,2),
      'purchase_order_id', _inv.purchase_order_id,
      'fx_rate', _rate,
      'fx_rate_date', _fxdate,
      'fx_rate_source', _src,
      'base_currency', _orgcur,
      'base_amount', _base,
      'ledger', _ledger);
  END LOOP;

  RETURN jsonb_build_object(
    'container_id', _container_id,
    'container_number', _cnum,
    'container_status', _cstatus,
    'owner', _owner,
    'org_currency', _orgcur,
    'components', _components,
    'blockers', _blockers,
    'warnings', _warnings);
END;
$function$;

-- --------------------------------------------------------------------- save
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

-- ------------------------------------------------------------- revaluation
CREATE OR REPLACE FUNCTION public.revalue_acquisition_fx(_currency_from text DEFAULT NULL::text, _as_of date DEFAULT CURRENT_DATE)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _org uuid := current_org_id();
  _orgcur text;
  _actor text := COALESCE(auth.jwt() ->> 'email', 'system');
  _inv RECORD;
  _fx jsonb; _rate numeric; _fxdate date; _newbase numeric; _oldbase numeric;
  _revalued int := 0; _unchanged int := 0; _skipped int := 0; _failed int := 0;
  _details jsonb := '[]'::jsonb;
BEGIN
  IF NOT (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'org_owner')
          OR public.has_role(auth.uid(),'accountant') OR public.is_platform_admin()) THEN
    RAISE EXCEPTION 'Only admins or accountants can revalue acquisition costs';
  END IF;

  SELECT upper(COALESCE(currency,'USD')) INTO _orgcur FROM public.organizations WHERE id = _org;
  _orgcur := COALESCE(_orgcur,'USD');

  FOR _inv IN
    SELECT si.id, si.invoice_number, si.reason, si.currency, si.total_amount, si.paid_amount,
           si.base_amount, si.fx_rate, si.fx_rate_source, si.container_id, c.container_number
      FROM public.supplier_invoices si
      LEFT JOIN public.containers c ON c.id = si.container_id
     WHERE si.organization_id = _org
       AND si.reason IN ('purchase','acquisition_transport','acquisition_crane_offloading')
       AND lower(COALESCE(si.status,'')) NOT IN ('cancelled','void','credited')
       AND upper(COALESCE(si.currency,'')) <> _orgcur
       AND (_currency_from IS NULL OR upper(COALESCE(si.currency,'')) = upper(_currency_from))
  LOOP
    IF COALESCE(_inv.fx_rate_source,'auto') = 'manual' THEN
      _skipped := _skipped + 1;
      _details := _details || jsonb_build_object('invoice_number', _inv.invoice_number,
        'container_number', _inv.container_number, 'status','skipped',
        'detail','Manually entered rate — left untouched.');
      CONTINUE;
    END IF;

    IF COALESCE(_inv.paid_amount,0) >= COALESCE(_inv.total_amount,0) AND COALESCE(_inv.total_amount,0) > 0 THEN
      _skipped := _skipped + 1;
      _details := _details || jsonb_build_object('invoice_number', _inv.invoice_number,
        'container_number', _inv.container_number, 'status','skipped',
        'detail','Fully paid — valuation left as posted.');
      CONTINUE;
    END IF;

    _fx := public.get_fx_rate_detail(_org, upper(_inv.currency), _orgcur, _as_of);
    _rate := NULLIF((_fx->>'rate')::numeric, 0);
    _fxdate := NULLIF(_fx->>'as_of_date','')::date;

    IF _rate IS NULL THEN
      _failed := _failed + 1;
      _details := _details || jsonb_build_object('invoice_number', _inv.invoice_number,
        'container_number', _inv.container_number, 'status','failed',
        'detail','No ' || upper(_inv.currency) || ' to ' || _orgcur || ' rate on or before ' || _as_of::text || '.');
      CONTINUE;
    END IF;

    _oldbase := COALESCE(_inv.base_amount, 0);
    _newbase := ROUND(COALESCE(_inv.total_amount,0) * _rate, 2);

    IF abs(_newbase - _oldbase) < 0.01 AND COALESCE(_inv.fx_rate,0) <> 0 THEN
      _unchanged := _unchanged + 1;
      CONTINUE;
    END IF;

    UPDATE public.supplier_invoices
       SET base_amount = _newbase, fx_rate = _rate, fx_rate_source = 'auto', updated_at = now()
     WHERE id = _inv.id;

    UPDATE public.accounting_transactions
       SET fx_rate = _rate
     WHERE organization_id = _org
       AND reference_type = 'supplier_invoices'
       AND reference_id = _inv.id;

    INSERT INTO public.finance_audit_log (
      organization_id, actor_user_id, actor_email, entity_type, entity_id, entity_ref,
      action, summary, before_data, after_data)
    VALUES (
      _org, auth.uid(), _actor, 'supplier_invoices', _inv.id, _inv.invoice_number,
      'container_acquisition_fx_revaluation',
      jsonb_build_object(
        'container_id', _inv.container_id,
        'container_number', _inv.container_number,
        'component', _inv.reason,
        'outcome', 'revalued',
        'trigger', 'FX revaluation',
        'reason', 'Exchange rate updated for ' || upper(_inv.currency) || ' to ' || _orgcur
                  || ' (rate of ' || COALESCE(_fxdate::text, _as_of::text) || ')',
        'fx_rate_date', _fxdate,
        'base_currency', _orgcur),
      jsonb_build_object('total_amount', _inv.total_amount, 'currency', _inv.currency,
        'fx_rate', _inv.fx_rate, 'base_amount', _oldbase),
      jsonb_build_object('total_amount', _inv.total_amount, 'currency', _inv.currency,
        'fx_rate', _rate, 'base_amount', _newbase));

    _revalued := _revalued + 1;
    _details := _details || jsonb_build_object('invoice_number', _inv.invoice_number,
      'container_number', _inv.container_number, 'status','revalued',
      'detail', _orgcur || ' ' || to_char(_oldbase,'FM999999990.00') || ' -> ' || to_char(_newbase,'FM999999990.00')
                || ' at ' || to_char(_rate,'FM999999990.000000'));
  END LOOP;

  RETURN jsonb_build_object(
    'revalued', _revalued, 'unchanged', _unchanged, 'skipped', _skipped, 'failed', _failed,
    'base_currency', _orgcur, 'as_of', _as_of, 'details', _details);
END;
$function$;

REVOKE ALL ON FUNCTION public.preview_container_acquisition_costs(uuid,numeric,text,numeric,text,text,numeric,text,text,numeric,numeric,numeric) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.preview_container_acquisition_costs(uuid,numeric,text,numeric,text,text,numeric,text,text,numeric,numeric,numeric) TO authenticated;
REVOKE ALL ON FUNCTION public.set_container_acquisition_costs(uuid,numeric,numeric,text,numeric,text,text,text,text,text,text,numeric,numeric,numeric,uuid,uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.set_container_acquisition_costs(uuid,numeric,numeric,text,numeric,text,text,text,text,text,text,numeric,numeric,numeric,uuid,uuid) TO authenticated;

DROP FUNCTION IF EXISTS public.preview_container_acquisition_costs(uuid,numeric,text,numeric,text,text,numeric,text,text);
DROP FUNCTION IF EXISTS public.set_container_acquisition_costs(uuid,numeric,numeric,text,numeric,text,text,text,text,text,text);