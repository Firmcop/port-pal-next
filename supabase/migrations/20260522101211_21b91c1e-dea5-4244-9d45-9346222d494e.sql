
CREATE TABLE public.fixed_assets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL DEFAULT current_org_id(),
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  category TEXT,
  acquisition_date DATE NOT NULL DEFAULT CURRENT_DATE,
  cost NUMERIC(14,2) NOT NULL DEFAULT 0,
  salvage_value NUMERIC(14,2) NOT NULL DEFAULT 0,
  useful_life_months INTEGER NOT NULL DEFAULT 60,
  method TEXT NOT NULL DEFAULT 'straight_line' CHECK (method IN ('straight_line','declining')),
  gl_asset_account UUID REFERENCES public.gl_accounts(id),
  gl_depr_account UUID REFERENCES public.gl_accounts(id),
  gl_expense_account UUID REFERENCES public.gl_accounts(id),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','disposed','retired')),
  disposed_at DATE,
  accumulated_depreciation NUMERIC(14,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, code)
);
ALTER TABLE public.fixed_assets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "org read fa" ON public.fixed_assets FOR SELECT USING (organization_id = current_org_id() OR is_platform_admin());
CREATE POLICY "admin write fa" ON public.fixed_assets FOR ALL USING (organization_id = current_org_id() AND (has_role(auth.uid(),'admin') OR is_platform_admin())) WITH CHECK (organization_id = current_org_id());
CREATE TRIGGER trg_fa_updated BEFORE UPDATE ON public.fixed_assets FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.fixed_asset_depreciation_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL DEFAULT current_org_id(),
  period_id UUID NOT NULL REFERENCES public.fiscal_periods(id),
  run_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  total_depreciation NUMERIC(14,2) NOT NULL DEFAULT 0,
  journal_id UUID,
  asset_count INTEGER NOT NULL DEFAULT 0,
  notes TEXT
);
ALTER TABLE public.fixed_asset_depreciation_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "org read fa_runs" ON public.fixed_asset_depreciation_runs FOR SELECT USING (organization_id = current_org_id() OR is_platform_admin());
CREATE POLICY "admin write fa_runs" ON public.fixed_asset_depreciation_runs FOR ALL USING (organization_id = current_org_id() AND (has_role(auth.uid(),'admin') OR is_platform_admin())) WITH CHECK (organization_id = current_org_id());

CREATE TABLE public.expense_claims (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL DEFAULT current_org_id(),
  employee_id UUID REFERENCES public.employees(id),
  claim_number TEXT NOT NULL,
  claim_date DATE NOT NULL DEFAULT CURRENT_DATE,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','submitted','approved','reimbursed','rejected')),
  total_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  notes TEXT,
  approved_at TIMESTAMPTZ,
  reimbursed_at TIMESTAMPTZ,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, claim_number)
);
ALTER TABLE public.expense_claims ENABLE ROW LEVEL SECURITY;
CREATE POLICY "org read claims" ON public.expense_claims FOR SELECT USING (organization_id = current_org_id() OR is_platform_admin());
CREATE POLICY "org write claims" ON public.expense_claims FOR ALL USING (organization_id = current_org_id()) WITH CHECK (organization_id = current_org_id());
CREATE TRIGGER trg_claims_updated BEFORE UPDATE ON public.expense_claims FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.expense_claim_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL DEFAULT current_org_id(),
  claim_id UUID NOT NULL REFERENCES public.expense_claims(id) ON DELETE CASCADE,
  category TEXT,
  gl_account_id UUID REFERENCES public.gl_accounts(id),
  project_id UUID REFERENCES public.projects(id),
  tax_code_id UUID REFERENCES public.tax_codes(id),
  description TEXT,
  amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  receipt_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.expense_claim_lines ENABLE ROW LEVEL SECURITY;
CREATE POLICY "org read claim_lines" ON public.expense_claim_lines FOR SELECT USING (organization_id = current_org_id() OR is_platform_admin());
CREATE POLICY "org write claim_lines" ON public.expense_claim_lines FOR ALL USING (organization_id = current_org_id()) WITH CHECK (organization_id = current_org_id());

CREATE TABLE public.petty_cash_floats (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL DEFAULT current_org_id(),
  account_id UUID REFERENCES public.financial_accounts(id),
  name TEXT NOT NULL,
  custodian_id UUID,
  opening_balance NUMERIC(14,2) NOT NULL DEFAULT 0,
  current_balance NUMERIC(14,2) NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.petty_cash_floats ENABLE ROW LEVEL SECURITY;
CREATE POLICY "org read pc" ON public.petty_cash_floats FOR SELECT USING (organization_id = current_org_id() OR is_platform_admin());
CREATE POLICY "admin write pc" ON public.petty_cash_floats FOR ALL USING (organization_id = current_org_id() AND (has_role(auth.uid(),'admin') OR is_platform_admin())) WITH CHECK (organization_id = current_org_id());
CREATE TRIGGER trg_pc_updated BEFORE UPDATE ON public.petty_cash_floats FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.petty_cash_vouchers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL DEFAULT current_org_id(),
  float_id UUID NOT NULL REFERENCES public.petty_cash_floats(id) ON DELETE CASCADE,
  voucher_number TEXT NOT NULL,
  voucher_date DATE NOT NULL DEFAULT CURRENT_DATE,
  payee TEXT,
  gl_account_id UUID REFERENCES public.gl_accounts(id),
  amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  notes TEXT,
  receipt_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, voucher_number)
);
ALTER TABLE public.petty_cash_vouchers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "org read pcv" ON public.petty_cash_vouchers FOR SELECT USING (organization_id = current_org_id() OR is_platform_admin());
CREATE POLICY "org write pcv" ON public.petty_cash_vouchers FOR ALL USING (organization_id = current_org_id()) WITH CHECK (organization_id = current_org_id());

CREATE TABLE public.approval_workflows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL DEFAULT current_org_id(),
  doc_type TEXT NOT NULL,
  threshold_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  approver_role TEXT NOT NULL DEFAULT 'admin',
  sequence INTEGER NOT NULL DEFAULT 1,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.approval_workflows ENABLE ROW LEVEL SECURITY;
CREATE POLICY "org read aw" ON public.approval_workflows FOR SELECT USING (organization_id = current_org_id() OR is_platform_admin());
CREATE POLICY "admin write aw" ON public.approval_workflows FOR ALL USING (organization_id = current_org_id() AND (has_role(auth.uid(),'admin') OR is_platform_admin())) WITH CHECK (organization_id = current_org_id());
CREATE TRIGGER trg_aw_updated BEFORE UPDATE ON public.approval_workflows FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.approval_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL DEFAULT current_org_id(),
  doc_type TEXT NOT NULL,
  doc_id UUID NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  requested_by UUID,
  current_step INTEGER NOT NULL DEFAULT 1,
  decision_note TEXT,
  decided_by UUID,
  decided_at TIMESTAMPTZ,
  amount NUMERIC(14,2),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.approval_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "org read ar" ON public.approval_requests FOR SELECT USING (organization_id = current_org_id() OR is_platform_admin());
CREATE POLICY "org write ar" ON public.approval_requests FOR ALL USING (organization_id = current_org_id()) WITH CHECK (organization_id = current_org_id());
CREATE TRIGGER trg_ar_updated BEFORE UPDATE ON public.approval_requests FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE OR REPLACE FUNCTION public.run_depreciation(_period_id UUID)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE org UUID; rid UUID; rec RECORD; total NUMERIC := 0; cnt INTEGER := 0; monthly NUMERIC;
BEGIN
  SELECT organization_id INTO org FROM public.fiscal_periods WHERE id = _period_id;
  IF org IS NULL THEN RAISE EXCEPTION 'Period not found'; END IF;

  FOR rec IN SELECT * FROM public.fixed_assets WHERE organization_id = org AND status = 'active' LOOP
    IF rec.method = 'straight_line' THEN
      monthly := GREATEST((rec.cost - rec.salvage_value), 0) / NULLIF(rec.useful_life_months, 0);
    ELSE
      monthly := GREATEST((rec.cost - rec.accumulated_depreciation), 0) * (2.0 / NULLIF(rec.useful_life_months, 0));
    END IF;
    monthly := COALESCE(monthly, 0);
    IF monthly > 0 AND rec.accumulated_depreciation + monthly <= (rec.cost - rec.salvage_value) THEN
      UPDATE public.fixed_assets SET accumulated_depreciation = accumulated_depreciation + monthly WHERE id = rec.id;
      total := total + monthly;
      cnt := cnt + 1;
    END IF;
  END LOOP;

  INSERT INTO public.fixed_asset_depreciation_runs (organization_id, period_id, total_depreciation, asset_count, notes)
  VALUES (org, _period_id, total, cnt, 'Auto depreciation run')
  RETURNING id INTO rid;
  RETURN rid;
END $$;

CREATE OR REPLACE FUNCTION public.submit_for_approval(_doc_type TEXT, _doc_id UUID, _amount NUMERIC DEFAULT NULL)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE rid UUID;
BEGIN
  INSERT INTO public.approval_requests (organization_id, doc_type, doc_id, amount, requested_by)
  VALUES (current_org_id(), _doc_type, _doc_id, _amount, auth.uid())
  RETURNING id INTO rid;
  RETURN rid;
END $$;

CREATE OR REPLACE FUNCTION public.act_on_approval(_request_id UUID, _decision TEXT, _note TEXT DEFAULT NULL)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF _decision NOT IN ('approved','rejected') THEN RAISE EXCEPTION 'Invalid decision'; END IF;
  UPDATE public.approval_requests
    SET status = _decision, decision_note = _note, decided_by = auth.uid(), decided_at = now()
    WHERE id = _request_id;
END $$;
