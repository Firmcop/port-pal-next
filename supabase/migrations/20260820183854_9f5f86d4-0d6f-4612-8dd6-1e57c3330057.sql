CREATE OR REPLACE FUNCTION public.ensure_supplier_invoice_for_po(_po_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _po public.purchase_orders%ROWTYPE; _inv_id uuid; _num text; _amt numeric; _tax numeric; _sub numeric;
BEGIN
  IF _po_id IS NULL THEN RETURN NULL; END IF;
  SELECT id INTO _inv_id FROM public.supplier_invoices WHERE purchase_order_id = _po_id LIMIT 1;
  IF _inv_id IS NOT NULL THEN RETURN _inv_id; END IF;

  SELECT * INTO _po FROM public.purchase_orders WHERE id = _po_id;
  IF NOT FOUND OR _po.supplier_id IS NULL THEN RETURN NULL; END IF;

  _amt := round(COALESCE(NULLIF(_po.landed_total,0), NULLIF(_po.total_cost,0), 0), 2);
  IF _amt <= 0 THEN RETURN NULL; END IF;

  _tax := round(COALESCE(_po.tax_total,0), 2);
  IF _tax < 0 OR _tax >= _amt THEN _tax := 0; END IF;
  _sub := round(_amt - _tax, 2);

  _num := 'PINV-' || to_char(COALESCE(_po.order_date, current_date),'YYYYMMDD') || '-' || substr(replace(gen_random_uuid()::text,'-',''),1,6);

  INSERT INTO public.supplier_invoices (
    organization_id, invoice_number, supplier_id, purchase_order_id, reason, reference,
    issue_date, due_date, subtotal, tax_amount, total_amount, currency, status, notes
  ) VALUES (
    _po.organization_id, _num, _po.supplier_id, _po.id, 'purchase', _po.po_number,
    COALESCE(_po.order_date, current_date), COALESCE(_po.order_date, current_date) + INTERVAL '30 days',
    _sub, _tax, _amt, _po.currency, 'issued', 'Auto-generated from ' || _po.po_number
  ) RETURNING id INTO _inv_id;

  INSERT INTO public.supplier_invoice_lines (organization_id, invoice_id, description, quantity, unit_price, line_total)
  SELECT _po.organization_id, _inv_id, i.description, i.quantity, i.unit_price, i.total_cost
    FROM public.po_items i WHERE i.po_id = _po.id;

  RETURN _inv_id;
END $$;
REVOKE ALL ON FUNCTION public.ensure_supplier_invoice_for_po(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.allocate_vendor_payment(_payment_id uuid)
RETURNS numeric LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _p public.vendor_payments%ROWTYPE;
  _left numeric; _allocated numeric := 0; _take numeric; _inv record;
BEGIN
  SELECT * INTO _p FROM public.vendor_payments WHERE id = _payment_id;
  IF NOT FOUND OR COALESCE(_p.amount,0) <= 0 THEN RETURN 0; END IF;

  IF _p.po_id IS NOT NULL THEN
    PERFORM public.ensure_supplier_invoice_for_po(_p.po_id);
  END IF;

  SELECT _p.amount - COALESCE(sum(amount),0) INTO _left
    FROM public.vendor_payment_allocations WHERE payment_id = _payment_id;
  IF _left <= 0 THEN RETURN 0; END IF;

  FOR _inv IN
    SELECT si.id, GREATEST(si.total_amount - COALESCE(si.paid_amount,0), 0) AS due
      FROM public.supplier_invoices si
     WHERE si.organization_id = _p.organization_id
       AND si.supplier_id = _p.supplier_id
       AND COALESCE(si.status,'') <> 'void'
       AND si.total_amount > COALESCE(si.paid_amount,0)
     ORDER BY (si.purchase_order_id IS DISTINCT FROM _p.po_id), si.issue_date, si.created_at
  LOOP
    EXIT WHEN _left <= 0;
    _take := LEAST(_left, _inv.due);
    IF _take > 0 THEN
      INSERT INTO public.vendor_payment_allocations (organization_id, payment_id, supplier_invoice_id, amount, method, created_by)
      VALUES (_p.organization_id, _payment_id, _inv.id, _take, 'auto_fifo', auth.uid());
      _left := _left - _take;
      _allocated := _allocated + _take;
    END IF;
  END LOOP;

  RETURN _allocated;
END $$;
REVOKE ALL ON FUNCTION public.allocate_vendor_payment(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.allocate_vendor_payment(uuid) TO authenticated;

DO $$ DECLARE r record; BEGIN
  FOR r IN SELECT id FROM public.vendor_payments ORDER BY paid_at NULLS LAST, created_at LOOP
    PERFORM public.allocate_vendor_payment(r.id);
  END LOOP;
END $$;
