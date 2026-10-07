
CREATE OR REPLACE FUNCTION public.logistics_propose_deposit(_order_id uuid, _amount numeric DEFAULT NULL)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _order logistics_transport_orders%ROWTYPE;
  _customer customers%ROWTYPE;
  _invoice_id uuid;
  _amt numeric(14,2);
  _pct numeric(6,2);
  _base_num text;
  _num text;
  _n int := 1;
BEGIN
  SELECT * INTO _order FROM logistics_transport_orders
    WHERE id = _order_id AND organization_id = current_org_id();
  IF _order.id IS NULL THEN RAISE EXCEPTION 'order_not_found'; END IF;

  IF _order.deposit_invoice_id IS NOT NULL THEN
    RAISE EXCEPTION 'deposit_already_invoiced';
  END IF;
  IF _order.deposit_status = 'pending_approval' THEN
    RAISE EXCEPTION 'deposit_already_pending';
  END IF;
  IF _order.status NOT IN ('confirmed','assigned','in_transit','delivered') THEN
    RAISE EXCEPTION 'order_not_ready_for_deposit';
  END IF;
  IF COALESCE(_order.quoted_price,0) <= 0 THEN
    RAISE EXCEPTION 'quoted_price_zero';
  END IF;

  IF _amount IS NOT NULL THEN
    IF _amount <= 0 OR _amount > _order.quoted_price THEN
      RAISE EXCEPTION 'invalid_deposit_amount';
    END IF;
    _amt := round(_amount, 2);
    _pct := round(_amt / _order.quoted_price * 100.0, 2);
  ELSE
    IF COALESCE(_order.deposit_pct, 0) <= 0 THEN
      RAISE EXCEPTION 'deposit_pct_zero';
    END IF;
    _pct := _order.deposit_pct;
    _amt := round(_order.quoted_price * _pct / 100.0, 2);
  END IF;

  SELECT * INTO _customer FROM customers WHERE id = _order.customer_id;

  -- Generate a unique invoice_number (base collides after cancel/re-propose)
  _base_num := 'LOG-' || _order.ref || '-DEP';
  _num := _base_num;
  WHILE EXISTS (SELECT 1 FROM invoices WHERE invoice_number = _num) LOOP
    _n := _n + 1;
    _num := _base_num || '-' || _n;
  END LOOP;

  INSERT INTO invoices (
    organization_id, invoice_number, customer_name, customer_reference,
    invoice_type, subtotal, tax_rate, tax_amount, total_amount, currency,
    status, issued_at, due_at, notes, created_by
  ) VALUES (
    _order.organization_id,
    _num,
    COALESCE(_customer.company_name, _order.customer_name, 'Walk-in'),
    _order.ref, 'other',
    _amt, 0, 0, _amt, _order.currency,
    'draft', NULL, now() + interval '30 days',
    'Deposit ' || _pct || '% (awaiting customer approval) — Logistics: '
      || _order.pickup_location || ' → ' || _order.dropoff_location,
    _order.created_by
  ) RETURNING id INTO _invoice_id;

  UPDATE logistics_transport_orders
     SET deposit_invoice_id = _invoice_id,
         deposit_pct = _pct,
         deposit_status = 'pending_approval',
         deposit_proposed_at = now(),
         deposit_disputed_at = NULL,
         deposit_dispute_reason = NULL,
         updated_at = now()
   WHERE id = _order.id;

  RETURN _invoice_id;
END $function$;

REVOKE EXECUTE ON FUNCTION public.logistics_propose_deposit(uuid, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.logistics_propose_deposit(uuid, numeric) TO authenticated;
