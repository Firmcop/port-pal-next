
-- 1. Audit log
CREATE TABLE public.goods_receipt_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL DEFAULT current_org_id(),
  receipt_id uuid NOT NULL REFERENCES public.goods_receipts(id) ON DELETE CASCADE,
  receipt_item_id uuid REFERENCES public.goods_receipt_items(id) ON DELETE SET NULL,
  po_id uuid,
  action text NOT NULL,
  actor_user_id uuid,
  actor_email text,
  payload jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.goods_receipt_audit TO authenticated;
GRANT ALL ON public.goods_receipt_audit TO service_role;
ALTER TABLE public.goods_receipt_audit ENABLE ROW LEVEL SECURITY;
CREATE POLICY "audit_org_select" ON public.goods_receipt_audit FOR SELECT TO authenticated
  USING (organization_id = current_org_id() OR is_platform_admin());
CREATE POLICY "audit_org_insert" ON public.goods_receipt_audit FOR INSERT TO authenticated
  WITH CHECK (organization_id = current_org_id() OR is_platform_admin());
CREATE INDEX idx_gr_audit_receipt ON public.goods_receipt_audit(receipt_id, created_at DESC);

-- 2. goods_receipts additions
ALTER TABLE public.goods_receipts
  ADD COLUMN approval_status text NOT NULL DEFAULT 'auto_posted',
  ADD COLUMN approval_request_id uuid,
  ADD COLUMN credit_note_invoice_id uuid,
  ADD COLUMN submitted_by uuid,
  ADD COLUMN submitted_at timestamptz,
  ADD COLUMN approved_by uuid,
  ADD COLUMN approved_at timestamptz,
  ADD COLUMN rejected_reason text;

-- 3. supplier_invoices kind flag
ALTER TABLE public.supplier_invoices
  ADD COLUMN invoice_kind text NOT NULL DEFAULT 'invoice';

-- 4. Rework receive_po_with_variances: hold variance receipts for approval
CREATE OR REPLACE FUNCTION public.receive_po_with_variances(_po_id uuid, _notes text, _lines jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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
  v_variance_value numeric := 0;
  v_approval_id uuid;
  v_actor_email text;
  v_existing_stock uuid;
  v_existing_qty numeric;
  v_item_id uuid;
BEGIN
  SELECT * INTO v_po FROM public.purchase_orders WHERE id = _po_id;
  IF v_po IS NULL THEN RAISE EXCEPTION 'PO not found'; END IF;
  v_org := v_po.organization_id;
  IF v_org <> public.current_org_id() AND NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  SELECT email INTO v_actor_email FROM auth.users WHERE id = auth.uid();

  -- First pass: classify variance
  FOR v_line IN SELECT * FROM jsonb_array_elements(_lines) LOOP
    SELECT * INTO v_po_item FROM public.po_items
      WHERE id = (v_line->>'po_item_id')::uuid AND po_id = _po_id;
    IF v_po_item IS NULL THEN CONTINUE; END IF;
    v_received := COALESCE((v_line->>'received_qty')::numeric, 0);
    v_ordered := v_po_item.quantity;
    IF v_received < v_ordered THEN
      v_has_variance := true; v_any_short := true;
      v_variance_value := v_variance_value + (v_ordered - v_received) * v_po_item.unit_price;
    ELSIF v_received > v_ordered THEN
      v_has_variance := true; v_any_over := true;
      v_variance_value := v_variance_value + (v_received - v_ordered) * v_po_item.unit_price;
    END IF;
  END LOOP;

  -- Create receipt header
  INSERT INTO public.goods_receipts
    (po_id, received_by, notes, organization_id, has_variance,
     approval_status, submitted_by, submitted_at)
  VALUES
    (_po_id, auth.uid(), _notes, v_org, v_has_variance,
     CASE WHEN v_has_variance THEN 'pending_approval' ELSE 'auto_posted' END,
     auth.uid(), now())
  RETURNING id INTO v_receipt_id;

  -- Insert line items always (store actuals + reason)
  FOR v_line IN SELECT * FROM jsonb_array_elements(_lines) LOOP
    SELECT * INTO v_po_item FROM public.po_items
      WHERE id = (v_line->>'po_item_id')::uuid AND po_id = _po_id;
    IF v_po_item IS NULL THEN CONTINUE; END IF;
    v_received := COALESCE((v_line->>'received_qty')::numeric, 0);
    v_ordered := v_po_item.quantity;
    v_reason := NULLIF(v_line->>'reason','');
    IF v_received = v_ordered THEN v_variance_type := 'exact';
    ELSIF v_received < v_ordered THEN v_variance_type := 'short';
    ELSE v_variance_type := 'over';
    END IF;

    INSERT INTO public.goods_receipt_items
      (receipt_id, po_item_id, received_qty, ordered_qty, variance_type, variance_reason, organization_id)
    VALUES
      (v_receipt_id, v_po_item.id, v_received, v_ordered, v_variance_type, v_reason, v_org)
    RETURNING id INTO v_item_id;

    INSERT INTO public.goods_receipt_audit
      (receipt_id, receipt_item_id, po_id, action, actor_user_id, actor_email, organization_id, payload)
    VALUES
      (v_receipt_id, v_item_id, _po_id, 'submitted', auth.uid(), v_actor_email, v_org,
       jsonb_build_object('po_item_id', v_po_item.id, 'description', v_po_item.description,
         'ordered_qty', v_ordered, 'received_qty', v_received,
         'variance_type', v_variance_type, 'variance_reason', v_reason));
  END LOOP;

  IF v_has_variance THEN
    -- Hold for approval. Create approval request, no stock, no docs.
    INSERT INTO public.approval_requests
      (organization_id, doc_type, doc_id, status, requested_by, current_step, amount)
    VALUES
      (v_org, 'goods_receipt_variance', v_receipt_id, 'pending', auth.uid(), 1, v_variance_value)
    RETURNING id INTO v_approval_id;

    UPDATE public.goods_receipts SET approval_request_id = v_approval_id WHERE id = v_receipt_id;

    INSERT INTO public.goods_receipt_audit
      (receipt_id, po_id, action, actor_user_id, actor_email, organization_id, payload)
    VALUES
      (v_receipt_id, _po_id, 'pending_approval', auth.uid(), v_actor_email, v_org,
       jsonb_build_object('approval_request_id', v_approval_id,
         'has_short', v_any_short, 'has_over', v_any_over, 'variance_value', v_variance_value));

    RETURN jsonb_build_object(
      'receipt_id', v_receipt_id,
      'approval_status', 'pending_approval',
      'approval_request_id', v_approval_id,
      'has_variance', true);
  END IF;

  -- Exact path: post stock immediately
  FOR v_line IN SELECT * FROM jsonb_array_elements(_lines) LOOP
    SELECT * INTO v_po_item FROM public.po_items
      WHERE id = (v_line->>'po_item_id')::uuid AND po_id = _po_id;
    IF v_po_item IS NULL THEN CONTINUE; END IF;
    v_received := COALESCE((v_line->>'received_qty')::numeric, 0);
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

  UPDATE public.purchase_orders SET status = 'received' WHERE id = _po_id;

  INSERT INTO public.goods_receipt_audit
    (receipt_id, po_id, action, actor_user_id, actor_email, organization_id, payload)
  VALUES
    (v_receipt_id, _po_id, 'inventory_posted', auth.uid(), v_actor_email, v_org,
     jsonb_build_object('auto', true));

  RETURN jsonb_build_object(
    'receipt_id', v_receipt_id,
    'approval_status', 'auto_posted',
    'has_variance', false);
END;
$function$;

-- 5. Decide RPC
CREATE OR REPLACE FUNCTION public.decide_goods_receipt_variance(_receipt_id uuid, _decision text, _note text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_receipt record;
  v_po record;
  v_org uuid;
  v_item record;
  v_sup_po_id uuid;
  v_sup_invoice_id uuid;
  v_credit_invoice_id uuid;
  v_sup_po_number text;
  v_sup_count int;
  v_sup_total numeric := 0;
  v_credit_total numeric := 0;
  v_any_short boolean := false;
  v_any_over boolean := false;
  v_existing_stock uuid;
  v_existing_qty numeric;
  v_actor_email text;
  v_uid uuid := auth.uid();
BEGIN
  SELECT * INTO v_receipt FROM public.goods_receipts WHERE id = _receipt_id;
  IF v_receipt IS NULL THEN RAISE EXCEPTION 'receipt not found'; END IF;
  v_org := v_receipt.organization_id;
  IF v_org <> public.current_org_id() AND NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  IF v_receipt.approval_status <> 'pending_approval' THEN
    RAISE EXCEPTION 'receipt not pending approval';
  END IF;
  IF _decision NOT IN ('approved','rejected') THEN
    RAISE EXCEPTION 'invalid decision';
  END IF;
  -- Prevent self-approval (unless platform admin)
  IF v_receipt.submitted_by = v_uid AND NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'submitter cannot approve own receipt';
  END IF;
  -- Approver role check: must be admin OR have role matching workflow
  IF NOT public.is_platform_admin()
     AND NOT public.has_role(v_uid, 'admin'::app_role)
     AND NOT EXISTS (
       SELECT 1 FROM public.approval_workflows w
       JOIN public.user_roles ur ON ur.user_id = v_uid AND ur.role::text = w.approver_role
       WHERE w.organization_id = v_org AND w.doc_type = 'goods_receipt_variance' AND w.is_active
     ) THEN
    RAISE EXCEPTION 'not authorised to approve goods receipt variances';
  END IF;

  SELECT * INTO v_po FROM public.purchase_orders WHERE id = v_receipt.po_id;
  SELECT email INTO v_actor_email FROM auth.users WHERE id = v_uid;

  IF _decision = 'rejected' THEN
    UPDATE public.goods_receipts
      SET approval_status = 'rejected', rejected_reason = _note,
          approved_by = v_uid, approved_at = now()
      WHERE id = _receipt_id;
    UPDATE public.approval_requests
      SET status = 'rejected', decision_note = _note, decided_by = v_uid, decided_at = now()
      WHERE id = v_receipt.approval_request_id;
    INSERT INTO public.goods_receipt_audit
      (receipt_id, po_id, action, actor_user_id, actor_email, organization_id, payload)
    VALUES
      (_receipt_id, v_receipt.po_id, 'rejected', v_uid, v_actor_email, v_org,
       jsonb_build_object('note', _note));
    RETURN jsonb_build_object('status','rejected');
  END IF;

  -- APPROVED: post stock, build supplementary PO/invoice for overs, credit note for shorts.
  FOR v_item IN
    SELECT gri.*, pi.material_id, pi.description, pi.unit_price, pi.is_vatable, pi.tax_rate
    FROM public.goods_receipt_items gri
    JOIN public.po_items pi ON pi.id = gri.po_item_id
    WHERE gri.receipt_id = _receipt_id
  LOOP
    IF v_item.variance_type = 'short' THEN v_any_short := true;
    ELSIF v_item.variance_type = 'over' THEN v_any_over := true;
    END IF;

    IF v_item.material_id IS NOT NULL AND v_item.received_qty > 0 THEN
      SELECT id, qty_available INTO v_existing_stock, v_existing_qty
        FROM public.material_stock WHERE material_id = v_item.material_id LIMIT 1;
      IF v_existing_stock IS NOT NULL THEN
        UPDATE public.material_stock
          SET qty_available = v_existing_qty + v_item.received_qty, last_updated = now()
          WHERE id = v_existing_stock;
      ELSE
        INSERT INTO public.material_stock (material_id, qty_available, qty_reserved, organization_id)
        VALUES (v_item.material_id, v_item.received_qty, 0, v_org);
      END IF;
    END IF;
  END LOOP;

  INSERT INTO public.goods_receipt_audit
    (receipt_id, po_id, action, actor_user_id, actor_email, organization_id, payload)
  VALUES
    (_receipt_id, v_receipt.po_id, 'inventory_posted', v_uid, v_actor_email, v_org, '{}'::jsonb);

  -- Supplementary PO + invoice for OVER lines
  IF v_any_over THEN
    SELECT COUNT(*) INTO v_sup_count FROM public.purchase_orders
      WHERE po_number LIKE v_po.po_number || '-SUP%';
    v_sup_po_number := v_po.po_number || '-SUP' || (v_sup_count + 1)::text;

    INSERT INTO public.purchase_orders
      (po_number, supplier_id, conversion_id, status, total_cost, created_by, organization_id, project_id)
    VALUES
      (v_sup_po_number, v_po.supplier_id, v_po.conversion_id, 'confirmed', 0, v_uid, v_org, v_po.project_id)
    RETURNING id INTO v_sup_po_id;

    FOR v_item IN
      SELECT gri.*, pi.material_id, pi.description, pi.unit_price, pi.is_vatable, pi.tax_rate
      FROM public.goods_receipt_items gri
      JOIN public.po_items pi ON pi.id = gri.po_item_id
      WHERE gri.receipt_id = _receipt_id AND gri.variance_type = 'over'
    LOOP
      INSERT INTO public.po_items
        (po_id, material_id, description, quantity, unit_price, total_cost, is_vatable, tax_rate, organization_id)
      VALUES
        (v_sup_po_id, v_item.material_id,
         v_item.description || ' (over-receipt vs ' || v_po.po_number || ')',
         v_item.received_qty - v_item.ordered_qty, v_item.unit_price,
         (v_item.received_qty - v_item.ordered_qty) * v_item.unit_price,
         v_item.is_vatable, v_item.tax_rate, v_org);
      v_sup_total := v_sup_total + (v_item.received_qty - v_item.ordered_qty) * v_item.unit_price;
    END LOOP;

    UPDATE public.purchase_orders SET total_cost = v_sup_total WHERE id = v_sup_po_id;
    UPDATE public.goods_receipts SET supplementary_po_id = v_sup_po_id WHERE id = _receipt_id;

    INSERT INTO public.supplier_invoices
      (invoice_number, supplier_id, purchase_order_id, reason, reference,
       subtotal, total_amount, status, notes, organization_id, invoice_kind)
    VALUES
      ('INV-' || v_sup_po_number, v_po.supplier_id, v_sup_po_id, 'goods_receipt',
       v_sup_po_number, v_sup_total, v_sup_total, 'issued',
       'Auto-raised for over-receipt against ' || v_po.po_number, v_org, 'invoice')
    RETURNING id INTO v_sup_invoice_id;

    INSERT INTO public.supplier_invoice_lines (invoice_id, description, quantity, unit_price, line_total, organization_id)
    SELECT v_sup_invoice_id, description, quantity, unit_price, total_cost, v_org
      FROM public.po_items WHERE po_id = v_sup_po_id;

    INSERT INTO public.goods_receipt_audit
      (receipt_id, po_id, action, actor_user_id, actor_email, organization_id, payload)
    VALUES
      (_receipt_id, v_receipt.po_id, 'supplementary_po_created', v_uid, v_actor_email, v_org,
       jsonb_build_object('supplementary_po_id', v_sup_po_id, 'po_number', v_sup_po_number,
         'supplier_invoice_id', v_sup_invoice_id, 'amount', v_sup_total));
  END IF;

  -- Credit note for SHORT lines
  IF v_any_short THEN
    SELECT COALESCE(SUM((gri.ordered_qty - gri.received_qty) * pi.unit_price), 0)
      INTO v_credit_total
      FROM public.goods_receipt_items gri
      JOIN public.po_items pi ON pi.id = gri.po_item_id
      WHERE gri.receipt_id = _receipt_id AND gri.variance_type = 'short';

    INSERT INTO public.supplier_invoices
      (invoice_number, supplier_id, purchase_order_id, reason, reference,
       subtotal, total_amount, status, notes, organization_id, invoice_kind)
    VALUES
      ('CN-' || v_po.po_number || '-' || to_char(now(),'YYYYMMDDHH24MISS'),
       v_po.supplier_id, v_po.id, 'goods_receipt_short',
       v_po.po_number, -v_credit_total, -v_credit_total, 'draft',
       'Auto credit note for under-receipt on ' || v_po.po_number, v_org, 'credit_note')
    RETURNING id INTO v_credit_invoice_id;

    INSERT INTO public.supplier_invoice_lines (invoice_id, description, quantity, unit_price, line_total, organization_id)
    SELECT v_credit_invoice_id,
           pi.description || ' (short by ' || (gri.ordered_qty - gri.received_qty) || ')',
           -(gri.ordered_qty - gri.received_qty), pi.unit_price,
           -(gri.ordered_qty - gri.received_qty) * pi.unit_price, v_org
    FROM public.goods_receipt_items gri
    JOIN public.po_items pi ON pi.id = gri.po_item_id
    WHERE gri.receipt_id = _receipt_id AND gri.variance_type = 'short';

    UPDATE public.goods_receipts SET credit_note_invoice_id = v_credit_invoice_id WHERE id = _receipt_id;

    INSERT INTO public.goods_receipt_audit
      (receipt_id, po_id, action, actor_user_id, actor_email, organization_id, payload)
    VALUES
      (_receipt_id, v_receipt.po_id, 'credit_note_created', v_uid, v_actor_email, v_org,
       jsonb_build_object('credit_note_invoice_id', v_credit_invoice_id, 'amount', v_credit_total));
  END IF;

  UPDATE public.purchase_orders
    SET status = CASE WHEN v_any_short THEN 'partially_received' ELSE 'received' END
    WHERE id = v_receipt.po_id;

  UPDATE public.goods_receipts
    SET approval_status = 'approved', approved_by = v_uid, approved_at = now()
    WHERE id = _receipt_id;

  UPDATE public.approval_requests
    SET status = 'approved', decision_note = _note, decided_by = v_uid, decided_at = now()
    WHERE id = v_receipt.approval_request_id;

  INSERT INTO public.goods_receipt_audit
    (receipt_id, po_id, action, actor_user_id, actor_email, organization_id, payload)
  VALUES
    (_receipt_id, v_receipt.po_id, 'approved', v_uid, v_actor_email, v_org,
     jsonb_build_object('note', _note));

  RETURN jsonb_build_object(
    'status','approved',
    'supplementary_po_id', v_sup_po_id,
    'supplementary_invoice_id', v_sup_invoice_id,
    'credit_note_invoice_id', v_credit_invoice_id);
END;
$function$;

-- 6. Seed default workflow per org (if missing)
INSERT INTO public.approval_workflows (organization_id, doc_type, threshold_amount, approver_role, sequence, is_active)
SELECT o.id, 'goods_receipt_variance', 0, 'admin', 1, true
  FROM public.organizations o
  WHERE NOT EXISTS (
    SELECT 1 FROM public.approval_workflows w
    WHERE w.organization_id = o.id AND w.doc_type = 'goods_receipt_variance'
  );
