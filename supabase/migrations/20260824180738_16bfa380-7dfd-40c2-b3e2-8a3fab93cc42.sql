
CREATE OR REPLACE FUNCTION public.repost_loan_transaction(_txn_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _x public.loan_transactions%ROWTYPE;
  _l public.loan_facilities%ROWTYPE;
  _cur text; _fa uuid; _num text; _ts timestamptz; _amt numeric;
  _gl_loan uuid; _gl_int_accr uuid; _gl_int_exp uuid; _gl_fees uuid; _gl_bank uuid;
BEGIN
  SELECT * INTO _x FROM public.loan_transactions WHERE id = _txn_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'transaction_not_found'; END IF;
  SELECT * INTO _l FROM public.loan_facilities WHERE id = _x.loan_id;
  IF NOT (_l.organization_id = public.current_org_id() OR public.is_platform_admin()) THEN
    RAISE EXCEPTION 'not_authorised';
  END IF;

  DELETE FROM public.accounting_transactions
   WHERE reference_type = 'loan_transaction' AND reference_id = _txn_id;

  _cur := COALESCE(_x.currency, _l.currency, 'USD');
  _fa  := COALESCE(_x.financial_account_id, _l.financial_account_id);
  _ts  := _x.txn_date::timestamptz;
  _amt := round(_x.amount, 2);
  _num := 'LN-' || substring(_txn_id::text,1,8);

  _gl_loan     := public.ensure_loan_gl_account(_l.organization_id, '2500', 'Loans Payable', 'liability');
  _gl_int_accr := public.ensure_loan_gl_account(_l.organization_id, '2510', 'Accrued Interest Payable', 'liability');
  _gl_int_exp  := public.ensure_loan_gl_account(_l.organization_id, '6750', 'Interest Expense', 'expense');
  SELECT id INTO _gl_fees FROM public.gl_accounts WHERE organization_id = _l.organization_id AND code = '6700' LIMIT 1;
  _gl_fees := COALESCE(_gl_fees, _gl_int_exp);
  SELECT id INTO _gl_bank FROM public.gl_accounts WHERE organization_id = _l.organization_id AND code = '1010' LIMIT 1;

  IF _x.txn_type = 'disbursement' THEN
    INSERT INTO public.accounting_transactions(transaction_number, transaction_date, account_type, category, description,
      debit_amount, credit_amount, reference_type, reference_id, organization_id, financial_account_id, gl_account_id, currency)
    VALUES (_num||'-DR', _ts, 'asset','loan_disbursement','Loan disbursement — '||_l.lender_name, _amt, 0,
      'loan_transaction', _txn_id, _l.organization_id, _fa, _gl_bank, _cur);
    INSERT INTO public.accounting_transactions(transaction_number, transaction_date, account_type, category, description,
      debit_amount, credit_amount, reference_type, reference_id, organization_id, gl_account_id, currency)
    VALUES (_num||'-CR', _ts, 'liability','loan_principal','Loan principal — '||COALESCE(_l.reference,_l.lender_name), 0, _amt,
      'loan_transaction', _txn_id, _l.organization_id, _gl_loan, _cur);

  ELSIF _x.txn_type IN ('charges','stamp_duty','insurance') THEN
    INSERT INTO public.accounting_transactions(transaction_number, transaction_date, account_type, category, description,
      debit_amount, credit_amount, reference_type, reference_id, organization_id, gl_account_id, currency)
    VALUES (_num||'-DR', _ts, 'expense','loan_fees','Loan '||replace(_x.txn_type::text,'_',' ')||' — '||_l.lender_name, _amt, 0,
      'loan_transaction', _txn_id, _l.organization_id, _gl_fees, _cur);
    INSERT INTO public.accounting_transactions(transaction_number, transaction_date, account_type, category, description,
      debit_amount, credit_amount, reference_type, reference_id, organization_id, financial_account_id, gl_account_id, currency)
    VALUES (_num||'-CR', _ts, 'asset','cash','Loan fee paid — '||_l.lender_name, 0, _amt,
      'loan_transaction', _txn_id, _l.organization_id, _fa, _gl_bank, _cur);

  ELSIF _x.txn_type IN ('interest_due','penalty_interest_due') THEN
    INSERT INTO public.accounting_transactions(transaction_number, transaction_date, account_type, category, description,
      debit_amount, credit_amount, reference_type, reference_id, organization_id, gl_account_id, currency)
    VALUES (_num||'-DR', _ts, 'expense','loan_interest','Loan interest — '||_l.lender_name, _amt, 0,
      'loan_transaction', _txn_id, _l.organization_id, _gl_int_exp, _cur);
    INSERT INTO public.accounting_transactions(transaction_number, transaction_date, account_type, category, description,
      debit_amount, credit_amount, reference_type, reference_id, organization_id, gl_account_id, currency)
    VALUES (_num||'-CR', _ts, 'liability','accrued_interest','Accrued loan interest — '||_l.lender_name, 0, _amt,
      'loan_transaction', _txn_id, _l.organization_id, _gl_int_accr, _cur);

  ELSIF _x.txn_type = 'principal_payment' THEN
    INSERT INTO public.accounting_transactions(transaction_number, transaction_date, account_type, category, description,
      debit_amount, credit_amount, reference_type, reference_id, organization_id, gl_account_id, currency)
    VALUES (_num||'-DR', _ts, 'liability','loan_principal','Loan principal repayment — '||_l.lender_name, _amt, 0,
      'loan_transaction', _txn_id, _l.organization_id, _gl_loan, _cur);
    INSERT INTO public.accounting_transactions(transaction_number, transaction_date, account_type, category, description,
      debit_amount, credit_amount, reference_type, reference_id, organization_id, financial_account_id, gl_account_id, currency)
    VALUES (_num||'-CR', _ts, 'asset','cash','Loan repayment — '||_l.lender_name, 0, _amt,
      'loan_transaction', _txn_id, _l.organization_id, _fa, _gl_bank, _cur);

  ELSIF _x.txn_type IN ('interest_payment','penalty_payment') THEN
    INSERT INTO public.accounting_transactions(transaction_number, transaction_date, account_type, category, description,
      debit_amount, credit_amount, reference_type, reference_id, organization_id, gl_account_id, currency)
    VALUES (_num||'-DR', _ts, 'liability','accrued_interest','Loan interest paid — '||_l.lender_name, _amt, 0,
      'loan_transaction', _txn_id, _l.organization_id, _gl_int_accr, _cur);
    INSERT INTO public.accounting_transactions(transaction_number, transaction_date, account_type, category, description,
      debit_amount, credit_amount, reference_type, reference_id, organization_id, financial_account_id, gl_account_id, currency)
    VALUES (_num||'-CR', _ts, 'asset','cash','Loan interest payment — '||_l.lender_name, 0, _amt,
      'loan_transaction', _txn_id, _l.organization_id, _fa, _gl_bank, _cur);
  ELSE
    RETURN 0;
  END IF;

  UPDATE public.loan_transactions
     SET posted = true, posts_to_ledger = true, updated_at = now()
   WHERE id = _txn_id;

  RETURN 1;
END $$;

REVOKE ALL ON FUNCTION public.repost_loan_transaction(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.repost_loan_transaction(uuid) TO authenticated;
