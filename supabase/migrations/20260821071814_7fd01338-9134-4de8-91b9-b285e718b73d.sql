
-- Material stock reconciliation
CREATE OR REPLACE FUNCTION public.reconcile_material_stock(_material_id uuid DEFAULT NULL, _reason text DEFAULT 'Manual reconciliation')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  _org uuid := current_org_id();
  _uid uuid := auth.uid();
  _rows jsonb := '[]'::jsonb;
  _r record;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF NOT (has_role(_uid,'admin'::app_role) OR has_role(_uid,'org_owner'::app_role)
          OR has_role(_uid,'accountant'::app_role) OR has_role(_uid,'production_manager'::app_role)
          OR has_role(_uid,'supply_chain_manager'::app_role)) THEN
    RAISE EXCEPTION 'Only admins, owners, accountants, production or supply chain managers can reconcile stock';
  END IF;

  FOR _r IN
    SELECT m.id, m.name, COALESCE(m.on_hand_qty,0) AS old_qty,
           COALESCE((SELECT sum(qty) FROM public.material_movements mm WHERE mm.material_id = m.id),0) AS new_qty
      FROM public.materials m
     WHERE m.organization_id = _org
       AND (_material_id IS NULL OR m.id = _material_id)
  LOOP
    IF _r.old_qty IS DISTINCT FROM _r.new_qty THEN
      UPDATE public.materials SET on_hand_qty = _r.new_qty WHERE id = _r.id;
      INSERT INTO public.material_stock_reconciliation_log
        (organization_id, material_id, material_name, old_on_hand_qty, new_balance, note)
      VALUES (_org, _r.id, _r.name, _r.old_qty, _r.new_qty, _reason);
      _rows := _rows || jsonb_build_object('material_id', _r.id, 'name', _r.name,
                 'old_qty', _r.old_qty, 'new_qty', _r.new_qty, 'delta', _r.new_qty - _r.old_qty);
    END IF;
  END LOOP;

  RETURN jsonb_build_object('corrected', jsonb_array_length(_rows), 'rows', _rows);
END $$;

-- Allocation engine with rule trail + currency guard
CREATE OR REPLACE FUNCTION public.auto_allocate_vendor_payment(_payment_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  _p public.vendor_payments%ROWTYPE;
  _left numeric; _allocated numeric := 0; _take numeric; _inv record;
  _trail jsonb := '[]'::jsonb;
  _rule text;
  _skipped_currency int := 0;
BEGIN
  SELECT * INTO _p FROM public.vendor_payments WHERE id = _payment_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Payment not found'; END IF;
  IF COALESCE(_p.amount,0) <= 0 THEN
    RETURN jsonb_build_object('allocated',0,'unallocated',0,'trail',_trail);
  END IF;

  IF _p.po_id IS NOT NULL THEN
    PERFORM public.ensure_supplier_invoice_for_po(_p.po_id);
  END IF;

  SELECT _p.amount - COALESCE(sum(amount),0) INTO _left
    FROM public.vendor_payment_allocations WHERE payment_id = _payment_id;
  IF _left <= 0 THEN
    RETURN jsonb_build_object('allocated',0,'unallocated',0,'trail',_trail,'note','already fully allocated');
  END IF;

  FOR _inv IN
    SELECT si.id, si.invoice_number, si.currency,
           GREATEST(si.total_amount - COALESCE(si.paid_amount,0), 0) AS due,
           (si.purchase_order_id IS NOT DISTINCT FROM _p.po_id AND _p.po_id IS NOT NULL) AS po_match
      FROM public.supplier_invoices si
     WHERE si.organization_id = _p.organization_id
       AND si.supplier_id = _p.supplier_id
       AND COALESCE(si.status,'') NOT IN ('void','cancelled')
       AND si.total_amount > COALESCE(si.paid_amount,0)
     ORDER BY (si.purchase_order_id IS DISTINCT FROM _p.po_id), si.issue_date, si.created_at
  LOOP
    EXIT WHEN _left <= 0;

    IF upper(COALESCE(_inv.currency,'')) <> upper(COALESCE(_p.currency,'')) THEN
      _skipped_currency := _skipped_currency + 1;
      _trail := _trail || jsonb_build_object('invoice_id',_inv.id,'invoice_number',_inv.invoice_number,
                 'rule','skipped_currency_mismatch','payment_currency',_p.currency,'invoice_currency',_inv.currency);
      CONTINUE;
    END IF;

    _take := LEAST(_left, _inv.due);
    IF _take > 0 THEN
      _rule := CASE WHEN _inv.po_match THEN 'po_match' ELSE 'fifo_oldest_open' END;
      INSERT INTO public.vendor_payment_allocations
        (organization_id, payment_id, supplier_invoice_id, amount, method, rule_applied, fx_rate, created_by)
      VALUES (_p.organization_id, _payment_id, _inv.id, _take, 'auto', _rule, _p.fx_rate, auth.uid());
      _left := _left - _take;
      _allocated := _allocated + _take;
      _trail := _trail || jsonb_build_object('invoice_id',_inv.id,'invoice_number',_inv.invoice_number,
                 'rule',_rule,'amount',_take);
    END IF;
  END LOOP;

  IF _left > 0 THEN
    _trail := _trail || jsonb_build_object('rule','unallocated_credit','amount',_left);
  END IF;

  RETURN jsonb_build_object('allocated',_allocated,'unallocated',_left,
                            'currency',_p.currency,'skipped_currency',_skipped_currency,'trail',_trail);
END $$;

-- Keep the legacy entry point working, now via the rule engine
CREATE OR REPLACE FUNCTION public.allocate_vendor_payment(_payment_id uuid)
RETURNS numeric LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _res jsonb;
BEGIN
  _res := public.auto_allocate_vendor_payment(_payment_id);
  RETURN COALESCE((_res->>'allocated')::numeric, 0);
END $$;

-- Manual allocation of a payment to a specific invoice
CREATE OR REPLACE FUNCTION public.manual_allocate_vendor_payment(_payment_id uuid, _supplier_invoice_id uuid, _amount numeric)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  _p public.vendor_payments%ROWTYPE; _si public.supplier_invoices%ROWTYPE; _left numeric; _due numeric;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT * INTO _p FROM public.vendor_payments WHERE id = _payment_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Payment not found'; END IF;
  SELECT * INTO _si FROM public.supplier_invoices WHERE id = _supplier_invoice_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Purchase invoice not found'; END IF;
  IF _si.organization_id <> _p.organization_id THEN RAISE EXCEPTION 'Cross-organization allocation is not allowed'; END IF;
  IF upper(COALESCE(_si.currency,'')) <> upper(COALESCE(_p.currency,'')) THEN
    RAISE EXCEPTION 'Currency mismatch: payment is % and invoice is %', _p.currency, _si.currency;
  END IF;

  SELECT _p.amount - COALESCE(sum(amount),0) INTO _left FROM public.vendor_payment_allocations WHERE payment_id = _payment_id;
  _due := GREATEST(COALESCE(_si.total_amount,0) - COALESCE(_si.paid_amount,0), 0);
  IF _amount IS NULL OR _amount <= 0 THEN RAISE EXCEPTION 'Amount must be greater than zero'; END IF;
  IF _amount > _left THEN RAISE EXCEPTION 'Only % remains unallocated on this payment', _left; END IF;
  IF _amount > _due THEN RAISE EXCEPTION 'Only % remains outstanding on this invoice', _due; END IF;

  INSERT INTO public.vendor_payment_allocations
    (organization_id, payment_id, supplier_invoice_id, amount, method, rule_applied, fx_rate, created_by)
  VALUES (_p.organization_id, _payment_id, _supplier_invoice_id, _amount, 'manual', 'manual', _p.fx_rate, auth.uid());

  RETURN jsonb_build_object('allocated', _amount, 'unallocated', _left - _amount);
END $$;

CREATE OR REPLACE FUNCTION public.unallocate_vendor_payment(_allocation_id uuid, _reason text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _uid uuid := auth.uid(); _a public.vendor_payment_allocations%ROWTYPE;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF NOT (has_role(_uid,'admin'::app_role) OR has_role(_uid,'org_owner'::app_role) OR has_role(_uid,'accountant'::app_role)) THEN
    RAISE EXCEPTION 'Only admins, owners or accountants can reverse an allocation';
  END IF;
  IF length(btrim(COALESCE(_reason,''))) < 5 THEN RAISE EXCEPTION 'A reason is required (minimum 5 characters)'; END IF;

  SELECT * INTO _a FROM public.vendor_payment_allocations WHERE id = _allocation_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Allocation not found'; END IF;

  INSERT INTO public.finance_audit_log (organization_id, table_name, record_id, action, changed_by, new_values)
  VALUES (_a.organization_id, 'vendor_payment_allocations', _a.id, 'unallocate', _uid,
          jsonb_build_object('amount', _a.amount, 'supplier_invoice_id', _a.supplier_invoice_id,
                             'payment_id', _a.payment_id, 'reason', _reason));

  DELETE FROM public.vendor_payment_allocations WHERE id = _allocation_id;
  RETURN true;
END $$;

REVOKE ALL ON FUNCTION public.lock_vendor_payment_fx() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.lock_supplier_invoice_fx() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.reconcile_material_stock(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.auto_allocate_vendor_payment(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.manual_allocate_vendor_payment(uuid, uuid, numeric) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.unallocate_vendor_payment(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.allocate_vendor_payment(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reconcile_material_stock(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.auto_allocate_vendor_payment(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.manual_allocate_vendor_payment(uuid, uuid, numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.unallocate_vendor_payment(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.allocate_vendor_payment(uuid) TO authenticated;
