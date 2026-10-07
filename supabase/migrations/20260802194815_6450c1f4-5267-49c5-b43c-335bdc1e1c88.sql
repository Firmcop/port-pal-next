-- 1. New columns
ALTER TABLE public.goods_receipts
  ADD COLUMN IF NOT EXISTS is_void boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS void_reason text,
  ADD COLUMN IF NOT EXISTS voided_by uuid,
  ADD COLUMN IF NOT EXISTS voided_at timestamptz;

ALTER TABLE public.po_items
  ADD COLUMN IF NOT EXISTS received_qty numeric NOT NULL DEFAULT 0;

-- 2. Reconciliation log
CREATE TABLE IF NOT EXISTS public.material_stock_reconciliation_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid,
  material_id uuid NOT NULL REFERENCES public.materials(id) ON DELETE CASCADE,
  material_name text,
  old_on_hand_qty numeric,
  old_qty_available numeric,
  new_balance numeric,
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.material_stock_reconciliation_log TO authenticated;
GRANT ALL ON public.material_stock_reconciliation_log TO service_role;
ALTER TABLE public.material_stock_reconciliation_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "recon_log_read" ON public.material_stock_reconciliation_log;
CREATE POLICY "recon_log_read" ON public.material_stock_reconciliation_log
  FOR SELECT TO authenticated
  USING (organization_id = public.current_org_id() OR public.is_platform_admin());

-- 3. Mirror materials.on_hand_qty -> material_stock.qty_available
CREATE OR REPLACE FUNCTION public.sync_material_stock_mirror()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  UPDATE public.material_stock
     SET qty_available = COALESCE(NEW.on_hand_qty, 0), last_updated = now()
   WHERE material_id = NEW.id;
  IF NOT FOUND THEN
    INSERT INTO public.material_stock(material_id, qty_available, qty_reserved, organization_id)
    VALUES (NEW.id, COALESCE(NEW.on_hand_qty,0), 0, NEW.organization_id);
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_sync_material_stock_mirror ON public.materials;
CREATE TRIGGER trg_sync_material_stock_mirror
AFTER INSERT OR UPDATE OF on_hand_qty ON public.materials
FOR EACH ROW EXECUTE FUNCTION public.sync_material_stock_mirror();

-- 4. Store issues / returns post movements automatically
CREATE OR REPLACE FUNCTION public.post_store_issue_movement()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE _cost numeric;
BEGIN
  IF NEW.material_id IS NULL OR COALESCE(NEW.quantity,0) = 0 THEN RETURN NEW; END IF;
  SELECT COALESCE(avg_unit_cost, unit_cost, 0) INTO _cost FROM public.materials WHERE id = NEW.material_id;
  INSERT INTO public.material_movements
    (material_id, movement_type, qty, unit_cost, conversion_id, organization_id, created_by, reason)
  VALUES (NEW.material_id, 'issue', -abs(NEW.quantity), _cost, NEW.conversion_id,
          NEW.organization_id, COALESCE(NEW.issued_by, auth.uid()),
          concat('Store issue ', COALESCE(NEW.issue_number,'')));
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_post_store_issue_movement ON public.store_issues;
CREATE TRIGGER trg_post_store_issue_movement
AFTER INSERT ON public.store_issues
FOR EACH ROW EXECUTE FUNCTION public.post_store_issue_movement();

CREATE OR REPLACE FUNCTION public.post_store_return_movement()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE _cost numeric;
BEGIN
  IF NEW.material_id IS NULL OR COALESCE(NEW.quantity,0) = 0 THEN RETURN NEW; END IF;
  SELECT COALESCE(avg_unit_cost, unit_cost, 0) INTO _cost FROM public.materials WHERE id = NEW.material_id;
  INSERT INTO public.material_movements
    (material_id, movement_type, qty, unit_cost, conversion_id, organization_id, created_by, reason)
  VALUES (NEW.material_id, 'return', abs(NEW.quantity), _cost, NEW.conversion_id,
          NEW.organization_id, COALESCE(NEW.returned_by, auth.uid()),
          concat('Store return ', COALESCE(NEW.return_number,'')));
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_post_store_return_movement ON public.store_returns;
CREATE TRIGGER trg_post_store_return_movement
AFTER INSERT ON public.store_returns
FOR EACH ROW EXECUTE FUNCTION public.post_store_return_movement();

-- 5. Central posting helper for goods receipts
CREATE OR REPLACE FUNCTION public.post_receipt_stock(_receipt_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE v_item record; v_org uuid;
BEGIN
  SELECT organization_id INTO v_org FROM public.goods_receipts WHERE id = _receipt_id;
  FOR v_item IN
    SELECT gri.received_qty, pi.id AS po_item_id, pi.material_id,
           COALESCE(pi.landed_unit_cost, pi.unit_price, 0) AS cost
      FROM public.goods_receipt_items gri
      JOIN public.po_items pi ON pi.id = gri.po_item_id
     WHERE gri.receipt_id = _receipt_id
  LOOP
    UPDATE public.po_items
       SET received_qty = COALESCE(received_qty,0) + COALESCE(v_item.received_qty,0)
     WHERE id = v_item.po_item_id;

    IF v_item.material_id IS NOT NULL AND COALESCE(v_item.received_qty,0) > 0 THEN
      INSERT INTO public.material_movements
        (material_id, movement_type, qty, unit_cost, goods_receipt_id, organization_id, created_by, reason)
      VALUES (v_item.material_id, 'receipt', v_item.received_qty, v_item.cost,
              _receipt_id, v_org, auth.uid(), 'Goods receipt');
    END IF;
  END LOOP;
END $$;
REVOKE ALL ON FUNCTION public.post_receipt_stock(uuid) FROM PUBLIC, anon;

-- 6. Link a free-text receipt line to a material and post it retroactively
CREATE OR REPLACE FUNCTION public.link_receipt_item_to_material(_receipt_item_id uuid, _material_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE v_gri record; v_po_item record; v_gr record; v_uid uuid := auth.uid(); v_cost numeric;
BEGIN
  IF NOT (public.has_role(v_uid,'admin'::app_role) OR public.has_role(v_uid,'procurement_officer'::app_role)
          OR public.has_role(v_uid,'production_manager'::app_role) OR public.is_platform_admin()) THEN
    RAISE EXCEPTION 'not authorised to link receipt lines';
  END IF;

  SELECT * INTO v_gri FROM public.goods_receipt_items WHERE id = _receipt_item_id;
  IF v_gri IS NULL THEN RAISE EXCEPTION 'receipt line not found'; END IF;
  SELECT * INTO v_gr FROM public.goods_receipts WHERE id = v_gri.receipt_id;
  IF v_gr.organization_id <> public.current_org_id() AND NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  IF v_gr.is_void THEN RAISE EXCEPTION 'receipt is void'; END IF;
  IF v_gr.approval_status NOT IN ('auto_posted','approved') THEN
    RAISE EXCEPTION 'receipt is not posted';
  END IF;

  SELECT * INTO v_po_item FROM public.po_items WHERE id = v_gri.po_item_id;
  IF v_po_item.material_id IS NOT NULL THEN
    RAISE EXCEPTION 'line already linked to a material';
  END IF;

  UPDATE public.po_items SET material_id = _material_id WHERE id = v_po_item.id;
  v_cost := COALESCE(v_po_item.landed_unit_cost, v_po_item.unit_price, 0);

  INSERT INTO public.material_movements
    (material_id, movement_type, qty, unit_cost, goods_receipt_id, organization_id, created_by, reason)
  VALUES (_material_id, 'receipt', v_gri.received_qty, v_cost, v_gr.id, v_gr.organization_id, v_uid,
          'Retro-link of receipt line to material');

  INSERT INTO public.goods_receipt_audit
    (receipt_id, receipt_item_id, po_id, action, actor_user_id, organization_id, payload)
  VALUES (v_gr.id, v_gri.id, v_gr.po_id, 'inventory_posted', v_uid, v_gr.organization_id,
          jsonb_build_object('linked_material_id', _material_id, 'qty', v_gri.received_qty, 'retro', true));

  RETURN jsonb_build_object('ok', true, 'material_id', _material_id, 'qty', v_gri.received_qty);
END $$;
REVOKE ALL ON FUNCTION public.link_receipt_item_to_material(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.link_receipt_item_to_material(uuid, uuid) TO authenticated;

-- 7. Rewrite receive_po_with_variances to use the ledger + outstanding-qty guard
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
  v_outstanding numeric;
  v_ordered numeric;
  v_variance_type text;
  v_reason text;
  v_has_variance boolean := false;
  v_any_short boolean := false;
  v_any_over boolean := false;
  v_variance_value numeric := 0;
  v_approval_id uuid;
  v_actor_email text;
  v_item_id uuid;
  v_all_received boolean;
BEGIN
  SELECT * INTO v_po FROM public.purchase_orders WHERE id = _po_id;
  IF v_po IS NULL THEN RAISE EXCEPTION 'PO not found'; END IF;
  v_org := v_po.organization_id;
  IF v_org <> public.current_org_id() AND NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  SELECT email INTO v_actor_email FROM auth.users WHERE id = auth.uid();

  -- First pass: validate against outstanding qty and classify variance
  FOR v_line IN SELECT * FROM jsonb_array_elements(_lines) LOOP
    SELECT * INTO v_po_item FROM public.po_items
      WHERE id = (v_line->>'po_item_id')::uuid AND po_id = _po_id;
    IF v_po_item IS NULL THEN CONTINUE; END IF;
    v_received := COALESCE((v_line->>'received_qty')::numeric, 0);
    v_outstanding := GREATEST(v_po_item.quantity - COALESCE(v_po_item.received_qty,0), 0);

    IF v_received > 0 AND v_outstanding <= 0 AND NOT COALESCE((v_line->>'allow_over')::boolean, false) THEN
      RAISE EXCEPTION 'Line "%" is already fully received (% of %). Receiving more requires an over-receipt.',
        v_po_item.description, COALESCE(v_po_item.received_qty,0), v_po_item.quantity;
    END IF;

    v_ordered := v_outstanding;
    IF v_received < v_ordered THEN
      v_has_variance := true; v_any_short := true;
      v_variance_value := v_variance_value + (v_ordered - v_received) * v_po_item.unit_price;
    ELSIF v_received > v_ordered THEN
      v_has_variance := true; v_any_over := true;
      v_variance_value := v_variance_value + (v_received - v_ordered) * v_po_item.unit_price;
    END IF;
  END LOOP;

  INSERT INTO public.goods_receipts
    (po_id, received_by, notes, organization_id, has_variance,
     approval_status, submitted_by, submitted_at)
  VALUES
    (_po_id, auth.uid(), _notes, v_org, v_has_variance,
     CASE WHEN v_has_variance THEN 'pending_approval' ELSE 'auto_posted' END,
     auth.uid(), now())
  RETURNING id INTO v_receipt_id;

  FOR v_line IN SELECT * FROM jsonb_array_elements(_lines) LOOP
    SELECT * INTO v_po_item FROM public.po_items
      WHERE id = (v_line->>'po_item_id')::uuid AND po_id = _po_id;
    IF v_po_item IS NULL THEN CONTINUE; END IF;
    v_received := COALESCE((v_line->>'received_qty')::numeric, 0);
    v_ordered := GREATEST(v_po_item.quantity - COALESCE(v_po_item.received_qty,0), 0);
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
         'outstanding_qty', v_ordered, 'received_qty', v_received,
         'variance_type', v_variance_type, 'variance_reason', v_reason));
  END LOOP;

  IF v_has_variance THEN
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

  PERFORM public.post_receipt_stock(v_receipt_id);

  SELECT bool_and(COALESCE(received_qty,0) >= quantity) INTO v_all_received
    FROM public.po_items WHERE po_id = _po_id;

  UPDATE public.purchase_orders
     SET status = CASE WHEN COALESCE(v_all_received,true) THEN 'received' ELSE 'partially_received' END
   WHERE id = _po_id;

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

-- 8. Variance approval posts through the same ledger helper
CREATE OR REPLACE FUNCTION public.gr_post_approved_stock(_receipt_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  PERFORM public.post_receipt_stock(_receipt_id);
END $$;
REVOKE ALL ON FUNCTION public.gr_post_approved_stock(uuid) FROM PUBLIC, anon;

-- 9. adjust_stock: material branch now posts a movement (single source of truth)
CREATE OR REPLACE FUNCTION public.adjust_stock(_item_type stock_adjustment_item_type, _item_id uuid, _adjustment_type stock_adjustment_type, _reason_category stock_adjustment_reason, _reason_text text, _new_qty numeric, _unit_cost numeric DEFAULT NULL::numeric, _from_depot uuid DEFAULT NULL::uuid, _to_depot uuid DEFAULT NULL::uuid)
RETURNS stock_adjustments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _org uuid := current_org_id();
  _uid uuid := auth.uid();
  _qty_before numeric := 0;
  _qty_after numeric := 0;
  _qty_delta numeric := 0;
  _cost numeric := COALESCE(_unit_cost, 0);
  _value_delta numeric := 0;
  _label text;
  _journal uuid;
  _txn_number text;
  _inv_acct uuid;
  _offset_acct uuid;
  _currency text;
  _row public.stock_adjustments;
  _ref text;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF NOT (
    has_role(_uid,'admin'::app_role)
    OR has_role(_uid,'production_manager'::app_role)
    OR has_role(_uid,'asset_manager'::app_role)
    OR has_role(_uid,'accountant'::app_role)
  ) THEN
    RAISE EXCEPTION 'Only admins, production managers, asset managers or accountants can adjust stock';
  END IF;

  IF length(btrim(COALESCE(_reason_text,''))) < 5 THEN
    RAISE EXCEPTION 'Reason is required (minimum 5 characters)';
  END IF;

  SELECT COALESCE(currency,'USD') INTO _currency FROM public.organizations WHERE id = _org;

  IF _item_type = 'material' THEN
    SELECT COALESCE(m.on_hand_qty,0), m.name
      INTO _qty_before, _label
      FROM public.materials m
     WHERE m.id = _item_id
     FOR UPDATE OF m;
    IF NOT FOUND THEN RAISE EXCEPTION 'Material not found'; END IF;

    IF _cost = 0 THEN
      SELECT COALESCE(avg_unit_cost, unit_cost, 0) INTO _cost FROM public.materials WHERE id = _item_id;
    END IF;

    _qty_after := _new_qty;
    _qty_delta := _qty_after - _qty_before;

    IF _qty_delta <> 0 THEN
      INSERT INTO public.material_movements(material_id, movement_type, qty, unit_cost, reason, organization_id, created_by)
      VALUES (
        _item_id,
        CASE WHEN _adjustment_type = 'write_off' THEN 'scrap'::material_movement_type
             ELSE 'adjustment'::material_movement_type END,
        _qty_delta, _cost,
        concat_ws(' | ', _adjustment_type::text, _reason_category::text, _reason_text),
        _org, _uid
      );
    END IF;

  ELSIF _item_type = 'sub_assembly' THEN
    SELECT on_hand_qty, name INTO _qty_before, _label
      FROM public.sub_assembly_stock
     WHERE id = _item_id AND organization_id = _org
     FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Sub-assembly not found'; END IF;

    IF _cost = 0 THEN
      SELECT COALESCE(avg_unit_cost,0) INTO _cost FROM public.sub_assembly_stock WHERE id = _item_id;
    END IF;

    _qty_after := _new_qty;
    _qty_delta := _qty_after - _qty_before;

    UPDATE public.sub_assembly_stock
       SET on_hand_qty = _qty_after
     WHERE id = _item_id AND organization_id = _org;

    INSERT INTO public.sub_assembly_movements(assembly_stock_id, movement_type, qty, unit_cost, reason, organization_id, created_by)
    VALUES (_item_id, 'adjustment', _qty_delta, _cost,
      concat_ws(' | ', _adjustment_type::text, _reason_category::text, _reason_text), _org, _uid);

  ELSIF _item_type = 'finished_product' THEN
    SELECT (CASE WHEN status IN ('scrapped','sold','leased') THEN 0 ELSE 1 END),
           COALESCE(name, product_number),
           COALESCE(total_cost, 0)
      INTO _qty_before, _label, _cost
      FROM public.finished_products
     WHERE id = _item_id AND organization_id = _org
     FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Finished product not found'; END IF;

    _qty_after := LEAST(GREATEST(_new_qty, 0), 1);
    _qty_delta := _qty_after - _qty_before;

    IF _adjustment_type = 'write_off' THEN
      UPDATE public.finished_products
         SET status = 'scrapped'::finished_product_status
       WHERE id = _item_id AND organization_id = _org;
    END IF;
  END IF;

  _value_delta := round(_qty_delta * COALESCE(_cost,0), 2);
  _ref := 'ADJ-' || upper(substr(replace(gen_random_uuid()::text,'-',''), 1, 8));

  IF _value_delta <> 0 THEN
    SELECT id INTO _inv_acct FROM public.financial_accounts
      WHERE organization_id = _org AND account_type = 'asset'
        AND (name ILIKE '%inventory%' OR code = '1300') LIMIT 1;
    SELECT id INTO _offset_acct FROM public.financial_accounts
      WHERE organization_id = _org
        AND (name ILIKE '%inventory adjust%' OR name ILIKE '%shrinkage%' OR name ILIKE '%write%off%')
      LIMIT 1;

    IF _inv_acct IS NOT NULL AND _offset_acct IS NOT NULL THEN
      _journal := gen_random_uuid();
      _txn_number := 'JV-' || upper(substr(replace(_journal::text,'-',''), 1, 8));

      INSERT INTO public.accounting_transactions(
        transaction_number, transaction_date, description, debit_amount, credit_amount,
        transaction_type, reference_id, account_id, journal_id, organization_id, created_by)
      VALUES (
        _txn_number, CURRENT_DATE,
        concat('Stock adjustment ', _ref, ' — ', _label, ' (', _adjustment_type::text, ')'),
        abs(_value_delta), 0,
        'stock_adjustment', NULL,
        CASE WHEN _value_delta > 0 THEN _inv_acct ELSE _offset_acct END,
        _journal, _org, _uid
      );
      INSERT INTO public.accounting_transactions(
        transaction_number, transaction_date, description, debit_amount, credit_amount,
        transaction_type, reference_id, account_id, journal_id, organization_id, created_by)
      VALUES (
        _txn_number, CURRENT_DATE,
        concat('Stock adjustment ', _ref, ' — ', _label, ' (', _adjustment_type::text, ')'),
        0, abs(_value_delta),
        'stock_adjustment', NULL,
        CASE WHEN _value_delta < 0 THEN _inv_acct ELSE _offset_acct END,
        _journal, _org, _uid
      );
    END IF;
  END IF;

  INSERT INTO public.stock_adjustments(
    organization_id, reference, item_type, item_id, item_label,
    adjustment_type, reason_category, reason_text,
    qty_before, qty_after, qty_delta, unit_cost, value_delta, currency,
    from_depot_id, to_depot_id, gl_journal_id, adjusted_by
  ) VALUES (
    _org, _ref, _item_type, _item_id, _label,
    _adjustment_type, _reason_category, _reason_text,
    _qty_before, _qty_after, _qty_delta, _cost, _value_delta, _currency,
    _from_depot, _to_depot, _journal, _uid
  ) RETURNING * INTO _row;

  IF _journal IS NOT NULL THEN
    UPDATE public.accounting_transactions
       SET reference_id = _row.id
     WHERE journal_id = _journal;
  END IF;

  INSERT INTO public.finance_audit_log(
    organization_id, actor_user_id, entity_type, entity_id, entity_ref, action, summary
  ) VALUES (
    _org, _uid, 'stock_adjustment', _row.id, _ref, 'adjust_stock',
    jsonb_build_object(
      'item_type', _item_type, 'item_id', _item_id, 'item_label', _label,
      'adjustment_type', _adjustment_type, 'reason_category', _reason_category,
      'qty_before', _qty_before, 'qty_after', _qty_after, 'qty_delta', _qty_delta,
      'unit_cost', _cost, 'value_delta', _value_delta, 'journal_id', _journal)
  );

  RETURN _row;
END $function$;

-- 10. Void the duplicate 2 Aug receipt (same PO, same lines, 3 minutes apart)
UPDATE public.goods_receipts
   SET is_void = true,
       void_reason = 'Duplicate of receipt recorded 3 minutes earlier for the same purchase order and quantities',
       voided_at = now()
 WHERE id = 'd1fb53d3-b2d5-4ef9-8ec2-acd9641480a0';

-- 11. Rebuild the material ledger and balances
DO $$
DECLARE r record;
BEGIN
  -- snapshot current values for review
  INSERT INTO public.material_stock_reconciliation_log
    (organization_id, material_id, material_name, old_on_hand_qty, old_qty_available, note)
  SELECT m.organization_id, m.id, m.name, m.on_hand_qty, ms.qty_available,
         'Pre-rebuild snapshot'
    FROM public.materials m
    LEFT JOIN public.material_stock ms ON ms.material_id = m.id;

  ALTER TABLE public.material_movements DISABLE TRIGGER trg_apply_material_movement;

  -- receipts from posted, non-void goods receipts
  INSERT INTO public.material_movements
    (material_id, movement_type, qty, unit_cost, goods_receipt_id, organization_id, created_by, reason, created_at)
  SELECT pi.material_id, 'receipt', gri.received_qty,
         COALESCE(pi.landed_unit_cost, pi.unit_price, 0), gr.id, gr.organization_id, gr.received_by,
         'Backfilled from goods receipt', gr.created_at
    FROM public.goods_receipt_items gri
    JOIN public.goods_receipts gr ON gr.id = gri.receipt_id
    JOIN public.po_items pi ON pi.id = gri.po_item_id
   WHERE gr.approval_status IN ('auto_posted','approved')
     AND gr.is_void = false
     AND pi.material_id IS NOT NULL
     AND gri.received_qty > 0;

  -- store issues
  INSERT INTO public.material_movements
    (material_id, movement_type, qty, unit_cost, conversion_id, organization_id, created_by, reason, created_at)
  SELECT si.material_id, 'issue', -abs(si.quantity),
         COALESCE(m.avg_unit_cost, m.unit_cost, 0), si.conversion_id, si.organization_id, si.issued_by,
         concat('Backfilled store issue ', COALESCE(si.issue_number,'')), si.created_at
    FROM public.store_issues si
    JOIN public.materials m ON m.id = si.material_id
   WHERE si.quantity <> 0;

  -- store returns
  INSERT INTO public.material_movements
    (material_id, movement_type, qty, unit_cost, conversion_id, organization_id, created_by, reason, created_at)
  SELECT sr.material_id, 'return', abs(sr.quantity),
         COALESCE(m.avg_unit_cost, m.unit_cost, 0), sr.conversion_id, sr.organization_id, sr.returned_by,
         concat('Backfilled store return ', COALESCE(sr.return_number,'')), sr.created_at
    FROM public.store_returns sr
    JOIN public.materials m ON m.id = sr.material_id
   WHERE sr.quantity <> 0;

  ALTER TABLE public.material_movements ENABLE TRIGGER trg_apply_material_movement;

  -- recompute balances from the ledger
  UPDATE public.materials m
     SET on_hand_qty = COALESCE(x.total, 0)
    FROM (SELECT material_id, SUM(qty) total FROM public.material_movements GROUP BY 1) x
   WHERE x.material_id = m.id;

  -- mirror into material_stock for every material
  UPDATE public.material_stock ms
     SET qty_available = COALESCE(m.on_hand_qty,0), last_updated = now()
    FROM public.materials m
   WHERE m.id = ms.material_id;

  INSERT INTO public.material_stock (material_id, qty_available, qty_reserved, organization_id)
  SELECT m.id, COALESCE(m.on_hand_qty,0), 0, m.organization_id
    FROM public.materials m
   WHERE NOT EXISTS (SELECT 1 FROM public.material_stock ms WHERE ms.material_id = m.id);

  UPDATE public.material_stock_reconciliation_log l
     SET new_balance = m.on_hand_qty
    FROM public.materials m
   WHERE m.id = l.material_id AND l.new_balance IS NULL;

  -- received-to-date on PO lines
  UPDATE public.po_items pi
     SET received_qty = COALESCE(x.total, 0)
    FROM (SELECT gri.po_item_id, SUM(gri.received_qty) total
            FROM public.goods_receipt_items gri
            JOIN public.goods_receipts gr ON gr.id = gri.receipt_id
           WHERE gr.approval_status IN ('auto_posted','approved') AND gr.is_void = false
           GROUP BY 1) x
   WHERE x.po_item_id = pi.id;
END $$;