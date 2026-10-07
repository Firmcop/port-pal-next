ALTER TABLE public.loan_facilities
  ADD COLUMN IF NOT EXISTS ledger_cutover_date date,
  ADD COLUMN IF NOT EXISTS stmt_as_of date,
  ADD COLUMN IF NOT EXISTS stmt_principal_outstanding numeric,
  ADD COLUMN IF NOT EXISTS stmt_accrued_interest numeric,
  ADD COLUMN IF NOT EXISTS stmt_arrears numeric;

ALTER TABLE public.loan_transactions
  ADD COLUMN IF NOT EXISTS posts_to_ledger boolean NOT NULL DEFAULT true;

CREATE OR REPLACE FUNCTION public.post_loan_transaction(_loan_id uuid, _txn_date date, _txn_type loan_txn_type, _amount numeric, _description text DEFAULT NULL::text, _financial_account_id uuid DEFAULT NULL::uuid, _external_ref text DEFAULT NULL::text, _statement_balance numeric DEFAULT NULL::numeric, _source text DEFAULT 'manual'::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _l public.loan_facilities%ROWTYPE;
  _id uuid; _cur text; _fa uuid; _num text;
  _gl_loan uuid; _gl_int_accr uuid; _gl_int_exp uuid; _gl_fees uuid; _gl_bank uuid;
  _ts timestamptz; _to_ledger boolean;
BEGIN
  SELECT * INTO _l FROM public.loan_facilities WHERE id = _loan_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'loan_not_found'; END IF;
  IF COALESCE(_amount,0) <= 0 THEN RAISE EXCEPTION 'amount_must_be_positive'; END IF;

  _cur := COALESCE(_l.currency, (SELECT currency FROM public.organizations WHERE id = _l.organization_id), 'USD');
  _fa := COALESCE(_financial_account_id, _l.financial_account_id);
  _ts := COALESCE(_txn_date, CURRENT_DATE)::timestamptz;
  _to_ledger := (_l.ledger_cutover_date IS NULL OR COALESCE(_txn_date, CURRENT_DATE) >= _l.ledger_cutover_date);

  INSERT INTO public.loan_transactions(organization_id, loan_id, txn_date, txn_type, description, amount,
    currency, statement_balance, financial_account_id, external_ref, posted, posts_to_ledger, source, created_by)
  VALUES (_l.organization_id, _loan_id, COALESCE(_txn_date, CURRENT_DATE), _txn_type,
    COALESCE(_description, replace(_txn_type::text,'_',' ')), round(_amount,2), _cur,
    _statement_balance, _fa, _external_ref, _to_ledger, _to_ledger, COALESCE(_source,'manual'), auth.uid())
  ON CONFLICT DO NOTHING
  RETURNING id INTO _id;

  IF _id IS NULL THEN RETURN NULL; END IF;
  IF NOT _to_ledger THEN RETURN _id; END IF;

  _gl_loan     := public.ensure_loan_gl_account(_l.organization_id, '2500', 'Loans Payable', 'liability');
  _gl_int_accr := public.ensure_loan_gl_account(_l.organization_id, '2510', 'Accrued Interest Payable', 'liability');
  _gl_int_exp  := public.ensure_loan_gl_account(_l.organization_id, '6750', 'Interest Expense', 'expense');
  SELECT id INTO _gl_fees FROM public.gl_accounts WHERE organization_id = _l.organization_id AND code = '6700' LIMIT 1;
  _gl_fees := COALESCE(_gl_fees, _gl_int_exp);
  SELECT id INTO _gl_bank FROM public.gl_accounts WHERE organization_id = _l.organization_id AND code = '1010' LIMIT 1;

  _num := 'LN-' || substring(_id::text,1,8);

  IF _txn_type = 'disbursement' THEN
    INSERT INTO public.accounting_transactions(transaction_number, transaction_date, account_type, category, description,
      debit_amount, credit_amount, reference_type, reference_id, organization_id, financial_account_id, gl_account_id, currency)
    VALUES (_num||'-DR', _ts, 'asset','loan_disbursement','Loan disbursement — '||_l.lender_name, round(_amount,2), 0,
      'loan_transaction', _id, _l.organization_id, _fa, _gl_bank, _cur);
    INSERT INTO public.accounting_transactions(transaction_number, transaction_date, account_type, category, description,
      debit_amount, credit_amount, reference_type, reference_id, organization_id, gl_account_id, currency)
    VALUES (_num||'-CR', _ts, 'liability','loan_principal','Loan principal — '||COALESCE(_l.reference,_l.lender_name), 0, round(_amount,2),
      'loan_transaction', _id, _l.organization_id, _gl_loan, _cur);

  ELSIF _txn_type IN ('charges','stamp_duty','insurance') THEN
    INSERT INTO public.accounting_transactions(transaction_number, transaction_date, account_type, category, description,
      debit_amount, credit_amount, reference_type, reference_id, organization_id, gl_account_id, currency)
    VALUES (_num||'-DR', _ts, 'expense','loan_fees','Loan '||replace(_txn_type::text,'_',' ')||' — '||_l.lender_name, round(_amount,2), 0,
      'loan_transaction', _id, _l.organization_id, _gl_fees, _cur);
    INSERT INTO public.accounting_transactions(transaction_number, transaction_date, account_type, category, description,
      debit_amount, credit_amount, reference_type, reference_id, organization_id, financial_account_id, gl_account_id, currency)
    VALUES (_num||'-CR', _ts, 'asset','cash','Loan fee paid — '||_l.lender_name, 0, round(_amount,2),
      'loan_transaction', _id, _l.organization_id, _fa, _gl_bank, _cur);

  ELSIF _txn_type IN ('interest_due','penalty_interest_due') THEN
    INSERT INTO public.accounting_transactions(transaction_number, transaction_date, account_type, category, description,
      debit_amount, credit_amount, reference_type, reference_id, organization_id, gl_account_id, currency)
    VALUES (_num||'-DR', _ts, 'expense','loan_interest','Loan interest — '||_l.lender_name, round(_amount,2), 0,
      'loan_transaction', _id, _l.organization_id, _gl_int_exp, _cur);
    INSERT INTO public.accounting_transactions(transaction_number, transaction_date, account_type, category, description,
      debit_amount, credit_amount, reference_type, reference_id, organization_id, gl_account_id, currency)
    VALUES (_num||'-CR', _ts, 'liability','accrued_interest','Accrued loan interest — '||_l.lender_name, 0, round(_amount,2),
      'loan_transaction', _id, _l.organization_id, _gl_int_accr, _cur);

  ELSIF _txn_type = 'principal_payment' THEN
    INSERT INTO public.accounting_transactions(transaction_number, transaction_date, account_type, category, description,
      debit_amount, credit_amount, reference_type, reference_id, organization_id, gl_account_id, currency)
    VALUES (_num||'-DR', _ts, 'liability','loan_principal','Loan principal repayment — '||_l.lender_name, round(_amount,2), 0,
      'loan_transaction', _id, _l.organization_id, _gl_loan, _cur);
    INSERT INTO public.accounting_transactions(transaction_number, transaction_date, account_type, category, description,
      debit_amount, credit_amount, reference_type, reference_id, organization_id, financial_account_id, gl_account_id, currency)
    VALUES (_num||'-CR', _ts, 'asset','cash','Loan repayment — '||_l.lender_name, 0, round(_amount,2),
      'loan_transaction', _id, _l.organization_id, _fa, _gl_bank, _cur);

  ELSIF _txn_type IN ('interest_payment','penalty_payment') THEN
    INSERT INTO public.accounting_transactions(transaction_number, transaction_date, account_type, category, description,
      debit_amount, credit_amount, reference_type, reference_id, organization_id, gl_account_id, currency)
    VALUES (_num||'-DR', _ts, 'liability','accrued_interest','Loan interest paid — '||_l.lender_name, round(_amount,2), 0,
      'loan_transaction', _id, _l.organization_id, _gl_int_accr, _cur);
    INSERT INTO public.accounting_transactions(transaction_number, transaction_date, account_type, category, description,
      debit_amount, credit_amount, reference_type, reference_id, organization_id, financial_account_id, gl_account_id, currency)
    VALUES (_num||'-CR', _ts, 'asset','cash','Loan interest payment — '||_l.lender_name, 0, round(_amount,2),
      'loan_transaction', _id, _l.organization_id, _fa, _gl_bank, _cur);
  END IF;

  RETURN _id;
END $function$;

DROP FUNCTION IF EXISTS public.loan_balances();

CREATE OR REPLACE FUNCTION public.loan_balances()
 RETURNS TABLE(loan_id uuid, lender_name text, reference text, loan_type loan_type, currency text, status loan_status, principal_amount numeric, maturity_date date, principal_repaid numeric, principal_outstanding numeric, interest_charged numeric, interest_paid numeric, accrued_interest numeric, fees_charged numeric, arrears_amount numeric, next_due_date date, next_due_amount numeric, stmt_as_of date, stmt_principal_outstanding numeric, stmt_accrued_interest numeric, stmt_arrears numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH t AS (
    SELECT l.id,
      COALESCE(sum(x.amount) FILTER (WHERE x.txn_type='principal_payment'),0) AS prin_paid,
      COALESCE(sum(x.amount) FILTER (WHERE x.txn_type IN ('interest_due','penalty_interest_due')),0) AS int_chg,
      COALESCE(sum(x.amount) FILTER (WHERE x.txn_type IN ('interest_payment','penalty_payment')),0) AS int_paid,
      COALESCE(sum(x.amount) FILTER (WHERE x.txn_type IN ('charges','stamp_duty','insurance')),0) AS fees
    FROM public.loan_facilities l
    LEFT JOIN public.loan_transactions x ON x.loan_id = l.id
    GROUP BY l.id
  ), a AS (
    SELECT loan_id, COALESCE(sum(total_due - paid_amount),0) AS arrears
    FROM public.loan_schedule_lines WHERE due_date < CURRENT_DATE AND status <> 'paid'
    GROUP BY loan_id
  ), n AS (
    SELECT DISTINCT ON (loan_id) loan_id, due_date, total_due
    FROM public.loan_schedule_lines WHERE status <> 'paid' AND due_date >= CURRENT_DATE
    ORDER BY loan_id, due_date
  )
  SELECT l.id, l.lender_name, l.reference, l.loan_type, l.currency, l.status,
         l.principal_amount, l.maturity_date,
         t.prin_paid, GREATEST(l.principal_amount - t.prin_paid, 0),
         t.int_chg, t.int_paid, GREATEST(t.int_chg - t.int_paid, 0), t.fees,
         COALESCE(a.arrears,0), n.due_date, n.total_due,
         l.stmt_as_of, l.stmt_principal_outstanding, l.stmt_accrued_interest, l.stmt_arrears
  FROM public.loan_facilities l
  JOIN t ON t.id = l.id
  LEFT JOIN a ON a.loan_id = l.id
  LEFT JOIN n ON n.loan_id = l.id
  WHERE (l.organization_id = public.current_org_id() OR public.is_platform_admin())
  ORDER BY l.lender_name;
$function$;