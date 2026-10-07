CREATE OR REPLACE FUNCTION public.record_customer_payment(
  _invoice_id uuid,
  _amount numeric,
  _account_id uuid,
  _method payment_method DEFAULT 'bank_transfer',
  _reference text DEFAULT NULL,
  _paid_at timestamptz DEFAULT now(),
  _notes text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _inv invoices%ROWTYPE;
  _pid uuid;
  _num text;
  _legacy uuid := '00000000-0000-0000-0000-000000000001';
  _org uuid;
BEGIN
  IF _amount IS NULL OR _amount <= 0 THEN RAISE EXCEPTION 'invalid_amount'; END IF;
  IF _account_id IS NULL THEN RAISE EXCEPTION 'financial_account_required'; END IF;
  SELECT * INTO _inv FROM invoices WHERE id = _invoice_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'invoice_not_found'; END IF;
  IF _inv.status IN ('cancelled','credited') THEN RAISE EXCEPTION 'invoice_voided'; END IF;

  -- Legacy invoices still parked under the placeholder organization must adopt
  -- the caller's active organization, otherwise the account-validation trigger
  -- rejects every selectable financial account.
  _org := _inv.organization_id;
  IF _org IS NULL OR _org = _legacy THEN
    _org := COALESCE(public.current_org_id(), _inv.organization_id);
    UPDATE public.invoices SET organization_id = _org WHERE id = _invoice_id AND _org IS NOT NULL;
  END IF;

  _num := 'PAY-'||to_char(now(),'YYYYMMDD')||'-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,6));
  INSERT INTO public.payments(
    payment_number, invoice_id, amount, payment_method, reference_number,
    paid_at, notes, recorded_by, organization_id, financial_account_id
  ) VALUES (_num,_invoice_id,_amount,_method,_reference,COALESCE(_paid_at,now()),_notes,auth.uid(),_org,_account_id)
  RETURNING id INTO _pid;
  RETURN _pid;
END $$;

REVOKE ALL ON FUNCTION public.record_customer_payment(uuid,numeric,uuid,payment_method,text,timestamptz,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_customer_payment(uuid,numeric,uuid,payment_method,text,timestamptz,text) TO authenticated;