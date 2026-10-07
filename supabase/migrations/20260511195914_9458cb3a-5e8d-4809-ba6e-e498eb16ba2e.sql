
-- =====================================================================
-- Finance module: accounts, transfers, reconciliations, projects
-- =====================================================================

-- Enums
DO $$ BEGIN
  CREATE TYPE public.financial_account_type AS ENUM ('bank','cash','mobile_money','credit_card','other');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.bank_reconciliation_status AS ENUM ('in_progress','completed','voided');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.project_status AS ENUM ('active','on_hold','completed','archived');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============= financial_accounts =============
CREATE TABLE public.financial_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL DEFAULT current_org_id() REFERENCES public.organizations(id),
  name text NOT NULL,
  account_type public.financial_account_type NOT NULL DEFAULT 'bank',
  currency text NOT NULL DEFAULT 'USD',
  opening_balance numeric(14,2) NOT NULL DEFAULT 0,
  opening_balance_date date NOT NULL DEFAULT CURRENT_DATE,
  bank_name text,
  account_number text,
  branch text,
  swift_bic text,
  is_active boolean NOT NULL DEFAULT true,
  is_default boolean NOT NULL DEFAULT false,
  notes text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_financial_accounts_org ON public.financial_accounts(organization_id);
ALTER TABLE public.financial_accounts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org members view financial_accounts" ON public.financial_accounts
  FOR SELECT USING (is_platform_admin() OR (organization_id = current_org_id() AND
    (has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'yard_operator'::app_role)
     OR has_role(auth.uid(),'gate_clerk'::app_role) OR has_role(auth.uid(),'viewer'::app_role))));
CREATE POLICY "Org staff insert financial_accounts" ON public.financial_accounts
  FOR INSERT WITH CHECK (organization_id = current_org_id() AND
    (has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'yard_operator'::app_role)));
CREATE POLICY "Org staff update financial_accounts" ON public.financial_accounts
  FOR UPDATE USING (is_platform_admin() OR (organization_id = current_org_id() AND
    (has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'yard_operator'::app_role))));
CREATE POLICY "Org admins delete financial_accounts" ON public.financial_accounts
  FOR DELETE USING (is_platform_admin() OR (organization_id = current_org_id() AND has_role(auth.uid(),'admin'::app_role)));

CREATE TRIGGER trg_financial_accounts_updated
  BEFORE UPDATE ON public.financial_accounts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============= projects =============
CREATE TABLE public.projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL DEFAULT current_org_id() REFERENCES public.organizations(id),
  code text NOT NULL,
  name text NOT NULL,
  customer_id uuid REFERENCES public.customers(id),
  status public.project_status NOT NULL DEFAULT 'active',
  start_date date,
  end_date date,
  budget_amount numeric(14,2) NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'USD',
  description text,
  manager_user_id uuid,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, code)
);
CREATE INDEX idx_projects_org ON public.projects(organization_id);
CREATE INDEX idx_projects_customer ON public.projects(customer_id);
ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org members view projects" ON public.projects
  FOR SELECT USING (is_platform_admin() OR (organization_id = current_org_id() AND
    (has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'yard_operator'::app_role)
     OR has_role(auth.uid(),'gate_clerk'::app_role) OR has_role(auth.uid(),'viewer'::app_role))));
CREATE POLICY "Org staff insert projects" ON public.projects
  FOR INSERT WITH CHECK (organization_id = current_org_id() AND
    (has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'yard_operator'::app_role)));
CREATE POLICY "Org staff update projects" ON public.projects
  FOR UPDATE USING (is_platform_admin() OR (organization_id = current_org_id() AND
    (has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'yard_operator'::app_role))));
CREATE POLICY "Org admins delete projects" ON public.projects
  FOR DELETE USING (is_platform_admin() OR (organization_id = current_org_id() AND has_role(auth.uid(),'admin'::app_role)));

CREATE TRIGGER trg_projects_updated
  BEFORE UPDATE ON public.projects
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============= bank_reconciliations =============
CREATE TABLE public.bank_reconciliations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL DEFAULT current_org_id() REFERENCES public.organizations(id),
  account_id uuid NOT NULL REFERENCES public.financial_accounts(id) ON DELETE RESTRICT,
  statement_start date NOT NULL,
  statement_end date NOT NULL,
  statement_opening_balance numeric(14,2) NOT NULL DEFAULT 0,
  statement_closing_balance numeric(14,2) NOT NULL DEFAULT 0,
  status public.bank_reconciliation_status NOT NULL DEFAULT 'in_progress',
  notes text,
  completed_at timestamptz,
  completed_by uuid,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_bank_recon_org ON public.bank_reconciliations(organization_id);
CREATE INDEX idx_bank_recon_account ON public.bank_reconciliations(account_id);
ALTER TABLE public.bank_reconciliations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org members view bank_reconciliations" ON public.bank_reconciliations
  FOR SELECT USING (is_platform_admin() OR (organization_id = current_org_id() AND
    (has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'yard_operator'::app_role)
     OR has_role(auth.uid(),'gate_clerk'::app_role) OR has_role(auth.uid(),'viewer'::app_role))));
CREATE POLICY "Org staff manage bank_reconciliations" ON public.bank_reconciliations
  FOR ALL USING (is_platform_admin() OR (organization_id = current_org_id() AND
    (has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'yard_operator'::app_role))))
  WITH CHECK (organization_id = current_org_id() AND
    (has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'yard_operator'::app_role)));

CREATE TRIGGER trg_bank_recon_updated
  BEFORE UPDATE ON public.bank_reconciliations
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============= accounting_transactions extensions =============
ALTER TABLE public.accounting_transactions
  ADD COLUMN IF NOT EXISTS financial_account_id uuid REFERENCES public.financial_accounts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS project_id uuid REFERENCES public.projects(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS reconciliation_id uuid REFERENCES public.bank_reconciliations(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS cleared_at timestamptz;
CREATE INDEX IF NOT EXISTS idx_acct_txn_account ON public.accounting_transactions(financial_account_id, transaction_date);
CREATE INDEX IF NOT EXISTS idx_acct_txn_project ON public.accounting_transactions(project_id);
CREATE INDEX IF NOT EXISTS idx_acct_txn_recon ON public.accounting_transactions(reconciliation_id);

-- ============= bank_reconciliation_lines =============
CREATE TABLE public.bank_reconciliation_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL DEFAULT current_org_id() REFERENCES public.organizations(id),
  reconciliation_id uuid NOT NULL REFERENCES public.bank_reconciliations(id) ON DELETE CASCADE,
  transaction_id uuid NOT NULL REFERENCES public.accounting_transactions(id) ON DELETE CASCADE,
  cleared boolean NOT NULL DEFAULT false,
  statement_ref text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (reconciliation_id, transaction_id)
);
CREATE INDEX idx_recon_lines_org ON public.bank_reconciliation_lines(organization_id);
ALTER TABLE public.bank_reconciliation_lines ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Org members view recon_lines" ON public.bank_reconciliation_lines
  FOR SELECT USING (is_platform_admin() OR (organization_id = current_org_id() AND
    (has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'yard_operator'::app_role)
     OR has_role(auth.uid(),'gate_clerk'::app_role) OR has_role(auth.uid(),'viewer'::app_role))));
CREATE POLICY "Org staff manage recon_lines" ON public.bank_reconciliation_lines
  FOR ALL USING (is_platform_admin() OR (organization_id = current_org_id() AND
    (has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'yard_operator'::app_role))))
  WITH CHECK (organization_id = current_org_id() AND
    (has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'yard_operator'::app_role)));

-- ============= bank_statement_imports =============
CREATE TABLE public.bank_statement_imports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL DEFAULT current_org_id() REFERENCES public.organizations(id),
  reconciliation_id uuid REFERENCES public.bank_reconciliations(id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES public.financial_accounts(id) ON DELETE CASCADE,
  txn_date date NOT NULL,
  description text,
  debit_amount numeric(14,2) NOT NULL DEFAULT 0,
  credit_amount numeric(14,2) NOT NULL DEFAULT 0,
  reference text,
  matched_transaction_id uuid REFERENCES public.accounting_transactions(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_stmt_imports_account ON public.bank_statement_imports(account_id, txn_date);
ALTER TABLE public.bank_statement_imports ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Org members view stmt_imports" ON public.bank_statement_imports
  FOR SELECT USING (is_platform_admin() OR (organization_id = current_org_id() AND
    (has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'yard_operator'::app_role)
     OR has_role(auth.uid(),'gate_clerk'::app_role) OR has_role(auth.uid(),'viewer'::app_role))));
CREATE POLICY "Org staff manage stmt_imports" ON public.bank_statement_imports
  FOR ALL USING (is_platform_admin() OR (organization_id = current_org_id() AND
    (has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'yard_operator'::app_role))))
  WITH CHECK (organization_id = current_org_id() AND
    (has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'yard_operator'::app_role)));

-- ============= inter_account_transfers =============
CREATE TABLE public.inter_account_transfers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL DEFAULT current_org_id() REFERENCES public.organizations(id),
  transfer_number text NOT NULL,
  transfer_date timestamptz NOT NULL DEFAULT now(),
  from_account_id uuid NOT NULL REFERENCES public.financial_accounts(id) ON DELETE RESTRICT,
  to_account_id uuid NOT NULL REFERENCES public.financial_accounts(id) ON DELETE RESTRICT,
  amount numeric(14,2) NOT NULL CHECK (amount > 0),
  fx_rate numeric(14,6) NOT NULL DEFAULT 1,
  fees numeric(14,2) NOT NULL DEFAULT 0 CHECK (fees >= 0),
  description text,
  reference text,
  voided_at timestamptz,
  voided_by uuid,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, transfer_number),
  CHECK (from_account_id <> to_account_id)
);
CREATE INDEX idx_transfers_org ON public.inter_account_transfers(organization_id);
ALTER TABLE public.inter_account_transfers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Org members view transfers" ON public.inter_account_transfers
  FOR SELECT USING (is_platform_admin() OR (organization_id = current_org_id() AND
    (has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'yard_operator'::app_role)
     OR has_role(auth.uid(),'gate_clerk'::app_role) OR has_role(auth.uid(),'viewer'::app_role))));
CREATE POLICY "Org staff insert transfers" ON public.inter_account_transfers
  FOR INSERT WITH CHECK (organization_id = current_org_id() AND
    (has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'yard_operator'::app_role)));
CREATE POLICY "Org staff update transfers" ON public.inter_account_transfers
  FOR UPDATE USING (is_platform_admin() OR (organization_id = current_org_id() AND
    (has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'yard_operator'::app_role))));
CREATE POLICY "Org admins delete transfers" ON public.inter_account_transfers
  FOR DELETE USING (is_platform_admin() OR (organization_id = current_org_id() AND has_role(auth.uid(),'admin'::app_role)));

CREATE TRIGGER trg_transfers_updated
  BEFORE UPDATE ON public.inter_account_transfers
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============= project_id columns on related tables =============
ALTER TABLE public.invoices            ADD COLUMN IF NOT EXISTS project_id uuid REFERENCES public.projects(id) ON DELETE SET NULL;
ALTER TABLE public.payments            ADD COLUMN IF NOT EXISTS project_id uuid REFERENCES public.projects(id) ON DELETE SET NULL;
ALTER TABLE public.payments            ADD COLUMN IF NOT EXISTS financial_account_id uuid REFERENCES public.financial_accounts(id) ON DELETE SET NULL;
ALTER TABLE public.vendor_payments     ADD COLUMN IF NOT EXISTS project_id uuid REFERENCES public.projects(id) ON DELETE SET NULL;
ALTER TABLE public.vendor_payments     ADD COLUMN IF NOT EXISTS financial_account_id uuid REFERENCES public.financial_accounts(id) ON DELETE SET NULL;
ALTER TABLE public.purchase_orders     ADD COLUMN IF NOT EXISTS project_id uuid REFERENCES public.projects(id) ON DELETE SET NULL;
ALTER TABLE public.container_conversions ADD COLUMN IF NOT EXISTS project_id uuid REFERENCES public.projects(id) ON DELETE SET NULL;
ALTER TABLE public.quotes              ADD COLUMN IF NOT EXISTS project_id uuid REFERENCES public.projects(id) ON DELETE SET NULL;
ALTER TABLE public.sales_orders        ADD COLUMN IF NOT EXISTS project_id uuid REFERENCES public.projects(id) ON DELETE SET NULL;
ALTER TABLE public.repatriations       ADD COLUMN IF NOT EXISTS project_id uuid REFERENCES public.projects(id) ON DELETE SET NULL;

-- ============= Views =============
CREATE OR REPLACE VIEW public.financial_account_balances AS
SELECT
  fa.id AS account_id,
  fa.organization_id,
  fa.name,
  fa.account_type,
  fa.currency,
  fa.opening_balance,
  fa.is_active,
  COALESCE((
    SELECT SUM(at.debit_amount - at.credit_amount)
    FROM public.accounting_transactions at
    WHERE at.financial_account_id = fa.id
  ), 0) AS net_movement,
  fa.opening_balance + COALESCE((
    SELECT SUM(at.debit_amount - at.credit_amount)
    FROM public.accounting_transactions at
    WHERE at.financial_account_id = fa.id
  ), 0) AS current_balance,
  COALESCE((
    SELECT SUM(at.debit_amount - at.credit_amount)
    FROM public.accounting_transactions at
    WHERE at.financial_account_id = fa.id AND at.cleared_at IS NOT NULL
  ), 0) + fa.opening_balance AS cleared_balance
FROM public.financial_accounts fa;

CREATE OR REPLACE VIEW public.project_pnl AS
SELECT
  p.id AS project_id,
  p.organization_id,
  p.code,
  p.name,
  p.status,
  p.budget_amount,
  p.currency,
  COALESCE(SUM(at.credit_amount) FILTER (WHERE at.account_type = 'revenue'), 0) AS revenue,
  COALESCE(SUM(at.debit_amount)  FILTER (WHERE at.account_type = 'cost_of_goods'), 0) AS cogs,
  COALESCE(SUM(at.debit_amount)  FILTER (WHERE at.account_type = 'expense'), 0) AS expenses,
  COALESCE(SUM(at.credit_amount) FILTER (WHERE at.account_type = 'revenue'), 0)
    - COALESCE(SUM(at.debit_amount) FILTER (WHERE at.account_type IN ('cost_of_goods','expense')), 0) AS margin
FROM public.projects p
LEFT JOIN public.accounting_transactions at ON at.project_id = p.id
GROUP BY p.id, p.organization_id, p.code, p.name, p.status, p.budget_amount, p.currency;

-- ============= Functions =============

-- Post a balanced pair of ledger entries for a transfer
CREATE OR REPLACE FUNCTION public.post_inter_account_transfer(_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_transfer record;
  v_org uuid;
  v_num_credit text;
  v_num_debit text;
  v_num_fee text;
BEGIN
  SELECT * INTO v_transfer FROM public.inter_account_transfers WHERE id = _id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Transfer not found'; END IF;
  IF v_transfer.voided_at IS NOT NULL THEN RAISE EXCEPTION 'Transfer is voided'; END IF;

  -- Skip if already posted
  IF EXISTS (SELECT 1 FROM public.accounting_transactions
             WHERE reference_type = 'inter_account_transfer' AND reference_id = _id) THEN
    RETURN;
  END IF;

  v_org := v_transfer.organization_id;
  v_num_credit := 'TRF-OUT-' || substr(_id::text, 1, 8);
  v_num_debit  := 'TRF-IN-'  || substr(_id::text, 1, 8);

  -- Credit (money out of from_account)
  INSERT INTO public.accounting_transactions
    (transaction_number, transaction_date, account_type, category, description,
     debit_amount, credit_amount, reference_type, reference_id, organization_id, financial_account_id)
  VALUES
    (v_num_credit, v_transfer.transfer_date, 'asset', 'inter_account_transfer',
     COALESCE(v_transfer.description,'') || ' (out)',
     0, v_transfer.amount + v_transfer.fees,
     'inter_account_transfer', _id, v_org, v_transfer.from_account_id);

  -- Debit (money into to_account)
  INSERT INTO public.accounting_transactions
    (transaction_number, transaction_date, account_type, category, description,
     debit_amount, credit_amount, reference_type, reference_id, organization_id, financial_account_id)
  VALUES
    (v_num_debit, v_transfer.transfer_date, 'asset', 'inter_account_transfer',
     COALESCE(v_transfer.description,'') || ' (in)',
     v_transfer.amount * v_transfer.fx_rate, 0,
     'inter_account_transfer', _id, v_org, v_transfer.to_account_id);

  -- Fee (expense)
  IF v_transfer.fees > 0 THEN
    v_num_fee := 'TRF-FEE-' || substr(_id::text, 1, 8);
    INSERT INTO public.accounting_transactions
      (transaction_number, transaction_date, account_type, category, description,
       debit_amount, credit_amount, reference_type, reference_id, organization_id, financial_account_id)
    VALUES
      (v_num_fee, v_transfer.transfer_date, 'expense', 'bank_charges',
       'Bank fee for transfer ' || v_transfer.transfer_number,
       v_transfer.fees, 0,
       'inter_account_transfer', _id, v_org, v_transfer.from_account_id);
  END IF;
END $$;

-- Auto-post on insert
CREATE OR REPLACE FUNCTION public.trg_post_inter_account_transfer()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM public.post_inter_account_transfer(NEW.id);
  RETURN NEW;
END $$;

CREATE TRIGGER trg_inter_account_transfer_post
AFTER INSERT ON public.inter_account_transfers
FOR EACH ROW EXECUTE FUNCTION public.trg_post_inter_account_transfer();

-- Void a transfer (post reversing ledger entries)
CREATE OR REPLACE FUNCTION public.void_inter_account_transfer(_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_transfer record;
BEGIN
  SELECT * INTO v_transfer FROM public.inter_account_transfers WHERE id = _id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Transfer not found'; END IF;
  IF v_transfer.voided_at IS NOT NULL THEN RAISE EXCEPTION 'Already voided'; END IF;

  -- Insert contra entries
  INSERT INTO public.accounting_transactions
    (transaction_number, transaction_date, account_type, category, description,
     debit_amount, credit_amount, reference_type, reference_id, organization_id, financial_account_id)
  VALUES
    ('TRF-VOID-OUT-' || substr(_id::text,1,8), now(), 'asset', 'inter_account_transfer_void',
     'Reversal of transfer ' || v_transfer.transfer_number,
     v_transfer.amount + v_transfer.fees, 0,
     'inter_account_transfer_void', _id, v_transfer.organization_id, v_transfer.from_account_id),
    ('TRF-VOID-IN-' || substr(_id::text,1,8), now(), 'asset', 'inter_account_transfer_void',
     'Reversal of transfer ' || v_transfer.transfer_number,
     0, v_transfer.amount * v_transfer.fx_rate,
     'inter_account_transfer_void', _id, v_transfer.organization_id, v_transfer.to_account_id);

  UPDATE public.inter_account_transfers
     SET voided_at = now(), voided_by = auth.uid()
   WHERE id = _id;
END $$;

-- Complete a bank reconciliation only when balanced
CREATE OR REPLACE FUNCTION public.complete_bank_reconciliation(_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_recon record;
  v_cleared_total numeric;
  v_diff numeric;
BEGIN
  SELECT * INTO v_recon FROM public.bank_reconciliations WHERE id = _id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Reconciliation not found'; END IF;
  IF v_recon.status = 'completed' THEN RAISE EXCEPTION 'Already completed'; END IF;

  SELECT COALESCE(SUM(at.debit_amount - at.credit_amount), 0)
    INTO v_cleared_total
  FROM public.bank_reconciliation_lines l
  JOIN public.accounting_transactions at ON at.id = l.transaction_id
  WHERE l.reconciliation_id = _id AND l.cleared = true;

  v_diff := (v_recon.statement_opening_balance + v_cleared_total) - v_recon.statement_closing_balance;
  IF abs(v_diff) > 0.01 THEN
    RAISE EXCEPTION 'Reconciliation not balanced. Difference: %', v_diff;
  END IF;

  -- Stamp cleared transactions
  UPDATE public.accounting_transactions at
     SET cleared_at = now(), reconciliation_id = _id
    FROM public.bank_reconciliation_lines l
   WHERE l.reconciliation_id = _id AND l.cleared = true AND at.id = l.transaction_id;

  UPDATE public.bank_reconciliations
     SET status = 'completed', completed_at = now(), completed_by = auth.uid()
   WHERE id = _id;
END $$;

-- Ensure default cash + bank account per org
CREATE OR REPLACE FUNCTION public.ensure_default_financial_accounts(_org uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.financial_accounts WHERE organization_id = _org AND account_type = 'cash') THEN
    INSERT INTO public.financial_accounts (organization_id, name, account_type, is_default)
    VALUES (_org, 'Petty Cash', 'cash', true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.financial_accounts WHERE organization_id = _org AND account_type = 'bank') THEN
    INSERT INTO public.financial_accounts (organization_id, name, account_type, is_default)
    VALUES (_org, 'Main Bank Account', 'bank', true);
  END IF;
END $$;
