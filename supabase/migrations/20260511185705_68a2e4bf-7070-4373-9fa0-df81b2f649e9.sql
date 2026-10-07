
-- 1) Extend container_size enum (must be committed before use)
ALTER TYPE public.container_size ADD VALUE IF NOT EXISTS '10';
ALTER TYPE public.container_size ADD VALUE IF NOT EXISTS '30';

-- 2) Organisation container prefix
ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS container_prefix text;

-- Backfill prefix from slug/name (3-4 uppercase letters), fallback DPT
UPDATE public.organizations
SET container_prefix = UPPER(
  COALESCE(
    NULLIF(regexp_replace(COALESCE(slug, name, 'depot'), '[^A-Za-z]', '', 'g'), ''),
    'DPT'
  )
)
WHERE container_prefix IS NULL OR container_prefix = '';

-- Trim/normalise to 3-4 chars
UPDATE public.organizations
SET container_prefix = SUBSTRING(container_prefix FROM 1 FOR 4)
WHERE LENGTH(container_prefix) > 4;

UPDATE public.organizations
SET container_prefix = RPAD(container_prefix, 3, 'X')
WHERE LENGTH(container_prefix) < 3;

-- 3) Per-org sequence table
CREATE TABLE IF NOT EXISTS public.org_container_sequences (
  organization_id uuid NOT NULL,
  kind text NOT NULL DEFAULT 'split',
  last_value bigint NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, kind)
);
ALTER TABLE public.org_container_sequences ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "ocs_select" ON public.org_container_sequences;
CREATE POLICY "ocs_select" ON public.org_container_sequences FOR SELECT TO authenticated
  USING (organization_id = current_org_id() OR is_platform_admin());

-- 4) Helper to mint next container number for an org
CREATE OR REPLACE FUNCTION public.next_org_container_number(_org uuid, _kind text DEFAULT 'split')
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _prefix text;
  _seq bigint;
BEGIN
  SELECT UPPER(COALESCE(container_prefix, 'DPT')) INTO _prefix
    FROM public.organizations WHERE id = _org;
  IF _prefix IS NULL OR _prefix = '' THEN _prefix := 'DPT'; END IF;
  -- Keep alpha only, 3-4 chars
  _prefix := regexp_replace(_prefix, '[^A-Z]', '', 'g');
  IF LENGTH(_prefix) < 3 THEN _prefix := RPAD(_prefix, 3, 'X'); END IF;
  IF LENGTH(_prefix) > 4 THEN _prefix := SUBSTRING(_prefix FROM 1 FOR 4); END IF;

  INSERT INTO public.org_container_sequences (organization_id, kind, last_value)
  VALUES (_org, _kind, 1)
  ON CONFLICT (organization_id, kind)
  DO UPDATE SET last_value = public.org_container_sequences.last_value + 1,
                updated_at = now()
  RETURNING last_value INTO _seq;

  RETURN _prefix || 'U' || LPAD(_seq::text, 6, '0');
END $$;

-- 5) Rewrite complete_conversion (split branch uses new numbering & owner)
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
    SELECT COALESCE(SUM(planned_count),0) INTO _children_count FROM public.conversion_outputs WHERE conversion_id=_id;
    IF _children_count = 0 THEN RAISE EXCEPTION 'split_requires_outputs'; END IF;
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

    FOR _out IN SELECT * FROM public.conversion_outputs WHERE conversion_id=_id LOOP
      FOR _i IN 1.._out.planned_count LOOP
        _num := public.next_org_container_number(_job.organization_id, 'split');
        INSERT INTO public.containers (container_number, size, category, height_class, owner, status, parent_container_id, acquisition_cost, organization_id, is_empty)
        VALUES (_num, _out.size, _out.category, _out.height_class,
                COALESCE(_out.target_owner, _org_name),
                'available', _job.container_id, _per_child, _job.organization_id, true)
        RETURNING id INTO _new_id;
        INSERT INTO public.conversion_output_costs (conversion_id, output_kind, output_id, container_cost, materials_cost, labour_cost, services_cost, sub_assemblies_cost, total_cost, allocation_basis, snapshot, organization_id, created_by)
        VALUES (_id, 'container', _new_id, _container_share, _mat_share, _lab_share, _svc_share, _sub_share, _per_child, 'equal_share', _snap, _job.organization_id, auth.uid());
      END LOOP;
    END LOOP;
    UPDATE public.containers SET status='converted' WHERE id=_job.container_id;

  ELSIF _job.job_kind = 'product' THEN
    _qty := GREATEST(1, _job.qty_produced::int);
    _per_child := _total / _qty;
    _container_share := COALESCE(_job.container_cost,0) / _qty;
    _mat_share := _mat / _qty;
    _lab_share := _lab / _qty;
    _svc_share := _svc / _qty;
    _sub_share := _sub / _qty;
    _snap := jsonb_build_object(
      'basis','equal_share','total_outputs',_qty,
      'totals', jsonb_build_object('container',_job.container_cost,'materials',_mat,'labour',_lab,'services',_svc,'sub_assemblies',_sub,'total',_total)
    );
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
    _snap := jsonb_build_object(
      'basis','equal_share','total_outputs',_qty,
      'totals', jsonb_build_object('container',_job.container_cost,'materials',_mat,'labour',_lab,'services',_svc,'sub_assemblies',_sub,'total',_total)
    );
    INSERT INTO public.conversion_output_costs (conversion_id, output_kind, output_id, container_cost, materials_cost, labour_cost, services_cost, sub_assemblies_cost, total_cost, allocation_basis, snapshot, organization_id, created_by)
    VALUES (_id, 'sub_assembly_lot', _lot_id, COALESCE(_job.container_cost,0), _mat, _lab, _svc, _sub, _total, 'equal_share', _snap, _job.organization_id, auth.uid());
  END IF;

  UPDATE public.container_conversions
    SET status='completed', completed_at=now(),
        actual_cost=_total,
        unit_cost = _total / GREATEST(1, COALESCE(NULLIF(_children_count,0), _job.qty_produced::int, 1))
    WHERE id=_id;

  _result := jsonb_build_object(
    'job_kind', _job.job_kind,
    'total_cost', _total,
    'children_created', _children_count,
    'finished_products_created', _fp_count
  );
  RETURN _result;
END $function$;

-- 6) Allow admins to update org prefix via existing organization update policy (no change needed if already present)
