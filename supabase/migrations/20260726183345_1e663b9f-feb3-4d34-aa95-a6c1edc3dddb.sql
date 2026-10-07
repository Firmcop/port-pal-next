-- ============ 1. BUDGETS: category / depot dimensions ============
ALTER TABLE public.budgets
  ADD COLUMN IF NOT EXISTS category_id uuid REFERENCES public.expense_categories(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS depot_id uuid REFERENCES public.depots(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS budgets_org_period_account_dims_uniq
  ON public.budgets (organization_id, period_id, gl_account_id,
    COALESCE(depot_id, '00000000-0000-0000-0000-000000000000'::uuid),
    COALESCE(project_id, '00000000-0000-0000-0000-000000000000'::uuid));

-- Ensure the 12 monthly fiscal periods of a year exist
CREATE OR REPLACE FUNCTION public.ensure_fiscal_year(_year integer)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_org uuid := public.current_org_id(); m int; v_created int := 0;
BEGIN
  IF v_org IS NULL THEN RAISE EXCEPTION 'No organization context'; END IF;
  IF _year < 2000 OR _year > 2100 THEN RAISE EXCEPTION 'Invalid year'; END IF;
  FOR m IN 1..12 LOOP
    IF NOT EXISTS (SELECT 1 FROM public.fiscal_periods p
                   WHERE p.organization_id = v_org AND p.year = _year AND p.month = m) THEN
      INSERT INTO public.fiscal_periods (organization_id, year, month, start_date, end_date, status)
      VALUES (v_org, _year, m,
              make_date(_year, m, 1),
              (make_date(_year, m, 1) + interval '1 month - 1 day')::date,
              'open');
      v_created := v_created + 1;
    END IF;
  END LOOP;
  RETURN v_created;
END $$;
REVOKE ALL ON FUNCTION public.ensure_fiscal_year(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ensure_fiscal_year(integer) TO authenticated;

-- Set / clear a single monthly budget target
CREATE OR REPLACE FUNCTION public.set_opex_budget(
  _year integer, _month integer, _gl_account_id uuid, _amount numeric,
  _category_id uuid DEFAULT NULL, _depot_id uuid DEFAULT NULL, _project_id uuid DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_org uuid := public.current_org_id(); v_period uuid; v_id uuid;
BEGIN
  IF v_org IS NULL THEN RAISE EXCEPTION 'No organization context'; END IF;
  IF NOT (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'org_owner')
          OR public.is_platform_admin()
          OR public.has_permission(auth.uid(),'accounting','edit')) THEN
    RAISE EXCEPTION 'Not authorized to edit budgets';
  END IF;

  SELECT id INTO v_period FROM public.fiscal_periods
   WHERE organization_id = v_org AND year = _year AND month = _month;
  IF v_period IS NULL THEN
    INSERT INTO public.fiscal_periods (organization_id, year, month, start_date, end_date, status)
    VALUES (v_org, _year, _month, make_date(_year,_month,1),
            (make_date(_year,_month,1) + interval '1 month - 1 day')::date, 'open')
    RETURNING id INTO v_period;
  END IF;

  SELECT id INTO v_id FROM public.budgets
   WHERE organization_id = v_org AND period_id = v_period AND gl_account_id = _gl_account_id
     AND COALESCE(depot_id,'00000000-0000-0000-0000-000000000000'::uuid)
         = COALESCE(_depot_id,'00000000-0000-0000-0000-000000000000'::uuid)
     AND COALESCE(project_id,'00000000-0000-0000-0000-000000000000'::uuid)
         = COALESCE(_project_id,'00000000-0000-0000-0000-000000000000'::uuid);

  IF v_id IS NULL THEN
    IF COALESCE(_amount,0) = 0 THEN RETURN NULL; END IF;
    INSERT INTO public.budgets (organization_id, gl_account_id, category_id, depot_id, project_id, period_id, amount)
    VALUES (v_org, _gl_account_id, _category_id, _depot_id, _project_id, v_period, _amount)
    RETURNING id INTO v_id;
  ELSIF COALESCE(_amount,0) = 0 THEN
    DELETE FROM public.budgets WHERE id = v_id;
    RETURN NULL;
  ELSE
    UPDATE public.budgets
       SET amount = _amount, category_id = COALESCE(_category_id, category_id), updated_at = now()
     WHERE id = v_id;
  END IF;
  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public.set_opex_budget(integer,integer,uuid,numeric,uuid,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_opex_budget(integer,integer,uuid,numeric,uuid,uuid,uuid) TO authenticated;

-- Monthly OPEX budget vs actual, long format (one row per account per month)
CREATE OR REPLACE FUNCTION public.opex_budget_vs_actual(
  _year integer, _depot_id uuid DEFAULT NULL, _project_id uuid DEFAULT NULL)
RETURNS TABLE(
  gl_account_id uuid, code text, name text, account_type text,
  category_id uuid, category_name text, month integer,
  budget_amount numeric, actual_amount numeric, variance_amount numeric, variance_pct numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  WITH org AS (SELECT public.current_org_id() AS id),
  acc AS (
    SELECT a.id, a.code, a.name, a.account_type::text AS account_type,
           c.id AS category_id, c.name AS category_name
      FROM public.gl_accounts a
      LEFT JOIN LATERAL (
        SELECT ec.id, ec.name FROM public.expense_categories ec
         WHERE ec.gl_account_id = a.id AND ec.organization_id = a.organization_id
         ORDER BY ec.sort_order NULLS LAST, ec.name LIMIT 1) c ON true
     WHERE a.organization_id = (SELECT id FROM org)
       AND a.account_type::text IN ('expense','cost_of_goods')
  ),
  months AS (SELECT generate_series(1,12) AS m),
  bud AS (
    SELECT b.gl_account_id, p.month AS m, SUM(b.amount) AS amt
      FROM public.budgets b
      JOIN public.fiscal_periods p ON p.id = b.period_id
     WHERE b.organization_id = (SELECT id FROM org) AND p.year = _year
       AND (_depot_id IS NULL OR b.depot_id = _depot_id)
       AND (_project_id IS NULL OR b.project_id = _project_id)
     GROUP BY 1,2
  ),
  act AS (
    SELECT t.gl_account_id, EXTRACT(MONTH FROM t.transaction_date)::int AS m,
           SUM(t.debit_amount - t.credit_amount) AS amt
      FROM public.accounting_transactions t
     WHERE t.organization_id = (SELECT id FROM org)
       AND EXTRACT(YEAR FROM t.transaction_date)::int = _year
       AND (_depot_id IS NULL OR t.depot_id = _depot_id)
       AND (_project_id IS NULL OR t.project_id = _project_id)
     GROUP BY 1,2
  )
  SELECT acc.id, acc.code, acc.name, acc.account_type, acc.category_id, acc.category_name, months.m,
         COALESCE(bud.amt,0)::numeric,
         COALESCE(act.amt,0)::numeric,
         (COALESCE(bud.amt,0) - COALESCE(act.amt,0))::numeric,
         CASE WHEN COALESCE(bud.amt,0) = 0 THEN NULL
              ELSE ROUND(((COALESCE(act.amt,0) - bud.amt) / bud.amt) * 100, 2) END
    FROM acc
    CROSS JOIN months
    LEFT JOIN bud ON bud.gl_account_id = acc.id AND bud.m = months.m
    LEFT JOIN act ON act.gl_account_id = acc.id AND act.m = months.m
   ORDER BY acc.code, months.m;
$$;
REVOKE ALL ON FUNCTION public.opex_budget_vs_actual(integer,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.opex_budget_vs_actual(integer,uuid,uuid) TO authenticated;

-- ============ 2. RECURRING OPERATING EXPENSES ============
CREATE TABLE IF NOT EXISTS public.recurring_expense_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  name text NOT NULL,
  supplier_id uuid REFERENCES public.suppliers(id) ON DELETE SET NULL,
  payee text,
  payment_mode text NOT NULL DEFAULT 'credit' CHECK (payment_mode IN ('paid','credit')),
  financial_account_id uuid REFERENCES public.financial_accounts(id) ON DELETE SET NULL,
  currency text,
  depot_id uuid REFERENCES public.depots(id) ON DELETE SET NULL,
  project_id uuid REFERENCES public.projects(id) ON DELETE SET NULL,
  reference text,
  notes text,
  frequency text NOT NULL DEFAULT 'monthly' CHECK (frequency IN ('monthly','quarterly','annual')),
  interval_count integer NOT NULL DEFAULT 1 CHECK (interval_count BETWEEN 1 AND 12),
  day_of_month integer NOT NULL DEFAULT 1 CHECK (day_of_month BETWEEN 1 AND 28),
  due_days integer NOT NULL DEFAULT 30 CHECK (due_days BETWEEN 0 AND 365),
  start_date date NOT NULL DEFAULT CURRENT_DATE,
  end_date date,
  next_run_date date NOT NULL DEFAULT CURRENT_DATE,
  auto_submit boolean NOT NULL DEFAULT true,
  is_active boolean NOT NULL DEFAULT true,
  last_run_at timestamptz,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.recurring_expense_templates TO authenticated;
GRANT ALL ON public.recurring_expense_templates TO service_role;
ALTER TABLE public.recurring_expense_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ret_select" ON public.recurring_expense_templates FOR SELECT TO authenticated
  USING (organization_id = public.current_org_id() OR public.is_platform_admin());
CREATE POLICY "ret_manage" ON public.recurring_expense_templates FOR ALL TO authenticated
  USING (organization_id = public.current_org_id()
         AND (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'org_owner')
              OR public.is_platform_admin() OR public.has_permission(auth.uid(),'accounting','edit')))
  WITH CHECK (organization_id = public.current_org_id()
         AND (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'org_owner')
              OR public.is_platform_admin() OR public.has_permission(auth.uid(),'accounting','edit')));
CREATE TRIGGER trg_ret_updated BEFORE UPDATE ON public.recurring_expense_templates
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_ret_currency BEFORE INSERT ON public.recurring_expense_templates
  FOR EACH ROW EXECUTE FUNCTION public.set_currency_from_org();

CREATE TABLE IF NOT EXISTS public.recurring_expense_template_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  template_id uuid NOT NULL REFERENCES public.recurring_expense_templates(id) ON DELETE CASCADE,
  category_id uuid REFERENCES public.expense_categories(id) ON DELETE SET NULL,
  gl_account_id uuid NOT NULL REFERENCES public.gl_accounts(id),
  description text,
  amount numeric NOT NULL DEFAULT 0 CHECK (amount >= 0),
  tax_code_id uuid REFERENCES public.tax_codes(id) ON DELETE SET NULL,
  project_id uuid REFERENCES public.projects(id) ON DELETE SET NULL,
  depot_id uuid REFERENCES public.depots(id) ON DELETE SET NULL,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.recurring_expense_template_lines TO authenticated;
GRANT ALL ON public.recurring_expense_template_lines TO service_role;
ALTER TABLE public.recurring_expense_template_lines ENABLE ROW LEVEL SECURITY;
CREATE POLICY "retl_select" ON public.recurring_expense_template_lines FOR SELECT TO authenticated
  USING (organization_id = public.current_org_id() OR public.is_platform_admin());
CREATE POLICY "retl_manage" ON public.recurring_expense_template_lines FOR ALL TO authenticated
  USING (organization_id = public.current_org_id()
         AND (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'org_owner')
              OR public.is_platform_admin() OR public.has_permission(auth.uid(),'accounting','edit')))
  WITH CHECK (organization_id = public.current_org_id()
         AND (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'org_owner')
              OR public.is_platform_admin() OR public.has_permission(auth.uid(),'accounting','edit')));
CREATE TRIGGER trg_retl_updated BEFORE UPDATE ON public.recurring_expense_template_lines
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE IF NOT EXISTS public.recurring_expense_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  template_id uuid NOT NULL REFERENCES public.recurring_expense_templates(id) ON DELETE CASCADE,
  period_key text NOT NULL,
  run_date date NOT NULL DEFAULT CURRENT_DATE,
  expense_id uuid REFERENCES public.operating_expenses(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'created',
  message text,
  triggered_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS recurring_expense_runs_template_period_uniq
  ON public.recurring_expense_runs (template_id, period_key);
GRANT SELECT, INSERT ON public.recurring_expense_runs TO authenticated;
GRANT ALL ON public.recurring_expense_runs TO service_role;
ALTER TABLE public.recurring_expense_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "rer_select" ON public.recurring_expense_runs FOR SELECT TO authenticated
  USING (organization_id = public.current_org_id() OR public.is_platform_admin());
CREATE POLICY "rer_insert" ON public.recurring_expense_runs FOR INSERT TO authenticated
  WITH CHECK (organization_id = public.current_org_id()
         AND (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'org_owner')
              OR public.is_platform_admin() OR public.has_permission(auth.uid(),'accounting','edit')));

-- internal: build one operating expense from a template
CREATE OR REPLACE FUNCTION public._create_expense_from_template(_template_id uuid, _run_date date)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  t public.recurring_expense_templates%ROWTYPE;
  v_id uuid := gen_random_uuid();
  v_number text;
  v_sub numeric := 0; v_tax numeric := 0; v_line_tax numeric;
  l record; v_rate numeric;
BEGIN
  SELECT * INTO t FROM public.recurring_expense_templates WHERE id = _template_id;
  IF t.id IS NULL THEN RAISE EXCEPTION 'Template not found'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.recurring_expense_template_lines WHERE template_id = t.id) THEN
    RAISE EXCEPTION 'Template % has no lines', t.name;
  END IF;

  SELECT public.next_operating_expense_number() INTO v_number;

  INSERT INTO public.operating_expenses (
    id, organization_id, expense_number, expense_date, supplier_id, payee, payment_mode,
    financial_account_id, due_date, currency, fx_rate, depot_id, project_id, reference, notes,
    status, approval_status, created_by, submitted_by, submitted_at
  ) VALUES (
    v_id, t.organization_id, v_number, _run_date, t.supplier_id, t.payee, t.payment_mode,
    CASE WHEN t.payment_mode = 'paid' THEN t.financial_account_id ELSE NULL END,
    CASE WHEN t.payment_mode = 'credit' THEN (_run_date + t.due_days) ELSE NULL END,
    COALESCE(t.currency, (SELECT currency FROM public.organizations WHERE id = t.organization_id), 'USD'),
    1, t.depot_id, t.project_id,
    COALESCE(t.reference, t.name),
    COALESCE(t.notes,'') || CASE WHEN t.notes IS NULL THEN '' ELSE E'\n' END
      || 'Generated from recurring template: ' || t.name,
    'draft',
    CASE WHEN t.auto_submit THEN 'submitted' ELSE 'draft' END,
    t.created_by,
    CASE WHEN t.auto_submit THEN t.created_by ELSE NULL END,
    CASE WHEN t.auto_submit THEN now() ELSE NULL END
  );

  FOR l IN SELECT * FROM public.recurring_expense_template_lines
            WHERE template_id = t.id ORDER BY sort_order, created_at LOOP
    SELECT COALESCE(rate,0) INTO v_rate FROM public.tax_codes WHERE id = l.tax_code_id;
    v_line_tax := ROUND(l.amount * COALESCE(v_rate,0) / 100.0, 2);
    INSERT INTO public.operating_expense_lines (
      organization_id, expense_id, gl_account_id, category_id, description, amount,
      tax_code_id, tax_amount, project_id, depot_id
    ) VALUES (
      t.organization_id, v_id, l.gl_account_id, l.category_id,
      COALESCE(l.description, t.name), l.amount, l.tax_code_id, v_line_tax,
      COALESCE(l.project_id, t.project_id), COALESCE(l.depot_id, t.depot_id)
    );
    v_sub := v_sub + l.amount;
    v_tax := v_tax + v_line_tax;
  END LOOP;

  UPDATE public.operating_expenses
     SET subtotal = v_sub, tax_amount = v_tax, total_amount = v_sub + v_tax
   WHERE id = v_id;

  INSERT INTO public.finance_audit_log (organization_id, actor_user_id, entity_type, entity_id, entity_ref, action, summary)
  VALUES (t.organization_id, auth.uid(), 'operating_expense', v_id, v_number, 'created',
          jsonb_build_object('source','recurring_template','template', t.name, 'total', v_sub + v_tax));

  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public._create_expense_from_template(uuid,date) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public._advance_recurring_expense_template(_template_id uuid)
RETURNS date
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE t public.recurring_expense_templates%ROWTYPE; v_next date; v_step interval;
BEGIN
  SELECT * INTO t FROM public.recurring_expense_templates WHERE id = _template_id;
  v_step := CASE t.frequency
              WHEN 'monthly' THEN make_interval(months => t.interval_count)
              WHEN 'quarterly' THEN make_interval(months => 3 * t.interval_count)
              ELSE make_interval(years => t.interval_count) END;
  v_next := (date_trunc('month', t.next_run_date + v_step)
             + make_interval(days => t.day_of_month - 1))::date;
  UPDATE public.recurring_expense_templates
     SET next_run_date = v_next,
         last_run_at = now(),
         is_active = CASE WHEN t.end_date IS NOT NULL AND v_next > t.end_date THEN false ELSE is_active END
   WHERE id = t.id;
  RETURN v_next;
END $$;
REVOKE ALL ON FUNCTION public._advance_recurring_expense_template(uuid) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.generate_due_recurring_expenses(_org_id uuid DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE t record; v_key text; v_expense uuid; v_count int := 0;
BEGIN
  FOR t IN SELECT * FROM public.recurring_expense_templates
            WHERE is_active
              AND next_run_date <= CURRENT_DATE
              AND start_date <= CURRENT_DATE
              AND (end_date IS NULL OR next_run_date <= end_date)
              AND (_org_id IS NULL OR organization_id = _org_id)
  LOOP
    v_key := to_char(t.next_run_date, 'YYYY-MM');
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
      VALUES (t.organization_id, t.id, v_key, t.next_run_date, 'failed', SQLERRM);
    END;
    PERFORM public._advance_recurring_expense_template(t.id);
  END LOOP;
  RETURN v_count;
END $$;
REVOKE ALL ON FUNCTION public.generate_due_recurring_expenses(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.generate_due_recurring_expenses(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.run_recurring_expense_now(_template_id uuid)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_org uuid := public.current_org_id();
  t public.recurring_expense_templates%ROWTYPE;
  v_key text; v_expense uuid;
BEGIN
  IF NOT (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'org_owner')
          OR public.is_platform_admin() OR public.has_permission(auth.uid(),'accounting','create')) THEN
    RAISE EXCEPTION 'Not authorized to generate expenses';
  END IF;
  SELECT * INTO t FROM public.recurring_expense_templates
   WHERE id = _template_id AND organization_id = v_org;
  IF t.id IS NULL THEN RAISE EXCEPTION 'Template not found'; END IF;

  v_key := to_char(t.next_run_date, 'YYYY-MM');
  IF EXISTS (SELECT 1 FROM public.recurring_expense_runs r
              WHERE r.template_id = t.id AND r.period_key = v_key AND r.status = 'created') THEN
    RAISE EXCEPTION 'An expense was already generated for %', v_key;
  END IF;

  v_expense := public._create_expense_from_template(t.id, GREATEST(t.next_run_date, t.start_date));
  INSERT INTO public.recurring_expense_runs (organization_id, template_id, period_key, run_date, expense_id, status, triggered_by)
  VALUES (t.organization_id, t.id, v_key, CURRENT_DATE, v_expense, 'created', auth.uid())
  ON CONFLICT (template_id, period_key) DO UPDATE
    SET expense_id = EXCLUDED.expense_id, status = 'created', message = NULL;
  PERFORM public._advance_recurring_expense_template(t.id);
  RETURN v_expense;
END $$;
REVOKE ALL ON FUNCTION public.run_recurring_expense_now(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.run_recurring_expense_now(uuid) TO authenticated;

-- ============ 3. ATTACHMENT EXTRACTION METADATA ============
ALTER TABLE public.operating_expense_attachments
  ADD COLUMN IF NOT EXISTS extracted_data jsonb,
  ADD COLUMN IF NOT EXISTS extracted_at timestamptz,
  ADD COLUMN IF NOT EXISTS extraction_status text,
  ADD COLUMN IF NOT EXISTS extraction_model text;

-- ============ 4. SETTLEMENT ============
ALTER TABLE public.financial_accounts
  ADD COLUMN IF NOT EXISTS gl_account_id uuid REFERENCES public.gl_accounts(id) ON DELETE SET NULL;

CREATE OR REPLACE FUNCTION public.pay_operating_expense(
  _expense_id uuid, _financial_account_id uuid, _amount numeric, _payment_date date DEFAULT CURRENT_DATE)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_org uuid := public.current_org_id();
  e public.operating_expenses%ROWTYPE;
  v_ap public.gl_accounts%ROWTYPE;
  v_cash public.gl_accounts%ROWTYPE;
  v_mapped uuid;
  v_journal uuid := gen_random_uuid();
  v_outstanding numeric;
BEGIN
  IF NOT (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'org_owner') OR public.is_platform_admin()) THEN
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

  SELECT * INTO v_ap FROM public.gl_accounts
    WHERE organization_id = v_org AND system_code = 'ap' AND is_active LIMIT 1;

  SELECT gl_account_id INTO v_mapped FROM public.financial_accounts
   WHERE id = _financial_account_id AND organization_id = v_org;
  IF v_mapped IS NOT NULL THEN
    SELECT * INTO v_cash FROM public.gl_accounts WHERE id = v_mapped AND organization_id = v_org;
  END IF;
  IF v_cash.id IS NULL THEN
    SELECT * INTO v_cash FROM public.gl_accounts
      WHERE organization_id = v_org AND system_code IN ('bank','cash') AND is_active
      ORDER BY CASE system_code WHEN 'bank' THEN 0 ELSE 1 END LIMIT 1;
  END IF;
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
          jsonb_build_object('amount', _amount, 'financial_account_id', _financial_account_id));
END $$;
REVOKE ALL ON FUNCTION public.pay_operating_expense(uuid,uuid,numeric,date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pay_operating_expense(uuid,uuid,numeric,date) TO authenticated;

CREATE OR REPLACE FUNCTION public.settle_operating_expenses(
  _expense_ids uuid[], _financial_account_id uuid,
  _payment_date date DEFAULT CURRENT_DATE, _reference text DEFAULT NULL)
RETURNS numeric
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_org uuid := public.current_org_id();
  e record; v_total numeric := 0; v_out numeric;
BEGIN
  IF _expense_ids IS NULL OR array_length(_expense_ids,1) IS NULL THEN
    RAISE EXCEPTION 'Select at least one bill to settle';
  END IF;
  FOR e IN SELECT * FROM public.operating_expenses
            WHERE id = ANY(_expense_ids) AND organization_id = v_org
  LOOP
    v_out := round(e.total_amount - e.amount_paid, 2);
    IF v_out > 0 THEN
      PERFORM public.pay_operating_expense(e.id, _financial_account_id, v_out, _payment_date);
      v_total := v_total + v_out;
      IF _reference IS NOT NULL THEN
        UPDATE public.operating_expenses
           SET notes = COALESCE(notes,'') || E'\nSettled: ' || _reference
         WHERE id = e.id;
      END IF;
    END IF;
  END LOOP;
  RETURN v_total;
END $$;
REVOKE ALL ON FUNCTION public.settle_operating_expenses(uuid[],uuid,date,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.settle_operating_expenses(uuid[],uuid,date,text) TO authenticated;

-- Reconcile OPEX register against the income statement for a date range
CREATE OR REPLACE FUNCTION public.opex_pl_reconciliation(_from date, _to date)
RETURNS TABLE(metric text, label text, amount numeric, count_value integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  WITH org AS (SELECT public.current_org_id() AS id),
  approved AS (
    SELECT COALESCE(SUM(total_amount),0) amt, COUNT(*)::int cnt
      FROM public.operating_expenses
     WHERE organization_id = (SELECT id FROM org)
       AND expense_date BETWEEN _from AND _to
       AND approval_status = 'approved' AND reversed_at IS NULL
  ),
  pending AS (
    SELECT COALESCE(SUM(total_amount),0) amt, COUNT(*)::int cnt
      FROM public.operating_expenses
     WHERE organization_id = (SELECT id FROM org)
       AND expense_date BETWEEN _from AND _to
       AND approval_status IN ('draft','submitted')
  ),
  reversed AS (
    SELECT COALESCE(SUM(total_amount),0) amt, COUNT(*)::int cnt
      FROM public.operating_expenses
     WHERE organization_id = (SELECT id FROM org)
       AND expense_date BETWEEN _from AND _to AND reversed_at IS NOT NULL
  ),
  ledger AS (
    SELECT COALESCE(SUM(t.debit_amount - t.credit_amount),0) amt, COUNT(*)::int cnt
      FROM public.accounting_transactions t
      JOIN public.gl_accounts a ON a.id = t.gl_account_id
     WHERE t.organization_id = (SELECT id FROM org)
       AND t.transaction_date BETWEEN _from AND _to
       AND a.account_type::text IN ('expense','cost_of_goods')
  ),
  from_opex AS (
    SELECT COALESCE(SUM(t.debit_amount - t.credit_amount),0) amt, COUNT(*)::int cnt
      FROM public.accounting_transactions t
      JOIN public.gl_accounts a ON a.id = t.gl_account_id
     WHERE t.organization_id = (SELECT id FROM org)
       AND t.transaction_date BETWEEN _from AND _to
       AND a.account_type::text IN ('expense','cost_of_goods')
       AND t.reference_type = 'operating_expense'
  )
  SELECT 'opex_approved', 'Approved OPEX documents', approved.amt, approved.cnt FROM approved
  UNION ALL SELECT 'opex_pending', 'Drafts / awaiting approval (not in P&L)', pending.amt, pending.cnt FROM pending
  UNION ALL SELECT 'opex_reversed', 'Reversed documents', reversed.amt, reversed.cnt FROM reversed
  UNION ALL SELECT 'ledger_expense', 'P&L expense + COGS total', ledger.amt, ledger.cnt FROM ledger
  UNION ALL SELECT 'ledger_from_opex', 'P&L lines sourced from OPEX', from_opex.amt, from_opex.cnt FROM from_opex
  UNION ALL SELECT 'ledger_other_sources', 'P&L lines from other modules',
                   (SELECT amt FROM ledger) - (SELECT amt FROM from_opex),
                   (SELECT cnt FROM ledger) - (SELECT cnt FROM from_opex);
$$;
REVOKE ALL ON FUNCTION public.opex_pl_reconciliation(date,date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.opex_pl_reconciliation(date,date) TO authenticated;