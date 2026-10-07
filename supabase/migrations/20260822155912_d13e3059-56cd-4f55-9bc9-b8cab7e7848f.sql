ALTER TABLE public.sub_assembly_stock ADD COLUMN IF NOT EXISTS project_id uuid REFERENCES public.projects(id) ON DELETE SET NULL;
ALTER TABLE public.sub_assembly_lots ADD COLUMN IF NOT EXISTS project_id uuid REFERENCES public.projects(id) ON DELETE SET NULL;
ALTER TABLE public.sub_assembly_movements ADD COLUMN IF NOT EXISTS project_id uuid REFERENCES public.projects(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_sa_stock_project ON public.sub_assembly_stock(project_id);
CREATE INDEX IF NOT EXISTS idx_sa_lots_project ON public.sub_assembly_lots(project_id);
CREATE INDEX IF NOT EXISTS idx_sa_moves_project ON public.sub_assembly_movements(project_id);

CREATE OR REPLACE FUNCTION public.build_sub_assembly(_assembly_stock_id uuid, _qty numeric, _notes text DEFAULT NULL::text, _project_id uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _org uuid;
  _bom_cost numeric;
  _mat_cost numeric := 0;
  _lab_cost numeric := 0;
  _ovh_cost numeric := 0;
  _on_hand numeric;
  _avg numeric;
  _new_on_hand numeric;
  _new_avg numeric;
  _lot_id uuid;
  _row record;
  _mat_on_hand numeric;
  _proj uuid;
BEGIN
  IF _qty IS NULL OR _qty <= 0 THEN RAISE EXCEPTION 'qty must be positive'; END IF;

  SELECT organization_id, on_hand_qty, avg_unit_cost, project_id INTO _org, _on_hand, _avg, _proj
    FROM sub_assembly_stock WHERE id = _assembly_stock_id FOR UPDATE;
  IF _org IS NULL THEN RAISE EXCEPTION 'sub_assembly_stock not found'; END IF;
  _proj := COALESCE(_project_id, _proj);

  FOR _row IN
    SELECT b.material_id, b.qty_per_unit * _qty AS need, COALESCE(m.avg_unit_cost, m.unit_cost, 0) AS unit_cost
      FROM sub_assembly_bom_materials b
      JOIN materials m ON m.id = b.material_id
     WHERE b.assembly_stock_id = _assembly_stock_id
  LOOP
    SELECT on_hand_qty INTO _mat_on_hand FROM materials WHERE id = _row.material_id FOR UPDATE;
    IF _mat_on_hand < _row.need AND NOT has_role(auth.uid(), 'admin'::app_role) THEN
      RAISE EXCEPTION 'insufficient material stock for material %', _row.material_id;
    END IF;
    INSERT INTO material_movements (material_id, movement_type, qty, unit_cost, reason, organization_id, created_by)
      VALUES (_row.material_id, 'issue'::material_movement_type, -_row.need, _row.unit_cost,
              'sub_assembly_build:'||_assembly_stock_id::text, _org, auth.uid());
    _mat_cost := _mat_cost + _row.need * _row.unit_cost;
  END LOOP;

  SELECT COALESCE(SUM(hours_per_unit * rate_per_hour), 0) * _qty INTO _lab_cost
    FROM sub_assembly_bom_labor WHERE assembly_stock_id = _assembly_stock_id;
  SELECT COALESCE(SUM(cost_per_unit), 0) * _qty INTO _ovh_cost
    FROM sub_assembly_bom_overheads WHERE assembly_stock_id = _assembly_stock_id;

  _bom_cost := (_mat_cost + _lab_cost + _ovh_cost) / NULLIF(_qty, 0);

  INSERT INTO sub_assembly_lots (assembly_stock_id, qty, unit_cost, organization_id, project_id)
    VALUES (_assembly_stock_id, _qty, COALESCE(_bom_cost, 0), _org, _proj)
    RETURNING id INTO _lot_id;

  INSERT INTO sub_assembly_movements (assembly_stock_id, movement_type, qty, unit_cost, reason, created_by, organization_id, project_id)
    VALUES (_assembly_stock_id, 'produce', _qty, COALESCE(_bom_cost, 0), COALESCE(_notes, 'Build'), auth.uid(), _org, _proj);

  _new_on_hand := COALESCE(_on_hand, 0) + _qty;
  IF _new_on_hand > 0 THEN
    _new_avg := ((COALESCE(_on_hand, 0) * COALESCE(_avg, 0)) + (_qty * COALESCE(_bom_cost, 0))) / _new_on_hand;
  ELSE
    _new_avg := _avg;
  END IF;
  UPDATE sub_assembly_stock
     SET on_hand_qty = _new_on_hand,
         avg_unit_cost = COALESCE(_new_avg, avg_unit_cost),
         updated_at = now()
   WHERE id = _assembly_stock_id;

  IF _lab_cost > 0 THEN
    INSERT INTO accounting_transactions (transaction_number, account_type, category, description, debit_amount, reference_type, reference_id, organization_id, created_by, project_id)
      VALUES ('SA-LAB-'||substr(_lot_id::text,1,8), 'expense'::account_type, 'manufacturing_labor',
              'Sub-assembly build labor', _lab_cost, 'sub_assembly_lot', _lot_id, _org, auth.uid(), _proj);
  END IF;
  IF _ovh_cost > 0 THEN
    INSERT INTO accounting_transactions (transaction_number, account_type, category, description, debit_amount, reference_type, reference_id, organization_id, created_by, project_id)
      VALUES ('SA-OVH-'||substr(_lot_id::text,1,8), 'expense'::account_type, 'manufacturing_overhead',
              'Sub-assembly build overhead', _ovh_cost, 'sub_assembly_lot', _lot_id, _org, auth.uid(), _proj);
  END IF;

  RETURN _lot_id;
END $function$;

CREATE OR REPLACE FUNCTION public.add_sub_assembly_stock(_stock_id uuid, _qty numeric, _unit_cost numeric, _conversion_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _on_hand numeric; _avg numeric; _new_on_hand numeric; _new_avg numeric; _org uuid; _proj uuid;
BEGIN
  SELECT on_hand_qty, avg_unit_cost, organization_id, project_id INTO _on_hand, _avg, _org, _proj
    FROM public.sub_assembly_stock WHERE id=_stock_id FOR UPDATE;
  IF _conversion_id IS NOT NULL THEN
    SELECT COALESCE(cc.project_id, _proj) INTO _proj FROM public.container_conversions cc WHERE cc.id = _conversion_id;
  END IF;
  _new_on_hand := COALESCE(_on_hand,0) + _qty;
  _new_avg := CASE WHEN _new_on_hand > 0
    THEN ((COALESCE(_on_hand,0)*COALESCE(_avg,0)) + (_qty*_unit_cost))/_new_on_hand
    ELSE _avg END;
  UPDATE public.sub_assembly_stock SET on_hand_qty=_new_on_hand, avg_unit_cost=_new_avg WHERE id=_stock_id;
  INSERT INTO public.sub_assembly_lots (assembly_stock_id, conversion_id, qty, unit_cost, project_id)
  VALUES (_stock_id, _conversion_id, _qty, _unit_cost, _proj);
  INSERT INTO public.sub_assembly_movements (assembly_stock_id, conversion_id, movement_type, qty, unit_cost, reason, created_by, organization_id, project_id)
  VALUES (_stock_id, _conversion_id, 'produce', _qty, _unit_cost, 'Produced from job', auth.uid(), _org, _proj);
END $function$;

REVOKE ALL ON FUNCTION public.build_sub_assembly(uuid, numeric, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.build_sub_assembly(uuid, numeric, text, uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.add_sub_assembly_stock(uuid, numeric, numeric, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.add_sub_assembly_stock(uuid, numeric, numeric, uuid) TO authenticated;
DROP FUNCTION IF EXISTS public.build_sub_assembly(uuid, numeric, text);