DO $$
DECLARE r record; v_cost numeric; v_mat uuid;
BEGIN
  FOR r IN
    SELECT gri.id AS gri_id, gri.received_qty, gr.id AS gr_id, gr.po_id, gr.organization_id,
           i.id AS po_item_id, i.description, i.landed_unit_cost, i.unit_price
    FROM public.po_items i
    JOIN public.goods_receipt_items gri ON gri.po_item_id = i.id
    JOIN public.goods_receipts gr ON gr.id = gri.receipt_id
    WHERE i.material_id IS NULL
      AND COALESCE(i.received_qty,0) > 0
      AND gr.is_void = false
  LOOP
    SELECT m.id INTO v_mat
    FROM public.materials m
    WHERE m.organization_id = r.organization_id
      AND lower(trim(m.name)) = lower(trim(r.description))
    LIMIT 1;

    IF v_mat IS NULL THEN
      CONTINUE;
    END IF;

    UPDATE public.po_items SET material_id = v_mat WHERE id = r.po_item_id;
    v_cost := COALESCE(r.landed_unit_cost, r.unit_price, 0);

    INSERT INTO public.material_movements
      (material_id, movement_type, qty, unit_cost, goods_receipt_id, organization_id, created_by, reason)
    VALUES (v_mat, 'receipt', r.received_qty, v_cost, r.gr_id, r.organization_id, NULL,
            'Backfill: receipt line linked to catalogue material (stock was never posted)');

    INSERT INTO public.goods_receipt_audit
      (receipt_id, receipt_item_id, po_id, action, actor_user_id, organization_id, payload)
    VALUES (r.gr_id, r.gri_id, r.po_id, 'inventory_posted', NULL, r.organization_id,
            jsonb_build_object('linked_material_id', v_mat, 'qty', r.received_qty, 'retro', true, 'source', 'backfill_migration'));
  END LOOP;
END $$;