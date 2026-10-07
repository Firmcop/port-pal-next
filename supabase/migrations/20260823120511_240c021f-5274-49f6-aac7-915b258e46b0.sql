-- see /tmp/mig_resync.sql
CREATE OR REPLACE FUNCTION public.container_acquisition_split(_container_id uuid, _currency text)
RETURNS TABLE(purchase numeric, services numeric)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _org uuid := current_org_id();
  _cnum text;
  _target text := upper(coalesce(nullif(trim(_currency), ''), 'USD'));
  _p numeric := 0;
  _s numeric := 0;
  _r record;
  _rate numeric;
  _amt numeric;
BEGIN
  IF _container_id IS NULL THEN
    purchase := 0; services := 0; RETURN NEXT; RETURN;
  END IF;
  SELECT container_number INTO _cnum FROM containers WHERE id = _container_id;

  FOR _r IN
    SELECT si.total_amount, si.reason, upper(coalesce(si.currency, _target)) AS ccy,
           coalesce(si.issue_date, current_date) AS on_date
      FROM supplier_invoices si
     WHERE si.reason IN ('purchase','acquisition_transport','acquisition_crane_offloading')
       AND lower(coalesce(si.status,'')) NOT IN ('cancelled','void','credited','draft_void')
       AND (si.container_id = _container_id OR (_cnum IS NOT NULL AND si.reference = _cnum))
  LOOP
    IF _r.ccy = _target THEN
      _amt := coalesce(_r.total_amount, 0);
    ELSE
      _rate := get_fx_rate(_org, _r.ccy, _target, _r.on_date::date);
      IF _rate IS NULL OR _rate <= 0 THEN
        RAISE EXCEPTION 'missing_fx_rate: no rate % -> % on %. Add it under Finance FX Rates.', _r.ccy, _target, _r.on_date;
      END IF;
      _amt := round(coalesce(_r.total_amount, 0) * _rate, 2);
    END IF;

    IF _r.reason = 'purchase' THEN _p := _p + _amt; ELSE _s := _s + _amt; END IF;
  END LOOP;

  purchase := round(_p, 2);
  services := round(_s, 2);
  RETURN NEXT;
END $$;

REVOKE ALL ON FUNCTION public.container_acquisition_split(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.container_acquisition_split(uuid, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.preview_conversion_container_resync(_conversion_id uuid DEFAULT NULL)
RETURNS TABLE(
  link_id uuid,
  conversion_id uuid,
  conversion_number text,
  job_status text,
  container_id uuid,
  container_number text,
  currency text,
  stored_purchase numeric,
  stored_transport numeric,
  live_purchase numeric,
  live_transport numeric,
  delta numeric,
  error text
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _org uuid := current_org_id();
  _r record;
  _sp numeric; _ss numeric;
BEGIN
  FOR _r IN
    SELECT cc.id AS link_id, cc.conversion_id, cc.container_id,
           cc.container_cost, cc.transport_offloading_cost,
           j.conversion_number, j.status::text AS status,
           coalesce(j.currency, 'USD') AS ccy,
           c.container_number
      FROM conversion_containers cc
      JOIN container_conversions j ON j.id = cc.conversion_id
      JOIN containers c ON c.id = cc.container_id
     WHERE (is_platform_admin() OR cc.organization_id = _org)
       AND (_conversion_id IS NULL OR cc.conversion_id = _conversion_id)
     ORDER BY j.created_at DESC
  LOOP
    link_id := _r.link_id;
    conversion_id := _r.conversion_id;
    conversion_number := _r.conversion_number;
    job_status := _r.status;
    container_id := _r.container_id;
    container_number := _r.container_number;
    currency := _r.ccy;
    stored_purchase := _r.container_cost;
    stored_transport := _r.transport_offloading_cost;
    error := NULL;

    BEGIN
      SELECT s.purchase, s.services INTO _sp, _ss
        FROM public.container_acquisition_split(_r.container_id, _r.ccy) s;
      live_purchase := coalesce(_sp, 0);
      live_transport := coalesce(_ss, 0);
      delta := (live_purchase + live_transport)
             - (coalesce(_r.container_cost,0) + coalesce(_r.transport_offloading_cost,0));
    EXCEPTION WHEN OTHERS THEN
      live_purchase := NULL; live_transport := NULL; delta := NULL;
      error := SQLERRM;
    END;

    RETURN NEXT;
  END LOOP;
END $$;

REVOKE ALL ON FUNCTION public.preview_conversion_container_resync(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.preview_conversion_container_resync(uuid) TO authenticated, service_role;

ALTER TABLE public.conversion_container_audit
  DROP CONSTRAINT IF EXISTS conversion_container_audit_action_check;
ALTER TABLE public.conversion_container_audit
  ADD CONSTRAINT conversion_container_audit_action_check
  CHECK (action = ANY (ARRAY['swap','detach','attach','resync']));

CREATE OR REPLACE FUNCTION public.resync_conversion_container_costs(
  _conversion_id uuid,
  _reason text,
  _container_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _org uuid := current_org_id();
  _job public.container_conversions%ROWTYPE;
  _uid uuid := auth.uid();
  _r record;
  _sp numeric; _ss numeric;
  _updated int := 0;
  _delta_total numeric := 0;
  _d numeric;
  _ccy text;
BEGIN
  IF NOT (is_platform_admin() OR is_org_admin(_uid)) THEN
    RAISE EXCEPTION 'not_authorized: only admins can resync conversion container costs';
  END IF;
  IF coalesce(trim(_reason), '') = '' THEN
    RAISE EXCEPTION 'reason_required';
  END IF;

  SELECT * INTO _job FROM container_conversions
   WHERE id = _conversion_id AND (is_platform_admin() OR organization_id = _org);
  IF NOT FOUND THEN RAISE EXCEPTION 'conversion_not_found'; END IF;
  IF _job.status = 'cancelled' THEN RAISE EXCEPTION 'conversion_cancelled'; END IF;

  _ccy := coalesce(_job.currency, 'USD');

  FOR _r IN
    SELECT cc.* FROM conversion_containers cc
     WHERE cc.conversion_id = _conversion_id
       AND (_container_id IS NULL OR cc.container_id = _container_id)
  LOOP
    SELECT s.purchase, s.services INTO _sp, _ss
      FROM public.container_acquisition_split(_r.container_id, _ccy) s;
    _sp := coalesce(_sp, 0); _ss := coalesce(_ss, 0);
    _d := (_sp + _ss) - (coalesce(_r.container_cost,0) + coalesce(_r.transport_offloading_cost,0));

    IF _sp = _r.container_cost AND _ss = _r.transport_offloading_cost THEN
      CONTINUE;
    END IF;

    UPDATE conversion_containers
       SET container_cost = _sp, transport_offloading_cost = _ss
     WHERE id = _r.id;

    INSERT INTO conversion_container_audit (
      conversion_id, organization_id, action, old_container_id, new_container_id,
      old_container_cost, old_transport_offloading_cost,
      new_container_cost, new_transport_offloading_cost, reason, changed_by
    ) VALUES (
      _conversion_id, coalesce(_job.organization_id, _org), 'resync',
      _r.container_id, _r.container_id,
      _r.container_cost, _r.transport_offloading_cost, _sp, _ss, _reason, _uid
    );

    _updated := _updated + 1;
    _delta_total := _delta_total + _d;
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
      'TXN-CONV-SYNC-' || substr(replace(gen_random_uuid()::text,'-',''),1,10),
      'expense', 'cost_adjustment',
      'Conversion container cost re-sync - ' || coalesce(_job.conversion_number, _conversion_id::text)
        || ' (' || _reason || ')',
      CASE WHEN _delta_total > 0 THEN _delta_total ELSE 0 END,
      CASE WHEN _delta_total < 0 THEN -_delta_total ELSE 0 END,
      'container_conversions', _conversion_id, coalesce(_job.organization_id, _org), _job.project_id
    );
  END IF;

  RETURN jsonb_build_object(
    'updated', _updated,
    'delta_total', _delta_total,
    'ledger_posted', (_job.status = 'completed' AND _delta_total <> 0)
  );
END $$;

REVOKE ALL ON FUNCTION public.resync_conversion_container_costs(uuid, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resync_conversion_container_costs(uuid, text, uuid) TO authenticated, service_role;