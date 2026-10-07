
CREATE OR REPLACE FUNCTION public.logistics_staff_confirm_deposit_and_pay(
  _order_id uuid,
  _amount numeric,
  _account_id uuid,
  _method payment_method DEFAULT 'bank_transfer'::payment_method,
  _reference text DEFAULT NULL,
  _paid_at timestamptz DEFAULT now(),
  _notes text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _order logistics_transport_orders%ROWTYPE;
  _invoice_id uuid;
  _payment_id uuid;
BEGIN
  SELECT * INTO _order FROM logistics_transport_orders WHERE id = _order_id;
  IF _order.id IS NULL THEN RAISE EXCEPTION 'order_not_found'; END IF;
  IF _order.organization_id <> current_org_id() THEN RAISE EXCEPTION 'not_authorized'; END IF;
  IF _order.deposit_invoice_id IS NULL THEN RAISE EXCEPTION 'no_deposit_invoice'; END IF;
  IF _amount IS NULL OR _amount <= 0 THEN RAISE EXCEPTION 'invalid_amount'; END IF;
  IF _account_id IS NULL THEN RAISE EXCEPTION 'financial_account_required'; END IF;

  -- Confirm deposit (approve) if still pending; skip if already approved
  IF _order.deposit_status = 'pending_approval' THEN
    _invoice_id := public.logistics_customer_confirm_deposit(_order_id);
  ELSIF _order.deposit_status = 'approved' THEN
    _invoice_id := _order.deposit_invoice_id;
  ELSE
    RAISE EXCEPTION 'deposit_not_confirmable';
  END IF;

  _payment_id := public.record_customer_payment(
    _invoice_id, _amount, _account_id, _method, _reference, COALESCE(_paid_at, now()), _notes
  );
  RETURN _payment_id;
END $$;

REVOKE ALL ON FUNCTION public.logistics_staff_confirm_deposit_and_pay(uuid,numeric,uuid,payment_method,text,timestamptz,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.logistics_staff_confirm_deposit_and_pay(uuid,numeric,uuid,payment_method,text,timestamptz,text) TO authenticated;
