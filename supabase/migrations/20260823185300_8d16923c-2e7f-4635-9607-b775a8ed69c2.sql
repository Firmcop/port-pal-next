CREATE OR REPLACE FUNCTION public.post_payslip_to_ledger(_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE _p payslips%ROWTYPE; _curr text;
BEGIN
  SELECT * INTO _p FROM payslips WHERE id=_id;
  IF NOT FOUND OR COALESCE(_p.gross_pay,0) <= 0 THEN RETURN; END IF;
  -- weekly wage summaries were already expensed and paid via attendance weeks
  IF COALESCE(_p.posting_mode,'ledger') = 'summary' THEN RETURN; END IF;
  IF _p.status NOT IN ('approved','posted','paid') AND _p.approval_status <> 'approved' THEN RETURN; END IF;
  IF EXISTS (SELECT 1 FROM accounting_transactions WHERE reference_type='payslip' AND reference_id=_id) THEN RETURN; END IF;
  _curr := COALESCE((SELECT currency FROM organizations WHERE id=_p.organization_id),'USD');

  INSERT INTO accounting_transactions(transaction_number, transaction_date, account_type, category, description,
    debit_amount, credit_amount, reference_type, reference_id, organization_id, currency)
  VALUES ('PAY-DR-'||substring(_p.id::text,1,8), COALESCE(_p.posted_at, _p.pay_date, now()),
    'expense','payroll','Wages — '||COALESCE(_p.reference,_p.id::text), _p.gross_pay, 0,
    'payslip', _p.id, _p.organization_id, _curr);

  IF COALESCE(_p.total_deductions,0) > 0 THEN
    INSERT INTO accounting_transactions(transaction_number, transaction_date, account_type, category, description,
      debit_amount, credit_amount, reference_type, reference_id, organization_id, currency)
    VALUES ('PAY-DED-'||substring(_p.id::text,1,8), COALESCE(_p.posted_at,_p.pay_date,now()),
      'liability','payroll_deductions','Statutory deductions — '||COALESCE(_p.reference,_p.id::text),
      0, _p.total_deductions, 'payslip', _p.id, _p.organization_id, _curr);
  END IF;

  IF _p.paid_at IS NOT NULL AND _p.paid_from_account_id IS NOT NULL THEN
    INSERT INTO accounting_transactions(transaction_number, transaction_date, account_type, category, description,
      debit_amount, credit_amount, reference_type, reference_id, organization_id, financial_account_id, currency)
    VALUES ('PAY-CR-'||substring(_p.id::text,1,8), _p.paid_at, 'asset','cash',
      'Net pay disbursed — '||COALESCE(_p.reference,_p.id::text), 0, _p.net_pay,
      'payslip', _p.id, _p.organization_id, _p.paid_from_account_id, _curr);
  ELSE
    INSERT INTO accounting_transactions(transaction_number, transaction_date, account_type, category, description,
      debit_amount, credit_amount, reference_type, reference_id, organization_id, currency)
    VALUES ('PAY-NP-'||substring(_p.id::text,1,8), COALESCE(_p.posted_at,_p.pay_date,now()),
      'liability','net_pay_payable','Net pay payable — '||COALESCE(_p.reference,_p.id::text),
      0, _p.net_pay, 'payslip', _p.id, _p.organization_id, _curr);
  END IF;
END $$;