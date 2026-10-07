
-- 1. Extend account_type enum with equity
DO $$ BEGIN
  ALTER TYPE public.account_type ADD VALUE IF NOT EXISTS 'equity';
EXCEPTION WHEN others THEN NULL; END $$;

-- 2. Chart of Accounts
CREATE TABLE IF NOT EXISTS public.gl_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  code text NOT NULL,
  name text NOT NULL,
  account_type public.account_type NOT NULL,
  parent_id uuid REFERENCES public.gl_accounts(id) ON DELETE SET NULL,
  currency text NOT NULL DEFAULT 'USD',
  is_active boolean NOT NULL DEFAULT true,
  is_system boolean NOT NULL DEFAULT false,
  system_code text,
  description text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, code)
);
CREATE INDEX IF NOT EXISTS gl_accounts_org_type_idx ON public.gl_accounts(organization_id, account_type);
ALTER TABLE public.gl_accounts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "gl_accounts_select" ON public.gl_accounts;
DROP POLICY IF EXISTS "gl_accounts_insert" ON public.gl_accounts;
DROP POLICY IF EXISTS "gl_accounts_update" ON public.gl_accounts;
DROP POLICY IF EXISTS "gl_accounts_delete" ON public.gl_accounts;
CREATE POLICY "gl_accounts_select" ON public.gl_accounts FOR SELECT
  USING (organization_id = public.current_org_id() OR public.is_platform_admin());
CREATE POLICY "gl_accounts_insert" ON public.gl_accounts FOR INSERT
  WITH CHECK (organization_id = public.current_org_id());
CREATE POLICY "gl_accounts_update" ON public.gl_accounts FOR UPDATE
  USING (organization_id = public.current_org_id() AND NOT is_system);
CREATE POLICY "gl_accounts_delete" ON public.gl_accounts FOR DELETE
  USING (organization_id = public.current_org_id() AND NOT is_system);

-- 3. Fiscal periods
CREATE TABLE IF NOT EXISTS public.fiscal_periods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  year int NOT NULL,
  month int NOT NULL CHECK (month BETWEEN 1 AND 12),
  start_date date NOT NULL,
  end_date date NOT NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed','locked')),
  closed_at timestamptz,
  closed_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, year, month)
);
CREATE INDEX IF NOT EXISTS fiscal_periods_org_idx ON public.fiscal_periods(organization_id, year, month);
ALTER TABLE public.fiscal_periods ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "fiscal_periods_select" ON public.fiscal_periods;
DROP POLICY IF EXISTS "fiscal_periods_insert" ON public.fiscal_periods;
DROP POLICY IF EXISTS "fiscal_periods_update" ON public.fiscal_periods;
CREATE POLICY "fiscal_periods_select" ON public.fiscal_periods FOR SELECT
  USING (organization_id = public.current_org_id() OR public.is_platform_admin());
CREATE POLICY "fiscal_periods_insert" ON public.fiscal_periods FOR INSERT
  WITH CHECK (organization_id = public.current_org_id());
CREATE POLICY "fiscal_periods_update" ON public.fiscal_periods FOR UPDATE
  USING (organization_id = public.current_org_id());

-- 4. Add gl_account_id + journal grouping to base ledger table
ALTER TABLE public.accounting_transactions
  ADD COLUMN IF NOT EXISTS gl_account_id uuid REFERENCES public.gl_accounts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS journal_id uuid,
  ADD COLUMN IF NOT EXISTS currency text;
CREATE INDEX IF NOT EXISTS at_gl_account_idx ON public.accounting_transactions(gl_account_id);
CREATE INDEX IF NOT EXISTS at_journal_idx ON public.accounting_transactions(journal_id);

-- 5. Seed default chart of accounts for an org (idempotent)
CREATE OR REPLACE FUNCTION public.ensure_default_coa(_org_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_currency text;
  existing int;
BEGIN
  SELECT COUNT(*) INTO existing FROM public.gl_accounts WHERE organization_id = _org_id;
  IF existing > 0 THEN RETURN; END IF;

  SELECT COALESCE(currency, 'USD') INTO v_currency FROM public.organizations WHERE id = _org_id;
  IF v_currency IS NULL THEN v_currency := 'USD'; END IF;

  INSERT INTO public.gl_accounts (organization_id, code, name, account_type, currency, is_system, system_code) VALUES
    (_org_id, '1000', 'Cash on Hand', 'asset', v_currency, true, 'cash'),
    (_org_id, '1010', 'Bank Accounts', 'asset', v_currency, true, 'bank'),
    (_org_id, '1100', 'Accounts Receivable', 'asset', v_currency, true, 'ar'),
    (_org_id, '1200', 'Inventory - Containers', 'asset', v_currency, true, 'inventory_containers'),
    (_org_id, '1210', 'Inventory - Materials', 'asset', v_currency, true, 'inventory_materials'),
    (_org_id, '1220', 'Work in Progress', 'asset', v_currency, true, 'wip'),
    (_org_id, '1500', 'Fixed Assets', 'asset', v_currency, true, 'fixed_assets'),
    (_org_id, '1510', 'Accumulated Depreciation', 'asset', v_currency, true, 'accumulated_depreciation'),
    (_org_id, '2000', 'Accounts Payable', 'liability', v_currency, true, 'ap'),
    (_org_id, '2010', 'Container Acquisition Payable', 'liability', v_currency, true, 'container_acquisition_payable'),
    (_org_id, '2100', 'Accrued Expenses', 'liability', v_currency, true, 'accrued_expenses'),
    (_org_id, '2200', 'VAT Payable (Output)', 'liability', v_currency, true, 'vat_output'),
    (_org_id, '2210', 'VAT Recoverable (Input)', 'liability', v_currency, true, 'vat_input'),
    (_org_id, '2300', 'Payroll Liabilities', 'liability', v_currency, true, 'payroll_liabilities'),
    (_org_id, '2400', 'Customer Deposits', 'liability', v_currency, true, 'customer_deposits'),
    (_org_id, '3000', 'Share Capital', 'equity', v_currency, true, 'share_capital'),
    (_org_id, '3100', 'Retained Earnings', 'equity', v_currency, true, 'retained_earnings'),
    (_org_id, '3200', 'Current Year Earnings', 'equity', v_currency, true, 'current_year_earnings'),
    (_org_id, '4000', 'Storage Revenue', 'revenue', v_currency, true, 'revenue_storage'),
    (_org_id, '4010', 'Handling Revenue', 'revenue', v_currency, true, 'revenue_handling'),
    (_org_id, '4020', 'Repair Revenue', 'revenue', v_currency, true, 'revenue_repair'),
    (_org_id, '4030', 'Container Sales Revenue', 'revenue', v_currency, true, 'revenue_container_sale'),
    (_org_id, '4040', 'Conversion Revenue', 'revenue', v_currency, true, 'revenue_conversion'),
    (_org_id, '4050', 'Lease Revenue', 'revenue', v_currency, true, 'revenue_lease'),
    (_org_id, '4060', 'Logistics Revenue', 'revenue', v_currency, true, 'revenue_logistics'),
    (_org_id, '4900', 'Other Income', 'revenue', v_currency, true, 'other_income'),
    (_org_id, '5000', 'Cost of Goods Sold', 'cost_of_goods', v_currency, true, 'cogs'),
    (_org_id, '5010', 'Container Acquisition Cost', 'cost_of_goods', v_currency, true, 'cogs_container_acquisition'),
    (_org_id, '5020', 'Conversion Materials', 'cost_of_goods', v_currency, true, 'cogs_conversion_materials'),
    (_org_id, '5030', 'Conversion Labour', 'cost_of_goods', v_currency, true, 'cogs_conversion_labour'),
    (_org_id, '6000', 'Salaries & Wages', 'expense', v_currency, true, 'expense_payroll'),
    (_org_id, '6100', 'Rent', 'expense', v_currency, true, 'expense_rent'),
    (_org_id, '6200', 'Utilities', 'expense', v_currency, true, 'expense_utilities'),
    (_org_id, '6300', 'Office Expenses', 'expense', v_currency, true, 'expense_office'),
    (_org_id, '6400', 'Logistics & Transport', 'expense', v_currency, true, 'expense_logistics'),
    (_org_id, '6500', 'Maintenance & Repairs', 'expense', v_currency, true, 'expense_maintenance'),
    (_org_id, '6600', 'Depreciation Expense', 'expense', v_currency, true, 'expense_depreciation'),
    (_org_id, '6700', 'Bank Charges', 'expense', v_currency, true, 'expense_bank_charges'),
    (_org_id, '6800', 'FX Gain/Loss', 'expense', v_currency, true, 'fx_gain_loss'),
    (_org_id, '6900', 'Other Expenses', 'expense', v_currency, true, 'other_expense');
END $$;

-- 6. Open a fiscal year (creates 12 monthly periods)
CREATE OR REPLACE FUNCTION public.open_fiscal_year(_year int)
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_org uuid := public.current_org_id();
  m int;
  inserted int := 0;
  s date; e date;
BEGIN
  IF v_org IS NULL THEN RAISE EXCEPTION 'No organization context'; END IF;
  FOR m IN 1..12 LOOP
    s := make_date(_year, m, 1);
    e := (s + interval '1 month - 1 day')::date;
    BEGIN
      INSERT INTO public.fiscal_periods (organization_id, year, month, start_date, end_date)
      VALUES (v_org, _year, m, s, e);
      inserted := inserted + 1;
    EXCEPTION WHEN unique_violation THEN NULL; END;
  END LOOP;
  RETURN inserted;
END $$;

-- 7. Toggle period status
CREATE OR REPLACE FUNCTION public.set_period_status(_period_id uuid, _status text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF _status NOT IN ('open','closed','locked') THEN RAISE EXCEPTION 'Invalid status'; END IF;
  UPDATE public.fiscal_periods
     SET status = _status,
         closed_at = CASE WHEN _status = 'open' THEN NULL ELSE now() END,
         closed_by = CASE WHEN _status = 'open' THEN NULL ELSE auth.uid() END
   WHERE id = _period_id
     AND organization_id = public.current_org_id();
END $$;

-- 8. Post a balanced manual journal
CREATE OR REPLACE FUNCTION public.post_journal(
  _entry_date timestamptz,
  _description text,
  _reference text,
  _currency text,
  _lines jsonb
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_org uuid := public.current_org_id();
  v_journal_id uuid := gen_random_uuid();
  v_total_debit numeric := 0;
  v_total_credit numeric := 0;
  v_period public.fiscal_periods%ROWTYPE;
  line jsonb;
  v_acct public.gl_accounts%ROWTYPE;
  v_txn_no text;
  v_seq int := 0;
BEGIN
  IF v_org IS NULL THEN RAISE EXCEPTION 'No organization context'; END IF;
  IF jsonb_typeof(_lines) <> 'array' OR jsonb_array_length(_lines) < 2 THEN
    RAISE EXCEPTION 'A journal must have at least 2 lines';
  END IF;

  SELECT * INTO v_period FROM public.fiscal_periods
   WHERE organization_id = v_org
     AND _entry_date::date BETWEEN start_date AND end_date
   LIMIT 1;
  IF v_period.id IS NULL THEN
    RAISE EXCEPTION 'No fiscal period covers %; open the period first', _entry_date::date;
  END IF;
  IF v_period.status <> 'open' THEN
    RAISE EXCEPTION 'Fiscal period % is %', to_char(_entry_date,'YYYY-MM'), v_period.status;
  END IF;

  FOR line IN SELECT * FROM jsonb_array_elements(_lines) LOOP
    v_total_debit := v_total_debit + COALESCE((line->>'debit')::numeric, 0);
    v_total_credit := v_total_credit + COALESCE((line->>'credit')::numeric, 0);
  END LOOP;
  IF round(v_total_debit, 2) <> round(v_total_credit, 2) THEN
    RAISE EXCEPTION 'Journal not balanced: debit % vs credit %', v_total_debit, v_total_credit;
  END IF;
  IF v_total_debit = 0 THEN
    RAISE EXCEPTION 'Journal totals are zero';
  END IF;

  FOR line IN SELECT * FROM jsonb_array_elements(_lines) LOOP
    v_seq := v_seq + 1;
    v_txn_no := 'JE-' || to_char(now(),'YYYYMMDD') || '-' || substr(v_journal_id::text,1,8) || '-' || v_seq;
    SELECT * INTO v_acct FROM public.gl_accounts
      WHERE id = NULLIF(line->>'gl_account_id','')::uuid AND organization_id = v_org;
    IF v_acct.id IS NULL THEN
      RAISE EXCEPTION 'Invalid gl_account_id on line %', v_seq;
    END IF;

    INSERT INTO public.accounting_transactions (
      transaction_number, transaction_date, account_type, category, description,
      debit_amount, credit_amount, reference_type, reference_id,
      organization_id, financial_account_id, project_id,
      gl_account_id, journal_id, currency
    ) VALUES (
      v_txn_no, _entry_date, v_acct.account_type,
      COALESCE(v_acct.system_code, 'manual'),
      COALESCE(line->>'description', _description),
      COALESCE((line->>'debit')::numeric, 0),
      COALESCE((line->>'credit')::numeric, 0),
      'manual_journal', v_journal_id,
      v_org,
      NULLIF(line->>'financial_account_id','')::uuid,
      NULLIF(line->>'project_id','')::uuid,
      v_acct.id, v_journal_id, _currency
    );
  END LOOP;

  RETURN v_journal_id;
END $$;

-- 9. Account balances view
CREATE OR REPLACE VIEW public.v_account_balances AS
SELECT
  a.id AS gl_account_id,
  a.organization_id,
  a.code,
  a.name,
  a.account_type,
  a.currency,
  COALESCE(SUM(t.debit_amount),0) AS total_debit,
  COALESCE(SUM(t.credit_amount),0) AS total_credit,
  CASE WHEN a.account_type IN ('asset','expense','cost_of_goods')
       THEN COALESCE(SUM(t.debit_amount),0) - COALESCE(SUM(t.credit_amount),0)
       ELSE COALESCE(SUM(t.credit_amount),0) - COALESCE(SUM(t.debit_amount),0)
  END AS balance
FROM public.gl_accounts a
LEFT JOIN public.accounting_transactions t
  ON t.gl_account_id = a.id AND t.organization_id = a.organization_id
GROUP BY a.id;
