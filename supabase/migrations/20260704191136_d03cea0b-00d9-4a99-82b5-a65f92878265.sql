
CREATE OR REPLACE FUNCTION public.mark_repatriation_invoice_paid(
  _repatriation_id uuid,
  _account_id uuid,
  _method public.payment_method DEFAULT 'bank_transfer'::public.payment_method,
  _reference text DEFAULT NULL,
  _paid_at timestamptz DEFAULT now(),
  _notes text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _rep record;
  _invoice record;
  _already_paid numeric := 0;
  _outstanding numeric := 0;
  _payment_id uuid;
BEGIN
  IF NOT (
    public.is_platform_admin()
    OR public.has_role(auth.uid(),'admin'::app_role)
    OR public.has_role(auth.uid(),'yard_operator'::app_role)
    OR public.has_role(auth.uid(),'gate_clerk'::app_role)
  ) THEN
    RAISE EXCEPTION 'forbidden_role';
  END IF;

  SELECT * INTO _rep FROM public.repatriations WHERE id = _repatriation_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'repatriation_not_found'; END IF;

  SELECT * INTO _invoice
  FROM public.invoices
  WHERE organization_id = _rep.organization_id
    AND invoice_number = 'REP-' || _rep.repatriation_number
  LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'repatriation_invoice_missing'; END IF;

  SELECT COALESCE(SUM(amount),0) INTO _already_paid
  FROM public.payments WHERE invoice_id = _invoice.id;

  _outstanding := COALESCE(_invoice.total_amount,0) - _already_paid;
  IF _outstanding <= 0 THEN RAISE EXCEPTION 'repatriation_invoice_already_settled'; END IF;

  _payment_id := public.record_customer_payment(
    _invoice.id, _outstanding, _account_id, _method, _reference, _paid_at, _notes
  );

  PERFORM public.log_org_event(_rep.organization_id, 'repatriation_invoice_paid',
    jsonb_build_object(
      'repatriation_id', _repatriation_id,
      'repatriation_number', _rep.repatriation_number,
      'invoice_id', _invoice.id,
      'invoice_number', _invoice.invoice_number,
      'payment_id', _payment_id,
      'amount', _outstanding,
      'currency', _invoice.currency
    ));

  RETURN _payment_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.mark_repatriation_invoice_paid(uuid, uuid, public.payment_method, text, timestamptz, text) TO authenticated;
