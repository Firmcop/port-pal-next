-- 1. Canonical material categories -------------------------------------------------
CREATE OR REPLACE FUNCTION public.canonical_material_category(_raw text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN _raw IS NULL OR btrim(_raw) = '' THEN 'Other'
    WHEN lower(btrim(_raw)) ~ 'steel|rhs|shs|angle line' THEN 'Steel'
    WHEN lower(btrim(_raw)) ~ 'plumb|sanitary|water' THEN 'Plumbing'
    WHEN lower(btrim(_raw)) ~ 'elect' THEN 'Electrical'
    WHEN lower(btrim(_raw)) ~ 'paint' THEN 'Paint'
    WHEN lower(btrim(_raw)) ~ 'interior|board|ceiling' THEN 'Interior'
    WHEN lower(btrim(_raw)) ~ 'fabricat|weld' THEN 'Fabrication'
    WHEN lower(btrim(_raw)) ~ 'hardware|screw|bolt|nail|fasten|hinge|door|window|lock' THEN 'Hardware'
    WHEN lower(btrim(_raw)) ~ 'floor' THEN 'Flooring'
    WHEN lower(btrim(_raw)) ~ 'clad' THEN 'Cladding'
    WHEN lower(btrim(_raw)) ~ 'insulat' THEN 'Insulation'
    WHEN lower(btrim(_raw)) ~ 'roof|iron sheet' THEN 'Roofing'
    WHEN lower(btrim(_raw)) ~ 'container' THEN 'Container Parts'
    WHEN lower(btrim(_raw)) ~ 'service|labour|labor' THEN 'Services'
    ELSE initcap(btrim(_raw))
  END
$$;

CREATE OR REPLACE FUNCTION public.normalize_material_category()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.category := public.canonical_material_category(NEW.category);
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS trg_normalize_material_category ON public.materials;
CREATE TRIGGER trg_normalize_material_category
BEFORE INSERT OR UPDATE OF category ON public.materials
FOR EACH ROW EXECUTE FUNCTION public.normalize_material_category();

UPDATE public.materials
   SET category = public.canonical_material_category(category)
 WHERE category IS DISTINCT FROM public.canonical_material_category(category);

-- 2. Job budget ---------------------------------------------------------------------
ALTER TABLE public.container_conversions
  ADD COLUMN IF NOT EXISTS budget_amount numeric NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS public.conversion_budget_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL DEFAULT current_org_id(),
  conversion_id uuid NOT NULL REFERENCES public.container_conversions(id) ON DELETE CASCADE,
  material_id uuid REFERENCES public.materials(id),
  description text NOT NULL,
  planned_qty numeric NOT NULL DEFAULT 0,
  est_unit_cost numeric NOT NULL DEFAULT 0,
  est_total numeric GENERATED ALWAYS AS (planned_qty * est_unit_cost) STORED,
  source text NOT NULL DEFAULT 'manual',
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.conversion_budget_lines TO authenticated;
GRANT ALL ON public.conversion_budget_lines TO service_role;

ALTER TABLE public.conversion_budget_lines ENABLE ROW LEVEL SECURITY;

CREATE POLICY rbac_select ON public.conversion_budget_lines FOR SELECT TO authenticated
USING (is_platform_admin() OR (organization_id = current_org_id() AND can_view_module(auth.uid(), 'manufacturing')));
CREATE POLICY rbac_insert ON public.conversion_budget_lines FOR INSERT TO authenticated
WITH CHECK (is_platform_admin() OR (organization_id = current_org_id() AND can_write_module(auth.uid(), 'manufacturing')));
CREATE POLICY rbac_update ON public.conversion_budget_lines FOR UPDATE TO authenticated
USING (is_platform_admin() OR (organization_id = current_org_id() AND can_write_module(auth.uid(), 'manufacturing')))
WITH CHECK (is_platform_admin() OR (organization_id = current_org_id() AND can_write_module(auth.uid(), 'manufacturing')));
CREATE POLICY rbac_delete ON public.conversion_budget_lines FOR DELETE TO authenticated
USING (is_platform_admin() OR (organization_id = current_org_id() AND can_write_module(auth.uid(), 'manufacturing')));

CREATE INDEX IF NOT EXISTS idx_cbl_conversion ON public.conversion_budget_lines(conversion_id);

CREATE TRIGGER trg_cbl_updated_at BEFORE UPDATE ON public.conversion_budget_lines
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 3. Requisitions -------------------------------------------------------------------
ALTER TABLE public.material_requests
  ADD COLUMN IF NOT EXISTS material_id uuid REFERENCES public.materials(id),
  ADD COLUMN IF NOT EXISTS qty_available_at_request numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS needed_by date,
  ADD COLUMN IF NOT EXISTS urgency text NOT NULL DEFAULT 'normal',
  ADD COLUMN IF NOT EXISTS purchase_order_id uuid REFERENCES public.purchase_orders(id),
  ADD COLUMN IF NOT EXISTS decided_by uuid,
  ADD COLUMN IF NOT EXISTS decided_at timestamptz,
  ADD COLUMN IF NOT EXISTS decision_reason text,
  ADD COLUMN IF NOT EXISTS note text;

CREATE INDEX IF NOT EXISTS idx_material_requests_status ON public.material_requests(status);

-- 4. Issue / return with reason, hard stock block -----------------------------------
CREATE OR REPLACE FUNCTION public.issue_material_to_job(
  _conversion_id uuid, _material_id uuid, _qty numeric,
  _allow_negative boolean DEFAULT false,
  _reason text DEFAULT NULL, _note text DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE _on_hand numeric; _cost numeric; _id uuid; _name text;
BEGIN
  IF _qty <= 0 THEN RAISE EXCEPTION 'qty must be positive'; END IF;
  SELECT on_hand_qty, COALESCE(avg_unit_cost, unit_cost, 0), name
    INTO _on_hand, _cost, _name FROM public.materials WHERE id = _material_id;
  IF _on_hand IS NULL THEN RAISE EXCEPTION 'material_not_found'; END IF;
  IF _on_hand < _qty THEN
    RAISE EXCEPTION 'insufficient_stock: % has % available, % requested (short %). Raise a requisition instead.',
      _name, _on_hand, _qty, (_qty - _on_hand);
  END IF;

  INSERT INTO public.material_movements (material_id, movement_type, qty, unit_cost, conversion_id, created_by, reason)
  VALUES (_material_id, 'issue', -_qty, _cost, _conversion_id, auth.uid(),
          COALESCE(NULLIF(btrim(COALESCE(_reason,'') || CASE WHEN COALESCE(_note,'') <> '' THEN ' — ' || _note ELSE '' END), ''), 'Issue to job'))
  RETURNING id INTO _id;
  RETURN _id;
END
$$;

CREATE OR REPLACE FUNCTION public.return_material_from_job(
  _conversion_id uuid, _material_id uuid, _qty numeric,
  _reason text DEFAULT NULL, _note text DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE _cost numeric; _id uuid; _net_issued numeric;
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

  INSERT INTO public.material_movements (material_id, movement_type, qty, unit_cost, conversion_id, created_by, reason)
  VALUES (_material_id, 'return', _qty, _cost, _conversion_id, auth.uid(),
          COALESCE(NULLIF(btrim(COALESCE(_reason,'') || CASE WHEN COALESCE(_note,'') <> '' THEN ' — ' || _note ELSE '' END), ''), 'Return from job'))
  RETURNING id INTO _id;
  RETURN _id;
END
$$;

-- 5. Raise a requisition from a job -------------------------------------------------
CREATE OR REPLACE FUNCTION public.raise_material_requisition(
  _conversion_id uuid, _material_id uuid, _description text, _qty numeric,
  _needed_by date DEFAULT NULL, _urgency text DEFAULT 'normal', _note text DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE _id uuid; _avail numeric := 0; _org uuid;
BEGIN
  IF _qty <= 0 THEN RAISE EXCEPTION 'qty must be positive'; END IF;
  SELECT organization_id INTO _org FROM public.container_conversions WHERE id = _conversion_id;
  IF _org IS NULL THEN RAISE EXCEPTION 'conversion_not_found'; END IF;
  IF _material_id IS NOT NULL THEN
    SELECT COALESCE(on_hand_qty,0) INTO _avail FROM public.materials WHERE id = _material_id;
  END IF;

  INSERT INTO public.material_requests
    (organization_id, conversion_id, material_id, description, quantity,
     qty_available_at_request, needed_by, urgency, note, status, created_by)
  VALUES (_org, _conversion_id, _material_id, _description, _qty,
          COALESCE(_avail,0), _needed_by, COALESCE(_urgency,'normal'), _note, 'requested', auth.uid())
  RETURNING id INTO _id;
  RETURN _id;
END
$$;

CREATE OR REPLACE FUNCTION public.decide_material_requisition(
  _request_id uuid, _approve boolean, _reason text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.material_requests
     SET status = CASE WHEN _approve THEN 'approved' ELSE 'rejected' END,
         decided_by = auth.uid(), decided_at = now(), decision_reason = _reason
   WHERE id = _request_id AND status = 'requested';
  IF NOT FOUND THEN RAISE EXCEPTION 'request_not_pending'; END IF;
END
$$;

-- 6. Convert an approved requisition into a draft PO --------------------------------
CREATE OR REPLACE FUNCTION public.convert_requisition_to_po(
  _request_id uuid, _supplier_id uuid, _unit_price numeric DEFAULT 0)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE _r record; _po uuid; _num text; _proj uuid; _org uuid;
BEGIN
  SELECT * INTO _r FROM public.material_requests WHERE id = _request_id;
  IF _r IS NULL THEN RAISE EXCEPTION 'request_not_found'; END IF;
  IF _r.purchase_order_id IS NOT NULL THEN RAISE EXCEPTION 'already_converted'; END IF;
  IF _r.status <> 'approved' THEN RAISE EXCEPTION 'request_not_approved'; END IF;

  SELECT project_id, organization_id INTO _proj, _org
    FROM public.container_conversions WHERE id = _r.conversion_id;

  _num := 'PO-REQ-' || to_char(now(), 'YYYYMMDD') || '-' || substr(replace(_request_id::text,'-',''), 1, 6);

  INSERT INTO public.purchase_orders
    (organization_id, po_number, supplier_id, conversion_id, project_id, status, total_cost, subtotal, created_by)
  VALUES (_org, _num, _supplier_id, _r.conversion_id, _proj, 'draft',
          COALESCE(_unit_price,0) * _r.quantity, COALESCE(_unit_price,0) * _r.quantity, auth.uid())
  RETURNING id INTO _po;

  INSERT INTO public.po_items
    (organization_id, po_id, material_id, description, quantity, unit_price, net_amount, total_cost)
  VALUES (_org, _po, _r.material_id, _r.description, _r.quantity, COALESCE(_unit_price,0),
          COALESCE(_unit_price,0) * _r.quantity, COALESCE(_unit_price,0) * _r.quantity);

  UPDATE public.material_requests
     SET purchase_order_id = _po, status = 'ordered'
   WHERE id = _request_id;

  RETURN _po;
END
$$;

-- 7. Budget variance ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.conversion_budget_variance(_conversion_id uuid)
RETURNS TABLE (
  material_id uuid,
  description text,
  category text,
  planned_qty numeric,
  est_unit_cost numeric,
  est_total numeric,
  used_qty numeric,
  actual_cost numeric,
  qty_variance numeric,
  cost_variance numeric,
  in_budget boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH b AS (
    SELECT material_id, description, planned_qty, est_unit_cost, est_total
      FROM public.conversion_budget_lines WHERE conversion_id = _conversion_id
  ), a AS (
    SELECT material_id, description,
           SUM(COALESCE(qty_used,0)) AS used_qty,
           SUM(COALESCE(qty_used,0) * COALESCE(unit_cost,0)) AS actual_cost
      FROM public.conversion_materials WHERE conversion_id = _conversion_id
     GROUP BY material_id, description
  )
  SELECT COALESCE(b.material_id, a.material_id) AS material_id,
         COALESCE(b.description, a.description) AS description,
         m.category,
         COALESCE(b.planned_qty, 0),
         COALESCE(b.est_unit_cost, 0),
         COALESCE(b.est_total, 0),
         COALESCE(a.used_qty, 0),
         COALESCE(a.actual_cost, 0),
         COALESCE(a.used_qty,0) - COALESCE(b.planned_qty,0),
         COALESCE(a.actual_cost,0) - COALESCE(b.est_total,0),
         b.material_id IS NOT NULL OR b.description IS NOT NULL
    FROM b
    FULL OUTER JOIN a
      ON (b.material_id IS NOT NULL AND b.material_id = a.material_id)
      OR (b.material_id IS NULL AND a.material_id IS NULL AND b.description = a.description)
    LEFT JOIN public.materials m ON m.id = COALESCE(b.material_id, a.material_id)
$$;

REVOKE ALL ON FUNCTION public.conversion_budget_variance(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.conversion_budget_variance(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.raise_material_requisition(uuid,uuid,text,numeric,date,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.decide_material_requisition(uuid,boolean,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.convert_requisition_to_po(uuid,uuid,numeric) TO authenticated;