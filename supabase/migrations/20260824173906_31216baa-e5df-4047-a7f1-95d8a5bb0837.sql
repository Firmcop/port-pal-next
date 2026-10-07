
DO $$ BEGIN
  CREATE TYPE public.loan_type AS ENUM ('asset_finance','unsecured','mortgage','overdraft','shareholder','other');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.loan_status AS ENUM ('draft','active','in_arrears','restructured','settled','written_off');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.loan_txn_type AS ENUM ('disbursement','charges','stamp_duty','insurance','interest_due','penalty_interest_due','principal_payment','interest_payment','penalty_payment','write_off','adjustment');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.loan_schedule_status AS ENUM ('expected','part_paid','paid','overdue','cancelled');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============ TABLES ============

CREATE TABLE IF NOT EXISTS public.loan_facilities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL DEFAULT public.current_org_id(),
  lender_name text NOT NULL,
  supplier_id uuid REFERENCES public.suppliers(id) ON DELETE SET NULL,
  reference text,
  loan_type public.loan_type NOT NULL DEFAULT 'unsecured',
  currency text,
  principal_amount numeric NOT NULL DEFAULT 0,
  interest_rate numeric NOT NULL DEFAULT 0,
  date_granted date NOT NULL DEFAULT CURRENT_DATE,
  maturity_date date,
  repayment_amount numeric NOT NULL DEFAULT 0,
  frequency text NOT NULL DEFAULT 'monthly',
  payment_day integer,
  financial_account_id uuid REFERENCES public.financial_accounts(id) ON DELETE SET NULL,
  fixed_asset_id uuid REFERENCES public.fixed_assets(id) ON DELETE SET NULL,
  status public.loan_status NOT NULL DEFAULT 'active',
  notes text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.loan_facilities TO authenticated;
GRANT ALL ON public.loan_facilities TO service_role;
ALTER TABLE public.loan_facilities ENABLE ROW LEVEL SECURITY;

CREATE POLICY "loans_select_org" ON public.loan_facilities FOR SELECT TO authenticated
USING ((organization_id = public.current_org_id() AND public.can_view_module(auth.uid(),'accounting')) OR public.is_platform_admin());

CREATE POLICY "loans_write_finance" ON public.loan_facilities FOR ALL TO authenticated
USING ((organization_id = public.current_org_id() AND (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'org_owner') OR public.has_role(auth.uid(),'accountant'))) OR public.is_platform_admin())
WITH CHECK ((organization_id = public.current_org_id() AND (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'org_owner') OR public.has_role(auth.uid(),'accountant'))) OR public.is_platform_admin());

CREATE TABLE IF NOT EXISTS public.loan_schedule_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL DEFAULT public.current_org_id(),
  loan_id uuid NOT NULL REFERENCES public.loan_facilities(id) ON DELETE CASCADE,
  seq integer NOT NULL,
  due_date date NOT NULL,
  opening_balance numeric NOT NULL DEFAULT 0,
  principal_due numeric NOT NULL DEFAULT 0,
  interest_due numeric NOT NULL DEFAULT 0,
  total_due numeric NOT NULL DEFAULT 0,
  closing_balance numeric NOT NULL DEFAULT 0,
  paid_amount numeric NOT NULL DEFAULT 0,
  status public.loan_schedule_status NOT NULL DEFAULT 'expected',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (loan_id, seq)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.loan_schedule_lines TO authenticated;
GRANT ALL ON public.loan_schedule_lines TO service_role;
ALTER TABLE public.loan_schedule_lines ENABLE ROW LEVEL SECURITY;

CREATE POLICY "loan_sched_select_org" ON public.loan_schedule_lines FOR SELECT TO authenticated
USING ((organization_id = public.current_org_id() AND public.can_view_module(auth.uid(),'accounting')) OR public.is_platform_admin());

CREATE POLICY "loan_sched_write_finance" ON public.loan_schedule_lines FOR ALL TO authenticated
USING ((organization_id = public.current_org_id() AND (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'org_owner') OR public.has_role(auth.uid(),'accountant'))) OR public.is_platform_admin())
WITH CHECK ((organization_id = public.current_org_id() AND (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'org_owner') OR public.has_role(auth.uid(),'accountant'))) OR public.is_platform_admin());

CREATE TABLE IF NOT EXISTS public.loan_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL DEFAULT public.current_org_id(),
  loan_id uuid NOT NULL REFERENCES public.loan_facilities(id) ON DELETE CASCADE,
  txn_date date NOT NULL DEFAULT CURRENT_DATE,
  value_date date,
  txn_type public.loan_txn_type NOT NULL,
  description text,
  amount numeric NOT NULL DEFAULT 0,
  currency text,
  statement_balance numeric,
  financial_account_id uuid REFERENCES public.financial_accounts(id) ON DELETE SET NULL,
  external_ref text,
  posted boolean NOT NULL DEFAULT false,
  source text NOT NULL DEFAULT 'manual',
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS loan_txn_dedupe
  ON public.loan_transactions (loan_id, txn_date, txn_type, amount, COALESCE(external_ref,''));
CREATE INDEX IF NOT EXISTS loan_txn_loan_date ON public.loan_transactions (loan_id, txn_date);
CREATE INDEX IF NOT EXISTS loan_sched_loan_due ON public.loan_schedule_lines (loan_id, due_date);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.loan_transactions TO authenticated;
GRANT ALL ON public.loan_transactions TO service_role;
ALTER TABLE public.loan_transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "loan_txn_select_org" ON public.loan_transactions FOR SELECT TO authenticated
USING ((organization_id = public.current_org_id() AND public.can_view_module(auth.uid(),'accounting')) OR public.is_platform_admin());

CREATE POLICY "loan_txn_write_finance" ON public.loan_transactions FOR ALL TO authenticated
USING ((organization_id = public.current_org_id() AND (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'org_owner') OR public.has_role(auth.uid(),'accountant'))) OR public.is_platform_admin())
WITH CHECK ((organization_id = public.current_org_id() AND (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'org_owner') OR public.has_role(auth.uid(),'accountant'))) OR public.is_platform_admin());

-- currency auto-fill + updated_at
CREATE TRIGGER trg_loan_facilities_currency BEFORE INSERT ON public.loan_facilities
  FOR EACH ROW EXECUTE FUNCTION public.set_currency_from_org();
CREATE TRIGGER trg_loan_transactions_currency BEFORE INSERT ON public.loan_transactions
  FOR EACH ROW EXECUTE FUNCTION public.set_currency_from_org();
CREATE TRIGGER trg_loan_facilities_updated BEFORE UPDATE ON public.loan_facilities
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_loan_schedule_updated BEFORE UPDATE ON public.loan_schedule_lines
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_loan_transactions_updated BEFORE UPDATE ON public.loan_transactions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============ GL ACCOUNTS ============

CREATE OR REPLACE FUNCTION public.ensure_loan_gl_account(_org uuid, _code text, _name text, _type public.account_type)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _id uuid;
BEGIN
  SELECT id INTO _id FROM public.gl_accounts WHERE organization_id = _org AND code = _code LIMIT 1;
  IF _id IS NULL THEN
    INSERT INTO public.gl_accounts(organization_id, code, name, account_type, is_active, is_system)
    VALUES (_org, _code, _name, _type, true, true)
    RETURNING id INTO _id;
  END IF;
  RETURN _id;
END $$;

-- ============ SCHEDULE ============

CREATE OR REPLACE FUNCTION public.generate_loan_schedule(_loan_id uuid)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  _l public.loan_facilities%ROWTYPE;
  _bal numeric; _rate numeric; _inst numeric; _i integer := 0;
  _due date; _int numeric; _prin numeric; _step interval; _per_year numeric;
BEGIN
  SELECT * INTO _l FROM public.loan_facilities WHERE id = _loan_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'loan_not_found'; END IF;

  DELETE FROM public.loan_schedule_lines WHERE loan_id = _loan_id AND paid_amount = 0;

  _per_year := CASE _l.frequency WHEN 'weekly' THEN 52 WHEN 'quarterly' THEN 4 ELSE 12 END;
  _step := CASE _l.frequency WHEN 'weekly' THEN interval '1 week'
                             WHEN 'quarterly' THEN interval '3 months'
                             ELSE interval '1 month' END;
  _rate := COALESCE(_l.interest_rate,0) / 100.0 / _per_year;
  _bal := COALESCE(_l.principal_amount,0);
  _inst := COALESCE(_l.repayment_amount,0);
  IF _bal <= 0 OR _inst <= 0 THEN RETURN 0; END IF;

  _due := _l.date_granted;
  IF _l.payment_day IS NOT NULL AND _l.frequency <> 'weekly' THEN
    _due := (date_trunc('month', _l.date_granted)::date
             + (LEAST(_l.payment_day, EXTRACT(DAY FROM (date_trunc('month',_l.date_granted) + interval '1 month - 1 day'))::int) - 1));
    IF _due <= _l.date_granted THEN _due := (_due + _step)::date; END IF;
  ELSE
    _due := (_due + _step)::date;
  END IF;

  WHILE _bal > 0.005 AND _i < 600 LOOP
    EXIT WHEN _l.maturity_date IS NOT NULL AND _due > _l.maturity_date + 31;
    _i := _i + 1;
    _int := round(_bal * _rate, 2);
    _prin := LEAST(_inst - _int, _bal);
    IF _prin <= 0 THEN _prin := _bal; END IF;
    INSERT INTO public.loan_schedule_lines(organization_id, loan_id, seq, due_date, opening_balance,
      principal_due, interest_due, total_due, closing_balance, status)
    VALUES (_l.organization_id, _loan_id, _i, _due, round(_bal,2), round(_prin,2), _int,
            round(_prin + _int,2), round(_bal - _prin,2),
            CASE WHEN _due < CURRENT_DATE THEN 'overdue'::public.loan_schedule_status ELSE 'expected'::public.loan_schedule_status END)
    ON CONFLICT (loan_id, seq) DO NOTHING;
    _bal := _bal - _prin;
    _due := (_due + _step)::date;
  END LOOP;

  PERFORM public.apply_loan_payments_to_schedule(_loan_id);
  RETURN _i;
END $$;

-- allocate recorded principal+interest payments across schedule lines (FIFO)
CREATE OR REPLACE FUNCTION public.apply_loan_payments_to_schedule(_loan_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _pool numeric; _r record; _take numeric;
BEGIN
  SELECT COALESCE(sum(amount),0) INTO _pool FROM public.loan_transactions
   WHERE loan_id = _loan_id AND txn_type IN ('principal_payment','interest_payment','penalty_payment');

  FOR _r IN SELECT id, total_due FROM public.loan_schedule_lines WHERE loan_id = _loan_id ORDER BY seq LOOP
    _take := LEAST(_pool, _r.total_due);
    IF _take < 0 THEN _take := 0; END IF;
    UPDATE public.loan_schedule_lines SET
      paid_amount = _take,
      status = CASE
        WHEN _take >= total_due - 0.005 THEN 'paid'::public.loan_schedule_status
        WHEN due_date < CURRENT_DATE THEN 'overdue'::public.loan_schedule_status
        WHEN _take > 0 THEN 'part_paid'::public.loan_schedule_status
        ELSE 'expected'::public.loan_schedule_status END
    WHERE id = _r.id;
    _pool := _pool - _take;
  END LOOP;
END $$;

-- ============ POSTING ============

CREATE OR REPLACE FUNCTION public.post_loan_transaction(
  _loan_id uuid,
  _txn_date date,
  _txn_type public.loan_txn_type,
  _amount numeric,
  _description text DEFAULT NULL,
  _financial_account_id uuid DEFAULT NULL,
  _external_ref text DEFAULT NULL,
  _statement_balance numeric DEFAULT NULL,
  _source text DEFAULT 'manual'
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  _l public.loan_facilities%ROWTYPE;
  _id uuid; _cur text; _fa uuid; _num text;
  _gl_loan uuid; _gl_int_accr uuid; _gl_int_exp uuid; _gl_fees uuid; _gl_bank uuid;
  _ts timestamptz;
BEGIN
  SELECT * INTO _l FROM public.loan_facilities WHERE id = _loan_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'loan_not_found'; END IF;
  IF COALESCE(_amount,0) <= 0 THEN RAISE EXCEPTION 'amount_must_be_positive'; END IF;

  _cur := COALESCE(_l.currency, (SELECT currency FROM public.organizations WHERE id = _l.organization_id), 'USD');
  _fa := COALESCE(_financial_account_id, _l.financial_account_id);
  _ts := COALESCE(_txn_date, CURRENT_DATE)::timestamptz;

  INSERT INTO public.loan_transactions(organization_id, loan_id, txn_date, txn_type, description, amount,
    currency, statement_balance, financial_account_id, external_ref, posted, source, created_by)
  VALUES (_l.organization_id, _loan_id, COALESCE(_txn_date, CURRENT_DATE), _txn_type,
    COALESCE(_description, replace(_txn_type::text,'_',' ')), round(_amount,2), _cur,
    _statement_balance, _fa, _external_ref, true, COALESCE(_source,'manual'), auth.uid())
  ON CONFLICT DO NOTHING
  RETURNING id INTO _id;

  IF _id IS NULL THEN RETURN NULL; END IF;

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

  ELSIF _txn_type IN ('write_off','adjustment') THEN
    INSERT INTO public.accounting_transactions(transaction_number, transaction_date, account_type, category, description,
      debit_amount, credit_amount, reference_type, reference_id, organization_id, gl_account_id, currency)
    VALUES (_num||'-DR', _ts, 'liability','loan_principal','Loan adjustment — '||_l.lender_name, round(_amount,2), 0,
      'loan_transaction', _id, _l.organization_id, _gl_loan, _cur);
    INSERT INTO public.accounting_transactions(transaction_number, transaction_date, account_type, category, description,
      debit_amount, credit_amount, reference_type, reference_id, organization_id, gl_account_id, currency)
    VALUES (_num||'-CR', _ts, 'revenue','loan_adjustment','Loan adjustment — '||_l.lender_name, 0, round(_amount,2),
      'loan_transaction', _id, _l.organization_id, _gl_int_exp, _cur);
  END IF;

  PERFORM public.apply_loan_payments_to_schedule(_loan_id);
  RETURN _id;
END $$;

CREATE OR REPLACE FUNCTION public.delete_loan_transaction(_txn_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _loan uuid;
BEGIN
  SELECT loan_id INTO _loan FROM public.loan_transactions WHERE id = _txn_id;
  IF _loan IS NULL THEN RETURN; END IF;
  DELETE FROM public.accounting_transactions WHERE reference_type = 'loan_transaction' AND reference_id = _txn_id;
  DELETE FROM public.loan_transactions WHERE id = _txn_id;
  PERFORM public.apply_loan_payments_to_schedule(_loan);
END $$;

CREATE OR REPLACE FUNCTION public.create_loan_facility(
  _lender_name text,
  _loan_type public.loan_type,
  _principal numeric,
  _interest_rate numeric,
  _date_granted date,
  _maturity_date date DEFAULT NULL,
  _repayment_amount numeric DEFAULT 0,
  _frequency text DEFAULT 'monthly',
  _payment_day integer DEFAULT NULL,
  _reference text DEFAULT NULL,
  _currency text DEFAULT NULL,
  _financial_account_id uuid DEFAULT NULL,
  _fixed_asset_id uuid DEFAULT NULL,
  _supplier_id uuid DEFAULT NULL,
  _notes text DEFAULT NULL,
  _post_disbursement boolean DEFAULT true
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _org uuid := public.current_org_id(); _id uuid;
BEGIN
  IF _org IS NULL THEN RAISE EXCEPTION 'No organization context'; END IF;
  IF NOT (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'org_owner')
          OR public.has_role(auth.uid(),'accountant') OR public.is_platform_admin()) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  INSERT INTO public.loan_facilities(organization_id, lender_name, supplier_id, reference, loan_type, currency,
    principal_amount, interest_rate, date_granted, maturity_date, repayment_amount, frequency, payment_day,
    financial_account_id, fixed_asset_id, notes, created_by)
  VALUES (_org, _lender_name, _supplier_id, _reference, _loan_type,
    COALESCE(NULLIF(upper(btrim(_currency)),''), (SELECT currency FROM public.organizations WHERE id=_org)),
    COALESCE(_principal,0), COALESCE(_interest_rate,0), COALESCE(_date_granted, CURRENT_DATE), _maturity_date,
    COALESCE(_repayment_amount,0), COALESCE(_frequency,'monthly'), _payment_day,
    _financial_account_id, _fixed_asset_id, _notes, auth.uid())
  RETURNING id INTO _id;

  IF _post_disbursement AND COALESCE(_principal,0) > 0 THEN
    PERFORM public.post_loan_transaction(_id, COALESCE(_date_granted, CURRENT_DATE), 'disbursement',
      _principal, 'Loan advanced — '||_lender_name, _financial_account_id, 'DISBURSEMENT', NULL, 'facility');
  END IF;

  PERFORM public.generate_loan_schedule(_id);
  RETURN _id;
END $$;

CREATE OR REPLACE FUNCTION public.import_loan_statement(_loan_id uuid, _rows jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _r jsonb; _new uuid; _ins int := 0; _skip int := 0;
BEGIN
  IF NOT (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'org_owner')
          OR public.has_role(auth.uid(),'accountant') OR public.is_platform_admin()) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  FOR _r IN SELECT * FROM jsonb_array_elements(COALESCE(_rows,'[]'::jsonb)) LOOP
    _new := public.post_loan_transaction(
      _loan_id,
      (_r->>'txn_date')::date,
      (_r->>'txn_type')::public.loan_txn_type,
      (_r->>'amount')::numeric,
      NULLIF(_r->>'description',''),
      NULL,
      NULLIF(_r->>'external_ref',''),
      NULLIF(_r->>'statement_balance','')::numeric,
      'statement_import');
    IF _new IS NULL THEN _skip := _skip + 1; ELSE _ins := _ins + 1; END IF;
  END LOOP;

  RETURN jsonb_build_object('inserted', _ins, 'skipped', _skip);
END $$;

-- ============ REPORTING ============

CREATE OR REPLACE FUNCTION public.loan_balances()
RETURNS TABLE (
  loan_id uuid, lender_name text, reference text, loan_type public.loan_type, currency text,
  status public.loan_status, principal_amount numeric, maturity_date date,
  principal_repaid numeric, principal_outstanding numeric, interest_charged numeric,
  interest_paid numeric, accrued_interest numeric, fees_charged numeric,
  arrears_amount numeric, next_due_date date, next_due_amount numeric
) LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
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
         COALESCE(a.arrears,0), n.due_date, n.total_due
  FROM public.loan_facilities l
  JOIN t ON t.id = l.id
  LEFT JOIN a ON a.loan_id = l.id
  LEFT JOIN n ON n.loan_id = l.id
  WHERE (l.organization_id = public.current_org_id() OR public.is_platform_admin())
  ORDER BY l.lender_name;
$$;

CREATE OR REPLACE FUNCTION public.commitments_due(_days integer DEFAULT 30)
RETURNS TABLE (
  kind text, source_id uuid, title text, due_date date, amount numeric, currency text,
  status text, days_until integer
) LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT 'loan'::text, s.loan_id, l.lender_name || COALESCE(' — '||l.reference,''),
         s.due_date, (s.total_due - s.paid_amount),
         COALESCE(l.currency,'USD'), s.status::text,
         (s.due_date - CURRENT_DATE)::int
  FROM public.loan_schedule_lines s
  JOIN public.loan_facilities l ON l.id = s.loan_id
  WHERE s.status <> 'paid' AND s.status <> 'cancelled'
    AND s.due_date <= CURRENT_DATE + COALESCE(_days,30)
    AND (l.organization_id = public.current_org_id() OR public.is_platform_admin())
  UNION ALL
  SELECT 'recurring_expense'::text, r.id, r.name, r.next_run_date, NULL::numeric,
         COALESCE(r.currency,'USD'),
         CASE WHEN r.next_run_date < CURRENT_DATE THEN 'overdue' ELSE 'expected' END,
         (r.next_run_date - CURRENT_DATE)::int
  FROM public.recurring_expense_templates r
  WHERE r.is_active AND r.next_run_date IS NOT NULL
    AND r.next_run_date <= CURRENT_DATE + COALESCE(_days,30)
    AND (r.organization_id = public.current_org_id() OR public.is_platform_admin())
  ORDER BY 4;
$$;

-- ============ ALERTS ============

CREATE OR REPLACE FUNCTION public.loan_due_scan()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _r record; _u record; _n int := 0; _title text; _msg text;
BEGIN
  -- refresh overdue markers
  UPDATE public.loan_schedule_lines SET status = 'overdue'
   WHERE due_date < CURRENT_DATE AND status IN ('expected','part_paid');

  UPDATE public.loan_facilities l SET status = 'in_arrears'
   WHERE l.status = 'active'
     AND EXISTS (SELECT 1 FROM public.loan_schedule_lines s WHERE s.loan_id = l.id AND s.status = 'overdue');

  FOR _r IN
    SELECT l.organization_id, l.id AS loan_id, l.lender_name, l.reference, COALESCE(l.currency,'USD') cur,
           s.due_date, (s.total_due - s.paid_amount) AS amt,
           CASE WHEN s.due_date < CURRENT_DATE THEN 'overdue' ELSE 'due_soon' END AS kind
    FROM public.loan_schedule_lines s
    JOIN public.loan_facilities l ON l.id = s.loan_id
    WHERE s.status <> 'paid' AND s.status <> 'cancelled'
      AND s.due_date <= CURRENT_DATE + 7
      AND s.due_date >= CURRENT_DATE - 90
      AND l.status NOT IN ('settled','written_off')
  LOOP
    _title := CASE WHEN _r.kind = 'overdue' THEN 'Loan instalment overdue' ELSE 'Loan instalment due soon' END;
    _msg := _r.lender_name || COALESCE(' ('||_r.reference||')','') || ' — ' || _r.cur || ' ' ||
            to_char(round(_r.amt,2),'FM999,999,999.00') || ' due ' || to_char(_r.due_date,'DD Mon YYYY');

    FOR _u IN SELECT om.user_id FROM public.organization_members om
              WHERE om.organization_id = _r.organization_id AND om.status = 'active'
                AND om.role IN ('org_owner','admin')
    LOOP
      IF NOT EXISTS (
        SELECT 1 FROM public.notifications nt
        WHERE nt.user_id = _u.user_id AND nt.reference_type = 'loan_schedule'
          AND nt.reference_id = _r.loan_id AND nt.title = _title
          AND nt.created_at > now() - interval '24 hours') THEN
        INSERT INTO public.notifications(user_id, organization_id, title, message, type, reference_type, reference_id)
        VALUES (_u.user_id, _r.organization_id, _title, _msg,
                CASE WHEN _r.kind='overdue' THEN 'error' ELSE 'warning' END, 'loan_schedule', _r.loan_id);
        _n := _n + 1;
      END IF;
    END LOOP;
  END LOOP;

  -- maturities within 90 days
  FOR _r IN
    SELECT l.organization_id, l.id AS loan_id, l.lender_name, l.reference, l.maturity_date
    FROM public.loan_facilities l
    WHERE l.maturity_date IS NOT NULL AND l.status NOT IN ('settled','written_off')
      AND l.maturity_date BETWEEN CURRENT_DATE AND CURRENT_DATE + 90
  LOOP
    FOR _u IN SELECT om.user_id FROM public.organization_members om
              WHERE om.organization_id = _r.organization_id AND om.status = 'active'
                AND om.role IN ('org_owner','admin')
    LOOP
      IF NOT EXISTS (
        SELECT 1 FROM public.notifications nt
        WHERE nt.user_id = _u.user_id AND nt.reference_type = 'loan_maturity'
          AND nt.reference_id = _r.loan_id AND nt.created_at > now() - interval '7 days') THEN
        INSERT INTO public.notifications(user_id, organization_id, title, message, type, reference_type, reference_id)
        VALUES (_u.user_id, _r.organization_id, 'Loan maturing soon',
                _r.lender_name || COALESCE(' ('||_r.reference||')','') || ' matures on ' || to_char(_r.maturity_date,'DD Mon YYYY'),
                'info', 'loan_maturity', _r.loan_id);
        _n := _n + 1;
      END IF;
    END LOOP;
  END LOOP;

  RETURN _n;
END $$;

REVOKE ALL ON FUNCTION public.ensure_loan_gl_account(uuid, text, text, public.account_type) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.loan_due_scan() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.generate_loan_schedule(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.apply_loan_payments_to_schedule(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.post_loan_transaction(uuid, date, public.loan_txn_type, numeric, text, uuid, text, numeric, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_loan_transaction(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_loan_facility(text, public.loan_type, numeric, numeric, date, date, numeric, text, integer, text, text, uuid, uuid, uuid, text, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.import_loan_statement(uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.loan_balances() TO authenticated;
GRANT EXECUTE ON FUNCTION public.commitments_due(integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.loan_due_scan() TO service_role;
