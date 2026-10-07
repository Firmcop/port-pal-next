
-- 1. Transport order deposit workflow columns
ALTER TABLE public.logistics_transport_orders
  ADD COLUMN IF NOT EXISTS deposit_status text NOT NULL DEFAULT 'not_proposed',
  ADD COLUMN IF NOT EXISTS deposit_proposed_at timestamptz,
  ADD COLUMN IF NOT EXISTS deposit_approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS deposit_disputed_at timestamptz,
  ADD COLUMN IF NOT EXISTS deposit_dispute_reason text;

ALTER TABLE public.logistics_transport_orders
  DROP CONSTRAINT IF EXISTS logistics_transport_orders_deposit_status_chk;
ALTER TABLE public.logistics_transport_orders
  ADD CONSTRAINT logistics_transport_orders_deposit_status_chk
  CHECK (deposit_status IN ('not_proposed','pending_approval','approved','disputed'));

-- Back-fill: orders that already have a deposit invoice are considered approved.
UPDATE public.logistics_transport_orders
   SET deposit_status = 'approved', deposit_approved_at = COALESCE(deposit_approved_at, updated_at)
 WHERE deposit_invoice_id IS NOT NULL AND deposit_status = 'not_proposed';

-- 2. Invoice partial-payment flag
ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS partially_paid boolean NOT NULL DEFAULT false;

-- 3. logistics_propose_deposit — staff creates a draft deposit invoice awaiting customer approval
CREATE OR REPLACE FUNCTION public.logistics_propose_deposit(_order_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
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
    _order.ref, 'service',
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
END $$;

-- 4. logistics_customer_confirm_deposit — portal customer confirms the proposal
CREATE OR REPLACE FUNCTION public.logistics_customer_confirm_deposit(_order_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _order logistics_transport_orders%ROWTYPE;
  _portal_customer uuid;
  _invoice invoices%ROWTYPE;
  _trip_id uuid;
  _is_staff boolean;
BEGIN
  SELECT * INTO _order FROM logistics_transport_orders WHERE id = _order_id;
  IF _order.id IS NULL THEN RAISE EXCEPTION 'order_not_found'; END IF;

  _is_staff := (_order.organization_id = current_org_id());
  _portal_customer := get_portal_customer_id(auth.uid());

  IF NOT _is_staff AND (_portal_customer IS NULL OR _order.customer_id <> _portal_customer) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  IF _order.deposit_status <> 'pending_approval' OR _order.deposit_invoice_id IS NULL THEN
    RAISE EXCEPTION 'no_pending_proposal';
  END IF;

  SELECT * INTO _invoice FROM invoices WHERE id = _order.deposit_invoice_id;

  UPDATE invoices
     SET status = 'sent', issued_at = COALESCE(issued_at, now()), updated_at = now()
   WHERE id = _invoice.id;

  UPDATE logistics_transport_orders
     SET deposit_status = 'approved',
         deposit_approved_at = now(),
         updated_at = now()
   WHERE id = _order.id;

  SELECT trip_id INTO _trip_id FROM logistics_trip_legs
    WHERE transport_order_id = _order.id LIMIT 1;

  -- Avoid duplicate revenue row if approve is called twice.
  IF NOT EXISTS (SELECT 1 FROM logistics_trip_revenue WHERE invoice_id = _invoice.id) AND _trip_id IS NOT NULL THEN
    INSERT INTO logistics_trip_revenue (
      organization_id, trip_id, transport_order_id, amount, currency, invoice_id
    ) VALUES (
      _order.organization_id, _trip_id, _order.id,
      _invoice.total_amount, _invoice.currency, _invoice.id
    );
  END IF;

  RETURN _invoice.id;
END $$;

-- 5. logistics_customer_dispute_deposit — customer or staff cancels the proposal
CREATE OR REPLACE FUNCTION public.logistics_customer_dispute_deposit(_order_id uuid, _reason text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _order logistics_transport_orders%ROWTYPE;
  _portal_customer uuid;
  _is_staff boolean;
BEGIN
  SELECT * INTO _order FROM logistics_transport_orders WHERE id = _order_id;
  IF _order.id IS NULL THEN RAISE EXCEPTION 'order_not_found'; END IF;

  _is_staff := (_order.organization_id = current_org_id());
  _portal_customer := get_portal_customer_id(auth.uid());

  IF NOT _is_staff AND (_portal_customer IS NULL OR _order.customer_id <> _portal_customer) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  IF _order.deposit_status <> 'pending_approval' OR _order.deposit_invoice_id IS NULL THEN
    RAISE EXCEPTION 'no_pending_proposal';
  END IF;

  IF _reason IS NULL OR length(trim(_reason)) = 0 THEN
    RAISE EXCEPTION 'reason_required';
  END IF;

  UPDATE invoices
     SET status = 'cancelled',
         voided_at = now(),
         void_reason = 'Deposit proposal disputed: ' || _reason,
         updated_at = now()
   WHERE id = _order.deposit_invoice_id;

  UPDATE logistics_transport_orders
     SET deposit_invoice_id = NULL,
         deposit_status = 'disputed',
         deposit_disputed_at = now(),
         deposit_dispute_reason = _reason,
         updated_at = now()
   WHERE id = _order.id;
END $$;

GRANT EXECUTE ON FUNCTION public.logistics_propose_deposit(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.logistics_customer_confirm_deposit(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.logistics_customer_dispute_deposit(uuid, text) TO authenticated;

-- 6. Payment reconciliation trigger
CREATE OR REPLACE FUNCTION public.payments_reconcile_invoice()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _invoice_id uuid;
  _paid numeric(14,2);
  _total numeric(14,2);
  _current_status invoice_status;
BEGIN
  _invoice_id := COALESCE(NEW.invoice_id, OLD.invoice_id);
  IF _invoice_id IS NULL THEN RETURN COALESCE(NEW, OLD); END IF;

  SELECT total_amount, status INTO _total, _current_status FROM invoices WHERE id = _invoice_id;
  IF _total IS NULL THEN RETURN COALESCE(NEW, OLD); END IF;

  SELECT COALESCE(SUM(amount), 0) INTO _paid FROM payments WHERE invoice_id = _invoice_id;

  IF _paid >= _total AND _total > 0 THEN
    UPDATE invoices
       SET status = 'paid', paid_at = COALESCE(paid_at, now()),
           partially_paid = false, updated_at = now()
     WHERE id = _invoice_id AND status NOT IN ('cancelled','credited');
  ELSIF _paid > 0 THEN
    UPDATE invoices
       SET partially_paid = true,
           status = CASE WHEN status = 'paid' THEN 'sent'::invoice_status ELSE status END,
           paid_at = NULL,
           updated_at = now()
     WHERE id = _invoice_id AND status NOT IN ('cancelled','credited');
  ELSE
    UPDATE invoices
       SET partially_paid = false,
           status = CASE WHEN status = 'paid' THEN 'sent'::invoice_status ELSE status END,
           paid_at = NULL,
           updated_at = now()
     WHERE id = _invoice_id AND status NOT IN ('cancelled','credited');
  END IF;

  RETURN COALESCE(NEW, OLD);
END $$;

DROP TRIGGER IF EXISTS trg_payments_reconcile_invoice ON public.payments;
CREATE TRIGGER trg_payments_reconcile_invoice
AFTER INSERT OR UPDATE OR DELETE ON public.payments
FOR EACH ROW EXECUTE FUNCTION public.payments_reconcile_invoice();

-- Back-fill partially_paid on existing invoices
UPDATE public.invoices i
   SET partially_paid = true
  FROM (SELECT invoice_id, SUM(amount) s FROM payments GROUP BY invoice_id) p
 WHERE p.invoice_id = i.id AND p.s > 0 AND p.s < i.total_amount
   AND i.status NOT IN ('paid','cancelled','credited');

-- 7. Realtime
DO $$ BEGIN
  EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.payments';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.logistics_transport_orders';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
