
-- employees: restrict writes to HR-related roles
DROP POLICY IF EXISTS "Org staff insert employees" ON public.employees;
CREATE POLICY "Org staff insert employees" ON public.employees
  FOR INSERT WITH CHECK (organization_id = current_org_id() AND (has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'hr_manager'::app_role)));
DROP POLICY IF EXISTS "Org staff update employees" ON public.employees;
CREATE POLICY "Org staff update employees" ON public.employees
  FOR UPDATE USING (is_platform_admin() OR (organization_id = current_org_id() AND (has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'hr_manager'::app_role))))
  WITH CHECK (organization_id = current_org_id() AND (has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'hr_manager'::app_role)));

-- payroll_run_items: restrict reads to admin/hr_manager/accountant
DROP POLICY IF EXISTS "Org members view run items" ON public.payroll_run_items;
CREATE POLICY "Org members view run items" ON public.payroll_run_items
  FOR SELECT USING (EXISTS (
    SELECT 1 FROM public.payroll_runs r
    WHERE r.id = payroll_run_items.run_id
      AND ((r.organization_id = current_org_id() AND (has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'hr_manager'::app_role) OR has_role(auth.uid(),'accountant'::app_role))) OR is_platform_admin())
  ));

-- payslip_lines: restrict reads
DROP POLICY IF EXISTS "Members view payslip lines" ON public.payslip_lines;
CREATE POLICY "Members view payslip lines" ON public.payslip_lines
  FOR SELECT USING (EXISTS (
    SELECT 1 FROM public.payslips p
    WHERE p.id = payslip_lines.payslip_id
      AND (is_platform_admin() OR (p.organization_id = current_org_id() AND (has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'hr_manager'::app_role) OR has_role(auth.uid(),'accountant'::app_role))))
  ));

-- payroll_runs: add write policy restricted to admin/hr_manager
DROP POLICY IF EXISTS "HR admins write payroll_runs" ON public.payroll_runs;
CREATE POLICY "HR admins write payroll_runs" ON public.payroll_runs
  FOR ALL USING (organization_id = current_org_id() AND (has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'hr_manager'::app_role)))
  WITH CHECK (organization_id = current_org_id() AND (has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'hr_manager'::app_role)));

-- approval_requests: restrict writes
DROP POLICY IF EXISTS "org write ar" ON public.approval_requests;
CREATE POLICY "org write ar" ON public.approval_requests
  FOR ALL USING (organization_id = current_org_id() AND (has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'accountant'::app_role) OR has_role(auth.uid(),'hr_manager'::app_role)))
  WITH CHECK (organization_id = current_org_id() AND (has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'accountant'::app_role) OR has_role(auth.uid(),'hr_manager'::app_role)));

-- expense_claim_lines: restrict reads/writes
DROP POLICY IF EXISTS "org read claim_lines" ON public.expense_claim_lines;
CREATE POLICY "org read claim_lines" ON public.expense_claim_lines
  FOR SELECT USING ((organization_id = current_org_id() AND (has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'hr_manager'::app_role) OR has_role(auth.uid(),'accountant'::app_role))) OR is_platform_admin());
DROP POLICY IF EXISTS "org write claim_lines" ON public.expense_claim_lines;
CREATE POLICY "org write claim_lines" ON public.expense_claim_lines
  FOR ALL USING (organization_id = current_org_id() AND (has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'hr_manager'::app_role) OR has_role(auth.uid(),'accountant'::app_role)))
  WITH CHECK (organization_id = current_org_id() AND (has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'hr_manager'::app_role) OR has_role(auth.uid(),'accountant'::app_role)));

-- petty_cash_vouchers: restrict reads/writes to finance roles
DROP POLICY IF EXISTS "org read pcv" ON public.petty_cash_vouchers;
CREATE POLICY "org read pcv" ON public.petty_cash_vouchers
  FOR SELECT USING ((organization_id = current_org_id() AND (has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'accountant'::app_role))) OR is_platform_admin());
DROP POLICY IF EXISTS "org write pcv" ON public.petty_cash_vouchers;
CREATE POLICY "org write pcv" ON public.petty_cash_vouchers
  FOR ALL USING (organization_id = current_org_id() AND (has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'accountant'::app_role)))
  WITH CHECK (organization_id = current_org_id() AND (has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'accountant'::app_role)));
