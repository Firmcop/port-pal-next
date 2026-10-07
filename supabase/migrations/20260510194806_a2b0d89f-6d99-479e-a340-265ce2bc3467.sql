
CREATE OR REPLACE FUNCTION public.cancel_conversion(_id uuid, _reason text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _job RECORD;
  _mat RECORD;
  _sub RECORD;
  _cost numeric;
  _materials_returned int := 0;
  _subs_returned int := 0;
  _container_released boolean := false;
  _previous_status text;
  _container_number text;
  _materials_detail jsonb := '[]'::jsonb;
  _subs_detail jsonb := '[]'::jsonb;
  _actor_name text;
  _event_id uuid;
  _user RECORD;
  _msg text;
  _is_admin boolean;
  _is_yard boolean;
  _is_gate boolean;
BEGIN
  SELECT * INTO _job FROM public.container_conversions WHERE id = _id;
  IF NOT FOUND THEN RAISE EXCEPTION 'job_not_found'; END IF;

  IF _job.status NOT IN ('planning','in_progress') THEN
    RAISE EXCEPTION 'cannot_cancel_status:%', _job.status;
  END IF;

  -- Stricter role enforcement
  _is_admin := has_role(auth.uid(),'admin'::app_role);
  _is_yard  := has_role(auth.uid(),'yard_operator'::app_role);
  _is_gate  := has_role(auth.uid(),'gate_clerk'::app_role);

  IF NOT (
    _is_admin OR _is_yard OR _is_gate
    OR (_job.created_by = auth.uid() AND _job.status = 'planning')
  ) THEN
    RAISE EXCEPTION 'forbidden_role';
  END IF;

  _previous_status := _job.status::text;

  -- 1. Return materials
  FOR _mat IN
    SELECT mm.material_id, COALESCE(-SUM(mm.qty), 0) AS net_issued, m.name
    FROM public.material_movements mm
    JOIN public.materials m ON m.id = mm.material_id
    WHERE mm.conversion_id = _id
    GROUP BY mm.material_id, m.name
    HAVING COALESCE(-SUM(mm.qty), 0) > 0
  LOOP
    SELECT COALESCE(avg_unit_cost, unit_cost, 0) INTO _cost
      FROM public.materials WHERE id = _mat.material_id;
    INSERT INTO public.material_movements (material_id, movement_type, qty, unit_cost, conversion_id, created_by, reason)
    VALUES (_mat.material_id, 'return', _mat.net_issued, _cost, _id, auth.uid(),
            'Job cancelled: ' || COALESCE(_reason, ''));
    _materials_returned := _materials_returned + 1;
    _materials_detail := _materials_detail || jsonb_build_object(
      'material_id', _mat.material_id,
      'name', _mat.name,
      'qty', _mat.net_issued,
      'unit_cost', _cost
    );
  END LOOP;

  -- 2. Return sub-assemblies
  FOR _sub IN
    SELECT csa.id, csa.assembly_stock_id, csa.qty_used, sas.name
    FROM public.conversion_sub_assemblies csa
    LEFT JOIN public.sub_assembly_stock sas ON sas.id = csa.assembly_stock_id
    WHERE csa.conversion_id = _id AND COALESCE(csa.qty_used, 0) > 0
  LOOP
    UPDATE public.sub_assembly_stock
      SET on_hand_qty = on_hand_qty + _sub.qty_used
      WHERE id = _sub.assembly_stock_id;
    UPDATE public.conversion_sub_assemblies
      SET qty_used = 0, total_cost = 0
      WHERE id = _sub.id;
    _subs_returned := _subs_returned + 1;
    _subs_detail := _subs_detail || jsonb_build_object(
      'assembly_stock_id', _sub.assembly_stock_id,
      'name', _sub.name,
      'qty', _sub.qty_used
    );
  END LOOP;

  -- 3. Release source container
  IF _job.container_id IS NOT NULL THEN
    SELECT container_number INTO _container_number FROM public.containers WHERE id = _job.container_id;
    UPDATE public.containers
      SET status = 'available'::container_status
      WHERE id = _job.container_id AND status = 'in_conversion'::container_status;
    _container_released := true;
  END IF;

  -- 4. Mark job cancelled
  UPDATE public.container_conversions
    SET status = 'cancelled',
        cancelled_at = now(),
        cancelled_by = auth.uid(),
        cancellation_reason = _reason,
        actual_cost = 0
    WHERE id = _id;

  -- 5. Audit log
  _event_id := public.log_org_event(
    _job.organization_id,
    'conversion_cancelled',
    jsonb_build_object(
      'conversion_id', _id,
      'conversion_number', _job.conversion_number,
      'job_kind', _job.job_kind,
      'previous_status', _previous_status,
      'reason', _reason,
      'cancelled_at', now(),
      'container', CASE WHEN _job.container_id IS NULL THEN NULL
                        ELSE jsonb_build_object('id', _job.container_id, 'container_number', _container_number) END,
      'materials_returned', _materials_detail,
      'sub_assemblies_returned', _subs_detail,
      'totals', jsonb_build_object(
        'materials_count', _materials_returned,
        'sub_assemblies_count', _subs_returned,
        'container_released', _container_released
      )
    ),
    auth.uid()
  );

  -- 6. Notify operational staff
  SELECT COALESCE(display_name, 'A user') INTO _actor_name FROM public.profiles WHERE user_id = auth.uid();
  _msg := COALESCE(_job.conversion_number,'Job') || ' cancelled by ' || COALESCE(_actor_name,'A user')
          || CASE WHEN _reason IS NULL OR _reason = '' THEN ''
                  ELSE ': ' || left(_reason, 120) END;

  FOR _user IN
    SELECT DISTINCT m.user_id
    FROM public.organization_members m
    JOIN public.user_roles ur ON ur.user_id = m.user_id
    WHERE m.organization_id = _job.organization_id
      AND m.status = 'active'
      AND ur.role IN ('admin','yard_operator','gate_clerk')
  LOOP
    INSERT INTO public.notifications (user_id, organization_id, title, message, type, reference_id, reference_type)
    VALUES (_user.user_id, _job.organization_id, 'Conversion cancelled', _msg,
            'conversion', _id, 'container_conversions');
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true,
    'materials_returned', _materials_returned,
    'sub_assemblies_returned', _subs_returned,
    'container_released', _container_released,
    'event_id', _event_id
  );
END;
$$;
