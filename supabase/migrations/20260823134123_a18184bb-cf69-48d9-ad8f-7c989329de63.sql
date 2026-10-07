
-- Shared size-weighted allocation for split jobs -----------------------------
CREATE OR REPLACE FUNCTION public.apply_split_output_allocation(
  _conversion_id uuid,
  _reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _job RECORD;
  _mat numeric := 0; _lab numeric := 0; _svc numeric := 0; _sub numeric := 0;
  _acq numeric := 0; _total numeric := 0;
  _n int := 0; _wsum numeric := 0;
  _dig int := 2; _step numeric;
  _ccy text;
  _child RECORD;
  _snap jsonb;
  _weights jsonb := '[]'::jsonb;
  _comp text;
  _amount numeric;
  _alloc jsonb := '{}'::jsonb;   -- child_id -> {component -> share}
  _running numeric;
  _share numeric;
  _biggest uuid;
  _sum_total numeric := 0;
  _updated int := 0;
BEGIN
  SELECT * INTO _job FROM public.container_conversions WHERE id = _conversion_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'job_not_found'; END IF;
  IF _job.job_kind <> 'split' THEN RAISE EXCEPTION 'not_a_split_job'; END IF;

  SELECT upper(COALESCE(NULLIF(_job.currency,''), o.currency, 'USD')) INTO _ccy
    FROM public.organizations o WHERE o.id = _job.organization_id;
  BEGIN
    _dig := public.currency_digits(_ccy);
  EXCEPTION WHEN OTHERS THEN _dig := 2;
  END;
  _dig := COALESCE(_dig, 2);
  _step := power(10, -_dig)::numeric;

  SELECT COALESCE(SUM(total_cost),0) INTO _mat FROM public.conversion_materials WHERE conversion_id = _conversion_id;
  SELECT COALESCE(SUM(total_cost),0) INTO _lab FROM public.conversion_labour WHERE conversion_id = _conversion_id;
  SELECT COALESCE(SUM(cost),0)       INTO _svc FROM public.conversion_services WHERE conversion_id = _conversion_id;
  SELECT COALESCE(SUM(total_cost),0) INTO _sub FROM public.conversion_sub_assemblies WHERE conversion_id = _conversion_id;

  _acq   := COALESCE(_job.container_cost,0) + COALESCE(_job.transport_offloading_cost,0);
  _total := round(_acq + _mat + _lab + _svc + _sub, _dig);

  -- children of this job's mother unit ---------------------------------------
  CREATE TEMP TABLE IF NOT EXISTS _split_kids (
    id uuid, container_number text, weight numeric
  ) ON COMMIT DROP;
  DELETE FROM _split_kids;

  INSERT INTO _split_kids (id, container_number, weight)
  SELECT c.id, c.container_number,
         NULLIF((c.size::text), '')::numeric
    FROM public.containers c
   WHERE c.parent_container_id = _job.container_id
     AND c.organization_id = _job.organization_id;

  SELECT count(*), COALESCE(SUM(weight),0) INTO _n, _wsum FROM _split_kids;
  IF _n = 0 THEN
    RAISE EXCEPTION 'no_child_containers: this split job has no produced child units to allocate cost to';
  END IF;
  IF EXISTS (SELECT 1 FROM _split_kids WHERE weight IS NULL OR weight <= 0) THEN
    RAISE EXCEPTION 'invalid_child_size: every child unit needs a valid size before cost can be apportioned';
  END IF;

  SELECT id INTO _biggest FROM _split_kids ORDER BY weight DESC, container_number LIMIT 1;

  SELECT jsonb_agg(jsonb_build_object('container_id', id, 'container_number', container_number,
                                      'weight', weight,
                                      'share_pct', round(weight * 100 / _wsum, 4))
                   ORDER BY container_number)
    INTO _weights FROM _split_kids;

  -- allocate every component in proportion to size, residual to the largest unit
  FOREACH _comp IN ARRAY ARRAY['container','materials','labour','services','sub_assemblies'] LOOP
    _amount := round(CASE _comp
                       WHEN 'container' THEN _acq
                       WHEN 'materials' THEN _mat
                       WHEN 'labour' THEN _lab
                       WHEN 'services' THEN _svc
                       ELSE _sub END, _dig);
    _running := 0;
    FOR _child IN SELECT * FROM _split_kids ORDER BY container_number LOOP
      IF _child.id = _biggest THEN
        CONTINUE; -- handled last, takes the residual
      END IF;
      _share := round(_amount * _child.weight / _wsum, _dig);
      _running := _running + _share;
      _alloc := jsonb_set(_alloc, ARRAY[_child.id::text],
                          COALESCE(_alloc->(_child.id::text), '{}'::jsonb) || jsonb_build_object(_comp, _share), true);
    END LOOP;
    _share := round(_amount - _running, _dig);
    _alloc := jsonb_set(_alloc, ARRAY[_biggest::text],
                        COALESCE(_alloc->(_biggest::text), '{}'::jsonb) || jsonb_build_object(_comp, _share), true);
  END LOOP;

  _snap := jsonb_build_object(
    'basis', 'size_weighted',
    'total_outputs', _n,
    'weight_total', _wsum,
    'currency', _ccy,
    'rounding_digits', _dig,
    'mother_container_id', _job.container_id,
    'mother_container_number', (SELECT container_number FROM public.containers WHERE id = _job.container_id),
    'allocated_at', now(),
    'reason', NULLIF(btrim(COALESCE(_reason,'')), ''),
    'weights', _weights,
    'totals', jsonb_build_object(
      'container', COALESCE(_job.container_cost,0),
      'transport_offloading', COALESCE(_job.transport_offloading_cost,0),
      'acquisition', _acq,
      'materials', _mat, 'labour', _lab, 'services', _svc,
      'sub_assemblies', _sub, 'total', _total)
  );

  FOR _child IN SELECT * FROM _split_kids ORDER BY container_number LOOP
    _amount := round(
        COALESCE((_alloc->(_child.id::text)->>'container')::numeric,0)
      + COALESCE((_alloc->(_child.id::text)->>'materials')::numeric,0)
      + COALESCE((_alloc->(_child.id::text)->>'labour')::numeric,0)
      + COALESCE((_alloc->(_child.id::text)->>'services')::numeric,0)
      + COALESCE((_alloc->(_child.id::text)->>'sub_assemblies')::numeric,0), _dig);
    _sum_total := _sum_total + _amount;

    IF EXISTS (SELECT 1 FROM public.conversion_output_costs
                WHERE conversion_id = _conversion_id AND output_kind = 'container' AND output_id = _child.id) THEN
      UPDATE public.conversion_output_costs
         SET container_cost      = (_alloc->(_child.id::text)->>'container')::numeric,
             materials_cost      = (_alloc->(_child.id::text)->>'materials')::numeric,
             labour_cost         = (_alloc->(_child.id::text)->>'labour')::numeric,
             services_cost       = (_alloc->(_child.id::text)->>'services')::numeric,
             sub_assemblies_cost = (_alloc->(_child.id::text)->>'sub_assemblies')::numeric,
             total_cost          = _amount,
             allocation_basis    = 'size_weighted',
             snapshot            = _snap || jsonb_build_object('this_unit',
                                     jsonb_build_object('weight', _child.weight,
                                                        'share_pct', round(_child.weight*100/_wsum, 4)))
       WHERE conversion_id = _conversion_id AND output_kind = 'container' AND output_id = _child.id;
    ELSE
      INSERT INTO public.conversion_output_costs
        (conversion_id, output_kind, output_id, container_cost, materials_cost, labour_cost,
         services_cost, sub_assemblies_cost, total_cost, allocation_basis, snapshot, organization_id, created_by)
      VALUES (_conversion_id, 'container', _child.id,
              (_alloc->(_child.id::text)->>'container')::numeric,
              (_alloc->(_child.id::text)->>'materials')::numeric,
              (_alloc->(_child.id::text)->>'labour')::numeric,
              (_alloc->(_child.id::text)->>'services')::numeric,
              (_alloc->(_child.id::text)->>'sub_assemblies')::numeric,
              _amount, 'size_weighted',
              _snap || jsonb_build_object('this_unit',
                        jsonb_build_object('weight', _child.weight,
                                           'share_pct', round(_child.weight*100/_wsum, 4))),
              _job.organization_id, auth.uid());
    END IF;

    UPDATE public.containers SET acquisition_cost = _amount, updated_at = now() WHERE id = _child.id;
    _updated := _updated + 1;
  END LOOP;

  -- hard guard: the parts must add back to the mother total, to the cent
  IF abs(round(_sum_total, _dig) - _total) > _step / 2 THEN
    RAISE EXCEPTION 'allocation_mismatch: shares total % but the job total is % (%). Nothing was saved.',
      round(_sum_total, _dig), _total, _ccy;
  END IF;

  UPDATE public.container_conversions
     SET actual_cost = _total,
         unit_cost = round(_total / _n, _dig),
         updated_at = now()
   WHERE id = _conversion_id;

  RETURN jsonb_build_object(
    'children', _updated, 'total_cost', _total,
    'per_child', round(_total / _n, _dig),
    'basis', 'size_weighted', 'currency', _ccy, 'weights', _weights);
END $function$;

REVOKE ALL ON FUNCTION public.apply_split_output_allocation(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.apply_split_output_allocation(uuid, text) TO authenticated, service_role;


-- Restate uses the shared allocator ------------------------------------------
CREATE OR REPLACE FUNCTION public.recompute_split_output_costs(_conversion_id uuid, _reason text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _job RECORD; _res jsonb;
BEGIN
  IF btrim(COALESCE(_reason,'')) = '' THEN RAISE EXCEPTION 'reason_required'; END IF;
  IF NOT (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'org_owner')
          OR public.is_platform_admin()) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  SELECT * INTO _job FROM public.container_conversions WHERE id = _conversion_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'job_not_found'; END IF;

  _res := public.apply_split_output_allocation(_conversion_id, _reason);

  INSERT INTO public.finance_audit_log (organization_id, entity_type, entity_id, action, summary)
  VALUES (_job.organization_id, 'container_conversions', _conversion_id, 'split_costs_restated',
    jsonb_build_object('conversion_number', _job.conversion_number,
                       'children', _res->'children', 'total', _res->'total_cost',
                       'per_child', _res->'per_child', 'basis', 'size_weighted', 'reason', _reason));

  RETURN _res;
END $function$;


-- Completion uses the shared allocator too ------------------------------------
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
  _acq numeric := 0;
  _by_size jsonb := '{}'::jsonb;
  _numbers text[] := ARRAY[]::text[];
  _seq int := 0;
  _alloc jsonb;
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

    SELECT name INTO _org_name FROM public.organizations WHERE id = _job.organization_id;

    FOR _out IN SELECT * FROM public.conversion_outputs WHERE conversion_id=_id ORDER BY created_at LOOP
      FOR _i IN 1.._out.planned_count LOOP
        _seq := _seq + 1;
        _num := _parent_number || '(' || public.split_letter_suffix(_seq) || ')';
        WHILE EXISTS (SELECT 1 FROM public.containers WHERE organization_id = _job.organization_id AND container_number = _num) LOOP
          _seq := _seq + 1;
          _num := _parent_number || '(' || public.split_letter_suffix(_seq) || ')';
        END LOOP;
        INSERT INTO public.containers (container_number, size, category, height_class, owner, status, parent_container_id, acquisition_cost, organization_id, is_empty)
        VALUES (_num, _out.size, _out.category, _out.height_class,
                COALESCE(_out.target_owner, _org_name),
                'available', _job.container_id, 0, _job.organization_id, true)
        RETURNING id INTO _new_id;
        _numbers := _numbers || _num;
        _by_size := jsonb_set(_by_size, ARRAY[_out.size::text],
          to_jsonb(COALESCE((_by_size->>(_out.size::text))::int, 0) + 1), true);
      END LOOP;
    END LOOP;
    UPDATE public.containers SET status='converted' WHERE id=_job.container_id;

    -- size-weighted apportioning of the mother unit's full cost, validated
    _alloc := public.apply_split_output_allocation(_id, 'job completion');
    _total := (_alloc->>'total_cost')::numeric;
    _per_child := (_alloc->>'per_child')::numeric;

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
