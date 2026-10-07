
CREATE OR REPLACE FUNCTION public.validate_payment_account()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _ok boolean;
BEGIN
  IF NEW.financial_account_id IS NULL THEN
    RAISE EXCEPTION 'financial_account_required'
      USING HINT = 'Select the bank, cash, or mobile-money account used for this payment.';
  END IF;
  SELECT (fa.organization_id = NEW.organization_id AND fa.is_active)
    INTO _ok FROM public.financial_accounts fa WHERE fa.id = NEW.financial_account_id;
  IF NOT COALESCE(_ok, false) THEN
    RAISE EXCEPTION 'invalid_financial_account'
      USING HINT = 'The selected account is inactive or belongs to another organization.';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_payments_validate_account ON public.payments;
CREATE TRIGGER trg_payments_validate_account
  BEFORE INSERT ON public.payments
  FOR EACH ROW EXECUTE FUNCTION public.validate_payment_account();

DROP TRIGGER IF EXISTS trg_vendor_payments_validate_account ON public.vendor_payments;
CREATE TRIGGER trg_vendor_payments_validate_account
  BEFORE INSERT ON public.vendor_payments
  FOR EACH ROW EXECUTE FUNCTION public.validate_payment_account();

CREATE OR REPLACE FUNCTION public.record_customer_payment(
  _invoice_id uuid, _amount numeric, _account_id uuid,
  _method public.payment_method DEFAULT 'bank_transfer',
  _reference text DEFAULT NULL, _paid_at timestamptz DEFAULT now(), _notes text DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _inv invoices%ROWTYPE; _pid uuid; _num text;
BEGIN
  IF _amount IS NULL OR _amount <= 0 THEN RAISE EXCEPTION 'invalid_amount'; END IF;
  IF _account_id IS NULL THEN RAISE EXCEPTION 'financial_account_required'; END IF;
  SELECT * INTO _inv FROM invoices WHERE id = _invoice_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'invoice_not_found'; END IF;
  IF _inv.status IN ('cancelled','credited') THEN RAISE EXCEPTION 'invoice_voided'; END IF;
  _num := 'PAY-'||to_char(now(),'YYYYMMDD')||'-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,6));
  INSERT INTO public.payments(
    payment_number, invoice_id, amount, payment_method, reference_number,
    paid_at, notes, recorded_by, organization_id, financial_account_id
  ) VALUES (_num,_invoice_id,_amount,_method,_reference,COALESCE(_paid_at,now()),_notes,auth.uid(),_inv.organization_id,_account_id)
  RETURNING id INTO _pid;
  RETURN _pid;
END $$;
REVOKE EXECUTE ON FUNCTION public.record_customer_payment(uuid,numeric,uuid,public.payment_method,text,timestamptz,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_customer_payment(uuid,numeric,uuid,public.payment_method,text,timestamptz,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.record_vendor_payment(
  _po_id uuid, _amount numeric, _account_id uuid,
  _method public.payment_method DEFAULT 'bank_transfer',
  _reference text DEFAULT NULL, _paid_at timestamptz DEFAULT now(), _notes text DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _po purchase_orders%ROWTYPE; _pid uuid; _num text; _paid numeric;
BEGIN
  IF _amount IS NULL OR _amount <= 0 THEN RAISE EXCEPTION 'invalid_amount'; END IF;
  IF _account_id IS NULL THEN RAISE EXCEPTION 'financial_account_required'; END IF;
  SELECT * INTO _po FROM purchase_orders WHERE id = _po_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'po_not_found'; END IF;
  _num := 'VPAY-'||to_char(now(),'YYYYMMDD')||'-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,6));
  INSERT INTO public.vendor_payments(
    payment_number, po_id, supplier_id, amount, payment_method, reference_number,
    paid_at, notes, recorded_by, organization_id, financial_account_id, conversion_id
  ) VALUES (_num,_po_id,_po.supplier_id,_amount,_method,_reference,COALESCE(_paid_at,now()),_notes,auth.uid(),_po.organization_id,_account_id,_po.conversion_id)
  RETURNING id INTO _pid;
  SELECT COALESCE(sum(amount),0) INTO _paid FROM vendor_payments WHERE po_id = _po_id;
  IF _paid >= COALESCE(_po.total_cost,0) AND COALESCE(_po.total_cost,0) > 0 THEN
    UPDATE purchase_orders SET status='paid' WHERE id=_po_id AND status<>'paid';
  END IF;
  RETURN _pid;
END $$;
REVOKE EXECUTE ON FUNCTION public.record_vendor_payment(uuid,numeric,uuid,public.payment_method,text,timestamptz,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_vendor_payment(uuid,numeric,uuid,public.payment_method,text,timestamptz,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.record_gate_fee_payment(
  _invoice_id uuid, _amount numeric, _account_id uuid,
  _method public.payment_method DEFAULT 'bank_transfer',
  _reference text DEFAULT NULL, _paid_at timestamptz DEFAULT now(), _notes text DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _row record; _paid_total numeric; _payment_id uuid; _pnum text;
BEGIN
  IF NOT (has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'gate_clerk'::app_role)) THEN
    RAISE EXCEPTION 'forbidden_role';
  END IF;
  IF _amount IS NULL OR _amount <= 0 THEN RAISE EXCEPTION 'invalid_amount'; END IF;
  IF _account_id IS NULL THEN RAISE EXCEPTION 'financial_account_required'; END IF;
  SELECT id, organization_id, status, invoice_number, total_amount INTO _row
    FROM public.invoices WHERE id=_invoice_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'invoice_not_found'; END IF;
  IF _row.status IN ('cancelled','credited') THEN RAISE EXCEPTION 'invoice_voided'; END IF;
  _pnum := 'PAY-'||to_char(now(),'YYYYMMDD')||'-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,6));
  INSERT INTO public.payments(
    payment_number, invoice_id, amount, payment_method, reference_number,
    paid_at, notes, recorded_by, organization_id, financial_account_id
  ) VALUES (_pnum,_invoice_id,_amount,_method,_reference,_paid_at,_notes,auth.uid(),_row.organization_id,_account_id)
  RETURNING id INTO _payment_id;
  SELECT COALESCE(SUM(amount),0) INTO _paid_total FROM public.payments WHERE invoice_id=_invoice_id;
  IF _paid_total >= _row.total_amount THEN
    UPDATE public.invoices SET status='paid', paid_at=COALESCE(paid_at, _paid_at) WHERE id=_invoice_id;
  ELSIF _row.status='draft' THEN
    UPDATE public.invoices SET status='sent', issued_at=COALESCE(issued_at, now()) WHERE id=_invoice_id;
  END IF;
  PERFORM public.log_org_event(_row.organization_id,'gate_fee_payment_recorded',
    jsonb_build_object('invoice_id',_row.id,'invoice_number',_row.invoice_number,
      'payment_id',_payment_id,'amount',_amount,'method',_method::text,
      'reference',_reference,'paid_total',_paid_total,'invoice_total',_row.total_amount,
      'financial_account_id',_account_id));
  RETURN _payment_id;
END $$;
REVOKE EXECUTE ON FUNCTION public.record_gate_fee_payment(uuid,numeric,uuid,public.payment_method,text,timestamptz,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_gate_fee_payment(uuid,numeric,uuid,public.payment_method,text,timestamptz,text) TO authenticated;

DROP VIEW IF EXISTS public.v_unrecorded_payments;
CREATE VIEW public.v_unrecorded_payments
WITH (security_invoker=on) AS
SELECT 'invoice'::text AS doc_type, i.id AS doc_id, i.invoice_number AS doc_number,
  i.customer_name AS counterparty, i.total_amount AS amount, i.currency,
  i.paid_at AS marked_at, i.organization_id
FROM public.invoices i
WHERE i.status='paid' AND NOT EXISTS (SELECT 1 FROM public.payments p WHERE p.invoice_id=i.id)
UNION ALL
SELECT 'purchase_order'::text, po.id, po.po_number, s.name, po.total_cost,
  NULL::text, po.created_at, po.organization_id
FROM public.purchase_orders po
LEFT JOIN public.suppliers s ON s.id = po.supplier_id
WHERE po.status='paid' AND NOT EXISTS (SELECT 1 FROM public.vendor_payments vp WHERE vp.po_id=po.id);

GRANT SELECT ON public.v_unrecorded_payments TO authenticated;
