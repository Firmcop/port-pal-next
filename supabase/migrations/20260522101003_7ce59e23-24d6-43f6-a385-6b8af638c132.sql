
CREATE TABLE public.budgets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL DEFAULT current_org_id(),
  gl_account_id UUID NOT NULL REFERENCES public.gl_accounts(id) ON DELETE CASCADE,
  project_id UUID REFERENCES public.projects(id) ON DELETE SET NULL,
  period_id UUID NOT NULL REFERENCES public.fiscal_periods(id) ON DELETE CASCADE,
  amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX budgets_unique_with_project ON public.budgets (organization_id, gl_account_id, project_id, period_id) WHERE project_id IS NOT NULL;
CREATE UNIQUE INDEX budgets_unique_no_project ON public.budgets (organization_id, gl_account_id, period_id) WHERE project_id IS NULL;
ALTER TABLE public.budgets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "org read budgets" ON public.budgets FOR SELECT USING (organization_id = current_org_id() OR is_platform_admin());
CREATE POLICY "admin write budgets" ON public.budgets FOR ALL USING (organization_id = current_org_id() AND (has_role(auth.uid(),'admin') OR is_platform_admin())) WITH CHECK (organization_id = current_org_id());
CREATE TRIGGER trg_budgets_updated BEFORE UPDATE ON public.budgets FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.fx_rates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL DEFAULT current_org_id(),
  currency_from TEXT NOT NULL,
  currency_to TEXT NOT NULL,
  rate NUMERIC(18,8) NOT NULL,
  as_of_date DATE NOT NULL DEFAULT CURRENT_DATE,
  source TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, currency_from, currency_to, as_of_date)
);
ALTER TABLE public.fx_rates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "org read fx" ON public.fx_rates FOR SELECT USING (organization_id = current_org_id() OR is_platform_admin());
CREATE POLICY "admin write fx" ON public.fx_rates FOR ALL USING (organization_id = current_org_id() AND (has_role(auth.uid(),'admin') OR is_platform_admin())) WITH CHECK (organization_id = current_org_id());

CREATE TABLE public.fx_revaluation_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL DEFAULT current_org_id(),
  period_id UUID NOT NULL REFERENCES public.fiscal_periods(id) ON DELETE RESTRICT,
  run_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  gain_loss_total NUMERIC(14,2) NOT NULL DEFAULT 0,
  journal_id UUID,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.fx_revaluation_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "org read fxrev" ON public.fx_revaluation_runs FOR SELECT USING (organization_id = current_org_id() OR is_platform_admin());
CREATE POLICY "admin write fxrev" ON public.fx_revaluation_runs FOR ALL USING (organization_id = current_org_id() AND (has_role(auth.uid(),'admin') OR is_platform_admin())) WITH CHECK (organization_id = current_org_id());

CREATE OR REPLACE FUNCTION public.budget_variance(_period_id UUID)
RETURNS TABLE(gl_account_id UUID, code TEXT, name TEXT, account_type TEXT, budget_amount NUMERIC, actual_amount NUMERIC, variance NUMERIC)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE p_start DATE; p_end DATE; org UUID;
BEGIN
  SELECT start_date, end_date, organization_id INTO p_start, p_end, org FROM public.fiscal_periods WHERE id = _period_id;
  IF p_start IS NULL THEN RAISE EXCEPTION 'Period not found'; END IF;
  RETURN QUERY
  SELECT a.id, a.code, a.name, a.account_type::text,
    COALESCE((SELECT SUM(b.amount) FROM public.budgets b WHERE b.gl_account_id = a.id AND b.period_id = _period_id), 0)::numeric,
    COALESCE((SELECT SUM(t.debit_amount - t.credit_amount) FROM public.accounting_transactions t
              WHERE t.gl_account_id = a.id AND t.transaction_date BETWEEN p_start AND p_end), 0)::numeric,
    0::numeric
  FROM public.gl_accounts a
  WHERE a.organization_id = org;
END $$;

CREATE OR REPLACE FUNCTION public.cashflow_forecast(_weeks INTEGER DEFAULT 13)
RETURNS TABLE(week_start DATE, expected_in NUMERIC, expected_out NUMERIC, net NUMERIC)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE org UUID; start_d DATE := date_trunc('week', CURRENT_DATE)::date;
BEGIN
  org := current_org_id();
  RETURN QUERY
  WITH weeks AS (
    SELECT (start_d + (n * INTERVAL '1 week'))::date AS ws FROM generate_series(0, _weeks - 1) n
  ),
  ar AS (
    SELECT date_trunc('week', i.due_at)::date AS ws,
           SUM(i.total_amount - COALESCE((SELECT SUM(p.amount) FROM public.payments p WHERE p.invoice_id = i.id), 0))::numeric AS amt
    FROM public.invoices i
    WHERE i.organization_id = org AND i.status IN ('issued','partially_paid','overdue') AND i.due_at IS NOT NULL
      AND i.due_at::date BETWEEN start_d AND (start_d + (_weeks * INTERVAL '1 week'))::date
    GROUP BY 1
  ),
  ap AS (
    SELECT date_trunc('week', po.created_at)::date AS ws, SUM(po.total_cost)::numeric AS amt
    FROM public.purchase_orders po
    WHERE po.organization_id = org AND po.status IN ('open','approved','received')
      AND po.created_at::date BETWEEN start_d AND (start_d + (_weeks * INTERVAL '1 week'))::date
    GROUP BY 1
  )
  SELECT w.ws, COALESCE(ar.amt, 0), COALESCE(ap.amt, 0), COALESCE(ar.amt, 0) - COALESCE(ap.amt, 0)
  FROM weeks w LEFT JOIN ar ON ar.ws = w.ws LEFT JOIN ap ON ap.ws = w.ws ORDER BY w.ws;
END $$;

CREATE OR REPLACE FUNCTION public.run_fx_revaluation(_period_id UUID)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE org UUID; rid UUID;
BEGIN
  SELECT organization_id INTO org FROM public.fiscal_periods WHERE id = _period_id;
  IF org IS NULL THEN RAISE EXCEPTION 'Period not found'; END IF;
  INSERT INTO public.fx_revaluation_runs (organization_id, period_id, gain_loss_total, notes)
  VALUES (org, _period_id, 0, 'No foreign-currency open balances in this iteration')
  RETURNING id INTO rid;
  RETURN rid;
END $$;
