
CREATE OR REPLACE FUNCTION public.logistics_propose_deposit(_order_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _order logistics_transport_orders%ROWTYPE;
  _customer customers%ROWTYPE;
  _invoice_id uuid;
  _amount numeric(14,2);
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
  IF COALESCE(_order.deposit_pct, 0) <= 0 THEN
    RAISE EXCEPTION 'deposit_pct_zero';
  END IF;
  IF _order.status NOT IN ('confirmed','assigned','in_transit','delivered') THEN
    RAISE EXCEPTION 'order_not_ready_for_deposit';
  END IF;

  SELECT * INTO _customer FROM customers WHERE id = _order.customer_id;

  _amount := round(_order.quoted_price * _order.deposit_pct / 100.0, 2);

  INSERT INTO invoices (
    organization_id, invoice_number, customer_name, customer_reference,
    invoice_type, subtotal, tax_rate, tax_amount, total_amount, currency,
    status, issued_at, due_at, notes, created_by
  ) VALUES (
    _order.organization_id,
    'LOG-' || _order.ref || '-DEP',
    COALESCE(_customer.company_name, _order.customer_name, 'Walk-in'),
    _order.ref, 'other',
    _amount, 0, 0, _amount, _order.currency,
    'draft', NULL, now() + interval '30 days',
    'Deposit ' || _order.deposit_pct || '% (awaiting customer approval) — Logistics: '
      || _order.pickup_location || ' → ' || _order.dropoff_location,
    _order.created_by
  ) RETURNING id INTO _invoice_id;

  UPDATE logistics_transport_orders
     SET deposit_invoice_id = _invoice_id,
         deposit_status = 'pending_approval',
         deposit_proposed_at = now(),
         deposit_disputed_at = NULL,
         deposit_dispute_reason = NULL,
         updated_at = now()
   WHERE id = _order.id;

  RETURN _invoice_id;
END $function$;

CREATE OR REPLACE FUNCTION public.logistics_invoice_order(_order_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _order logistics_transport_orders%ROWTYPE;
  _customer customers%ROWTYPE;
  _invoice_id uuid;
  _trip_id uuid;
BEGIN
  SELECT * INTO _order FROM logistics_transport_orders
    WHERE id = _order_id AND organization_id = current_org_id();
  IF _order.id IS NULL THEN RAISE EXCEPTION 'order_not_found'; END IF;
  IF _order.invoice_id IS NOT NULL THEN RETURN _order.invoice_id; END IF;
  IF _order.status NOT IN ('delivered','in_transit','assigned') THEN
    RAISE EXCEPTION 'order_not_ready';
  END IF;

  SELECT * INTO _customer FROM customers WHERE id = _order.customer_id;

  INSERT INTO invoices (
    organization_id, invoice_number, customer_name, customer_reference,
    invoice_type, subtotal, tax_rate, tax_amount, total_amount, currency,
    status, issued_at, due_at, notes, created_by
  ) VALUES (
    _order.organization_id,
    'LOG-' || _order.ref,
    COALESCE(_customer.company_name, _order.customer_name, 'Walk-in'),
    _order.ref, 'other',
    _order.quoted_price, 0, 0, _order.quoted_price, _order.currency,
    'issued', now(), now() + interval '30 days',
    'Logistics: ' || _order.pickup_location || ' → ' || _order.dropoff_location,
    _order.created_by
  ) RETURNING id INTO _invoice_id;

  UPDATE logistics_transport_orders
    SET invoice_id = _invoice_id, status = 'invoiced', updated_at = now()
    WHERE id = _order.id;

  SELECT trip_id INTO _trip_id FROM logistics_trip_legs
    WHERE transport_order_id = _order.id LIMIT 1;
  IF _trip_id IS NOT NULL THEN
    INSERT INTO logistics_trip_revenue (
      organization_id, trip_id, transport_order_id, amount, currency, invoice_id
    ) VALUES (
      _order.organization_id, _trip_id, _order.id,
      _order.quoted_price, _order.currency, _invoice_id
    );
  END IF;

  RETURN _invoice_id;
END $function$;

CREATE OR REPLACE FUNCTION public.logistics_invoice_order_part(_order_id uuid, _part text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _order logistics_transport_orders%ROWTYPE;
  _customer customers%ROWTYPE;
  _invoice_id uuid;
  _trip_id uuid;
  _amount numeric(14,2);
  _deposit_amount numeric(14,2);
  _suffix text;
  _label text;
BEGIN
  IF _part NOT IN ('deposit','balance') THEN
    RAISE EXCEPTION 'invalid_part';
  END IF;

  SELECT * INTO _order FROM logistics_transport_orders
    WHERE id = _order_id AND organization_id = current_org_id();
  IF _order.id IS NULL THEN RAISE EXCEPTION 'order_not_found'; END IF;

  SELECT * INTO _customer FROM customers WHERE id = _order.customer_id;

  IF _part = 'deposit' THEN
    IF _order.deposit_invoice_id IS NOT NULL THEN
      RAISE EXCEPTION 'deposit_already_invoiced';
    END IF;
    IF COALESCE(_order.deposit_pct,0) <= 0 THEN
      RAISE EXCEPTION 'deposit_pct_zero';
    END IF;
    IF _order.status NOT IN ('confirmed','assigned','in_transit','delivered') THEN
      RAISE EXCEPTION 'order_not_ready_for_deposit';
    END IF;
    _amount := round(_order.quoted_price * _order.deposit_pct / 100.0, 2);
    _suffix := '-DEP';
    _label := 'Deposit ' || _order.deposit_pct || '%';
  ELSE
    IF _order.balance_invoice_id IS NOT NULL THEN
      RAISE EXCEPTION 'balance_already_invoiced';
    END IF;
    IF _order.status <> 'delivered' THEN
      RAISE EXCEPTION 'order_not_delivered';
    END IF;
    IF _order.deposit_invoice_id IS NOT NULL THEN
      SELECT total_amount INTO _deposit_amount FROM invoices WHERE id = _order.deposit_invoice_id;
    ELSE
      _deposit_amount := 0;
    END IF;
    _amount := _order.quoted_price - COALESCE(_deposit_amount, 0);
    IF _amount <= 0 THEN RAISE EXCEPTION 'balance_zero'; END IF;
    _suffix := '-BAL';
    _label := 'Final balance';
  END IF;

  INSERT INTO invoices (
    organization_id, invoice_number, customer_name, customer_reference,
    invoice_type, subtotal, tax_rate, tax_amount, total_amount, currency,
    status, issued_at, due_at, notes, created_by
  ) VALUES (
    _order.organization_id,
    'LOG-' || _order.ref || _suffix,
    COALESCE(_customer.company_name, _order.customer_name, 'Walk-in'),
    _order.ref, 'other',
    _amount, 0, 0, _amount, _order.currency,
    'issued', now(), now() + interval '30 days',
    _label || ' — Logistics: ' || _order.pickup_location || ' → ' || _order.dropoff_location,
    _order.created_by
  ) RETURNING id INTO _invoice_id;

  IF _part = 'deposit' THEN
    UPDATE logistics_transport_orders
      SET deposit_invoice_id = _invoice_id, updated_at = now()
      WHERE id = _order.id;
  ELSE
    UPDATE logistics_transport_orders
      SET balance_invoice_id = _invoice_id, status = 'invoiced', updated_at = now()
      WHERE id = _order.id;
  END IF;

  SELECT trip_id INTO _trip_id FROM logistics_trip_legs
    WHERE transport_order_id = _order.id LIMIT 1;
  IF _trip_id IS NOT NULL THEN
    INSERT INTO logistics_trip_revenue (
      organization_id, trip_id, transport_order_id, amount, currency, invoice_id
    ) VALUES (
      _order.organization_id, _trip_id, _order.id,
      _amount, _order.currency, _invoice_id
    );
  END IF;

  RETURN _invoice_id;
END $function$;
