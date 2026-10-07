
ALTER TABLE public.goods_receipt_items
  ADD COLUMN IF NOT EXISTS ordered_qty numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS variance_reason text,
  ADD COLUMN IF NOT EXISTS variance_type text NOT NULL DEFAULT 'exact' CHECK (variance_type IN ('exact','short','over'));

ALTER TABLE public.goods_receipts
  ADD COLUMN IF NOT EXISTS has_variance boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS supplementary_po_id uuid REFERENCES public.purchase_orders(id);

CREATE OR REPLACE FUNCTION public.receive_po_with_variances(
  _po_id uuid,
  _notes text,
  _lines jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org uuid;
  v_receipt_id uuid;
  v_po record;
  v_line jsonb;
  v_po_item record;
  v_received numeric;
  v_ordered numeric;
  v_variance_type text;
  v_reason text;
  v_has_variance boolean := false;
  v_any_short boolean := false;
  v_any_over boolean := false;
  v_sup_po_id uuid;
  v_sup_invoice_id uuid;
  v_sup_po_number text;
  v_sup_total numeric := 0;
  v_sup_count int;
  v_existing_stock uuid;
  v_existing_qty numeric;
BEGIN
  SELECT * INTO v_po FROM public.purchase_orders WHERE id = _po_id;
  IF v_po IS NULL THEN RAISE EXCEPTION 'PO not found'; END IF;
  v_org := v_po.organization_id;
  IF v_org <> public.current_org_id() AND NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  INSERT INTO public.goods_receipts (po_id, received_by, notes, organization_id)
  VALUES (_po_id, auth.uid(), _notes, v_org)
  RETURNING id INTO v_receipt_id;

  FOR v_line IN SELECT * FROM jsonb_array_elements(_lines)
  LOOP
    SELECT * INTO v_po_item FROM public.po_items
      WHERE id = (v_line->>'po_item_id')::uuid AND po_id = _po_id;
    IF v_po_item IS NULL THEN CONTINUE; END IF;

    v_received := COALESCE((v_line->>'received_qty')::numeric, 0);
    v_ordered := v_po_item.quantity;
    v_reason := NULLIF(v_line->>'reason','');

    IF v_received = v_ordered THEN
      v_variance_type := 'exact';
    ELSIF v_received < v_ordered THEN
      v_variance_type := 'short';
      v_has_variance := true;
      v_any_short := true;
    ELSE
      v_variance_type := 'over';
      v_has_variance := true;
      v_any_over := true;
    END IF;

    INSERT INTO public.goods_receipt_items
      (receipt_id, po_item_id, received_qty, ordered_qty, variance_type, variance_reason, organization_id)
    VALUES
      (v_receipt_id, v_po_item.id, v_received, v_ordered, v_variance_type, v_reason, v_org);

    IF v_po_item.material_id IS NOT NULL AND v_received > 0 THEN
      SELECT id, qty_available INTO v_existing_stock, v_existing_qty
        FROM public.material_stock WHERE material_id = v_po_item.material_id LIMIT 1;
      IF v_existing_stock IS NOT NULL THEN
        UPDATE public.material_stock
          SET qty_available = v_existing_qty + v_received, last_updated = now()
          WHERE id = v_existing_stock;
      ELSE
        INSERT INTO public.material_stock (material_id, qty_available, qty_reserved, organization_id)
        VALUES (v_po_item.material_id, v_received, 0, v_org);
      END IF;
    END IF;
  END LOOP;

  IF v_any_over THEN
    SELECT COUNT(*) INTO v_sup_count FROM public.purchase_orders
      WHERE po_number LIKE v_po.po_number || '-SUP%';
    v_sup_po_number := v_po.po_number || '-SUP' || (v_sup_count + 1)::text;

    INSERT INTO public.purchase_orders
      (po_number, supplier_id, conversion_id, status, total_cost, created_by, organization_id, project_id)
    VALUES
      (v_sup_po_number, v_po.supplier_id, v_po.conversion_id, 'confirmed', 0, auth.uid(), v_org, v_po.project_id)
    RETURNING id INTO v_sup_po_id;

    FOR v_line IN SELECT * FROM jsonb_array_elements(_lines)
    LOOP
      SELECT * INTO v_po_item FROM public.po_items
        WHERE id = (v_line->>'po_item_id')::uuid AND po_id = _po_id;
      IF v_po_item IS NULL THEN CONTINUE; END IF;
      v_received := COALESCE((v_line->>'received_qty')::numeric, 0);
      IF v_received > v_po_item.quantity THEN
        INSERT INTO public.po_items
          (po_id, material_id, description, quantity, unit_price, total_cost, is_vatable, tax_rate, organization_id)
        VALUES
          (v_sup_po_id, v_po_item.material_id,
           v_po_item.description || ' (over-receipt vs ' || v_po.po_number || ')',
           v_received - v_po_item.quantity, v_po_item.unit_price,
           (v_received - v_po_item.quantity) * v_po_item.unit_price,
           v_po_item.is_vatable, v_po_item.tax_rate, v_org);
        v_sup_total := v_sup_total + (v_received - v_po_item.quantity) * v_po_item.unit_price;
      END IF;
    END LOOP;

    UPDATE public.purchase_orders SET total_cost = v_sup_total WHERE id = v_sup_po_id;
    UPDATE public.goods_receipts SET supplementary_po_id = v_sup_po_id WHERE id = v_receipt_id;

    INSERT INTO public.supplier_invoices
      (invoice_number, supplier_id, purchase_order_id, reason, reference,
       subtotal, total_amount, status, notes, organization_id)
    VALUES
      ('INV-' || v_sup_po_number, v_po.supplier_id, v_sup_po_id, 'goods_receipt',
       v_sup_po_number, v_sup_total, v_sup_total, 'issued',
       'Auto-raised for over-receipt against ' || v_po.po_number, v_org)
    RETURNING id INTO v_sup_invoice_id;

    INSERT INTO public.supplier_invoice_lines (invoice_id, description, quantity, unit_price, line_total, organization_id)
    SELECT v_sup_invoice_id, description, quantity, unit_price, total_cost, v_org
      FROM public.po_items WHERE po_id = v_sup_po_id;
  END IF;

  UPDATE public.goods_receipts SET has_variance = v_has_variance WHERE id = v_receipt_id;

  UPDATE public.purchase_orders
    SET status = CASE WHEN v_any_short THEN 'partially_received' ELSE 'received' END
    WHERE id = _po_id;

  RETURN jsonb_build_object(
    'receipt_id', v_receipt_id,
    'supplementary_po_id', v_sup_po_id,
    'supplementary_invoice_id', v_sup_invoice_id
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.receive_po_with_variances(uuid, text, jsonb) TO authenticated;
