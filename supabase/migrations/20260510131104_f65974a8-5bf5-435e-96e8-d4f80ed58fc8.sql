
CREATE OR REPLACE FUNCTION public.gate_in_imported_container(_container_number text, _payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _org uuid := current_org_id();
  _container RECORD;
  _block_id uuid;
  _block RECORD;
  _bay int;  _row int;  _tier int;
  _gate_in_at timestamptz;
  _block_name text := nullif(trim(_payload->>'block_name'), '');
  _condition_grade condition_grade;
  _seal text := nullif(_payload->>'seal_number','');
  _eir_number text := nullif(_payload->>'eir_number','');
  _movement_id uuid;
  _eir_id uuid;
  _occupied_id uuid;
BEGIN
  IF _org IS NULL THEN RAISE EXCEPTION 'no_organization'; END IF;
  IF NOT (has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'gate_clerk'::app_role) OR has_role(auth.uid(),'yard_operator'::app_role)) THEN
    RAISE EXCEPTION 'forbidden_role';
  END IF;

  SELECT * INTO _container FROM public.containers
    WHERE organization_id = _org AND container_number = _container_number;
  IF NOT FOUND THEN RAISE EXCEPTION 'container_not_found:%', _container_number; END IF;

  -- Resolve gate_in_at
  BEGIN
    _gate_in_at := COALESCE((_payload->>'gate_in_at')::timestamptz, now());
  EXCEPTION WHEN others THEN
    _gate_in_at := now();
  END;

  -- Resolve block (optional)
  IF _block_name IS NOT NULL THEN
    SELECT * INTO _block FROM public.yard_blocks
      WHERE organization_id = _org AND lower(name) = lower(_block_name)
      LIMIT 1;
    IF NOT FOUND THEN RAISE EXCEPTION 'block_not_found:%', _block_name; END IF;
    _block_id := _block.id;

    _bay := NULLIF(_payload->>'bay','')::int;
    _row := NULLIF(_payload->>'row','')::int;
    _tier := NULLIF(_payload->>'tier','')::int;

    IF _bay IS NULL OR _row IS NULL OR _tier IS NULL THEN
      RAISE EXCEPTION 'slot_required:bay/row/tier required when block_name provided';
    END IF;
    IF _bay < 1 OR _bay > _block.max_bays OR _row < 1 OR _row > _block.max_rows OR _tier < 1 OR _tier > _block.max_tiers THEN
      RAISE EXCEPTION 'slot_out_of_range:block %x%x%', _block.max_bays, _block.max_rows, _block.max_tiers;
    END IF;

    SELECT id INTO _occupied_id FROM public.containers
      WHERE organization_id = _org AND block_id = _block_id
        AND bay = _bay AND row = _row AND tier = _tier
        AND id <> _container.id
      LIMIT 1;
    IF _occupied_id IS NOT NULL THEN
      RAISE EXCEPTION 'slot_occupied:% bay% row% tier%', _block_name, _bay, _row, _tier;
    END IF;
  END IF;

  -- Update container
  UPDATE public.containers
    SET gate_in_at = _gate_in_at,
        gate_out_at = NULL,
        block_id = COALESCE(_block_id, block_id),
        bay = COALESCE(_bay, bay),
        row = COALESCE(_row, row),
        tier = COALESCE(_tier, tier),
        status = COALESCE(NULLIF(_payload->>'status','')::container_status, 'available'::container_status)
    WHERE id = _container.id;

  -- Movement
  INSERT INTO public.container_movements (container_id, movement_type, to_block_id, to_bay, to_row, to_tier, performed_by, notes, organization_id)
  VALUES (_container.id, 'gate_in', _block_id, _bay, _row, _tier, auth.uid(),
          concat_ws(' | ',
            NULLIF('Bulk import gate-in', ''),
            NULLIF(_payload->>'truck_plate',''),
            NULLIF(_payload->>'driver_name',''),
            NULLIF(_payload->>'transporter',''),
            NULLIF(_payload->>'gate_in_notes','')
          ),
          _org)
  RETURNING id INTO _movement_id;

  -- EIR
  _condition_grade := COALESCE(NULLIF(_payload->>'condition_grade','')::condition_grade, 'A'::condition_grade);
  IF _eir_number IS NULL THEN
    _eir_number := 'EIR-' || to_char(now(), 'YYMMDDHH24MISS') || '-' || substring(gen_random_uuid()::text, 1, 4);
  END IF;

  INSERT INTO public.eir_records (eir_number, container_id, eir_type, condition_grade, cargo_status, seal_number, inspector_notes, inspected_by, completed_at, organization_id)
  VALUES (_eir_number, _container.id, 'gate_in', _condition_grade, 'empty', _seal,
          concat_ws(' | ',
            NULLIF('Bulk import gate-in', ''),
            NULLIF(_payload->>'truck_plate',''),
            NULLIF(_payload->>'driver_name',''),
            NULLIF(_payload->>'transporter','')
          ),
          auth.uid(), _gate_in_at, _org)
  RETURNING id INTO _eir_id;

  RETURN jsonb_build_object(
    'ok', true,
    'container_id', _container.id,
    'movement_id', _movement_id,
    'eir_id', _eir_id,
    'eir_number', _eir_number
  );
END $$;

GRANT EXECUTE ON FUNCTION public.gate_in_imported_container(text, jsonb) TO authenticated;
