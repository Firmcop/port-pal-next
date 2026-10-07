ALTER TABLE public.goods_receipt_items
  ADD COLUMN IF NOT EXISTS allocated_conversion_material_id uuid;

CREATE INDEX IF NOT EXISTS idx_gri_allocated ON public.goods_receipt_items (allocated_conversion_material_id);

CREATE OR REPLACE FUNCTION public.allocate_receipt_line_to_conversion(
  _receipt_item_id uuid,
  _conversion_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _item record;
  _job record;
  _uid uuid := auth.uid();
  _allowed boolean;
  _cm_id uuid;
  _supplier text;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT gri.id, gri.received_qty, gri.organization_id, gri.allocated_conversion_material_id,
         pi.material_id, pi.description, pi.unit_price
    INTO _item
  FROM public.goods_receipt_items gri
  JOIN public.po_items pi ON pi.id = gri.po_item_id
  WHERE gri.id = _receipt_item_id;

  IF _item.id IS NULL THEN
    RAISE EXCEPTION 'Receipt line not found';
  END IF;
  IF _item.allocated_conversion_material_id IS NOT NULL THEN
    RAISE EXCEPTION 'This receipt line has already been allocated to a job';
  END IF;

  SELECT cc.id, cc.organization_id, cc.status INTO _job
  FROM public.container_conversions cc WHERE cc.id = _conversion_id;

  IF _job.id IS NULL THEN
    RAISE EXCEPTION 'Conversion job not found';
  END IF;
  IF _job.organization_id IS DISTINCT FROM _item.organization_id THEN
    RAISE EXCEPTION 'Receipt line and job belong to different organizations';
  END IF;
  IF _job.status = 'cancelled' THEN
    RAISE EXCEPTION 'Cannot allocate costs to a cancelled job';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = _uid
      AND ur.role IN ('admin','production_manager','procurement_officer','supply_chain_manager')
  ) OR EXISTS (
    SELECT 1 FROM public.organization_members om
    WHERE om.user_id = _uid AND om.organization_id = _job.organization_id
      AND om.role IN ('org_owner','admin') AND om.status = 'active'
  ) OR public.is_platform_admin()
  INTO _allowed;

  IF NOT _allowed THEN
    RAISE EXCEPTION 'You do not have permission to allocate purchases to jobs';
  END IF;

  SELECT s.name INTO _supplier
  FROM public.goods_receipt_items gri
  JOIN public.goods_receipts gr ON gr.id = gri.receipt_id
  JOIN public.purchase_orders po ON po.id = gr.po_id
  LEFT JOIN public.suppliers s ON s.id = po.supplier_id
  WHERE gri.id = _receipt_item_id;

  INSERT INTO public.conversion_materials (
    conversion_id, material_id, description, quantity, qty_planned, qty_used,
    unit_cost, total_cost, supplier, source, organization_id
  ) VALUES (
    _conversion_id, _item.material_id, COALESCE(_item.description, 'Purchased material'),
    _item.received_qty, _item.received_qty, _item.received_qty,
    COALESCE(_item.unit_price, 0), _item.received_qty * COALESCE(_item.unit_price, 0),
    _supplier, 'purchase', _job.organization_id
  ) RETURNING id INTO _cm_id;

  UPDATE public.goods_receipt_items
     SET allocated_conversion_material_id = _cm_id
   WHERE id = _receipt_item_id;

  RETURN jsonb_build_object('conversion_material_id', _cm_id, 'qty', _item.received_qty);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.allocate_receipt_line_to_conversion(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.allocate_receipt_line_to_conversion(uuid, uuid) TO authenticated;