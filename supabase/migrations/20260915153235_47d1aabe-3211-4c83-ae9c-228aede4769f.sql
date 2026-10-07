CREATE OR REPLACE FUNCTION public.conversion_eir_costs(_conversion_id uuid)
RETURNS TABLE(
  container_id uuid, container_number text, eir_id uuid, eir_number text,
  approval_status text, pending boolean, currency text,
  purchase_price numeric, gate_fee numeric, repair_cost numeric,
  eir_total numeric, stored_cost numeric, difference numeric
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _job public.container_conversions%ROWTYPE;
  _ccy text;
  _r record;
  _e record;
  _pp numeric; _gf numeric; _rc numeric; _tot numeric; _stored numeric;
BEGIN
  SELECT * INTO _job FROM container_conversions
   WHERE id = _conversion_id AND (is_platform_admin() OR organization_id = current_org_id());
  IF NOT FOUND THEN RAISE EXCEPTION 'conversion_not_found'; END IF;
  _ccy := upper(coalesce(_job.currency, 'USD'));

  FOR _r IN
    SELECT cc.container_id, cc.container_cost, cc.transport_offloading_cost, c.container_number
      FROM conversion_containers cc
      LEFT JOIN containers c ON c.id = cc.container_id
     WHERE cc.conversion_id = _conversion_id
     ORDER BY c.container_number
  LOOP
    SELECT e.* INTO _e FROM eir_records e
     WHERE e.container_id = _r.container_id AND e.eir_type = 'gate_in'
     ORDER BY e.approved_at DESC NULLS LAST, e.created_at DESC
     LIMIT 1;

    _pp := 0; _gf := 0; _rc := 0;
    IF FOUND THEN
      _pp := coalesce(_e.purchase_price_snapshot, 0)
             * CASE WHEN upper(coalesce(_e.purchase_price_currency, _ccy)) = _ccy THEN 1
                    ELSE coalesce(_e.fx_rate_snapshot, 1) END;
      _gf := coalesce(_e.gate_fee_amount, 0)
             * CASE WHEN upper(coalesce(_e.gate_fee_currency, _ccy)) = _ccy THEN 1
                    ELSE coalesce(_e.fx_rate_snapshot, 1) END;
    END IF;

    SELECT coalesce(sum(de.total_cost), 0) INTO _rc
      FROM damage_estimates de
     WHERE de.container_id = _r.container_id
       AND de.approval_status = 'approved'
       AND upper(coalesce(de.currency, _ccy)) = _ccy;

    _tot := round(coalesce(_pp,0) + coalesce(_gf,0) + coalesce(_rc,0), 2);
    _stored := round(coalesce(_r.container_cost,0) + coalesce(_r.transport_offloading_cost,0), 2);

    container_id := _r.container_id;
    container_number := _r.container_number;
    eir_id := _e.id;
    eir_number := _e.eir_number;
    approval_status := _e.approval_status::text;
    pending := (_e.id IS NULL) OR coalesce(_e.approval_status::text, '') <> 'approved';
    currency := _ccy;
    purchase_price := round(coalesce(_pp,0), 2);
    gate_fee := round(coalesce(_gf,0), 2);
    repair_cost := round(coalesce(_rc,0), 2);
    eir_total := _tot;
    stored_cost := _stored;
    difference := round(_tot - _stored, 2);
    RETURN NEXT;
  END LOOP;
END
$function$;

REVOKE ALL ON FUNCTION public.conversion_eir_costs(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.conversion_eir_costs(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.resync_conversion_container_costs_from_eir(
  _conversion_id uuid, _reason text, _container_id uuid DEFAULT NULL::uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _org uuid := current_org_id();
  _uid uuid := auth.uid();
  _job public.container_conversions%ROWTYPE;
  _r record;
  _cc record;
  _updated int := 0;
  _skipped int := 0;
  _delta_total numeric := 0;
  _new_purchase numeric; _new_services numeric;
BEGIN
  IF NOT (is_platform_admin() OR is_org_admin(_uid)) THEN
    RAISE EXCEPTION 'not_authorized: only admins can resync conversion container costs';
  END IF;
  IF coalesce(trim(_reason), '') = '' THEN RAISE EXCEPTION 'reason_required'; END IF;

  SELECT * INTO _job FROM container_conversions
   WHERE id = _conversion_id AND (is_platform_admin() OR organization_id = _org);
  IF NOT FOUND THEN RAISE EXCEPTION 'conversion_not_found'; END IF;
  IF _job.status = 'cancelled' THEN RAISE EXCEPTION 'conversion_cancelled'; END IF;

  FOR _r IN SELECT * FROM public.conversion_eir_costs(_conversion_id)
             WHERE (_container_id IS NULL OR conversion_eir_costs.container_id = _container_id)
  LOOP
    IF _r.pending THEN _skipped := _skipped + 1; CONTINUE; END IF;

    SELECT * INTO _cc FROM conversion_containers
     WHERE conversion_id = _conversion_id AND container_id = _r.container_id
     LIMIT 1;
    IF NOT FOUND THEN CONTINUE; END IF;

    _new_purchase := _r.purchase_price;
    _new_services := round(_r.gate_fee + _r.repair_cost, 2);

    IF _new_purchase = coalesce(_cc.container_cost,0)
       AND _new_services = coalesce(_cc.transport_offloading_cost,0) THEN
      CONTINUE;
    END IF;

    UPDATE conversion_containers
       SET container_cost = _new_purchase, transport_offloading_cost = _new_services
     WHERE id = _cc.id;

    INSERT INTO conversion_container_audit (
      conversion_id, organization_id, action, old_container_id, new_container_id,
      old_container_cost, old_transport_offloading_cost,
      new_container_cost, new_transport_offloading_cost, reason, changed_by
    ) VALUES (
      _conversion_id, coalesce(_job.organization_id, _org), 'resync_eir',
      _r.container_id, _r.container_id,
      _cc.container_cost, _cc.transport_offloading_cost, _new_purchase, _new_services,
      _reason, _uid
    );

    _updated := _updated + 1;
    _delta_total := _delta_total
      + ((_new_purchase + _new_services)
         - (coalesce(_cc.container_cost,0) + coalesce(_cc.transport_offloading_cost,0)));
  END LOOP;

  UPDATE container_conversions j
     SET container_cost = t.p, transport_offloading_cost = t.s, updated_at = now()
    FROM (SELECT coalesce(sum(container_cost),0) p, coalesce(sum(transport_offloading_cost),0) s
            FROM conversion_containers WHERE conversion_id = _conversion_id) t
   WHERE j.id = _conversion_id;

  IF _job.status = 'completed' AND _delta_total <> 0 THEN
    INSERT INTO accounting_transactions (
      transaction_number, account_type, category, description,
      debit_amount, credit_amount, reference_type, reference_id, organization_id, project_id
    ) VALUES (
      'TXN-CONV-EIR-' || substr(replace(gen_random_uuid()::text,'-',''),1,10),
      'expense', 'cost_adjustment',
      'Conversion container cost re-sync from gate-in EIR - '
        || coalesce(_job.conversion_number, _conversion_id::text) || ' (' || _reason || ')',
      CASE WHEN _delta_total > 0 THEN _delta_total ELSE 0 END,
      CASE WHEN _delta_total < 0 THEN -_delta_total ELSE 0 END,
      'container_conversions', _conversion_id, coalesce(_job.organization_id, _org), _job.project_id
    );
  END IF;

  RETURN jsonb_build_object(
    'updated', _updated, 'skipped_pending', _skipped, 'delta_total', _delta_total,
    'ledger_posted', (_job.status = 'completed' AND _delta_total <> 0)
  );
END
$function$;

REVOKE ALL ON FUNCTION public.resync_conversion_container_costs_from_eir(uuid, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resync_conversion_container_costs_from_eir(uuid, text, uuid) TO authenticated;