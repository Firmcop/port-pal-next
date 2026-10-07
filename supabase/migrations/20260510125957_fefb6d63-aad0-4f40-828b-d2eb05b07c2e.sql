
-- 1) sub_assembly_movements ledger
CREATE TABLE IF NOT EXISTS public.sub_assembly_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assembly_stock_id uuid NOT NULL REFERENCES public.sub_assembly_stock(id) ON DELETE CASCADE,
  conversion_id uuid REFERENCES public.container_conversions(id) ON DELETE SET NULL,
  movement_type text NOT NULL CHECK (movement_type IN ('produce','consume','return','adjustment')),
  qty numeric NOT NULL,
  unit_cost numeric NOT NULL DEFAULT 0,
  reason text,
  created_by uuid,
  organization_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.sub_assembly_movements ENABLE ROW LEVEL SECURITY;

CREATE POLICY "sam_select" ON public.sub_assembly_movements FOR SELECT TO authenticated
USING (
  is_platform_admin() OR EXISTS (
    SELECT 1 FROM public.sub_assembly_stock s
    WHERE s.id = sub_assembly_movements.assembly_stock_id
      AND s.organization_id = current_org_id()
  )
);
CREATE POLICY "sam_insert" ON public.sub_assembly_movements FOR INSERT TO authenticated
WITH CHECK (
  is_platform_admin() OR EXISTS (
    SELECT 1 FROM public.sub_assembly_stock s
    WHERE s.id = assembly_stock_id
      AND s.organization_id = current_org_id()
  )
);

CREATE INDEX IF NOT EXISTS idx_sam_stock ON public.sub_assembly_movements(assembly_stock_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sam_conv ON public.sub_assembly_movements(conversion_id);

-- 2) conversion_output_costs
CREATE TABLE IF NOT EXISTS public.conversion_output_costs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversion_id uuid NOT NULL REFERENCES public.container_conversions(id) ON DELETE CASCADE,
  output_kind text NOT NULL CHECK (output_kind IN ('container','finished_product','sub_assembly_lot')),
  output_id uuid NOT NULL,
  container_cost numeric NOT NULL DEFAULT 0,
  materials_cost numeric NOT NULL DEFAULT 0,
  labour_cost numeric NOT NULL DEFAULT 0,
  services_cost numeric NOT NULL DEFAULT 0,
  sub_assemblies_cost numeric NOT NULL DEFAULT 0,
  total_cost numeric NOT NULL DEFAULT 0,
  allocation_basis text NOT NULL DEFAULT 'equal_share',
  snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  organization_id uuid,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.conversion_output_costs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "coc_select" ON public.conversion_output_costs FOR SELECT TO authenticated
USING (
  is_platform_admin() OR EXISTS (
    SELECT 1 FROM public.container_conversions cc
    WHERE cc.id = conversion_output_costs.conversion_id
      AND cc.organization_id = current_org_id()
  )
);
CREATE POLICY "coc_insert" ON public.conversion_output_costs FOR INSERT TO authenticated
WITH CHECK (
  is_platform_admin() OR EXISTS (
    SELECT 1 FROM public.container_conversions cc
    WHERE cc.id = conversion_id
      AND cc.organization_id = current_org_id()
  )
);

CREATE INDEX IF NOT EXISTS idx_coc_conv ON public.conversion_output_costs(conversion_id);
CREATE INDEX IF NOT EXISTS idx_coc_output ON public.conversion_output_costs(output_kind, output_id);

-- 3) variance summary view
CREATE OR REPLACE VIEW public.conversion_variance_summary AS
SELECT
  cc.id AS conversion_id,
  cc.organization_id,
  cc.conversion_number,
  cc.status,
  cc.job_kind,
  COALESCE(SUM(cm.qty_planned * cm.unit_cost), 0) AS planned_cost,
  COALESCE(SUM(COALESCE(cm.qty_used, cm.quantity, 0) * cm.unit_cost), 0) AS actual_cost,
  COALESCE(SUM((COALESCE(cm.qty_used, cm.quantity, 0) - cm.qty_planned) * cm.unit_cost), 0) AS variance_cost,
  COALESCE(SUM(cm.qty_planned), 0) AS planned_qty,
  COALESCE(SUM(COALESCE(cm.qty_used, cm.quantity, 0)), 0) AS actual_qty
FROM public.container_conversions cc
LEFT JOIN public.conversion_materials cm ON cm.conversion_id = cc.id
GROUP BY cc.id;

GRANT SELECT ON public.conversion_variance_summary TO authenticated;

-- 4) update add_sub_assembly_stock to write a 'produce' ledger row
CREATE OR REPLACE FUNCTION public.add_sub_assembly_stock(_stock_id uuid, _qty numeric, _unit_cost numeric, _conversion_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE _on_hand numeric; _avg numeric; _new_on_hand numeric; _new_avg numeric; _org uuid;
BEGIN
  SELECT on_hand_qty, avg_unit_cost, organization_id INTO _on_hand, _avg, _org
    FROM public.sub_assembly_stock WHERE id=_stock_id FOR UPDATE;
  _new_on_hand := COALESCE(_on_hand,0) + _qty;
  _new_avg := CASE WHEN _new_on_hand > 0
    THEN ((COALESCE(_on_hand,0)*COALESCE(_avg,0)) + (_qty*_unit_cost))/_new_on_hand
    ELSE _avg END;
  UPDATE public.sub_assembly_stock SET on_hand_qty=_new_on_hand, avg_unit_cost=_new_avg WHERE id=_stock_id;
  INSERT INTO public.sub_assembly_lots (assembly_stock_id, conversion_id, qty, unit_cost)
  VALUES (_stock_id, _conversion_id, _qty, _unit_cost);
  INSERT INTO public.sub_assembly_movements (assembly_stock_id, conversion_id, movement_type, qty, unit_cost, reason, created_by, organization_id)
  VALUES (_stock_id, _conversion_id, 'produce', _qty, _unit_cost, 'Produced from job', auth.uid(), _org);
END $function$;

-- 5) consume_sub_assembly: accept reason, write ledger
CREATE OR REPLACE FUNCTION public.consume_sub_assembly(_conversion_id uuid, _csa_id uuid, _qty numeric, _reason text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE _stock_id uuid; _on_hand numeric; _cost numeric; _org uuid;
BEGIN
  IF _qty <= 0 THEN RAISE EXCEPTION 'qty must be positive'; END IF;
  SELECT assembly_stock_id INTO _stock_id FROM public.conversion_sub_assemblies WHERE id=_csa_id;
  SELECT on_hand_qty, avg_unit_cost, organization_id INTO _on_hand, _cost, _org
    FROM public.sub_assembly_stock WHERE id=_stock_id FOR UPDATE;
  IF _on_hand < _qty AND NOT has_role(auth.uid(),'admin'::app_role) THEN
    RAISE EXCEPTION 'insufficient_assembly_stock';
  END IF;
  UPDATE public.sub_assembly_stock SET on_hand_qty = on_hand_qty - _qty WHERE id=_stock_id;
  UPDATE public.conversion_sub_assemblies
    SET qty_used = COALESCE(qty_used,0) + _qty,
        unit_cost_snapshot = _cost,
        total_cost = (COALESCE(qty_used,0) + _qty) * _cost
    WHERE id=_csa_id;
  INSERT INTO public.sub_assembly_movements (assembly_stock_id, conversion_id, movement_type, qty, unit_cost, reason, created_by, organization_id)
  VALUES (_stock_id, _conversion_id, 'consume', -_qty, _cost, COALESCE(_reason,'Issued to job'), auth.uid(), _org);
END $function$;

-- 6) return_sub_assembly
CREATE OR REPLACE FUNCTION public.return_sub_assembly(_conversion_id uuid, _csa_id uuid, _qty numeric, _reason text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE _stock_id uuid; _cost numeric; _org uuid; _used numeric;
BEGIN
  IF _qty <= 0 THEN RAISE EXCEPTION 'qty must be positive'; END IF;
  SELECT assembly_stock_id, COALESCE(qty_used,0) INTO _stock_id, _used FROM public.conversion_sub_assemblies WHERE id=_csa_id;
  IF _used < _qty THEN RAISE EXCEPTION 'cannot_return_more_than_used'; END IF;
  SELECT avg_unit_cost, organization_id INTO _cost, _org
    FROM public.sub_assembly_stock WHERE id=_stock_id FOR UPDATE;
  UPDATE public.sub_assembly_stock SET on_hand_qty = on_hand_qty + _qty WHERE id=_stock_id;
  UPDATE public.conversion_sub_assemblies
    SET qty_used = COALESCE(qty_used,0) - _qty,
        total_cost = GREATEST(COALESCE(qty_used,0) - _qty, 0) * COALESCE(unit_cost_snapshot, _cost)
    WHERE id=_csa_id;
  INSERT INTO public.sub_assembly_movements (assembly_stock_id, conversion_id, movement_type, qty, unit_cost, reason, created_by, organization_id)
  VALUES (_stock_id, _conversion_id, 'return', _qty, _cost, COALESCE(_reason,'Returned from job'), auth.uid(), _org);
END $function$;

-- 7) complete_conversion: persist per-output cost rows
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
    FOR _out IN SELECT * FROM public.conversion_outputs WHERE conversion_id=_id LOOP
      FOR _i IN 1.._out.planned_count LOOP
        _num := COALESCE(_out.number_prefix,'CHILD-') || to_char(now(),'YYMMDDHH24MISS') || '-' || lpad(_i::text,2,'0') || '-' || substring(gen_random_uuid()::text,1,4);
        INSERT INTO public.containers (container_number, size, category, height_class, owner, status, parent_container_id, acquisition_cost, organization_id)
        VALUES (_num, _out.size, _out.category, _out.height_class,
                COALESCE(_out.target_owner, (SELECT owner FROM public.containers WHERE id=_job.container_id)),
                'available', _job.container_id, _per_child, _job.organization_id)
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
