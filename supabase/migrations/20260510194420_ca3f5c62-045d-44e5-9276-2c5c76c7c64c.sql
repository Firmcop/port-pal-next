
ALTER TABLE public.container_conversions
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz,
  ADD COLUMN IF NOT EXISTS cancelled_by uuid,
  ADD COLUMN IF NOT EXISTS cancellation_reason text;

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
  _net_issued numeric;
  _cost numeric;
  _materials_returned int := 0;
  _subs_returned int := 0;
  _container_released boolean := false;
BEGIN
  SELECT * INTO _job FROM public.container_conversions WHERE id = _id;
  IF NOT FOUND THEN RAISE EXCEPTION 'job_not_found'; END IF;

  IF _job.status NOT IN ('planning','in_progress') THEN
    RAISE EXCEPTION 'cannot_cancel_status:%', _job.status;
  END IF;

  IF NOT (has_role(auth.uid(),'admin'::app_role) OR _job.created_by = auth.uid()) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  -- 1. Return materials (net issued = -SUM(qty) since issues are negative)
  FOR _mat IN
    SELECT material_id, COALESCE(-SUM(qty), 0) AS net_issued
    FROM public.material_movements
    WHERE conversion_id = _id
    GROUP BY material_id
    HAVING COALESCE(-SUM(qty), 0) > 0
  LOOP
    SELECT COALESCE(avg_unit_cost, unit_cost, 0) INTO _cost
      FROM public.materials WHERE id = _mat.material_id;
    INSERT INTO public.material_movements (material_id, movement_type, qty, unit_cost, conversion_id, created_by, reason)
    VALUES (_mat.material_id, 'return', _mat.net_issued, _cost, _id, auth.uid(),
            'Job cancelled: ' || COALESCE(_reason, ''));
    _materials_returned := _materials_returned + 1;
  END LOOP;

  -- 2. Return sub-assemblies
  FOR _sub IN
    SELECT id, assembly_stock_id, qty_used
    FROM public.conversion_sub_assemblies
    WHERE conversion_id = _id AND COALESCE(qty_used, 0) > 0
  LOOP
    UPDATE public.sub_assembly_stock
      SET on_hand_qty = on_hand_qty + _sub.qty_used
      WHERE id = _sub.assembly_stock_id;
    UPDATE public.conversion_sub_assemblies
      SET qty_used = 0, total_cost = 0
      WHERE id = _sub.id;
    _subs_returned := _subs_returned + 1;
  END LOOP;

  -- 3. Release source container
  IF _job.container_id IS NOT NULL THEN
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

  RETURN jsonb_build_object(
    'ok', true,
    'materials_returned', _materials_returned,
    'sub_assemblies_returned', _subs_returned,
    'container_released', _container_released
  );
END;
$$;
