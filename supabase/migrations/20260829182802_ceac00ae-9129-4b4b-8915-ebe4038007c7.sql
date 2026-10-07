-- 1. Audit table for job material lines
CREATE TABLE public.conversion_material_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid,
  conversion_id uuid,
  conversion_material_id uuid,
  material_id uuid,
  event text NOT NULL,
  qty numeric,
  unit_cost numeric,
  field_changed text,
  old_value text,
  new_value text,
  reason text,
  note text,
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT ON public.conversion_material_audit TO authenticated;
GRANT ALL ON public.conversion_material_audit TO service_role;

ALTER TABLE public.conversion_material_audit ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org members can view conversion material audit"
  ON public.conversion_material_audit FOR SELECT TO authenticated
  USING (organization_id = current_org_id() OR is_platform_admin());

CREATE POLICY "Org members can insert conversion material audit"
  ON public.conversion_material_audit FOR INSERT TO authenticated
  WITH CHECK (organization_id = current_org_id() OR is_platform_admin());

CREATE INDEX idx_cma_conversion ON public.conversion_material_audit (conversion_id, created_at DESC);
CREATE INDEX idx_cma_line ON public.conversion_material_audit (conversion_material_id, created_at DESC);

-- 2. Snapshot columns on movements
ALTER TABLE public.material_movements
  ADD COLUMN IF NOT EXISTS note text,
  ADD COLUMN IF NOT EXISTS planned_qty_snapshot numeric,
  ADD COLUMN IF NOT EXISTS planned_unit_cost_snapshot numeric;

-- 3. Trigger auditing manual edits to job material lines
CREATE OR REPLACE FUNCTION public.audit_conversion_material_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE _org uuid;
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.conversion_material_audit
      (organization_id, conversion_id, conversion_material_id, material_id, event, qty, unit_cost, new_value)
    VALUES (NEW.organization_id, NEW.conversion_id, NEW.id, NEW.material_id, 'line_created',
            NEW.qty_used, NEW.unit_cost, NEW.description);
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    INSERT INTO public.conversion_material_audit
      (organization_id, conversion_id, conversion_material_id, material_id, event, qty, unit_cost, old_value)
    VALUES (OLD.organization_id, OLD.conversion_id, OLD.id, OLD.material_id, 'line_deleted',
            OLD.qty_used, OLD.unit_cost, OLD.description);
    RETURN OLD;
  END IF;

  _org := NEW.organization_id;

  IF COALESCE(NEW.qty_planned, -1) IS DISTINCT FROM COALESCE(OLD.qty_planned, -1) THEN
    INSERT INTO public.conversion_material_audit
      (organization_id, conversion_id, conversion_material_id, material_id, event, field_changed, old_value, new_value)
    VALUES (_org, NEW.conversion_id, NEW.id, NEW.material_id, 'planned_qty_changed', 'qty_planned',
            OLD.qty_planned::text, NEW.qty_planned::text);
  END IF;

  IF COALESCE(NEW.qty_used, -1) IS DISTINCT FROM COALESCE(OLD.qty_used, -1) THEN
    INSERT INTO public.conversion_material_audit
      (organization_id, conversion_id, conversion_material_id, material_id, event, field_changed, old_value, new_value)
    VALUES (_org, NEW.conversion_id, NEW.id, NEW.material_id, 'used_qty_changed', 'qty_used',
            OLD.qty_used::text, NEW.qty_used::text);
  END IF;

  IF COALESCE(NEW.unit_cost, -1) IS DISTINCT FROM COALESCE(OLD.unit_cost, -1) THEN
    INSERT INTO public.conversion_material_audit
      (organization_id, conversion_id, conversion_material_id, material_id, event, field_changed, old_value, new_value)
    VALUES (_org, NEW.conversion_id, NEW.id, NEW.material_id, 'unit_cost_changed', 'unit_cost',
            OLD.unit_cost::text, NEW.unit_cost::text);
  END IF;

  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS trg_audit_conversion_material ON public.conversion_materials;
CREATE TRIGGER trg_audit_conversion_material
AFTER INSERT OR UPDATE OR DELETE ON public.conversion_materials
FOR EACH ROW EXECUTE FUNCTION public.audit_conversion_material_change();

-- 4. Issue / return with snapshots + audit
CREATE OR REPLACE FUNCTION public.issue_material_to_job(
  _conversion_id uuid, _material_id uuid, _qty numeric,
  _allow_negative boolean DEFAULT false, _reason text DEFAULT NULL, _note text DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE _on_hand numeric; _cost numeric; _id uuid; _name text;
        _p_qty numeric; _p_cost numeric; _org uuid; _line uuid;
BEGIN
  IF _qty <= 0 THEN RAISE EXCEPTION 'qty must be positive'; END IF;
  SELECT on_hand_qty, COALESCE(avg_unit_cost, unit_cost, 0), name
    INTO _on_hand, _cost, _name FROM public.materials WHERE id = _material_id;
  IF _on_hand IS NULL THEN RAISE EXCEPTION 'material_not_found'; END IF;
  IF _on_hand < _qty THEN
    RAISE EXCEPTION 'insufficient_stock: % has % available, % requested (short %). Raise a requisition instead.',
      _name, _on_hand, _qty, (_qty - _on_hand);
  END IF;

  SELECT planned_qty, est_unit_cost INTO _p_qty, _p_cost
    FROM public.conversion_budget_lines
   WHERE conversion_id = _conversion_id AND material_id = _material_id
   ORDER BY created_at LIMIT 1;

  SELECT organization_id, id INTO _org, _line FROM public.conversion_materials
   WHERE conversion_id = _conversion_id AND material_id = _material_id
   ORDER BY created_at LIMIT 1;

  INSERT INTO public.material_movements
    (material_id, movement_type, qty, unit_cost, conversion_id, created_by, reason, note,
     planned_qty_snapshot, planned_unit_cost_snapshot)
  VALUES (_material_id, 'issue', -_qty, _cost, _conversion_id, auth.uid(),
          COALESCE(NULLIF(btrim(COALESCE(_reason,'')), ''), 'Issue to job'), NULLIF(btrim(COALESCE(_note,'')), ''),
          _p_qty, _p_cost)
  RETURNING id INTO _id;

  INSERT INTO public.conversion_material_audit
    (organization_id, conversion_id, conversion_material_id, material_id, event, qty, unit_cost, reason, note)
  VALUES (_org, _conversion_id, _line, _material_id, 'issue', _qty, _cost,
          NULLIF(btrim(COALESCE(_reason,'')), ''), NULLIF(btrim(COALESCE(_note,'')), ''));

  RETURN _id;
END
$$;

CREATE OR REPLACE FUNCTION public.return_material_from_job(
  _conversion_id uuid, _material_id uuid, _qty numeric,
  _reason text DEFAULT NULL, _note text DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE _cost numeric; _id uuid; _net_issued numeric;
        _p_qty numeric; _p_cost numeric; _org uuid; _line uuid;
BEGIN
  IF _qty <= 0 THEN RAISE EXCEPTION 'qty must be positive'; END IF;
  SELECT COALESCE(avg_unit_cost, unit_cost, 0) INTO _cost FROM public.materials WHERE id=_material_id;

  SELECT COALESCE(-SUM(qty), 0) INTO _net_issued
    FROM public.material_movements
   WHERE conversion_id = _conversion_id AND material_id = _material_id
     AND movement_type IN ('issue','return');

  IF _qty > _net_issued THEN
    RAISE EXCEPTION 'return_exceeds_issued: only % outstanding on this job', _net_issued;
  END IF;

  SELECT planned_qty, est_unit_cost INTO _p_qty, _p_cost
    FROM public.conversion_budget_lines
   WHERE conversion_id = _conversion_id AND material_id = _material_id
   ORDER BY created_at LIMIT 1;

  SELECT organization_id, id INTO _org, _line FROM public.conversion_materials
   WHERE conversion_id = _conversion_id AND material_id = _material_id
   ORDER BY created_at LIMIT 1;

  INSERT INTO public.material_movements
    (material_id, movement_type, qty, unit_cost, conversion_id, created_by, reason, note,
     planned_qty_snapshot, planned_unit_cost_snapshot)
  VALUES (_material_id, 'return', _qty, _cost, _conversion_id, auth.uid(),
          COALESCE(NULLIF(btrim(COALESCE(_reason,'')), ''), 'Return from job'), NULLIF(btrim(COALESCE(_note,'')), ''),
          _p_qty, _p_cost)
  RETURNING id INTO _id;

  INSERT INTO public.conversion_material_audit
    (organization_id, conversion_id, conversion_material_id, material_id, event, qty, unit_cost, reason, note)
  VALUES (_org, _conversion_id, _line, _material_id, 'return', _qty, _cost,
          NULLIF(btrim(COALESCE(_reason,'')), ''), NULLIF(btrim(COALESCE(_note,'')), ''));

  RETURN _id;
END
$$;

-- 5. Variance from historical snapshots
DROP FUNCTION IF EXISTS public.conversion_budget_variance(uuid);
CREATE OR REPLACE FUNCTION public.conversion_budget_variance(_conversion_id uuid)
RETURNS TABLE(material_id uuid, description text, category text, planned_qty numeric,
              est_unit_cost numeric, est_total numeric, used_qty numeric, actual_cost numeric,
              qty_variance numeric, cost_variance numeric, in_budget boolean,
              issued_qty numeric, returned_qty numeric, budget_edited_after_use boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  WITH b AS (
    SELECT material_id, description, planned_qty, est_unit_cost, est_total
      FROM public.conversion_budget_lines WHERE conversion_id = _conversion_id
  ), mv AS (
    SELECT material_id,
           SUM(CASE WHEN qty < 0 THEN -qty ELSE 0 END) AS issued_qty,
           SUM(CASE WHEN qty > 0 THEN qty ELSE 0 END)  AS returned_qty,
           SUM(-qty * COALESCE(unit_cost,0))           AS actual_cost,
           MAX(planned_qty_snapshot)                   AS snap_planned_qty,
           MAX(planned_unit_cost_snapshot)             AS snap_planned_cost
      FROM public.material_movements
     WHERE conversion_id = _conversion_id AND movement_type IN ('issue','return')
     GROUP BY material_id
  ), a AS (
    SELECT cm.material_id, cm.description,
           SUM(COALESCE(cm.qty_used,0)) AS used_qty,
           SUM(COALESCE(cm.qty_used,0) * COALESCE(cm.unit_cost,0)) AS line_cost
      FROM public.conversion_materials cm WHERE cm.conversion_id = _conversion_id
     GROUP BY cm.material_id, cm.description
  )
  SELECT COALESCE(b.material_id, a.material_id) AS material_id,
         COALESCE(b.description, a.description) AS description,
         m.category,
         COALESCE(b.planned_qty, 0),
         COALESCE(b.est_unit_cost, 0),
         COALESCE(b.est_total, 0),
         COALESCE(a.used_qty, 0),
         COALESCE(mv.actual_cost, a.line_cost, 0) AS actual_cost,
         COALESCE(a.used_qty,0) - COALESCE(b.planned_qty,0),
         COALESCE(mv.actual_cost, a.line_cost, 0) - COALESCE(b.est_total,0),
         (b.material_id IS NOT NULL OR b.description IS NOT NULL),
         COALESCE(mv.issued_qty, 0),
         COALESCE(mv.returned_qty, 0),
         (mv.snap_planned_qty IS NOT NULL
            AND (mv.snap_planned_qty IS DISTINCT FROM b.planned_qty
                 OR mv.snap_planned_cost IS DISTINCT FROM b.est_unit_cost))
    FROM b
    FULL OUTER JOIN a
      ON (b.material_id IS NOT NULL AND b.material_id = a.material_id)
      OR (b.material_id IS NULL AND a.material_id IS NULL AND b.description = a.description)
    LEFT JOIN mv ON mv.material_id = COALESCE(b.material_id, a.material_id)
    LEFT JOIN public.materials m ON m.id = COALESCE(b.material_id, a.material_id)
$$;

-- 6. Procurement status per material on a job
CREATE OR REPLACE FUNCTION public.conversion_material_procurement_status(_conversion_id uuid)
RETURNS TABLE(material_id uuid, request_id uuid, request_status text, urgency text,
              requested_qty numeric, needed_by date, purchase_order_id uuid,
              po_number text, po_status text, ordered_qty numeric, received_qty numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT DISTINCT ON (mr.material_id)
         mr.material_id, mr.id, mr.status, mr.urgency, mr.quantity, mr.needed_by,
         mr.purchase_order_id, po.po_number, po.status,
         pi.quantity, pi.received_qty
    FROM public.material_requests mr
    LEFT JOIN public.purchase_orders po ON po.id = mr.purchase_order_id
    LEFT JOIN LATERAL (
      SELECT SUM(quantity) AS quantity, SUM(COALESCE(received_qty,0)) AS received_qty
        FROM public.po_items WHERE po_id = po.id AND material_id = mr.material_id
    ) pi ON true
   WHERE mr.conversion_id = _conversion_id AND mr.material_id IS NOT NULL
   ORDER BY mr.material_id, mr.created_at DESC
$$;

REVOKE EXECUTE ON FUNCTION public.conversion_material_procurement_status(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.conversion_material_procurement_status(uuid) TO authenticated;
