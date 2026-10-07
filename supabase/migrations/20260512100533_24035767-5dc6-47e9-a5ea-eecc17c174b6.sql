
-- 1. Register HRM module
INSERT INTO public.modules_catalog (code, name, description, monthly_price, is_core, sort_order)
VALUES ('hrm', 'Human Resources', 'Employees and payslips', 0, false, 80)
ON CONFLICT (code) DO NOTHING;

-- 2. Extend employees
ALTER TABLE public.employees
  ADD COLUMN IF NOT EXISTS code text,
  ADD COLUMN IF NOT EXISTS email text,
  ADD COLUMN IF NOT EXISTS division text,
  ADD COLUMN IF NOT EXISTS control_account_id uuid REFERENCES public.financial_accounts(id),
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS hired_on date,
  ADD COLUMN IF NOT EXISTS termination_date date,
  ADD COLUMN IF NOT EXISTS tax_id text,
  ADD COLUMN IF NOT EXISTS bank_details jsonb;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='employees_status_check') THEN
    ALTER TABLE public.employees ADD CONSTRAINT employees_status_check
      CHECK (status IN ('active','on_leave','terminated'));
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS employees_code_org_uniq
  ON public.employees(organization_id, code) WHERE code IS NOT NULL;

-- 3. Payslips
CREATE TABLE IF NOT EXISTS public.payslips (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL DEFAULT current_org_id() REFERENCES public.organizations(id),
  reference text NOT NULL DEFAULT '',
  employee_id uuid NOT NULL REFERENCES public.employees(id),
  pay_date date NOT NULL,
  period_start date NOT NULL,
  period_end date NOT NULL,
  description text,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','posted','paid','void')),
  gross_pay numeric NOT NULL DEFAULT 0,
  total_deductions numeric NOT NULL DEFAULT 0,
  total_contributions numeric NOT NULL DEFAULT 0,
  net_pay numeric NOT NULL DEFAULT 0,
  notes text,
  posted_at timestamptz,
  paid_at timestamptz,
  paid_from_account_id uuid REFERENCES public.financial_accounts(id),
  accounting_transaction_id uuid,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, reference)
);

CREATE INDEX IF NOT EXISTS idx_payslips_org ON public.payslips(organization_id);
CREATE INDEX IF NOT EXISTS idx_payslips_employee ON public.payslips(employee_id);

CREATE TABLE IF NOT EXISTS public.payslip_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payslip_id uuid NOT NULL REFERENCES public.payslips(id) ON DELETE CASCADE,
  line_type text NOT NULL CHECK (line_type IN ('earning','deduction','contribution')),
  label text NOT NULL,
  amount numeric NOT NULL DEFAULT 0,
  taxable boolean NOT NULL DEFAULT true,
  sort_order int NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_payslip_lines_payslip ON public.payslip_lines(payslip_id);

ALTER TABLE public.payslips ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payslip_lines ENABLE ROW LEVEL SECURITY;

-- RLS payslips
CREATE POLICY "Org members view payslips" ON public.payslips FOR SELECT
USING (is_platform_admin() OR (organization_id = current_org_id() AND (
  has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'yard_operator'::app_role)
  OR has_role(auth.uid(),'gate_clerk'::app_role) OR has_role(auth.uid(),'viewer'::app_role)
)));
CREATE POLICY "Org admins insert payslips" ON public.payslips FOR INSERT
WITH CHECK (organization_id = current_org_id() AND has_role(auth.uid(),'admin'::app_role));
CREATE POLICY "Org admins update payslips" ON public.payslips FOR UPDATE
USING (is_platform_admin() OR (organization_id = current_org_id() AND has_role(auth.uid(),'admin'::app_role)));
CREATE POLICY "Org admins delete payslips" ON public.payslips FOR DELETE
USING (is_platform_admin() OR (organization_id = current_org_id() AND has_role(auth.uid(),'admin'::app_role)));

-- RLS payslip_lines via payslip
CREATE POLICY "Members view payslip lines" ON public.payslip_lines FOR SELECT
USING (EXISTS (SELECT 1 FROM public.payslips p WHERE p.id = payslip_id
  AND (is_platform_admin() OR p.organization_id = current_org_id())));
CREATE POLICY "Admins insert payslip lines" ON public.payslip_lines FOR INSERT
WITH CHECK (EXISTS (SELECT 1 FROM public.payslips p WHERE p.id = payslip_id
  AND p.organization_id = current_org_id() AND has_role(auth.uid(),'admin'::app_role)));
CREATE POLICY "Admins update payslip lines" ON public.payslip_lines FOR UPDATE
USING (EXISTS (SELECT 1 FROM public.payslips p WHERE p.id = payslip_id
  AND p.organization_id = current_org_id() AND has_role(auth.uid(),'admin'::app_role)));
CREATE POLICY "Admins delete payslip lines" ON public.payslip_lines FOR DELETE
USING (EXISTS (SELECT 1 FROM public.payslips p WHERE p.id = payslip_id
  AND p.organization_id = current_org_id() AND has_role(auth.uid(),'admin'::app_role)));

-- Reference generator
CREATE OR REPLACE FUNCTION public.payslips_set_reference()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  yymm text;
  seq int;
BEGIN
  IF NEW.reference IS NULL OR NEW.reference = '' THEN
    yymm := to_char(coalesce(NEW.pay_date, current_date), 'YYYYMM');
    SELECT COALESCE(MAX(NULLIF(regexp_replace(reference, '^PSL-' || yymm || '-', ''), '')::int), 0) + 1
      INTO seq
    FROM public.payslips
    WHERE organization_id = NEW.organization_id
      AND reference LIKE 'PSL-' || yymm || '-%';
    NEW.reference := 'PSL-' || yymm || '-' || lpad(seq::text, 4, '0');
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_payslips_set_reference ON public.payslips;
CREATE TRIGGER trg_payslips_set_reference BEFORE INSERT ON public.payslips
FOR EACH ROW EXECUTE FUNCTION public.payslips_set_reference();

-- Recalc totals from lines
CREATE OR REPLACE FUNCTION public.payslips_recalc_totals(_payslip_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  g numeric := 0; d numeric := 0; c numeric := 0;
BEGIN
  SELECT COALESCE(SUM(CASE WHEN line_type='earning' THEN amount END),0),
         COALESCE(SUM(CASE WHEN line_type='deduction' THEN amount END),0),
         COALESCE(SUM(CASE WHEN line_type='contribution' THEN amount END),0)
    INTO g, d, c
    FROM public.payslip_lines WHERE payslip_id = _payslip_id;
  UPDATE public.payslips
     SET gross_pay = g, total_deductions = d, total_contributions = c,
         net_pay = g - d, updated_at = now()
   WHERE id = _payslip_id;
END $$;

CREATE OR REPLACE FUNCTION public.payslip_lines_after_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  PERFORM public.payslips_recalc_totals(COALESCE(NEW.payslip_id, OLD.payslip_id));
  RETURN COALESCE(NEW, OLD);
END $$;

DROP TRIGGER IF EXISTS trg_payslip_lines_aiud ON public.payslip_lines;
CREATE TRIGGER trg_payslip_lines_aiud AFTER INSERT OR UPDATE OR DELETE ON public.payslip_lines
FOR EACH ROW EXECUTE FUNCTION public.payslip_lines_after_change();

-- updated_at trigger
DROP TRIGGER IF EXISTS trg_payslips_updated_at ON public.payslips;
CREATE TRIGGER trg_payslips_updated_at BEFORE UPDATE ON public.payslips
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Employee balances view (posted but not paid)
CREATE OR REPLACE VIEW public.employee_balances AS
SELECT e.id AS employee_id, e.organization_id,
       COALESCE(SUM(CASE WHEN p.status='posted' THEN p.net_pay ELSE 0 END), 0) AS balance
FROM public.employees e
LEFT JOIN public.payslips p ON p.employee_id = e.id
GROUP BY e.id, e.organization_id;

-- Post payslip
CREATE OR REPLACE FUNCTION public.post_payslip(_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  ps RECORD; emp RECORD; txn_id uuid; txn_no text;
BEGIN
  SELECT * INTO ps FROM public.payslips WHERE id = _id;
  IF ps IS NULL THEN RAISE EXCEPTION 'Payslip not found'; END IF;
  IF ps.organization_id <> current_org_id() THEN RAISE EXCEPTION 'Forbidden'; END IF;
  IF NOT has_role(auth.uid(),'admin'::app_role) THEN RAISE EXCEPTION 'Admin required'; END IF;
  IF ps.status <> 'draft' THEN RAISE EXCEPTION 'Only draft payslips can be posted'; END IF;

  SELECT * INTO emp FROM public.employees WHERE id = ps.employee_id;
  txn_no := 'PSL-TXN-' || to_char(now(),'YYYYMMDDHH24MISS') || '-' || substring(_id::text,1,4);

  INSERT INTO public.accounting_transactions
    (transaction_number, transaction_date, account_type, category, description,
     debit_amount, credit_amount, reference_type, reference_id, organization_id, created_by)
  VALUES
    (txn_no, ps.pay_date, 'expense', 'payroll',
     'Payroll: ' || emp.name || ' (' || ps.reference || ')',
     ps.gross_pay + ps.total_contributions, 0,
     'payslip', ps.id, ps.organization_id, auth.uid())
  RETURNING id INTO txn_id;

  UPDATE public.payslips
     SET status = 'posted', posted_at = now(), accounting_transaction_id = txn_id
   WHERE id = _id;

  INSERT INTO public.org_lifecycle_events (organization_id, event_type, actor_user_id, details)
  VALUES (ps.organization_id, 'payslip_posted', auth.uid(),
          jsonb_build_object('payslip_id', ps.id, 'reference', ps.reference, 'net_pay', ps.net_pay));

  RETURN txn_id;
END $$;

-- Pay payslip
CREATE OR REPLACE FUNCTION public.pay_payslip(_id uuid, _from_account_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  ps RECORD; emp RECORD; txn_no text;
BEGIN
  SELECT * INTO ps FROM public.payslips WHERE id = _id;
  IF ps IS NULL THEN RAISE EXCEPTION 'Payslip not found'; END IF;
  IF ps.organization_id <> current_org_id() THEN RAISE EXCEPTION 'Forbidden'; END IF;
  IF NOT has_role(auth.uid(),'admin'::app_role) THEN RAISE EXCEPTION 'Admin required'; END IF;
  IF ps.status <> 'posted' THEN RAISE EXCEPTION 'Only posted payslips can be paid'; END IF;

  SELECT * INTO emp FROM public.employees WHERE id = ps.employee_id;
  txn_no := 'PSL-PAY-' || to_char(now(),'YYYYMMDDHH24MISS') || '-' || substring(_id::text,1,4);

  INSERT INTO public.accounting_transactions
    (transaction_number, transaction_date, account_type, category, description,
     debit_amount, credit_amount, reference_type, reference_id, organization_id,
     financial_account_id, created_by)
  VALUES
    (txn_no, now(), 'asset', 'payroll_payment',
     'Payroll payment: ' || emp.name || ' (' || ps.reference || ')',
     0, ps.net_pay, 'payslip', ps.id, ps.organization_id, _from_account_id, auth.uid());

  UPDATE public.payslips
     SET status = 'paid', paid_at = now(), paid_from_account_id = _from_account_id
   WHERE id = _id;

  INSERT INTO public.org_lifecycle_events (organization_id, event_type, actor_user_id, details)
  VALUES (ps.organization_id, 'payslip_paid', auth.uid(),
          jsonb_build_object('payslip_id', ps.id, 'reference', ps.reference,
                             'net_pay', ps.net_pay, 'from_account', _from_account_id));
END $$;

-- Void payslip
CREATE OR REPLACE FUNCTION public.void_payslip(_id uuid, _reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  ps RECORD;
BEGIN
  SELECT * INTO ps FROM public.payslips WHERE id = _id;
  IF ps IS NULL THEN RAISE EXCEPTION 'Payslip not found'; END IF;
  IF ps.organization_id <> current_org_id() THEN RAISE EXCEPTION 'Forbidden'; END IF;
  IF NOT has_role(auth.uid(),'admin'::app_role) THEN RAISE EXCEPTION 'Admin required'; END IF;
  IF ps.status = 'void' THEN RETURN; END IF;

  UPDATE public.payslips SET status = 'void' WHERE id = _id;

  INSERT INTO public.org_lifecycle_events (organization_id, event_type, actor_user_id, details)
  VALUES (ps.organization_id, 'payslip_voided', auth.uid(),
          jsonb_build_object('payslip_id', ps.id, 'reference', ps.reference, 'reason', _reason));
END $$;
