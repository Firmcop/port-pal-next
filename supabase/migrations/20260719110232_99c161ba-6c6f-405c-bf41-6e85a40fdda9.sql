
-- 1) Split naming: helper to convert 1-based index to A, B, ..., Z, AA, AB, ...
CREATE OR REPLACE FUNCTION public.split_letter_suffix(_n int)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  _s text := '';
  _i int := _n;
BEGIN
  IF _i <= 0 THEN RETURN 'A'; END IF;
  WHILE _i > 0 LOOP
    _s := chr(65 + ((_i - 1) % 26)) || _s;
    _i := (_i - 1) / 26;
  END LOOP;
  RETURN _s;
END $$;

-- 2) Rewrite complete_conversion so split children take the parent number + letter suffix
CREATE OR REPLACE FUNCTION public.complete_conversion(_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _job RECORD; _mat numeric:=0; _lab numeric:=0; _svc numeric:=0; _sub numeric:=0;
  _total numeric; _children_count int:=0; _per_child numeric:=0;
  _out RECORD; _i int; _new_id uuid; _num text; _result jsonb;
  _stock_id uuid; _fp_id uuid; _fp_count int:=0;
  _container_share numeric; _mat_share numeric; _lab_share numeric; _svc_share numeric; _sub_share numeric;
  _qty int; _lot_id uuid; _snap jsonb;
  _org_name text;
  _parent_size int; _parent_number text;
  _planned_footprint int := 0;
  _bad int;
  _by_size jsonb := '{}'::jsonb;
  _numbers text[] := ARRAY[]::text[];
  _seq int := 0;
BEGIN
  SELECT * INTO _job FROM public.container_conversions WHERE id=_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'job_not_found'; END IF;
  IF _job.status='completed' THEN RAISE EXCEPTION 'already_completed'; END IF;

  SELECT COALESCE(SUM(total_cost),0) INTO _mat FROM public.conversion_materials WHERE conversion_id=_id;
  SELECT COALESCE(SUM(total_cost),0) INTO _lab FROM public.conversion_labour WHERE conversion_id=_id;
  SELECT COALESCE(SUM(cost),0) INTO _svc FROM public.conversion_services WHERE conversion_id=_id;
  SELECT COALESCE(SUM(total_cost),0) INTO _sub FROM public.conversion_sub_assemblies WHERE conversion_id=_id;
  _total := COALESCE(_job.container_cost,0) + _mat + _lab + _svc + _sub;

  IF _job.job_kind = 'split' THEN
    IF _job.container_id IS NULL THEN RAISE EXCEPTION 'split_requires_source_container'; END IF;
    SELECT (size::text)::int, container_number INTO _parent_size, _parent_number
      FROM public.containers WHERE id = _job.container_id;
    IF _parent_size IS NULL THEN RAISE EXCEPTION 'split_requires_source_container'; END IF;

    SELECT COALESCE(SUM(planned_count),0) INTO _children_count FROM public.conversion_outputs WHERE conversion_id=_id;
    IF _children_count = 0 THEN RAISE EXCEPTION 'split_requires_outputs'; END IF;
    IF _children_count > 26 THEN RAISE EXCEPTION 'split_invalid_count'; END IF;

    SELECT COUNT(*) INTO _bad FROM public.conversion_outputs
      WHERE conversion_id=_id AND (size::text NOT IN ('10','20','30','40','45'));
    IF _bad > 0 THEN RAISE EXCEPTION 'split_invalid_size'; END IF;

    SELECT COUNT(*) INTO _bad FROM public.conversion_outputs
      WHERE conversion_id=_id AND (planned_count <= 0 OR planned_count > 26);
    IF _bad > 0 THEN RAISE EXCEPTION 'split_invalid_count'; END IF;

    SELECT COUNT(*) INTO _bad FROM public.conversion_outputs
      WHERE conversion_id=_id AND category::text='dry' AND height_class IS NULL;
    IF _bad > 0 THEN RAISE EXCEPTION 'split_dry_requires_height_class'; END IF;

    SELECT COUNT(*) INTO _bad FROM public.conversion_outputs
      WHERE conversion_id=_id AND category::text<>'dry' AND height_class IS NOT NULL;
    IF _bad > 0 THEN RAISE EXCEPTION 'split_height_class_not_allowed'; END IF;

    SELECT COALESCE(SUM((size::text)::int * planned_count),0) INTO _planned_footprint
      FROM public.conversion_outputs WHERE conversion_id=_id;
    IF _planned_footprint > _parent_size THEN RAISE EXCEPTION 'split_size_compat'; END IF;

    _per_child := _total / _children_count;
    _container_share := COALESCE(_job.container_cost,0) / _children_count;
    _mat_share := _mat / _children_count;
    _lab_share := _lab / _children_count;
    _svc_share := _svc / _children_count;
    _sub_share := _sub / _children_count;
    _snap := jsonb_build_object(
      'basis','equal_share','total_outputs',_children_count,
      'totals', jsonb_build_object('container',_job.container_cost,'materials',_mat,'labour',_lab,'services',_svc,'sub_assemblies',_sub,'total',_total)
    );

    SELECT name INTO _org_name FROM public.organizations WHERE id = _job.organization_id;

    FOR _out IN SELECT * FROM public.conversion_outputs WHERE conversion_id=_id ORDER BY created_at LOOP
      FOR _i IN 1.._out.planned_count LOOP
        _seq := _seq + 1;
        _num := _parent_number || '(' || public.split_letter_suffix(_seq) || ')';
        -- Guarantee uniqueness inside the organization
        WHILE EXISTS (SELECT 1 FROM public.containers WHERE organization_id = _job.organization_id AND container_number = _num) LOOP
          _seq := _seq + 1;
          _num := _parent_number || '(' || public.split_letter_suffix(_seq) || ')';
        END LOOP;
        INSERT INTO public.containers (container_number, size, category, height_class, owner, status, parent_container_id, acquisition_cost, organization_id, is_empty)
        VALUES (_num, _out.size, _out.category, _out.height_class,
                COALESCE(_out.target_owner, _org_name),
                'available', _job.container_id, _per_child, _job.organization_id, true)
        RETURNING id INTO _new_id;
        INSERT INTO public.conversion_output_costs (conversion_id, output_kind, output_id, container_cost, materials_cost, labour_cost, services_cost, sub_assemblies_cost, total_cost, allocation_basis, snapshot, organization_id, created_by)
        VALUES (_id, 'container', _new_id, _container_share, _mat_share, _lab_share, _svc_share, _sub_share, _per_child, 'equal_share', _snap, _job.organization_id, auth.uid());
        _numbers := _numbers || _num;
        _by_size := jsonb_set(_by_size, ARRAY[_out.size::text],
          to_jsonb(COALESCE((_by_size->>(_out.size::text))::int, 0) + 1), true);
      END LOOP;
    END LOOP;
    UPDATE public.containers SET status='converted' WHERE id=_job.container_id;

    PERFORM public.log_org_event(
      _job.organization_id, 'split_children_generated',
      jsonb_build_object(
        'conversion_id', _job.id, 'conversion_number', _job.conversion_number,
        'parent_container_id', _job.container_id, 'parent_container_number', _parent_number,
        'owner', _org_name, 'total_created', _children_count,
        'by_size', _by_size, 'container_numbers', to_jsonb(_numbers)
      ),
      auth.uid()
    );

  ELSIF _job.job_kind = 'product' THEN
    _qty := GREATEST(1, _job.qty_produced::int);
    _per_child := _total / _qty;
    _container_share := COALESCE(_job.container_cost,0) / _qty;
    _mat_share := _mat / _qty; _lab_share := _lab / _qty;
    _svc_share := _svc / _qty; _sub_share := _sub / _qty;
    _snap := jsonb_build_object('basis','equal_share','total_outputs',_qty,
      'totals', jsonb_build_object('container',_job.container_cost,'materials',_mat,'labour',_lab,'services',_svc,'sub_assemblies',_sub,'total',_total));
    FOR _i IN 1.._qty LOOP
      _num := 'FP-' || to_char(now(),'YYMMDDHH24MISS') || '-' || lpad(_i::text,2,'0');
      INSERT INTO public.finished_products (product_number, product_type, source_conversion_id, source_container_id, total_cost, list_price, status, organization_id, created_by)
      VALUES (_num, _job.product_type, _id, _job.container_id, _per_child,
              COALESCE(_job.quoted_price,0)/_qty, 'in_stock', _job.organization_id, auth.uid())
      RETURNING id INTO _fp_id;
      INSERT INTO public.conversion_output_costs (conversion_id, output_kind, output_id, container_cost, materials_cost, labour_cost, services_cost, sub_assemblies_cost, total_cost, allocation_basis, snapshot, organization_id, created_by)
      VALUES (_id, 'finished_product', _fp_id, _container_share, _mat_share, _lab_share, _svc_share, _sub_share, _per_child, 'equal_share', _snap, _job.organization_id, auth.uid());
      _fp_count := _fp_count + 1;
    END LOOP;
    IF _job.container_id IS NOT NULL THEN
      UPDATE public.containers SET status='converted' WHERE id=_job.container_id;
    END IF;

  ELSIF _job.job_kind = 'sub_assembly' THEN
    IF _job.assembly_type IS NULL THEN RAISE EXCEPTION 'sub_assembly_requires_type'; END IF;
    INSERT INTO public.sub_assembly_stock (assembly_type, name, uom, organization_id)
    VALUES (_job.assembly_type, COALESCE(_job.description, _job.assembly_type::text), COALESCE(_job.unit_of_measure,'pcs'), _job.organization_id)
    ON CONFLICT (organization_id, assembly_type, name) DO UPDATE SET updated_at=now()
    RETURNING id INTO _stock_id;
    PERFORM public.add_sub_assembly_stock(_stock_id, _job.qty_produced, _total / GREATEST(1,_job.qty_produced), _id);
    SELECT id INTO _lot_id FROM public.sub_assembly_lots
      WHERE conversion_id=_id AND assembly_stock_id=_stock_id ORDER BY created_at DESC LIMIT 1;
    _qty := GREATEST(1, _job.qty_produced::int);
    _snap := jsonb_build_object('basis','equal_share','total_outputs',_qty,
      'totals', jsonb_build_object('container',_job.container_cost,'materials',_mat,'labour',_lab,'services',_svc,'sub_assemblies',_sub,'total',_total));
    INSERT INTO public.conversion_output_costs (conversion_id, output_kind, output_id, container_cost, materials_cost, labour_cost, services_cost, sub_assemblies_cost, total_cost, allocation_basis, snapshot, organization_id, created_by)
    VALUES (_id, 'sub_assembly_lot', _lot_id, COALESCE(_job.container_cost,0), _mat, _lab, _svc, _sub, _total, 'equal_share', _snap, _job.organization_id, auth.uid());
  END IF;

  UPDATE public.container_conversions
    SET status='completed', completed_at=now(),
        actual_cost=_total,
        unit_cost = _total / GREATEST(1, COALESCE(NULLIF(_children_count,0), _job.qty_produced::int, 1))
    WHERE id=_id;

  _result := jsonb_build_object(
    'job_kind', _job.job_kind, 'total_cost', _total,
    'children_created', _children_count, 'finished_products_created', _fp_count
  );
  RETURN _result;
END $function$;

-- 3) Backfill: rename existing split children to <PARENT>(<LETTER>).
--    Skips containers whose current number already contains '(' to avoid double-processing.
DO $$
DECLARE _job RECORD; _child RECORD; _parent_number text; _seq int; _new_num text;
BEGIN
  FOR _job IN
    SELECT cc.id, cc.container_id, cc.organization_id, c.container_number AS parent_number
    FROM public.container_conversions cc
    JOIN public.containers c ON c.id = cc.container_id
    WHERE cc.job_kind = 'split' AND cc.status = 'completed' AND cc.container_id IS NOT NULL
  LOOP
    _seq := 0;
    FOR _child IN
      SELECT id, container_number FROM public.containers
      WHERE parent_container_id = _job.container_id AND container_number NOT LIKE '%(%'
      ORDER BY created_at
    LOOP
      _seq := _seq + 1;
      _new_num := _job.parent_number || '(' || public.split_letter_suffix(_seq) || ')';
      WHILE EXISTS (SELECT 1 FROM public.containers WHERE organization_id = _job.organization_id AND container_number = _new_num AND id <> _child.id) LOOP
        _seq := _seq + 1;
        _new_num := _job.parent_number || '(' || public.split_letter_suffix(_seq) || ')';
      END LOOP;
      UPDATE public.containers SET container_number = _new_num WHERE id = _child.id;
    END LOOP;
  END LOOP;
END $$;

-- 4) Finished-product gate-out fields + action
ALTER TABLE public.finished_products
  ADD COLUMN IF NOT EXISTS gated_out_at timestamptz,
  ADD COLUMN IF NOT EXISTS gated_out_by uuid,
  ADD COLUMN IF NOT EXISTS gate_out_notes text,
  ADD COLUMN IF NOT EXISTS gate_out_checklist jsonb,
  ADD COLUMN IF NOT EXISTS gate_out_truck_plate text,
  ADD COLUMN IF NOT EXISTS gate_out_driver_name text,
  ADD COLUMN IF NOT EXISTS gate_out_driver_phone text,
  ADD COLUMN IF NOT EXISTS gate_out_transporter text,
  ADD COLUMN IF NOT EXISTS gate_out_indemnity_signed boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS gate_out_indemnity_signer text;

CREATE OR REPLACE FUNCTION public.gate_out_finished_product(
  _finished_product_id uuid,
  _checklist jsonb,
  _truck_plate text,
  _driver_name text,
  _driver_phone text,
  _transporter text,
  _indemnity_signer text,
  _notes text
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _fp RECORD;
  _bad int;
BEGIN
  SELECT * INTO _fp FROM public.finished_products WHERE id = _finished_product_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'finished_product_not_found'; END IF;
  IF _fp.gated_out_at IS NOT NULL THEN RAISE EXCEPTION 'already_gated_out'; END IF;
  IF _fp.status IN ('in_production','scrapped') THEN RAISE EXCEPTION 'finished_product_not_ready_for_gate_out'; END IF;
  IF _checklist IS NULL OR jsonb_typeof(_checklist) <> 'object' THEN RAISE EXCEPTION 'checklist_required'; END IF;

  -- All checklist items must be true (any false / null blocks gate-out)
  SELECT COUNT(*) INTO _bad
  FROM jsonb_each(_checklist) AS kv(k, v)
  WHERE (v::text)::boolean IS DISTINCT FROM true;
  IF _bad > 0 THEN RAISE EXCEPTION 'checklist_incomplete'; END IF;

  IF _truck_plate IS NULL OR length(trim(_truck_plate)) = 0 THEN RAISE EXCEPTION 'truck_plate_required'; END IF;
  IF _driver_name IS NULL OR length(trim(_driver_name)) = 0 THEN RAISE EXCEPTION 'driver_name_required'; END IF;
  IF _indemnity_signer IS NULL OR length(trim(_indemnity_signer)) = 0 THEN RAISE EXCEPTION 'indemnity_signer_required'; END IF;

  UPDATE public.finished_products
     SET gated_out_at = now(),
         gated_out_by = auth.uid(),
         gate_out_notes = _notes,
         gate_out_checklist = _checklist,
         gate_out_truck_plate = _truck_plate,
         gate_out_driver_name = _driver_name,
         gate_out_driver_phone = _driver_phone,
         gate_out_transporter = _transporter,
         gate_out_indemnity_signed = true,
         gate_out_indemnity_signer = _indemnity_signer
   WHERE id = _finished_product_id;

  PERFORM public.log_org_event(
    _fp.organization_id, 'finished_product_gated_out',
    jsonb_build_object(
      'finished_product_id', _fp.id, 'product_number', _fp.product_number,
      'product_type', _fp.product_type, 'truck_plate', _truck_plate,
      'driver_name', _driver_name, 'transporter', _transporter, 'checklist', _checklist
    ),
    auth.uid()
  );
  RETURN _fp.id;
END $$;

GRANT EXECUTE ON FUNCTION public.gate_out_finished_product(uuid, jsonb, text, text, text, text, text, text) TO authenticated;

-- 5) Quote templates: reference file (PDF / spreadsheet) used as a starter
ALTER TABLE public.quote_templates
  ADD COLUMN IF NOT EXISTS reference_file_url text,
  ADD COLUMN IF NOT EXISTS reference_file_name text,
  ADD COLUMN IF NOT EXISTS reference_file_kind text CHECK (reference_file_kind IN ('pdf','spreadsheet','other'));
