-- =====================================================================
-- Finance audit, step 8: operating expenses, expense claims, recurring
-- expenses, projects & job costing
--
--  1. Expenses paid from a bank reduce that bank: only the money-out line
--     carries the bank account (all lines did, so they cancelled out).
--     Existing postings are corrected.
--  2. Expense numbers come from a per-company, per-year sequence that never
--     reuses a number (count+1 collided after a delete).
--  3. Foreign-currency expenses take the day's rate when none is given.
--  4. Posted expenses are locked (amounts, lines, delete); correct by reversal.
--     Nobody approves their own expense above the approval limit.
--     Accountants can pay and reverse expenses.
--  5. Expense claims post line by line (account, project, VAT) to
--     "Employee claims payable" on approval; reimbursement pays from a chosen
--     bank account. Totals follow the lines; approved claims are locked; no
--     self-approval. Existing claim postings are put on GL accounts.
--  6. Recurring expenses: weekly and yearly accepted, generator limited to the
--     caller's company, runs daily.
--  7. Projects: P&L nets reversals, converts to base currency, includes the
--     whole end date; accountants can open projects.
-- =====================================================================

-- ---------------------------------------------------------------- 1. bank tagging

CREATE OR REPLACE FUNCTION public._opex_post_journal(_expense_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  e public.operating_expenses%ROWTYPE;
  v_journal uuid := gen_random_uuid();
  v_seq int := 0;
  v_tax numeric := 0;
  v_total numeric := 0;
  v_credit public.gl_accounts%ROWTYPE;
  v_vat public.gl_accounts%ROWTYPE;
  v_base text;
  v_mapped uuid;
  ln record;
BEGIN
  SELECT * INTO e FROM public.operating_expenses WHERE id = _expense_id;
  IF e.id IS NULL THEN RAISE EXCEPTION 'Expense not found'; END IF;
  IF e.journal_id IS NOT NULL THEN RETURN; END IF;

  PERFORM public._opex_assert_period_open(e.organization_id, e.expense_date);
  SELECT currency INTO v_base FROM organizations WHERE id = e.organization_id;

  IF e.payment_mode = 'paid' THEN
    SELECT gl_account_id INTO v_mapped FROM financial_accounts WHERE id = e.financial_account_id;
    IF v_mapped IS NOT NULL THEN
      SELECT * INTO v_credit FROM gl_accounts WHERE id = v_mapped AND organization_id = e.organization_id;
    END IF;
    IF v_credit.id IS NULL THEN
      SELECT * INTO v_credit FROM public.gl_accounts
        WHERE organization_id = e.organization_id AND system_code IN ('bank','cash') AND is_active
        ORDER BY CASE system_code WHEN 'bank' THEN 0 ELSE 1 END LIMIT 1;
    END IF;
    IF v_credit.id IS NULL THEN RAISE EXCEPTION 'No bank/cash GL account configured'; END IF;
  ELSE
    SELECT * INTO v_credit FROM public.gl_accounts
      WHERE organization_id = e.organization_id AND system_code = 'ap' AND is_active LIMIT 1;
    IF v_credit.id IS NULL THEN RAISE EXCEPTION 'No accounts payable GL account configured'; END IF;
  END IF;

  SELECT * INTO v_vat FROM public.gl_accounts
    WHERE organization_id = e.organization_id AND system_code = 'vat_input' AND is_active LIMIT 1;

  FOR ln IN
    SELECT l.*, a.account_type, a.system_code
      FROM public.operating_expense_lines l
      JOIN public.gl_accounts a ON a.id = l.gl_account_id
     WHERE l.expense_id = e.id
     ORDER BY l.created_at
  LOOP
    v_seq := v_seq + 1;
    INSERT INTO public.accounting_transactions (
      transaction_number, transaction_date, account_type, category, description,
      debit_amount, credit_amount, reference_type, reference_id, organization_id,
      financial_account_id, project_id, depot_id, gl_account_id, journal_id, currency, fx_rate, base_currency
    ) VALUES (
      e.expense_number || '-' || v_seq, e.expense_date, ln.account_type,
      COALESCE(ln.system_code,'operating_expense'),
      COALESCE(ln.description, 'Operating expense ' || e.expense_number),
      ln.amount, 0, 'operating_expense', e.id, e.organization_id,
      NULL, COALESCE(ln.project_id, e.project_id),
      COALESCE(ln.depot_id, e.depot_id), ln.gl_account_id, v_journal,
      e.currency, COALESCE(e.fx_rate,1), v_base
    );
    v_tax := v_tax + COALESCE(ln.tax_amount,0);
  END LOOP;

  IF v_seq = 0 THEN RAISE EXCEPTION 'Expense has no lines'; END IF;

  IF v_tax > 0 THEN
    IF v_vat.id IS NULL THEN RAISE EXCEPTION 'No VAT input GL account configured'; END IF;
    v_seq := v_seq + 1;
    INSERT INTO public.accounting_transactions (
      transaction_number, transaction_date, account_type, category, description,
      debit_amount, credit_amount, reference_type, reference_id, organization_id,
      financial_account_id, project_id, depot_id, gl_account_id, journal_id, currency, fx_rate, base_currency
    ) VALUES (
      e.expense_number || '-' || v_seq, e.expense_date, v_vat.account_type,
      'vat_input', 'Input VAT on ' || e.expense_number, v_tax, 0, 'operating_expense', e.id,
      e.organization_id, NULL, e.project_id, e.depot_id, v_vat.id, v_journal,
      e.currency, COALESCE(e.fx_rate,1), v_base
    );
  END IF;

  v_total := COALESCE(e.subtotal,0) + v_tax;
  v_seq := v_seq + 1;
  INSERT INTO public.accounting_transactions (
    transaction_number, transaction_date, account_type, category, description,
    debit_amount, credit_amount, reference_type, reference_id, organization_id,
    financial_account_id, project_id, depot_id, gl_account_id, journal_id, currency, fx_rate, base_currency
  ) VALUES (
    e.expense_number || '-' || v_seq, e.expense_date, v_credit.account_type,
    CASE WHEN e.payment_mode = 'paid' THEN 'cash_out' ELSE 'ap' END,
    'Operating expense ' || e.expense_number || COALESCE(' - ' || e.payee, ''),
    0, v_total, 'operating_expense', e.id, e.organization_id,
    CASE WHEN e.payment_mode = 'paid' THEN e.financial_account_id END,
    e.project_id, e.depot_id, v_credit.id, v_journal, e.currency, COALESCE(e.fx_rate,1), v_base
  );

  UPDATE public.operating_expenses
     SET journal_id = v_journal,
         tax_amount = v_tax,
         total_amount = v_total,
         amount_paid = CASE WHEN payment_mode = 'paid' THEN v_total ELSE 0 END,
         status = CASE WHEN payment_mode = 'paid' THEN 'paid' ELSE 'unpaid' END,
         posted_at = now()
   WHERE id = e.id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.pay_operating_expense(_expense_id uuid, _financial_account_id uuid, _amount numeric, _payment_date date DEFAULT CURRENT_DATE)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_org uuid := public.current_org_id();
  e public.operating_expenses%ROWTYPE;
  v_ap public.gl_accounts%ROWTYPE;
  v_cash public.gl_accounts%ROWTYPE;
  v_mapped uuid;
  v_journal uuid := gen_random_uuid();
  v_outstanding numeric;
  v_base text; v_fa_cur text; v_fx_pay numeric; v_diff numeric; v_fx_gl uuid;
BEGIN
  IF NOT (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'org_owner')
          OR public.has_role(auth.uid(),'accountant') OR public.is_platform_admin()) THEN
    RAISE EXCEPTION 'Not authorized to pay expenses';
  END IF;
  SELECT * INTO e FROM public.operating_expenses WHERE id = _expense_id AND organization_id = v_org;
  IF e.id IS NULL THEN RAISE EXCEPTION 'Expense not found'; END IF;
  IF e.reversed_at IS NOT NULL THEN RAISE EXCEPTION 'Expense has been reversed'; END IF;
  IF COALESCE(e.approval_status,'draft') <> 'approved' THEN
    RAISE EXCEPTION 'Only approved expenses can be settled';
  END IF;
  v_outstanding := e.total_amount - e.amount_paid;
  IF _amount <= 0 OR round(_amount,2) > round(v_outstanding,2) THEN
    RAISE EXCEPTION 'Payment must be between 0 and the outstanding balance (%)', v_outstanding;
  END IF;

  PERFORM public._opex_assert_period_open(v_org, _payment_date);
  SELECT currency INTO v_base FROM organizations WHERE id = v_org;

  SELECT * INTO v_ap FROM public.gl_accounts
    WHERE organization_id = v_org AND system_code = 'ap' AND is_active LIMIT 1;
  SELECT gl_account_id, upper(currency) INTO v_mapped, v_fa_cur FROM public.financial_accounts
   WHERE id = _financial_account_id AND organization_id = v_org;
  IF NOT FOUND THEN RAISE EXCEPTION 'Bank account not found'; END IF;
  IF v_fa_cur IS NOT NULL AND v_fa_cur <> upper(e.currency) THEN
    RAISE EXCEPTION 'Pay a % bill from a % account', e.currency, e.currency;
  END IF;
  IF v_mapped IS NOT NULL THEN
    SELECT * INTO v_cash FROM public.gl_accounts WHERE id = v_mapped AND organization_id = v_org;
  END IF;
  IF v_cash.id IS NULL THEN
    SELECT * INTO v_cash FROM public.gl_accounts
      WHERE organization_id = v_org AND system_code IN ('bank','cash') AND is_active
      ORDER BY CASE system_code WHEN 'bank' THEN 0 ELSE 1 END LIMIT 1;
  END IF;
  IF v_ap.id IS NULL OR v_cash.id IS NULL THEN RAISE EXCEPTION 'Chart of accounts missing AP or bank account'; END IF;

  v_fx_pay := CASE WHEN upper(e.currency) = upper(v_base) THEN 1
                   ELSE COALESCE(public.get_fx_rate(v_org, e.currency, v_base, _payment_date), e.fx_rate, 1) END;

  INSERT INTO public.accounting_transactions (
    transaction_number, transaction_date, account_type, category, description,
    debit_amount, credit_amount, reference_type, reference_id, organization_id,
    financial_account_id, project_id, depot_id, gl_account_id, journal_id, currency, fx_rate, base_currency
  ) VALUES
  (e.expense_number || '-PAY-' || substr(v_journal::text,1,6) || '-1', _payment_date, v_ap.account_type, 'ap',
   'Payment for ' || e.expense_number, _amount, 0, 'operating_expense_payment', e.id, v_org,
   NULL, e.project_id, e.depot_id, v_ap.id, v_journal, e.currency, COALESCE(e.fx_rate, 1), v_base),
  (e.expense_number || '-PAY-' || substr(v_journal::text,1,6) || '-2', _payment_date, v_cash.account_type, 'cash_out',
   'Payment for ' || e.expense_number, 0, _amount, 'operating_expense_payment', e.id, v_org,
   _financial_account_id, e.project_id, e.depot_id, v_cash.id, v_journal, e.currency, v_fx_pay, v_base);

  -- exchange difference between the bill's rate and the payment day's rate
  v_diff := round(_amount * (v_fx_pay - COALESCE(e.fx_rate, 1)), 2);
  IF v_diff <> 0 THEN
    v_fx_gl := public.ensure_gl_account(v_org, '6800', 'FX Gain/Loss', 'expense', 'fx_gain_loss');
    INSERT INTO public.accounting_transactions (
      transaction_number, transaction_date, account_type, category, description,
      debit_amount, credit_amount, reference_type, reference_id, organization_id,
      gl_account_id, journal_id, currency, fx_rate, base_currency
    ) VALUES (e.expense_number || '-PAY-' || substr(v_journal::text,1,6) || '-3', _payment_date, 'expense', 'fx_gain_loss',
      'Exchange difference on ' || e.expense_number,
      greatest(v_diff, 0), greatest(-v_diff, 0), 'operating_expense_payment', e.id, v_org,
      v_fx_gl, v_journal, v_base, 1, v_base);
  END IF;
  -- paying more base currency than was booked is a loss (debit), less is a gain (credit)

  UPDATE public.operating_expenses
     SET amount_paid = amount_paid + _amount,
         status = CASE WHEN round(amount_paid + _amount, 2) >= round(total_amount, 2) THEN 'paid' ELSE 'partly_paid' END,
         financial_account_id = COALESCE(financial_account_id, _financial_account_id)
   WHERE id = e.id;

  INSERT INTO public.finance_audit_log (organization_id, actor_user_id, entity_type, entity_id, entity_ref, action, summary)
  VALUES (v_org, auth.uid(), 'operating_expense', e.id, e.expense_number, 'payment_recorded',
          jsonb_build_object('amount', _amount, 'financial_account_id', _financial_account_id));
END $function$;

-- Accountants may reverse too.
DO $$
DECLARE def text;
BEGIN
  SELECT pg_get_functiondef('public.reverse_operating_expense(uuid,text)'::regprocedure) INTO def;
  def := replace(def,
    'IF NOT (public.has_role(auth.uid(),''admin'') OR public.has_role(auth.uid(),''org_owner'') OR public.is_platform_admin()) THEN',
    'IF NOT (public.has_role(auth.uid(),''admin'') OR public.has_role(auth.uid(),''org_owner'') OR public.has_role(auth.uid(),''accountant'') OR public.is_platform_admin()) THEN');
  IF position('''accountant''' IN def) = 0 THEN RAISE EXCEPTION 'reverse_operating_expense patch did not apply'; END IF;
  EXECUTE def;
END $$;

-- Correct existing postings: only the money-out line belongs to the bank account.
UPDATE public.accounting_transactions
   SET financial_account_id = NULL
 WHERE reference_type IN ('operating_expense', 'operating_expense_payment', 'operating_expense_reversal')
   AND financial_account_id IS NOT NULL
   AND category <> 'cash_out';

-- ---------------------------------------------------------------- 2. numbering

CREATE OR REPLACE FUNCTION public.next_operating_expense_number(_org uuid, _on date)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE _y int := extract(year FROM COALESCE(_on, current_date))::int; _n int; _num text; _max int;
BEGIN
  -- start the series after the highest number already used this year
  SELECT COALESCE(max(NULLIF(substring(expense_number FROM '^EXP-' || _y || '-([0-9]+)$'), '')::int), 0) INTO _max
    FROM operating_expenses WHERE organization_id = _org AND expense_number LIKE 'EXP-' || _y || '-%';
  INSERT INTO invoice_number_sequences(organization_id, series, year, last_value)
  VALUES (_org, 'EXP', _y, _max)
  ON CONFLICT (organization_id, series, year) DO NOTHING;
  LOOP
    UPDATE invoice_number_sequences SET last_value = greatest(last_value, _max) + 1
     WHERE organization_id = _org AND series = 'EXP' AND year = _y
    RETURNING last_value INTO _n;
    _num := 'EXP-' || _y || '-' || lpad(_n::text, 4, '0');
    EXIT WHEN NOT EXISTS (SELECT 1 FROM operating_expenses WHERE organization_id = _org AND expense_number = _num);
  END LOOP;
  RETURN _num;
END $$;

CREATE OR REPLACE FUNCTION public.next_operating_expense_number()
RETURNS text LANGUAGE sql SECURITY DEFINER SET search_path TO 'public'
AS $$ SELECT public.next_operating_expense_number(public.current_org_id(), current_date) $$;

DO $$
DECLARE def text;
BEGIN
  SELECT pg_get_functiondef('public.post_operating_expense'::regproc) INTO def;
  IF position('next_operating_expense_number()' IN def) > 0 THEN
    def := replace(def, 'public.next_operating_expense_number()', 'public.next_operating_expense_number(v_org, _expense_date)');
    EXECUTE def;
  END IF;
  SELECT pg_get_functiondef('public._create_expense_from_template'::regproc) INTO def;
  IF position('next_operating_expense_number()' IN def) > 0 THEN
    def := replace(def, 'public.next_operating_expense_number()', 'public.next_operating_expense_number((SELECT organization_id FROM public.recurring_expense_templates WHERE id = _template_id), _run_date)');
    EXECUTE def;
  END IF;
END $$;

-- ---------------------------------------------------------------- 3. exchange rate

CREATE OR REPLACE FUNCTION public.trg_opex_fx()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE _base text;
BEGIN
  SELECT currency INTO _base FROM organizations WHERE id = NEW.organization_id;
  IF NEW.currency IS NULL OR _base IS NULL OR upper(NEW.currency) = upper(_base) THEN
    NEW.fx_rate := 1;
  ELSIF NEW.fx_rate IS NULL OR NEW.fx_rate = 1 OR NEW.fx_rate <= 0 THEN
    NEW.fx_rate := public.get_fx_rate(NEW.organization_id, NEW.currency, _base, COALESCE(NEW.expense_date, current_date));
    IF NEW.fx_rate IS NULL THEN
      RAISE EXCEPTION 'Missing FX rate % → % for %. Add it under Finance → FX Rates.', NEW.currency, _base, NEW.expense_date
        USING ERRCODE = '22023';
    END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_opex_fx ON public.operating_expenses;
CREATE TRIGGER trg_opex_fx BEFORE INSERT ON public.operating_expenses
  FOR EACH ROW EXECUTE FUNCTION public.trg_opex_fx();

-- ---------------------------------------------------------------- 4. lock posted, approvals

CREATE OR REPLACE FUNCTION public.trg_opex_lock_posted()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  IF auth.uid() IS NULL OR OLD.journal_id IS NULL THEN RETURN COALESCE(NEW, OLD); END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'expense_posted: % is posted; reverse it instead of deleting', OLD.expense_number USING ERRCODE = '22023';
  END IF;
  IF NEW.subtotal IS DISTINCT FROM OLD.subtotal OR NEW.tax_amount IS DISTINCT FROM OLD.tax_amount
     OR NEW.total_amount IS DISTINCT FROM OLD.total_amount OR NEW.currency IS DISTINCT FROM OLD.currency
     OR NEW.fx_rate IS DISTINCT FROM OLD.fx_rate OR NEW.expense_date IS DISTINCT FROM OLD.expense_date
     OR NEW.payment_mode IS DISTINCT FROM OLD.payment_mode OR NEW.organization_id IS DISTINCT FROM OLD.organization_id
     OR NEW.amount_paid < OLD.amount_paid AND OLD.reversed_at IS NULL AND NEW.reversed_at IS NULL THEN
    RAISE EXCEPTION 'expense_posted: % is posted; reverse it and enter a new one', OLD.expense_number USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_opex_lock_posted ON public.operating_expenses;
CREATE TRIGGER trg_opex_lock_posted BEFORE UPDATE OR DELETE ON public.operating_expenses
  FOR EACH ROW EXECUTE FUNCTION public.trg_opex_lock_posted();

CREATE OR REPLACE FUNCTION public.trg_opex_lines_lock_posted()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE _posted boolean;
BEGIN
  IF auth.uid() IS NULL THEN RETURN COALESCE(NEW, OLD); END IF;
  SELECT journal_id IS NOT NULL INTO _posted FROM operating_expenses WHERE id = COALESCE(NEW.expense_id, OLD.expense_id);
  IF COALESCE(_posted, false) THEN
    RAISE EXCEPTION 'expense_posted: the expense is posted; reverse it and enter a new one' USING ERRCODE = '22023';
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;
DROP TRIGGER IF EXISTS trg_opex_lines_lock_posted ON public.operating_expense_lines;
CREATE TRIGGER trg_opex_lines_lock_posted BEFORE INSERT OR UPDATE OR DELETE ON public.operating_expense_lines
  FOR EACH ROW EXECUTE FUNCTION public.trg_opex_lines_lock_posted();

CREATE OR REPLACE FUNCTION public.approve_operating_expense(_expense_id uuid, _note text DEFAULT NULL::text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE e public.operating_expenses%ROWTYPE; v_threshold numeric; v_enabled boolean;
BEGIN
  SELECT * INTO e FROM public.operating_expenses WHERE id = _expense_id;
  IF e.id IS NULL OR e.organization_id <> public.current_org_id() THEN
    RAISE EXCEPTION 'Expense not found';
  END IF;
  IF e.approval_status = 'approved' THEN RETURN; END IF;
  IF e.approval_status <> 'submitted' THEN
    RAISE EXCEPTION 'Only submitted expenses can be approved';
  END IF;
  IF NOT (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'org_owner')
          OR public.is_platform_admin()
          OR public.has_permission(auth.uid(),'accounting','approve')) THEN
    RAISE EXCEPTION 'Not authorized to approve expenses';
  END IF;

  -- Over the approval limit, someone other than the person who entered it must approve.
  SELECT p.min_amount, p.enabled INTO v_threshold, v_enabled
    FROM public.approval_policies p
   WHERE p.organization_id = e.organization_id AND p.document_type = 'operating_expense' LIMIT 1;
  IF COALESCE(v_enabled, false) AND COALESCE(e.total_amount, 0) >= COALESCE(v_threshold, 0)
     AND auth.uid() IN (e.created_by, e.submitted_by) AND NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'self_approval: someone other than the person who entered this expense must approve it'
      USING ERRCODE = '42501';
  END IF;

  UPDATE public.operating_expenses
     SET approval_status = 'approved', approved_by = auth.uid(), approved_at = now()
   WHERE id = _expense_id;

  PERFORM public._opex_post_journal(_expense_id);

  INSERT INTO public.finance_audit_log (organization_id, actor_user_id, entity_type, entity_id, entity_ref, action, summary)
  VALUES (e.organization_id, auth.uid(), 'operating_expense', e.id, e.expense_number, 'approved',
          jsonb_build_object('total', e.total_amount, 'note', _note));
END;
$function$;

-- ---------------------------------------------------------------- 5. expense claims

ALTER TABLE public.expense_claims ADD COLUMN IF NOT EXISTS submitted_by uuid;
ALTER TABLE public.expense_claims ADD COLUMN IF NOT EXISTS approved_by uuid;
ALTER TABLE public.expense_claims ADD COLUMN IF NOT EXISTS reimbursed_by uuid;
ALTER TABLE public.expense_claims ADD COLUMN IF NOT EXISTS financial_account_id uuid;
ALTER TABLE public.expense_claims ADD COLUMN IF NOT EXISTS rejection_reason text;
ALTER TABLE public.expense_claims ALTER COLUMN created_by SET DEFAULT auth.uid();

DROP TRIGGER IF EXISTS trg_expense_claim_autopost ON public.expense_claims;

-- Put old claim postings on GL accounts so they show on the statements.
DO $$
DECLARE o record; _g uuid;
BEGIN
  FOR o IN SELECT DISTINCT organization_id FROM accounting_transactions
            WHERE reference_type = 'expense_claim' AND gl_account_id IS NULL LOOP
    _g := public.ensure_gl_account(o.organization_id, '6950', 'Staff Expense Claims', 'expense', 'expense_claims');
    UPDATE accounting_transactions SET gl_account_id = _g
     WHERE organization_id = o.organization_id AND reference_type = 'expense_claim'
       AND gl_account_id IS NULL AND category = 'employee_expense';
    UPDATE accounting_transactions
       SET gl_account_id = (SELECT id FROM gl_accounts WHERE organization_id = o.organization_id AND system_code = 'cash' LIMIT 1)
     WHERE organization_id = o.organization_id AND reference_type = 'expense_claim'
       AND gl_account_id IS NULL AND category = 'cash';
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.assert_claim_approver(_org uuid)
RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  IF public.is_platform_admin() THEN RETURN; END IF;
  IF _org IS DISTINCT FROM public.current_org_id() THEN RAISE EXCEPTION 'Claim not found'; END IF;
  IF NOT (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'org_owner')
          OR has_role(auth.uid(), 'accountant') OR has_role(auth.uid(), 'hr_manager')) THEN
    RAISE EXCEPTION 'not_authorized: only admins, accountants and HR managers can do this' USING ERRCODE = '42501';
  END IF;
END $$;

-- Claim total follows its lines.
CREATE OR REPLACE FUNCTION public.trg_claim_lines_sync()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE _cid uuid := COALESCE(NEW.claim_id, OLD.claim_id); _st text;
BEGIN
  SELECT status INTO _st FROM expense_claims WHERE id = _cid;
  IF _st IN ('approved', 'reimbursed') AND auth.uid() IS NOT NULL THEN
    RAISE EXCEPTION 'claim_locked: the claim is %; its lines can no longer change', _st USING ERRCODE = '22023';
  END IF;
  PERFORM set_config('app.claim_action', 'on', true);
  UPDATE expense_claims SET total_amount = (SELECT COALESCE(sum(amount), 0) FROM expense_claim_lines WHERE claim_id = _cid)
   WHERE id = _cid;
  PERFORM set_config('app.claim_action', '', true);
  RETURN COALESCE(NEW, OLD);
END $$;
DROP TRIGGER IF EXISTS trg_claim_lines_sync ON public.expense_claim_lines;
CREATE TRIGGER trg_claim_lines_sync AFTER INSERT OR UPDATE OR DELETE ON public.expense_claim_lines
  FOR EACH ROW EXECUTE FUNCTION public.trg_claim_lines_sync();

-- Status changes go through the functions below; approved claims are locked.
CREATE OR REPLACE FUNCTION public.trg_claim_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  IF auth.uid() IS NULL OR COALESCE(current_setting('app.claim_action', true), '') = 'on' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  IF TG_OP = 'DELETE' THEN
    IF OLD.status IN ('approved', 'reimbursed') THEN
      RAISE EXCEPTION 'claim_locked: an approved claim cannot be deleted' USING ERRCODE = '22023';
    END IF;
    RETURN OLD;
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status NOT IN ('draft', 'submitted') THEN
      RAISE EXCEPTION 'A new claim starts as draft or submitted' USING ERRCODE = '22023';
    END IF;
    NEW.created_by := COALESCE(NEW.created_by, auth.uid());
    RETURN NEW;
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status AND NEW.status IN ('approved', 'reimbursed', 'rejected') THEN
    RAISE EXCEPTION 'Use Approve / Reject / Reimburse to change a claim''s status' USING ERRCODE = '22023';
  END IF;
  IF OLD.status IN ('approved', 'reimbursed') AND (NEW.total_amount IS DISTINCT FROM OLD.total_amount
       OR NEW.status IS DISTINCT FROM OLD.status OR NEW.organization_id IS DISTINCT FROM OLD.organization_id) THEN
    RAISE EXCEPTION 'claim_locked: the claim is %; it can no longer change', OLD.status USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_claim_guard ON public.expense_claims;
CREATE TRIGGER trg_claim_guard BEFORE INSERT OR UPDATE OR DELETE ON public.expense_claims
  FOR EACH ROW EXECUTE FUNCTION public.trg_claim_guard();

CREATE OR REPLACE FUNCTION public.decide_expense_claim(_claim_id uuid, _decision text, _note text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE c expense_claims%ROWTYPE; _base text; _payable uuid; _default uuid; _vat uuid; _lines int;
        _jid uuid := gen_random_uuid(); ln record; _rate numeric; _net numeric; _tax numeric; _seq int := 0;
BEGIN
  SELECT * INTO c FROM expense_claims WHERE id = _claim_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Claim not found'; END IF;
  PERFORM public.assert_claim_approver(c.organization_id);
  IF c.status NOT IN ('submitted', 'draft') THEN RAISE EXCEPTION 'Only submitted claims can be approved or rejected (this one is %)', c.status; END IF;
  IF c.created_by = auth.uid() AND NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'self_approval: someone else must approve your own claim' USING ERRCODE = '42501';
  END IF;

  PERFORM set_config('app.claim_action', 'on', true);
  IF _decision = 'rejected' THEN
    IF COALESCE(btrim(_note), '') = '' THEN RAISE EXCEPTION 'A rejection reason is required'; END IF;
    UPDATE expense_claims SET status = 'rejected', rejection_reason = _note, updated_at = now() WHERE id = _claim_id;
    PERFORM set_config('app.claim_action', '', true);
    RETURN;
  ELSIF _decision <> 'approved' THEN
    RAISE EXCEPTION 'Decision must be approved or rejected';
  END IF;

  SELECT count(*) INTO _lines FROM expense_claim_lines WHERE claim_id = _claim_id;
  IF _lines > 0 AND round((SELECT sum(amount) FROM expense_claim_lines WHERE claim_id = _claim_id), 2) <> round(c.total_amount, 2) THEN
    RAISE EXCEPTION 'The claim total % does not match its lines %', c.total_amount,
      (SELECT sum(amount) FROM expense_claim_lines WHERE claim_id = _claim_id);
  END IF;
  IF COALESCE(c.total_amount, 0) <= 0 THEN RAISE EXCEPTION 'The claim has no amount'; END IF;

  SELECT currency INTO _base FROM organizations WHERE id = c.organization_id;
  _payable := public.ensure_gl_account(c.organization_id, '2310', 'Employee Claims Payable', 'liability', 'employee_claims_payable');
  _default := public.ensure_gl_account(c.organization_id, '6950', 'Staff Expense Claims', 'expense', 'expense_claims');
  SELECT id INTO _vat FROM gl_accounts WHERE organization_id = c.organization_id AND system_code = 'vat_input' LIMIT 1;

  -- One debit per line (VAT-inclusive receipts are split), or one line for a claim without lines.
  FOR ln IN
    SELECT l.id, COALESCE(l.gl_account_id, _default) AS gl, l.project_id, l.amount, l.tax_code_id,
           COALESCE(l.description, l.category, 'Claim line') AS descr, a.account_type
      FROM expense_claim_lines l LEFT JOIN gl_accounts a ON a.id = COALESCE(l.gl_account_id, _default)
     WHERE l.claim_id = _claim_id
    UNION ALL
    SELECT NULL, _default, NULL, c.total_amount, NULL, COALESCE(c.notes, 'Expense claim'), 'expense'::account_type
     WHERE _lines = 0
  LOOP
    _seq := _seq + 1;
    SELECT COALESCE(rate, 0) INTO _rate FROM tax_codes WHERE id = ln.tax_code_id;
    _rate := COALESCE(_rate, 0);
    _tax := CASE WHEN _rate > 0 AND _vat IS NOT NULL THEN round(ln.amount * _rate / (100 + _rate), 2) ELSE 0 END;
    _net := ln.amount - _tax;
    INSERT INTO accounting_transactions(transaction_number, transaction_date, account_type, category, description,
      debit_amount, credit_amount, reference_type, reference_id, organization_id, project_id, gl_account_id, journal_id,
      currency, fx_rate, base_currency, created_by)
    VALUES (c.claim_number || '-' || _seq, COALESCE(c.claim_date, current_date), COALESCE(ln.account_type, 'expense'),
      'expense_claim', ln.descr, _net, 0, 'expense_claim', c.id, c.organization_id, ln.project_id, ln.gl, _jid,
      _base, 1, _base, auth.uid());
    IF _tax > 0 THEN
      _seq := _seq + 1;
      INSERT INTO accounting_transactions(transaction_number, transaction_date, account_type, category, description,
        debit_amount, credit_amount, reference_type, reference_id, organization_id, project_id, gl_account_id, journal_id,
        currency, fx_rate, base_currency, created_by)
      VALUES (c.claim_number || '-' || _seq, COALESCE(c.claim_date, current_date), 'asset', 'vat_input',
        'Input VAT — ' || ln.descr, _tax, 0, 'expense_claim', c.id, c.organization_id, ln.project_id, _vat, _jid,
        _base, 1, _base, auth.uid());
    END IF;
  END LOOP;
  INSERT INTO accounting_transactions(transaction_number, transaction_date, account_type, category, description,
    debit_amount, credit_amount, reference_type, reference_id, organization_id, gl_account_id, journal_id,
    currency, fx_rate, base_currency, created_by)
  VALUES (c.claim_number || '-PAY', COALESCE(c.claim_date, current_date), 'liability', 'employee_claims_payable',
    'Owed to employee — claim ' || c.claim_number, 0, c.total_amount, 'expense_claim', c.id, c.organization_id,
    _payable, _jid, _base, 1, _base, auth.uid());

  UPDATE expense_claims SET status = 'approved', approved_at = now(), approved_by = auth.uid(), updated_at = now()
   WHERE id = _claim_id;
  PERFORM set_config('app.claim_action', '', true);
END $$;
GRANT EXECUTE ON FUNCTION public.decide_expense_claim(uuid, text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.reimburse_expense_claim(_claim_id uuid, _financial_account_id uuid, _date date DEFAULT current_date, _reference text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE c expense_claims%ROWTYPE; _base text; _payable uuid; _cash uuid; _fa record; _jid uuid := gen_random_uuid();
BEGIN
  SELECT * INTO c FROM expense_claims WHERE id = _claim_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Claim not found'; END IF;
  PERFORM public.assert_claim_approver(c.organization_id);
  IF c.status <> 'approved' THEN RAISE EXCEPTION 'Only approved claims can be reimbursed (this one is %)', c.status; END IF;
  SELECT * INTO _fa FROM financial_accounts WHERE id = _financial_account_id AND organization_id = c.organization_id AND is_active;
  IF NOT FOUND THEN RAISE EXCEPTION 'Choose an active bank or cash account to pay from'; END IF;
  SELECT currency INTO _base FROM organizations WHERE id = c.organization_id;
  IF upper(COALESCE(_fa.currency, _base)) <> upper(_base) THEN
    RAISE EXCEPTION 'Reimburse from a % account', _base;
  END IF;

  -- clear whichever liability the approval credited (older claims used accounts payable)
  SELECT gl_account_id INTO _payable FROM accounting_transactions
   WHERE reference_type = 'expense_claim' AND reference_id = c.id AND credit_amount > 0 AND account_type = 'liability'
   ORDER BY created_at LIMIT 1;
  _payable := COALESCE(_payable, public.ensure_gl_account(c.organization_id, '2310', 'Employee Claims Payable', 'liability', 'employee_claims_payable'));
  _cash := COALESCE(_fa.gl_account_id,
                    (SELECT id FROM gl_accounts WHERE organization_id = c.organization_id AND system_code IN ('bank', 'cash')
                      ORDER BY CASE system_code WHEN 'bank' THEN 0 ELSE 1 END LIMIT 1));

  INSERT INTO accounting_transactions(transaction_number, transaction_date, account_type, category, description,
    debit_amount, credit_amount, reference_type, reference_id, organization_id, gl_account_id, journal_id,
    financial_account_id, currency, fx_rate, base_currency, created_by)
  VALUES
    (c.claim_number || '-RMB-1', COALESCE(_date, current_date), 'liability', 'employee_claims_payable',
     'Reimbursement of claim ' || c.claim_number || COALESCE(' — ' || _reference, ''), c.total_amount, 0,
     'expense_claim_payment', c.id, c.organization_id, _payable, _jid, NULL, _base, 1, _base, auth.uid()),
    (c.claim_number || '-RMB-2', COALESCE(_date, current_date), 'asset', 'cash_out',
     'Reimbursement of claim ' || c.claim_number || COALESCE(' — ' || _reference, ''), 0, c.total_amount,
     'expense_claim_payment', c.id, c.organization_id, _cash, _jid, _financial_account_id, _base, 1, _base, auth.uid());

  PERFORM set_config('app.claim_action', 'on', true);
  UPDATE expense_claims SET status = 'reimbursed', reimbursed_at = now(), reimbursed_by = auth.uid(),
                            financial_account_id = _financial_account_id, updated_at = now()
   WHERE id = _claim_id;
  PERFORM set_config('app.claim_action', '', true);
END $$;
GRANT EXECUTE ON FUNCTION public.reimburse_expense_claim(uuid, uuid, date, text) TO authenticated;

-- Claim lines are visible to the same people as the claim list.
DROP POLICY IF EXISTS "org read claim_lines" ON public.expense_claim_lines;
CREATE POLICY "org read claim_lines" ON public.expense_claim_lines FOR SELECT
  USING (is_platform_admin() OR (organization_id = current_org_id() AND (
         has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'org_owner') OR has_role(auth.uid(), 'hr_manager')
         OR has_role(auth.uid(), 'accountant') OR has_role(auth.uid(), 'viewer'))));

-- ---------------------------------------------------------------- 6. recurring expenses

ALTER TABLE public.recurring_expense_templates DROP CONSTRAINT IF EXISTS recurring_expense_templates_frequency_check;
ALTER TABLE public.recurring_expense_templates ADD CONSTRAINT recurring_expense_templates_frequency_check
  CHECK (frequency IN ('weekly', 'monthly', 'quarterly', 'annual', 'yearly'));

CREATE OR REPLACE FUNCTION public.recurring_expense_period_key(_frequency text, _on date)
RETURNS text LANGUAGE sql IMMUTABLE
AS $$ SELECT CASE WHEN _frequency = 'weekly' THEN to_char(_on, 'IYYY-"W"IW') ELSE to_char(_on, 'YYYY-MM') END $$;

CREATE OR REPLACE FUNCTION public._advance_recurring_expense_template(_template_id uuid)
RETURNS date
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE t public.recurring_expense_templates%ROWTYPE; v_next date; v_step interval;
BEGIN
  SELECT * INTO t FROM public.recurring_expense_templates WHERE id = _template_id;
  IF t.frequency = 'weekly' THEN
    v_next := t.next_run_date + 7 * COALESCE(t.interval_count, 1);
  ELSE
    v_step := CASE t.frequency
                WHEN 'monthly' THEN make_interval(months => t.interval_count)
                WHEN 'quarterly' THEN make_interval(months => 3 * t.interval_count)
                ELSE make_interval(years => t.interval_count) END;
    v_next := (date_trunc('month', t.next_run_date + v_step)
               + make_interval(days => COALESCE(t.day_of_month, extract(day FROM t.next_run_date)::int) - 1))::date;
  END IF;
  UPDATE public.recurring_expense_templates
     SET next_run_date = v_next,
         last_run_at = now(),
         is_active = CASE WHEN t.end_date IS NOT NULL AND v_next > t.end_date THEN false ELSE is_active END
   WHERE id = t.id;
  RETURN v_next;
END $function$;

CREATE OR REPLACE FUNCTION public.generate_due_recurring_expenses(_org_id uuid DEFAULT NULL::uuid)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE t record; v_key text; v_expense uuid; v_count int := 0;
BEGIN
  -- From the app: only your own company, and only finance staff. The daily job runs for all.
  IF auth.uid() IS NOT NULL THEN
    _org_id := public.current_org_id();
    IF NOT (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'org_owner')
            OR public.has_role(auth.uid(),'accountant') OR public.is_platform_admin()
            OR public.has_permission(auth.uid(),'accounting','create')) THEN
      RAISE EXCEPTION 'Not authorized to generate expenses' USING ERRCODE = '42501';
    END IF;
  END IF;
  FOR t IN SELECT * FROM public.recurring_expense_templates
            WHERE is_active
              AND next_run_date <= CURRENT_DATE
              AND start_date <= CURRENT_DATE
              AND (end_date IS NULL OR next_run_date <= end_date)
              AND (_org_id IS NULL OR organization_id = _org_id)
  LOOP
    v_key := public.recurring_expense_period_key(t.frequency, t.next_run_date);
    IF EXISTS (SELECT 1 FROM public.recurring_expense_runs r
                WHERE r.template_id = t.id AND r.period_key = v_key) THEN
      PERFORM public._advance_recurring_expense_template(t.id);
      CONTINUE;
    END IF;
    BEGIN
      v_expense := public._create_expense_from_template(t.id, t.next_run_date);
      INSERT INTO public.recurring_expense_runs (organization_id, template_id, period_key, run_date, expense_id, status)
      VALUES (t.organization_id, t.id, v_key, t.next_run_date, v_expense, 'created');
      v_count := v_count + 1;
    EXCEPTION WHEN OTHERS THEN
      INSERT INTO public.recurring_expense_runs (organization_id, template_id, period_key, run_date, status, message)
      VALUES (t.organization_id, t.id, v_key, t.next_run_date, 'failed', SQLERRM)
      ON CONFLICT (template_id, period_key) DO UPDATE SET status = 'failed', message = EXCLUDED.message;
    END;
    PERFORM public._advance_recurring_expense_template(t.id);
  END LOOP;
  RETURN v_count;
END $function$;

DO $$
DECLARE def text;
BEGIN
  SELECT pg_get_functiondef('public.run_recurring_expense_now'::regproc) INTO def;
  def := replace(def, 'v_key := to_char(t.next_run_date, ''YYYY-MM'');',
                      'v_key := public.recurring_expense_period_key(t.frequency, t.next_run_date);');
  def := replace(def, 'OR public.is_platform_admin() OR public.has_permission(auth.uid(),''accounting'',''create'')) THEN',
                      'OR public.has_role(auth.uid(),''accountant'') OR public.is_platform_admin() OR public.has_permission(auth.uid(),''accounting'',''create'')) THEN');
  IF position('recurring_expense_period_key' IN def) = 0 THEN RAISE EXCEPTION 'run_recurring_expense_now patch did not apply'; END IF;
  EXECUTE def;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
              WHERE n.nspname = 'cron' AND p.proname = 'schedule') THEN
    BEGIN PERFORM cron.unschedule('finance-daily-recurring-expenses'); EXCEPTION WHEN OTHERS THEN NULL; END;
    PERFORM cron.schedule('finance-daily-recurring-expenses', '20 3 * * *', 'SELECT public.generate_due_recurring_expenses(NULL)');
  END IF;
END $$;

-- ---------------------------------------------------------------- 7. projects

CREATE OR REPLACE VIEW public.project_pnl WITH (security_invoker = on) AS
SELECT p.id AS project_id,
       p.organization_id,
       p.code,
       p.name,
       p.status,
       p.budget_amount,
       p.currency,
       round(COALESCE(sum((at.credit_amount - at.debit_amount) * public.ledger_base_factor(at.currency, COALESCE(at.base_currency, o.currency), at.fx_rate))
             FILTER (WHERE at.account_type = 'revenue'), 0), 2) AS revenue,
       round(COALESCE(sum((at.debit_amount - at.credit_amount) * public.ledger_base_factor(at.currency, COALESCE(at.base_currency, o.currency), at.fx_rate))
             FILTER (WHERE at.account_type = 'cost_of_goods'), 0), 2) AS cogs,
       round(COALESCE(sum((at.debit_amount - at.credit_amount) * public.ledger_base_factor(at.currency, COALESCE(at.base_currency, o.currency), at.fx_rate))
             FILTER (WHERE at.account_type = 'expense'), 0), 2) AS expenses,
       round(COALESCE(sum((at.credit_amount - at.debit_amount) * public.ledger_base_factor(at.currency, COALESCE(at.base_currency, o.currency), at.fx_rate))
             FILTER (WHERE at.account_type IN ('revenue', 'cost_of_goods', 'expense')), 0), 2) AS margin
  FROM projects p
  JOIN organizations o ON o.id = p.organization_id
  LEFT JOIN accounting_transactions at ON at.project_id = p.id AND at.organization_id = p.organization_id
                                       AND at.reference_type IS DISTINCT FROM 'year_end_close'
 GROUP BY p.id, p.organization_id, p.code, p.name, p.status, p.budget_amount, p.currency;

CREATE OR REPLACE FUNCTION public.project_pnl_report(_from date DEFAULT NULL::date, _to date DEFAULT NULL::date)
RETURNS TABLE(project_id uuid, code text, name text, status text, customer_id uuid, customer_name text, revenue numeric, materials numeric, other_cogs numeric, expenses numeric, gross_profit numeric, net_profit numeric, budget numeric, quoted numeric, variance numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  WITH t AS (
    SELECT a.project_id,
      SUM(CASE WHEN a.account_type='revenue' THEN (a.credit_amount-a.debit_amount) * f.k ELSE 0 END) rev,
      SUM(CASE WHEN a.account_type='cost_of_goods' AND a.category='cogs_conversion_materials' THEN (a.debit_amount-a.credit_amount) * f.k ELSE 0 END) mat,
      SUM(CASE WHEN a.account_type='cost_of_goods' AND a.category<>'cogs_conversion_materials' THEN (a.debit_amount-a.credit_amount) * f.k ELSE 0 END) oc,
      SUM(CASE WHEN a.account_type='expense' THEN (a.debit_amount-a.credit_amount) * f.k ELSE 0 END) ex
    FROM accounting_transactions a
    JOIN organizations o ON o.id = a.organization_id
    CROSS JOIN LATERAL (SELECT public.ledger_base_factor(a.currency, COALESCE(a.base_currency, o.currency), a.fx_rate) AS k) f
    WHERE a.project_id IS NOT NULL AND a.organization_id = current_org_id()
      AND a.reference_type IS DISTINCT FROM 'year_end_close'
      AND (_from IS NULL OR a.transaction_date >= _from) AND (_to IS NULL OR a.transaction_date < _to + 1)
    GROUP BY a.project_id
  ), b AS (SELECT bu.project_id, SUM(bu.amount) amt FROM budgets bu WHERE bu.organization_id=current_org_id() AND bu.project_id IS NOT NULL GROUP BY 1),
  q AS (SELECT cc.project_id, SUM(COALESCE(cc.quoted_price,0)) amt FROM container_conversions cc WHERE cc.organization_id=current_org_id() AND cc.project_id IS NOT NULL AND cc.status<>'cancelled' GROUP BY 1)
  SELECT p.id, p.code, p.name, p.status::text, p.customer_id, cu.company_name,
    round(COALESCE(t.rev,0), 2), round(COALESCE(t.mat,0), 2), round(COALESCE(t.oc,0), 2), round(COALESCE(t.ex,0), 2),
    round(COALESCE(t.rev,0)-COALESCE(t.mat,0)-COALESCE(t.oc,0), 2),
    round(COALESCE(t.rev,0)-COALESCE(t.mat,0)-COALESCE(t.oc,0)-COALESCE(t.ex,0), 2),
    COALESCE(NULLIF(b.amt,0), NULLIF(p.budget_amount,0)), q.amt,
    round(COALESCE(NULLIF(b.amt,0), NULLIF(p.budget_amount,0), NULLIF(q.amt,0)) - (COALESCE(t.mat,0)+COALESCE(t.oc,0)+COALESCE(t.ex,0)), 2)
  FROM projects p
  LEFT JOIN t ON t.project_id=p.id LEFT JOIN b ON b.project_id=p.id LEFT JOIN q ON q.project_id=p.id
  LEFT JOIN customers cu ON cu.id=p.customer_id
  WHERE p.organization_id = current_org_id()
  ORDER BY p.code;
$function$;

DROP POLICY IF EXISTS "Org staff insert projects" ON public.projects;
CREATE POLICY "Org staff insert projects" ON public.projects FOR INSERT
  WITH CHECK (organization_id = current_org_id() AND (
              has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'org_owner') OR has_role(auth.uid(), 'accountant')
              OR has_role(auth.uid(), 'yard_operator') OR has_role(auth.uid(), 'sales_manager') OR has_role(auth.uid(), 'production_manager')));
DROP POLICY IF EXISTS "Org staff update projects" ON public.projects;
CREATE POLICY "Org staff update projects" ON public.projects FOR UPDATE
  USING (is_platform_admin() OR (organization_id = current_org_id() AND (
         has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'org_owner') OR has_role(auth.uid(), 'accountant')
         OR has_role(auth.uid(), 'yard_operator') OR has_role(auth.uid(), 'sales_manager') OR has_role(auth.uid(), 'production_manager'))));
