
CREATE OR REPLACE FUNCTION public.post_contra_settlement(
  _supplier_id uuid,
  _currency text,
  _amount numeric,
  _notes text DEFAULT NULL,
  _settled_on date DEFAULT NULL,
  _account_id uuid DEFAULT NULL,
  _cash_amount numeric DEFAULT 0,
  _fx_rate numeric DEFAULT NULL,
  _bank_charge numeric DEFAULT 0,
  _bank_charge_note text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _org uuid := public.current_org_id();
  _preview jsonb;
  _cur text := upper(btrim(_currency));
  _on date := COALESCE(_settled_on, CURRENT_DATE);
  _acct uuid;
  _sid uuid;
  _num text;
  _left_ar numeric := _amount;
  _left_ap numeric := _amount;
  _take numeric;
  _row jsonb;
  _pay uuid;
  _ar_ids uuid[] := '{}';
  _ap_payment uuid;
  _customer uuid;
  _name text;
  _offsettable numeric;
  _ap_total numeric := 0;
  _acct_cur text;
  _cash jsonb;
  _cash_payment uuid;
  _charge_expense uuid;
BEGIN
  IF _org IS NULL THEN RAISE EXCEPTION 'No organization context'; END IF;
  IF NOT (has_role(auth.uid(),'admin') OR has_role(auth.uid(),'org_owner')
          OR has_role(auth.uid(),'accountant') OR is_platform_admin()) THEN
    RAISE EXCEPTION 'not_authorised';
  END IF;
  IF _amount IS NULL OR _amount <= 0 THEN RAISE EXCEPTION 'invalid_amount'; END IF;

  _preview := public.preview_contra_settlement(_supplier_id);
  _customer := NULLIF(_preview->>'customer_id','')::uuid;
  _name := _preview->>'supplier_name';
  IF _customer IS NULL THEN RAISE EXCEPTION 'counterparty_not_linked'; END IF;

  SELECT COALESCE((t->>'offsettable')::numeric,0), COALESCE((t->>'ap_total')::numeric,0)
    INTO _offsettable, _ap_total
    FROM jsonb_array_elements(_preview->'totals') t WHERE t->>'currency' = _cur;
  IF COALESCE(_offsettable,0) + 0.01 < _amount THEN
    RAISE EXCEPTION 'amount_exceeds_offsettable_balance';
  END IF;

  IF COALESCE(_cash_amount,0) > 0 THEN
    IF _account_id IS NULL THEN RAISE EXCEPTION 'financial_account_required'; END IF;
    IF _cash_amount > COALESCE(_ap_total,0) - _amount + 0.01 THEN
      RAISE EXCEPTION 'cash_exceeds_residual_balance';
    END IF;
    SELECT upper(currency) INTO _acct_cur FROM public.financial_accounts
     WHERE id = _account_id AND organization_id = _org;
    IF _acct_cur IS NULL THEN RAISE EXCEPTION 'financial_account_not_found'; END IF;
    IF _acct_cur <> _cur AND COALESCE(_fx_rate,0) <= 0 THEN
      RAISE EXCEPTION 'fx_rate_required';
    END IF;
  ELSIF COALESCE(_bank_charge,0) > 0 AND _account_id IS NULL THEN
    RAISE EXCEPTION 'financial_account_required';
  END IF;

  _acct := public.ensure_contra_clearing_account(_org, _cur);
  _num := 'CONTRA-'||to_char(now(),'YYYYMMDD')||'-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,5));

  INSERT INTO public.contra_settlements(organization_id, settlement_number, supplier_id, customer_id,
    counterparty_name, currency, amount, status, settled_on, notes, created_by,
    settlement_account_id, cash_amount, cash_fx_rate, bank_charge_amount)
  VALUES (_org, _num, _supplier_id, _customer, _name, _cur, _amount, 'posted', _on, _notes, auth.uid(),
          _account_id, COALESCE(_cash_amount,0), _fx_rate, COALESCE(_bank_charge,0))
  RETURNING id INTO _sid;

  -- AR side: settle oldest sales invoices through the clearing account
  FOR _row IN SELECT x FROM jsonb_array_elements(_preview->'ar') x WHERE x->>'currency' = _cur
  LOOP
    EXIT WHEN _left_ar <= 0.005;
    _take := LEAST(_left_ar, (_row->>'outstanding')::numeric);
    IF _take > 0 THEN
      INSERT INTO public.payments(payment_number, invoice_id, amount, payment_method, reference_number,
        paid_at, notes, recorded_by, organization_id, financial_account_id, currency)
      VALUES ('PAY-'||_num||'-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,4)),
              (_row->>'invoice_id')::uuid, _take, 'other', _num, _on::timestamptz,
              'Contra set-off against supplier balance ('||_name||')', auth.uid(), _org, _acct, _cur)
      RETURNING id INTO _pay;
      _ar_ids := _ar_ids || _pay;
      INSERT INTO public.contra_settlement_lines(organization_id, settlement_id, side, invoice_id, document_number, amount)
      VALUES (_org, _sid, 'ar', (_row->>'invoice_id')::uuid, _row->>'document_number', _take);
      _left_ar := _left_ar - _take;
    END IF;
  END LOOP;

  -- AP side: one on-account payment through the same clearing account, split FIFO
  INSERT INTO public.vendor_payments(payment_number, po_id, supplier_id, amount, payment_method,
    reference_number, paid_at, notes, recorded_by, organization_id, financial_account_id, currency)
  VALUES ('VPAY-'||_num, NULL, _supplier_id, _amount, 'other', _num, _on::timestamptz,
          'Contra set-off against customer balance ('||_name||')', auth.uid(), _org, _acct, _cur)
  RETURNING id INTO _ap_payment;

  FOR _row IN SELECT x FROM jsonb_array_elements(_preview->'ap') x WHERE x->>'currency' = _cur
  LOOP
    EXIT WHEN _left_ap <= 0.005;
    _take := LEAST(_left_ap, (_row->>'outstanding')::numeric);
    IF _take > 0 THEN
      INSERT INTO public.contra_settlement_lines(organization_id, settlement_id, side, supplier_invoice_id, document_number, amount)
      VALUES (_org, _sid, 'ap', (_row->>'supplier_invoice_id')::uuid, _row->>'document_number', _take);
      _left_ap := _left_ap - _take;
    END IF;
  END LOOP;

  -- Cash settlement of the residual supplier balance from a real bank/cash account
  IF COALESCE(_cash_amount,0) > 0 THEN
    _cash := public.record_supplier_onaccount_payment(
      _supplier_id := _supplier_id,
      _amount := _cash_amount,
      _account_id := _account_id,
      _method := 'bank_transfer'::payment_method,
      _reference := _num,
      _paid_at := _on::timestamptz,
      _notes := 'Cash settlement of residual balance after contra set-off '||_num,
      _currency := _cur,
      _fx_rate := _fx_rate,
      _allocations := NULL,
      _bank_charge := 0,
      _bank_charge_note := NULL);
    _cash_payment := NULLIF(_cash->>'payment_id','')::uuid;
  END IF;

  IF COALESCE(_bank_charge,0) > 0 THEN
    _charge_expense := public.post_bank_charge_expense(
      _account_id, _bank_charge, _on, _num,
      COALESCE(_bank_charge_note, 'Bank charges on settlement '||_num), NULL, NULL, _supplier_id);
  END IF;

  UPDATE public.contra_settlements
     SET ar_payment_ids = _ar_ids, ap_payment_id = _ap_payment,
         cash_payment_id = _cash_payment, bank_charge_expense_id = _charge_expense
   WHERE id = _sid;

  INSERT INTO public.finance_audit_log(organization_id, actor_user_id, entity_type, entity_id, entity_ref, action, summary)
  VALUES (_org, auth.uid(), 'contra_settlement', _sid, _num, 'contra_settlement_posted',
          jsonb_build_object('supplier_id', _supplier_id, 'customer_id', _customer,
                             'currency', _cur, 'amount', _amount,
                             'cash_amount', COALESCE(_cash_amount,0),
                             'settlement_account_id', _account_id,
                             'fx_rate', _fx_rate,
                             'bank_charge', COALESCE(_bank_charge,0),
                             'standard', 'IAS 32.42 offsetting — legally enforceable right of set-off',
                             'notes', _notes));

  RETURN jsonb_build_object('settlement_id', _sid, 'settlement_number', _num,
                            'currency', _cur, 'amount', _amount,
                            'cash_amount', COALESCE(_cash_amount,0),
                            'cash_payment_id', _cash_payment,
                            'bank_charge_expense_id', _charge_expense,
                            'ar_payments', array_length(_ar_ids,1),
                            'ap_payment_id', _ap_payment);
END;
$$;

REVOKE ALL ON FUNCTION public.post_contra_settlement(uuid, text, numeric, text, date, uuid, numeric, numeric, numeric, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.post_contra_settlement(uuid, text, numeric, text, date, uuid, numeric, numeric, numeric, text) TO authenticated;
