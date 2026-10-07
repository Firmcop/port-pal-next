
CREATE OR REPLACE FUNCTION public.reverse_payment(_payment_id uuid, _reason text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _p payments%ROWTYPE;
  _new_id uuid;
  _remaining numeric;
  _order_id uuid;
BEGIN
  IF _reason IS NULL OR btrim(_reason) = '' THEN
    RAISE EXCEPTION 'A reason is required to reverse a payment';
  END IF;

  SELECT * INTO _p FROM payments WHERE id = _payment_id FOR UPDATE;
  IF _p.id IS NULL THEN
    RAISE EXCEPTION 'Payment not found';
  END IF;

  IF _p.organization_id IS DISTINCT FROM current_org_id() AND NOT is_platform_admin() THEN
    RAISE EXCEPTION 'Not authorized to reverse this payment';
  END IF;

  IF _p.reversed_at IS NOT NULL THEN
    RETURN _p.reversed_payment_id;
  END IF;

  IF _p.amount < 0 THEN
    RAISE EXCEPTION 'This is already a reversal entry';
  END IF;

  INSERT INTO payments(
    invoice_id, amount, payment_method, reference_number, paid_at, notes,
    organization_id, financial_account_id, currency, reversed_payment_id
  ) VALUES (
    _p.invoice_id, -_p.amount, _p.payment_method,
    COALESCE(_p.reference_number,'') || ' [REV]',
    now(),
    'Reversal of ' || COALESCE(_p.payment_number,_p.id::text) || ': ' || _reason,
    _p.organization_id, _p.financial_account_id, _p.currency, _p.id
  ) RETURNING id INTO _new_id;

  UPDATE payments
     SET reversed_at = now(),
         reversed_by = auth.uid(),
         reversal_reason = _reason,
         reversed_payment_id = _new_id
   WHERE id = _p.id;

  BEGIN
    INSERT INTO finance_audit_log(organization_id, entity_type, entity_id, action, actor_user_id, summary, before_data, after_data)
    VALUES (
      _p.organization_id, 'payment', _p.id, 'reverse', auth.uid(),
      jsonb_build_object('reason', _reason, 'reversal_payment_id', _new_id, 'amount', _p.amount, 'invoice_id', _p.invoice_id),
      jsonb_build_object('amount', _p.amount, 'reversed_at', null),
      jsonb_build_object('amount', _p.amount, 'reversed_at', now(), 'reversed_payment_id', _new_id)
    );
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  SELECT id INTO _order_id FROM logistics_transport_orders WHERE deposit_invoice_id = _p.invoice_id;
  IF _order_id IS NOT NULL THEN
    SELECT COALESCE(SUM(amount),0) INTO _remaining FROM payments WHERE invoice_id = _p.invoice_id;
    IF _remaining <= 0 THEN
      UPDATE logistics_transport_orders
         SET deposit_status = 'pending_approval',
             updated_at = now()
       WHERE id = _order_id
         AND deposit_status = 'approved';
    END IF;
  END IF;

  RETURN _new_id;
END $$;

REVOKE ALL ON FUNCTION public.reverse_payment(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reverse_payment(uuid, text) TO authenticated;
