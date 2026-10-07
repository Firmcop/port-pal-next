-- 1. Employee pay setup
ALTER TABLE public.employees
  ADD COLUMN IF NOT EXISTS pay_frequency text NOT NULL DEFAULT 'monthly',
  ADD COLUMN IF NOT EXISTS pay_basis text NOT NULL DEFAULT 'daily',
  ADD COLUMN IF NOT EXISTS hourly_rate numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS monthly_salary numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS overtime_multiplier numeric NOT NULL DEFAULT 1.5;

ALTER TABLE public.employees DROP CONSTRAINT IF EXISTS employees_pay_frequency_chk;
ALTER TABLE public.employees ADD CONSTRAINT employees_pay_frequency_chk CHECK (pay_frequency IN ('weekly','monthly'));
ALTER TABLE public.employees DROP CONSTRAINT IF EXISTS employees_pay_basis_chk;
ALTER TABLE public.employees ADD CONSTRAINT employees_pay_basis_chk CHECK (pay_basis IN ('daily','hourly'));

-- 2. Employee code sequence
CREATE TABLE IF NOT EXISTS public.hrm_employee_code_seq (
  organization_id uuid NOT NULL,
  prefix text NOT NULL,
  next_number integer NOT NULL DEFAULT 1,
  PRIMARY KEY (organization_id, prefix)
);
GRANT SELECT ON public.hrm_employee_code_seq TO authenticated;
GRANT ALL ON public.hrm_employee_code_seq TO service_role;
ALTER TABLE public.hrm_employee_code_seq ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Org staff view employee code seq" ON public.hrm_employee_code_seq;
CREATE POLICY "Org staff view employee code seq" ON public.hrm_employee_code_seq FOR SELECT TO authenticated
  USING (is_platform_admin() OR organization_id = current_org_id());

CREATE OR REPLACE FUNCTION public.set_employee_code()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE _prefix text; _n integer; _org uuid;
BEGIN
  IF NEW.code IS NOT NULL AND btrim(NEW.code) <> '' THEN RETURN NEW; END IF;
  _org := COALESCE(NEW.organization_id, current_org_id());
  _prefix := upper(regexp_replace(COALESCE(NULLIF(btrim(NEW.division),''),'EMP'), '[^A-Za-z]', '', 'g'));
  _prefix := COALESCE(NULLIF(substring(_prefix from 1 for 3),''), 'EMP');
  INSERT INTO public.hrm_employee_code_seq(organization_id, prefix, next_number)
  VALUES (_org, _prefix, 2)
  ON CONFLICT (organization_id, prefix) DO UPDATE SET next_number = hrm_employee_code_seq.next_number + 1
  RETURNING CASE WHEN xmax = 0 THEN 1 ELSE hrm_employee_code_seq.next_number - 1 END INTO _n;
  IF _n IS NULL THEN _n := 1; END IF;
  NEW.code := _prefix || '-' || lpad(_n::text, 4, '0');
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_set_employee_code ON public.employees;
CREATE TRIGGER trg_set_employee_code BEFORE INSERT ON public.employees
FOR EACH ROW EXECUTE FUNCTION public.set_employee_code();

-- 3. Attendance tables
CREATE TABLE IF NOT EXISTS public.attendance_weeks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL DEFAULT current_org_id(),
  week_start date NOT NULL,
  week_end date NOT NULL,
  status text NOT NULL DEFAULT 'draft',
  total_amount numeric NOT NULL DEFAULT 0,
  currency text,
  notes text,
  approved_by uuid,
  approved_at timestamptz,
  paid_by uuid,
  paid_at timestamptz,
  paid_from_account_id uuid REFERENCES public.financial_accounts(id),
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.attendance_weeks DROP CONSTRAINT IF EXISTS attendance_weeks_status_chk;
ALTER TABLE public.attendance_weeks ADD CONSTRAINT attendance_weeks_status_chk CHECK (status IN ('draft','approved','paid'));
CREATE UNIQUE INDEX IF NOT EXISTS attendance_weeks_org_week_uk ON public.attendance_weeks(organization_id, week_start);

CREATE TABLE IF NOT EXISTS public.attendance_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  week_id uuid NOT NULL REFERENCES public.attendance_weeks(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL DEFAULT current_org_id(),
  employee_id uuid NOT NULL REFERENCES public.employees(id),
  project_id uuid REFERENCES public.projects(id),
  conversion_id uuid REFERENCES public.container_conversions(id),
  basis text NOT NULL DEFAULT 'daily',
  days numeric NOT NULL DEFAULT 0,
  hours numeric NOT NULL DEFAULT 0,
  overtime_hours numeric NOT NULL DEFAULT 0,
  rate numeric NOT NULL DEFAULT 0,
  amount numeric NOT NULL DEFAULT 0,
  notes text,
  payslip_id uuid REFERENCES public.payslips(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS attendance_lines_week_idx ON public.attendance_lines(week_id);
CREATE INDEX IF NOT EXISTS attendance_lines_emp_idx ON public.attendance_lines(employee_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.attendance_weeks TO authenticated;
GRANT ALL ON public.attendance_weeks TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.attendance_lines TO authenticated;
GRANT ALL ON public.attendance_lines TO service_role;
ALTER TABLE public.attendance_weeks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attendance_lines ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Org HR view attendance weeks" ON public.attendance_weeks;
CREATE POLICY "Org HR view attendance weeks" ON public.attendance_weeks FOR SELECT TO authenticated
  USING (is_platform_admin() OR (organization_id = current_org_id() AND (has_role(auth.uid(),'admin') OR has_role(auth.uid(),'hr_manager') OR has_role(auth.uid(),'accountant') OR has_role(auth.uid(),'production_manager'))));
DROP POLICY IF EXISTS "Org HR write attendance weeks" ON public.attendance_weeks;
CREATE POLICY "Org HR write attendance weeks" ON public.attendance_weeks FOR INSERT TO authenticated
  WITH CHECK (organization_id = current_org_id() AND (has_role(auth.uid(),'admin') OR has_role(auth.uid(),'hr_manager')));
DROP POLICY IF EXISTS "Org HR update attendance weeks" ON public.attendance_weeks;
CREATE POLICY "Org HR update attendance weeks" ON public.attendance_weeks FOR UPDATE TO authenticated
  USING (is_platform_admin() OR (organization_id = current_org_id() AND (has_role(auth.uid(),'admin') OR has_role(auth.uid(),'hr_manager'))))
  WITH CHECK (organization_id = current_org_id());
DROP POLICY IF EXISTS "Org admins delete attendance weeks" ON public.attendance_weeks;
CREATE POLICY "Org admins delete attendance weeks" ON public.attendance_weeks FOR DELETE TO authenticated
  USING (is_platform_admin() OR (organization_id = current_org_id() AND has_role(auth.uid(),'admin')));

DROP POLICY IF EXISTS "Org HR view attendance lines" ON public.attendance_lines;
CREATE POLICY "Org HR view attendance lines" ON public.attendance_lines FOR SELECT TO authenticated
  USING (is_platform_admin() OR (organization_id = current_org_id() AND (has_role(auth.uid(),'admin') OR has_role(auth.uid(),'hr_manager') OR has_role(auth.uid(),'accountant') OR has_role(auth.uid(),'production_manager'))));
DROP POLICY IF EXISTS "Org HR insert attendance lines" ON public.attendance_lines;
CREATE POLICY "Org HR insert attendance lines" ON public.attendance_lines FOR INSERT TO authenticated
  WITH CHECK (organization_id = current_org_id() AND (has_role(auth.uid(),'admin') OR has_role(auth.uid(),'hr_manager')));
DROP POLICY IF EXISTS "Org HR update attendance lines" ON public.attendance_lines;
CREATE POLICY "Org HR update attendance lines" ON public.attendance_lines FOR UPDATE TO authenticated
  USING (is_platform_admin() OR (organization_id = current_org_id() AND (has_role(auth.uid(),'admin') OR has_role(auth.uid(),'hr_manager'))))
  WITH CHECK (organization_id = current_org_id());
DROP POLICY IF EXISTS "Org HR delete attendance lines" ON public.attendance_lines;
CREATE POLICY "Org HR delete attendance lines" ON public.attendance_lines FOR DELETE TO authenticated
  USING (is_platform_admin() OR (organization_id = current_org_id() AND (has_role(auth.uid(),'admin') OR has_role(auth.uid(),'hr_manager'))));

DROP TRIGGER IF EXISTS trg_attendance_weeks_currency ON public.attendance_weeks;
CREATE TRIGGER trg_attendance_weeks_currency BEFORE INSERT ON public.attendance_weeks
FOR EACH ROW EXECUTE FUNCTION public.set_currency_from_org();

-- 4. Payslip summary flag
ALTER TABLE public.payslips ADD COLUMN IF NOT EXISTS posting_mode text NOT NULL DEFAULT 'ledger';
ALTER TABLE public.payslips DROP CONSTRAINT IF EXISTS payslips_posting_mode_chk;
ALTER TABLE public.payslips ADD CONSTRAINT payslips_posting_mode_chk CHECK (posting_mode IN ('ledger','summary'));