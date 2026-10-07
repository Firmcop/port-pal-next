
ALTER TABLE public.accounting_transactions ADD COLUMN IF NOT EXISTS depot_id uuid;

CREATE TABLE IF NOT EXISTS public.operating_expenses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL DEFAULT public.current_org_id(),
  expense_number text NOT NULL,
  expense_date date NOT NULL DEFAULT CURRENT_DATE,
  supplier_id uuid REFERENCES public.suppliers(id) ON DELETE SET NULL,
  payee text,
  payment_mode text NOT NULL DEFAULT 'paid',
  financial_account_id uuid REFERENCES public.financial_accounts(id) ON DELETE SET NULL,
  due_date date,
  currency text,
  fx_rate numeric NOT NULL DEFAULT 1,
  subtotal numeric NOT NULL DEFAULT 0,
  tax_amount numeric NOT NULL DEFAULT 0,
  total_amount numeric NOT NULL DEFAULT 0,
  amount_paid numeric NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'unpaid',
  depot_id uuid REFERENCES public.depots(id) ON DELETE SET NULL,
  project_id uuid REFERENCES public.projects(id) ON DELETE SET NULL,
  reference text,
  notes text,
  attachment_url text,
  journal_id uuid,
  reversed_at timestamptz,
  reversed_by uuid,
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, expense_number)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.operating_expenses TO authenticated;
GRANT ALL ON public.operating_expenses TO service_role;
ALTER TABLE public.operating_expenses ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "opex_select_org" ON public.operating_expenses;
CREATE POLICY "opex_select_org" ON public.operating_expenses
  FOR SELECT TO authenticated
  USING (organization_id = public.current_org_id() OR public.is_platform_admin());

DROP POLICY IF EXISTS "opex_write_admin" ON public.operating_expenses;
CREATE POLICY "opex_write_admin" ON public.operating_expenses
  FOR ALL TO authenticated
  USING (
    (organization_id = public.current_org_id()
      AND (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'org_owner')))
    OR public.is_platform_admin()
  )
  WITH CHECK (
    (organization_id = public.current_org_id()
      AND (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'org_owner')))
    OR public.is_platform_admin()
  );

CREATE TABLE IF NOT EXISTS public.operating_expense_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL DEFAULT public.current_org_id(),
  expense_id uuid NOT NULL REFERENCES public.operating_expenses(id) ON DELETE CASCADE,
  gl_account_id uuid NOT NULL REFERENCES public.gl_accounts(id),
  description text,
  amount numeric NOT NULL DEFAULT 0,
  tax_code_id uuid REFERENCES public.tax_codes(id) ON DELETE SET NULL,
  tax_amount numeric NOT NULL DEFAULT 0,
  project_id uuid REFERENCES public.projects(id) ON DELETE SET NULL,
  depot_id uuid REFERENCES public.depots(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.operating_expense_lines TO authenticated;
GRANT ALL ON public.operating_expense_lines TO service_role;
ALTER TABLE public.operating_expense_lines ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "opex_lines_select_org" ON public.operating_expense_lines;
CREATE POLICY "opex_lines_select_org" ON public.operating_expense_lines
  FOR SELECT TO authenticated
  USING (organization_id = public.current_org_id() OR public.is_platform_admin());

DROP POLICY IF EXISTS "opex_lines_write_admin" ON public.operating_expense_lines;
CREATE POLICY "opex_lines_write_admin" ON public.operating_expense_lines
  FOR ALL TO authenticated
  USING (
    (organization_id = public.current_org_id()
      AND (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'org_owner')))
    OR public.is_platform_admin()
  )
  WITH CHECK (
    (organization_id = public.current_org_id()
      AND (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'org_owner')))
    OR public.is_platform_admin()
  );

CREATE INDEX IF NOT EXISTS idx_opex_org_date ON public.operating_expenses(organization_id, expense_date DESC);
CREATE INDEX IF NOT EXISTS idx_opex_lines_expense ON public.operating_expense_lines(expense_id);

DROP TRIGGER IF EXISTS trg_opex_updated_at ON public.operating_expenses;
CREATE TRIGGER trg_opex_updated_at BEFORE UPDATE ON public.operating_expenses
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS trg_opex_currency ON public.operating_expenses;
CREATE TRIGGER trg_opex_currency BEFORE INSERT ON public.operating_expenses
  FOR EACH ROW EXECUTE FUNCTION public.set_currency_from_org();

CREATE OR REPLACE FUNCTION public.next_operating_expense_number()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org uuid := public.current_org_id();
  v_year text := to_char(now(),'YYYY');
  v_n int;
BEGIN
  SELECT COUNT(*) + 1 INTO v_n FROM public.operating_expenses
   WHERE organization_id = v_org AND to_char(expense_date,'YYYY') = v_year;
  RETURN 'EXP-' || v_year || '-' || lpad(v_n::text, 4, '0');
END;
$$;
REVOKE ALL ON FUNCTION public.next_operating_expense_number() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.next_operating_expense_number() TO authenticated;

CREATE OR REPLACE FUNCTION public._opex_assert_period_open(_org uuid, _date date)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_status text;
BEGIN
  SELECT status INTO v_status FROM public.fiscal_periods
   WHERE organization_id = _org AND _date BETWEEN start_date AND end_date LIMIT 1;
  IF v_status IS NULL THEN
    RAISE EXCEPTION 'No fiscal period covers %; open the period first', _date;
  END IF;
  IF v_status <> 'open' THEN
    RAISE EXCEPTION 'Fiscal period covering % is %', _date, v_status;
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public._opex_assert_period_open(uuid, date) FROM PUBLIC, anon;

CREATE OR REPLACE FUNCTION public.post_operating_expense(
  _expense_date date,
  _payment_mode text,
  _lines jsonb,
  _supplier_id uuid DEFAULT NULL,
  _payee text DEFAULT NULL,
  _financial_account_id uuid DEFAULT NULL,
  _due_date date DEFAULT NULL,
  _currency text DEFAULT NULL,
  _fx_rate numeric DEFAULT 1,
  _depot_id uuid DEFAULT NULL,
  _project_id uuid DEFAULT NULL,
  _reference text DEFAULT NULL,
  _notes text DEFAULT NULL,
  _attachment_url text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org uuid := public.current_org_id();
  v_id uuid := gen_random_uuid();
  v_journal uuid := gen_random_uuid();
  v_currency text;
  v_subtotal numeric := 0;
  v_tax numeric := 0;
  v_total numeric := 0;
  v_number text;
  v_seq int := 0;
  line jsonb;
  v_acct public.gl_accounts%ROWTYPE;
  v_credit public.gl_accounts%ROWTYPE;
  v_vat public.gl_accounts%ROWTYPE;
  v_line_tax numeric;
BEGIN
  IF v_org IS NULL THEN RAISE EXCEPTION 'No organization context'; END IF;
  IF NOT (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'org_owner') OR public.is_platform_admin()) THEN
    RAISE EXCEPTION 'Not authorized to post expenses';
  END IF;
  IF _payment_mode NOT IN ('paid','credit') THEN
    RAISE EXCEPTION 'payment_mode must be paid or credit';
  END IF;
  IF jsonb_typeof(_lines) <> 'array' OR jsonb_array_length(_lines) = 0 THEN
    RAISE EXCEPTION 'At least one expense line is required';
  END IF;

  PERFORM public._opex_assert_period_open(v_org, _expense_date);

  SELECT COALESCE(_currency, o.currency, 'USD') INTO v_currency
    FROM public.organizations o WHERE o.id = v_org;

  IF _payment_mode = 'paid' THEN
    IF _financial_account_id IS NULL THEN
      RAISE EXCEPTION 'Select the bank or cash account the expense was paid from';
    END IF;
    SELECT * INTO v_credit FROM public.gl_accounts
      WHERE organization_id = v_org AND system_code IN ('bank','cash') AND is_active
      ORDER BY CASE system_code WHEN 'bank' THEN 0 ELSE 1 END LIMIT 1;
    IF v_credit.id IS NULL THEN RAISE EXCEPTION 'No bank/cash GL account configured'; END IF;
  ELSE
    SELECT * INTO v_credit FROM public.gl_accounts
      WHERE organization_id = v_org AND system_code = 'ap' AND is_active LIMIT 1;
    IF v_credit.id IS NULL THEN RAISE EXCEPTION 'No accounts payable GL account configured'; END IF;
  END IF;

  SELECT * INTO v_vat FROM public.gl_accounts
    WHERE organization_id = v_org AND system_code = 'vat_input' AND is_active LIMIT 1;

  v_number := public.next_operating_expense_number();

  INSERT INTO public.operating_expenses (
    id, organization_id, expense_number, expense_date, supplier_id, payee, payment_mode,
    financial_account_id, due_date, currency, fx_rate, depot_id, project_id, reference,
    notes, attachment_url, journal_id, status, created_by
  ) VALUES (
    v_id, v_org, v_number, _expense_date, _supplier_id, _payee, _payment_mode,
    CASE WHEN _payment_mode = 'paid' THEN _financial_account_id ELSE NULL END,
    CASE WHEN _payment_mode = 'credit' THEN _due_date ELSE NULL END,
    v_currency, COALESCE(_fx_rate,1), _depot_id, _project_id, _reference,
    _notes, _attachment_url, v_journal,
    CASE WHEN _payment_mode = 'paid' THEN 'paid' ELSE 'unpaid' END,
    auth.uid()
  );

  FOR line IN SELECT * FROM jsonb_array_elements(_lines) LOOP
    v_seq := v_seq + 1;
    SELECT * INTO v_acct FROM public.gl_accounts
      WHERE id = NULLIF(line->>'gl_account_id','')::uuid AND organization_id = v_org;
    IF v_acct.id IS NULL THEN RAISE EXCEPTION 'Invalid expense account on line %', v_seq; END IF;
    IF COALESCE((line->>'amount')::numeric,0) <= 0 THEN
      RAISE EXCEPTION 'Line % amount must be greater than zero', v_seq;
    END IF;

    v_line_tax := COALESCE((line->>'tax_amount')::numeric, 0);

    INSERT INTO public.operating_expense_lines (
      organization_id, expense_id, gl_account_id, description, amount, tax_code_id,
      tax_amount, project_id, depot_id
    ) VALUES (
      v_org, v_id, v_acct.id, line->>'description', (line->>'amount')::numeric,
      NULLIF(line->>'tax_code_id','')::uuid, v_line_tax,
      COALESCE(NULLIF(line->>'project_id','')::uuid, _project_id),
      COALESCE(NULLIF(line->>'depot_id','')::uuid, _depot_id)
    );

    INSERT INTO public.accounting_transactions (
      transaction_number, transaction_date, account_type, category, description,
      debit_amount, credit_amount, reference_type, reference_id, organization_id,
      financial_account_id, project_id, depot_id, gl_account_id, journal_id, currency, fx_rate
    ) VALUES (
      v_number || '-' || v_seq, _expense_date, v_acct.account_type,
      COALESCE(v_acct.system_code,'operating_expense'),
      COALESCE(line->>'description', 'Operating expense ' || v_number),
      (line->>'amount')::numeric, 0, 'operating_expense', v_id, v_org,
      CASE WHEN _payment_mode = 'paid' THEN _financial_account_id ELSE NULL END,
      COALESCE(NULLIF(line->>'project_id','')::uuid, _project_id),
      COALESCE(NULLIF(line->>'depot_id','')::uuid, _depot_id),
      v_acct.id, v_journal, v_currency, COALESCE(_fx_rate,1)
    );

    v_subtotal := v_subtotal + (line->>'amount')::numeric;
    v_tax := v_tax + v_line_tax;
  END LOOP;

  IF v_tax > 0 THEN
    IF v_vat.id IS NULL THEN RAISE EXCEPTION 'No VAT input GL account configured'; END IF;
    v_seq := v_seq + 1;
    INSERT INTO public.accounting_transactions (
      transaction_number, transaction_date, account_type, category, description,
      debit_amount, credit_amount, reference_type, reference_id, organization_id,
      financial_account_id, project_id, depot_id, gl_account_id, journal_id, currency, fx_rate
    ) VALUES (
      v_number || '-' || v_seq, _expense_date, v_vat.account_type,
      'vat_input', 'Input VAT on ' || v_number, v_tax, 0, 'operating_expense', v_id, v_org,
      CASE WHEN _payment_mode = 'paid' THEN _financial_account_id ELSE NULL END,
      _project_id, _depot_id, v_vat.id, v_journal, v_currency, COALESCE(_fx_rate,1)
    );
  END IF;

  v_total := v_subtotal + v_tax;
  v_seq := v_seq + 1;

  INSERT INTO public.accounting_transactions (
    transaction_number, transaction_date, account_type, category, description,
    debit_amount, credit_amount, reference_type, reference_id, organization_id,
    financial_account_id, project_id, depot_id, gl_account_id, journal_id, currency, fx_rate
  ) VALUES (
    v_number || '-' || v_seq, _expense_date, v_credit.account_type,
    CASE WHEN _payment_mode = 'paid' THEN 'cash_out' ELSE 'ap' END,
    'Operating expense ' || v_number || COALESCE(' - ' || _payee, ''),
    0, v_total, 'operating_expense', v_id, v_org,
    CASE WHEN _payment_mode = 'paid' THEN _financial_account_id ELSE NULL END,
    _project_id, _depot_id, v_credit.id, v_journal, v_currency, COALESCE(_fx_rate,1)
  );

  UPDATE public.operating_expenses
     SET subtotal = v_subtotal, tax_amount = v_tax, total_amount = v_total,
         amount_paid = CASE WHEN _payment_mode = 'paid' THEN v_total ELSE 0 END
   WHERE id = v_id;

  INSERT INTO public.finance_audit_log (organization_id, actor_user_id, entity_type, entity_id, entity_ref, action, summary)
  VALUES (v_org, auth.uid(), 'operating_expense', v_id, v_number, 'posted',
          jsonb_build_object('total', v_total, 'mode', _payment_mode, 'currency', v_currency));

  RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION public.post_operating_expense(date, text, jsonb, uuid, text, uuid, date, text, numeric, uuid, uuid, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.post_operating_expense(date, text, jsonb, uuid, text, uuid, date, text, numeric, uuid, uuid, text, text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.pay_operating_expense(
  _expense_id uuid,
  _financial_account_id uuid,
  _amount numeric,
  _payment_date date DEFAULT CURRENT_DATE
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org uuid := public.current_org_id();
  e public.operating_expenses%ROWTYPE;
  v_ap public.gl_accounts%ROWTYPE;
  v_cash public.gl_accounts%ROWTYPE;
  v_journal uuid := gen_random_uuid();
  v_outstanding numeric;
BEGIN
  IF NOT (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'org_owner') OR public.is_platform_admin()) THEN
    RAISE EXCEPTION 'Not authorized to pay expenses';
  END IF;
  SELECT * INTO e FROM public.operating_expenses WHERE id = _expense_id AND organization_id = v_org;
  IF e.id IS NULL THEN RAISE EXCEPTION 'Expense not found'; END IF;
  IF e.reversed_at IS NOT NULL THEN RAISE EXCEPTION 'Expense has been reversed'; END IF;
  v_outstanding := e.total_amount - e.amount_paid;
  IF _amount <= 0 OR round(_amount,2) > round(v_outstanding,2) THEN
    RAISE EXCEPTION 'Payment must be between 0 and the outstanding balance (%)', v_outstanding;
  END IF;

  PERFORM public._opex_assert_period_open(v_org, _payment_date);

  SELECT * INTO v_ap FROM public.gl_accounts
    WHERE organization_id = v_org AND system_code = 'ap' AND is_active LIMIT 1;
  SELECT * INTO v_cash FROM public.gl_accounts
    WHERE organization_id = v_org AND system_code IN ('bank','cash') AND is_active
    ORDER BY CASE system_code WHEN 'bank' THEN 0 ELSE 1 END LIMIT 1;
  IF v_ap.id IS NULL OR v_cash.id IS NULL THEN RAISE EXCEPTION 'Chart of accounts missing AP or bank account'; END IF;

  INSERT INTO public.accounting_transactions (
    transaction_number, transaction_date, account_type, category, description,
    debit_amount, credit_amount, reference_type, reference_id, organization_id,
    financial_account_id, project_id, depot_id, gl_account_id, journal_id, currency, fx_rate
  ) VALUES
  (e.expense_number || '-PAY-' || substr(v_journal::text,1,6) || '-1', _payment_date, v_ap.account_type, 'ap',
   'Payment for ' || e.expense_number, _amount, 0, 'operating_expense_payment', e.id, v_org,
   _financial_account_id, e.project_id, e.depot_id, v_ap.id, v_journal, e.currency, e.fx_rate),
  (e.expense_number || '-PAY-' || substr(v_journal::text,1,6) || '-2', _payment_date, v_cash.account_type, 'cash_out',
   'Payment for ' || e.expense_number, 0, _amount, 'operating_expense_payment', e.id, v_org,
   _financial_account_id, e.project_id, e.depot_id, v_cash.id, v_journal, e.currency, e.fx_rate);

  UPDATE public.operating_expenses
     SET amount_paid = amount_paid + _amount,
         status = CASE WHEN round(amount_paid + _amount, 2) >= round(total_amount, 2) THEN 'paid' ELSE 'partly_paid' END,
         financial_account_id = COALESCE(financial_account_id, _financial_account_id)
   WHERE id = e.id;

  INSERT INTO public.finance_audit_log (organization_id, actor_user_id, entity_type, entity_id, entity_ref, action, summary)
  VALUES (v_org, auth.uid(), 'operating_expense', e.id, e.expense_number, 'payment_recorded',
          jsonb_build_object('amount', _amount));
END;
$$;
REVOKE ALL ON FUNCTION public.pay_operating_expense(uuid, uuid, numeric, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pay_operating_expense(uuid, uuid, numeric, date) TO authenticated;

CREATE OR REPLACE FUNCTION public.reverse_operating_expense(_expense_id uuid, _reason text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org uuid := public.current_org_id();
  e public.operating_expenses%ROWTYPE;
  v_journal uuid := gen_random_uuid();
  t public.accounting_transactions%ROWTYPE;
  v_seq int := 0;
BEGIN
  IF NOT (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'org_owner') OR public.is_platform_admin()) THEN
    RAISE EXCEPTION 'Not authorized to reverse expenses';
  END IF;
  SELECT * INTO e FROM public.operating_expenses WHERE id = _expense_id AND organization_id = v_org;
  IF e.id IS NULL THEN RAISE EXCEPTION 'Expense not found'; END IF;
  IF e.reversed_at IS NOT NULL THEN RAISE EXCEPTION 'Expense already reversed'; END IF;
  IF COALESCE(_reason,'') = '' THEN RAISE EXCEPTION 'A reason is required'; END IF;

  PERFORM public._opex_assert_period_open(v_org, CURRENT_DATE);

  FOR t IN SELECT * FROM public.accounting_transactions
            WHERE organization_id = v_org AND reference_id = e.id
              AND reference_type IN ('operating_expense','operating_expense_payment') LOOP
    v_seq := v_seq + 1;
    INSERT INTO public.accounting_transactions (
      transaction_number, transaction_date, account_type, category, description,
      debit_amount, credit_amount, reference_type, reference_id, organization_id,
      financial_account_id, project_id, depot_id, gl_account_id, journal_id, currency, fx_rate
    ) VALUES (
      e.expense_number || '-REV-' || v_seq, CURRENT_DATE, t.account_type, t.category,
      'Reversal: ' || COALESCE(t.description,'') || ' (' || _reason || ')',
      t.credit_amount, t.debit_amount, 'operating_expense_reversal', e.id, v_org,
      t.financial_account_id, t.project_id, t.depot_id, t.gl_account_id, v_journal, t.currency, t.fx_rate
    );
  END LOOP;

  UPDATE public.operating_expenses
     SET reversed_at = now(), reversed_by = auth.uid(), status = 'reversed',
         notes = COALESCE(notes,'') || E'\nReversed: ' || _reason
   WHERE id = e.id;

  INSERT INTO public.finance_audit_log (organization_id, actor_user_id, entity_type, entity_id, entity_ref, action, summary)
  VALUES (v_org, auth.uid(), 'operating_expense', e.id, e.expense_number, 'reversed', jsonb_build_object('reason', _reason));
END;
$$;
REVOKE ALL ON FUNCTION public.reverse_operating_expense(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reverse_operating_expense(uuid, text) TO authenticated;
