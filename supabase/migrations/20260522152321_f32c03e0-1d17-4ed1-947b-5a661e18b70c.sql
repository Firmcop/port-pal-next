
CREATE TABLE public.period_close_checklist (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL DEFAULT current_org_id(),
  period_id UUID NOT NULL REFERENCES public.fiscal_periods(id) ON DELETE CASCADE,
  sequence INTEGER NOT NULL DEFAULT 1,
  task TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','in_progress','done','skipped')),
  owner_user_id UUID,
  completed_at TIMESTAMPTZ,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.period_close_checklist ENABLE ROW LEVEL SECURITY;
CREATE POLICY "org read pcc" ON public.period_close_checklist FOR SELECT USING (organization_id = current_org_id() OR is_platform_admin());
CREATE POLICY "admin write pcc" ON public.period_close_checklist FOR ALL USING (organization_id = current_org_id() AND (has_role(auth.uid(),'admin') OR is_platform_admin())) WITH CHECK (organization_id = current_org_id());
CREATE TRIGGER trg_pcc_updated BEFORE UPDATE ON public.period_close_checklist FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.year_end_closes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL DEFAULT current_org_id(),
  fiscal_year INTEGER NOT NULL,
  closed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_by UUID,
  net_income NUMERIC(14,2) NOT NULL DEFAULT 0,
  retained_earnings_account UUID REFERENCES public.gl_accounts(id),
  journal_id UUID,
  notes TEXT,
  UNIQUE (organization_id, fiscal_year)
);
ALTER TABLE public.year_end_closes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "org read yec" ON public.year_end_closes FOR SELECT USING (organization_id = current_org_id() OR is_platform_admin());
CREATE POLICY "admin write yec" ON public.year_end_closes FOR ALL USING (organization_id = current_org_id() AND (has_role(auth.uid(),'admin') OR is_platform_admin())) WITH CHECK (organization_id = current_org_id());

CREATE OR REPLACE FUNCTION public.seed_close_checklist(_period_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE org UUID; n INTEGER := 0;
BEGIN
  SELECT organization_id INTO org FROM public.fiscal_periods WHERE id = _period_id;
  IF org IS NULL THEN RAISE EXCEPTION 'Period not found'; END IF;
  IF EXISTS (SELECT 1 FROM public.period_close_checklist WHERE period_id = _period_id) THEN
    RETURN 0;
  END IF;
  INSERT INTO public.period_close_checklist (organization_id, period_id, sequence, task) VALUES
    (org, _period_id, 1, 'Reconcile all bank and cash accounts'),
    (org, _period_id, 2, 'Post recurring invoices and subscriptions'),
    (org, _period_id, 3, 'Review AR aging and follow up on overdue'),
    (org, _period_id, 4, 'Review AP aging and approve pending bills'),
    (org, _period_id, 5, 'Run fixed-asset depreciation'),
    (org, _period_id, 6, 'Run FX revaluation for foreign currency balances'),
    (org, _period_id, 7, 'Review and post tax return for the period'),
    (org, _period_id, 8, 'Lock period after review');
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;

CREATE OR REPLACE FUNCTION public.close_fiscal_year(_fiscal_year INTEGER, _retained_earnings_account UUID)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  org UUID := current_org_id();
  ni NUMERIC := 0;
  jid UUID;
  yec_id UUID;
  income_total NUMERIC := 0;
  expense_total NUMERIC := 0;
  pnl_lines JSONB := '[]'::jsonb;
  rec RECORD;
BEGIN
  IF NOT (has_role(auth.uid(),'admin') OR is_platform_admin()) THEN
    RAISE EXCEPTION 'Only admins can close the fiscal year';
  END IF;
  IF EXISTS (SELECT 1 FROM public.year_end_closes WHERE organization_id = org AND fiscal_year = _fiscal_year) THEN
    RAISE EXCEPTION 'Fiscal year % already closed', _fiscal_year;
  END IF;

  FOR rec IN
    SELECT ga.id, ga.type,
      COALESCE(SUM(jl.debit - jl.credit), 0) AS net
    FROM public.gl_accounts ga
    LEFT JOIN public.journal_lines jl ON jl.account_id = ga.id
    LEFT JOIN public.journals j ON j.id = jl.journal_id
    LEFT JOIN public.fiscal_periods fp ON fp.id = j.period_id
    WHERE ga.organization_id = org
      AND ga.type IN ('revenue','expense')
      AND (fp.id IS NULL OR EXTRACT(YEAR FROM fp.start_date)::INTEGER = _fiscal_year)
    GROUP BY ga.id, ga.type
  LOOP
    IF rec.type = 'revenue' AND rec.net <> 0 THEN
      pnl_lines := pnl_lines || jsonb_build_object('account_id', rec.id, 'debit', -rec.net, 'credit', 0);
      income_total := income_total + (-rec.net);
    ELSIF rec.type = 'expense' AND rec.net <> 0 THEN
      pnl_lines := pnl_lines || jsonb_build_object('account_id', rec.id, 'debit', 0, 'credit', rec.net);
      expense_total := expense_total + rec.net;
    END IF;
  END LOOP;

  ni := income_total - expense_total;
  pnl_lines := pnl_lines || jsonb_build_object(
    'account_id', _retained_earnings_account,
    'debit', CASE WHEN ni >= 0 THEN 0 ELSE -ni END,
    'credit', CASE WHEN ni >= 0 THEN ni ELSE 0 END
  );

  UPDATE public.fiscal_periods
    SET status = 'closed', closed_at = now()
    WHERE organization_id = org
      AND EXTRACT(YEAR FROM start_date)::INTEGER = _fiscal_year
      AND status <> 'closed';

  INSERT INTO public.year_end_closes (organization_id, fiscal_year, closed_by, net_income, retained_earnings_account, notes)
  VALUES (org, _fiscal_year, auth.uid(), ni, _retained_earnings_account, 'Year-end close')
  RETURNING id INTO yec_id;

  RETURN yec_id;
END $$;
