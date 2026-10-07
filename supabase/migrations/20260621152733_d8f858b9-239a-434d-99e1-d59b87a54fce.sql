
-- ===== Org-scoped write policies =====
DROP POLICY IF EXISTS "Admins and operators can insert conversion_services" ON public.conversion_services;
CREATE POLICY "Admins and operators can insert conversion_services" ON public.conversion_services
  FOR INSERT WITH CHECK (organization_id = current_org_id() AND (has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'yard_operator'::app_role)));
DROP POLICY IF EXISTS "Admins and operators can update conversion_services" ON public.conversion_services;
CREATE POLICY "Admins and operators can update conversion_services" ON public.conversion_services
  FOR UPDATE USING (organization_id = current_org_id() AND (has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'yard_operator'::app_role)))
  WITH CHECK (organization_id = current_org_id());

DROP POLICY IF EXISTS "Admins and operators can insert purchases" ON public.purchases;
CREATE POLICY "Admins and operators can insert purchases" ON public.purchases
  FOR INSERT WITH CHECK (organization_id = current_org_id() AND (has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'yard_operator'::app_role)));
DROP POLICY IF EXISTS "Admins and operators can update purchases" ON public.purchases;
CREATE POLICY "Admins and operators can update purchases" ON public.purchases
  FOR UPDATE USING (organization_id = current_org_id() AND (has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'yard_operator'::app_role)))
  WITH CHECK (organization_id = current_org_id());

DROP POLICY IF EXISTS "Admins and operators can insert cost_entries" ON public.cost_entries;
CREATE POLICY "Admins and operators can insert cost_entries" ON public.cost_entries
  FOR INSERT WITH CHECK (organization_id = current_org_id() AND (has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'yard_operator'::app_role)));
DROP POLICY IF EXISTS "Admins and operators can update cost_entries" ON public.cost_entries;
CREATE POLICY "Admins and operators can update cost_entries" ON public.cost_entries
  FOR UPDATE USING (organization_id = current_org_id() AND (has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'yard_operator'::app_role)))
  WITH CHECK (organization_id = current_org_id());

DROP POLICY IF EXISTS "Admins and operators can insert material_requests" ON public.material_requests;
CREATE POLICY "Admins and operators can insert material_requests" ON public.material_requests
  FOR INSERT WITH CHECK (organization_id = current_org_id() AND (has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'yard_operator'::app_role)));
DROP POLICY IF EXISTS "Admins and operators can update material_requests" ON public.material_requests;
CREATE POLICY "Admins and operators can update material_requests" ON public.material_requests
  FOR UPDATE USING (organization_id = current_org_id() AND (has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'yard_operator'::app_role)))
  WITH CHECK (organization_id = current_org_id());

DROP POLICY IF EXISTS "Operators, clerks, and admins can insert line items" ON public.repair_line_items;
CREATE POLICY "Operators, clerks, and admins can insert line items" ON public.repair_line_items
  FOR INSERT WITH CHECK (organization_id = current_org_id() AND (has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'yard_operator'::app_role) OR has_role(auth.uid(),'gate_clerk'::app_role)));
DROP POLICY IF EXISTS "Operators, clerks, and admins can update line items" ON public.repair_line_items;
CREATE POLICY "Operators, clerks, and admins can update line items" ON public.repair_line_items
  FOR UPDATE USING (organization_id = current_org_id() AND (has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'yard_operator'::app_role) OR has_role(auth.uid(),'gate_clerk'::app_role)))
  WITH CHECK (organization_id = current_org_id());

-- ===== Org-scoped read policies =====
DROP POLICY IF EXISTS "Staff can view notification logs" ON public.notification_log;
CREATE POLICY "Staff can view notification logs" ON public.notification_log
  FOR SELECT USING (organization_id = current_org_id() AND (has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'yard_operator'::app_role) OR has_role(auth.uid(),'gate_clerk'::app_role) OR has_role(auth.uid(),'viewer'::app_role)));

DROP POLICY IF EXISTS "Staff can view store_issues" ON public.store_issues;
CREATE POLICY "Staff can view store_issues" ON public.store_issues
  FOR SELECT USING (organization_id = current_org_id() AND (has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'yard_operator'::app_role) OR has_role(auth.uid(),'viewer'::app_role)));

DROP POLICY IF EXISTS "Staff can view store_returns" ON public.store_returns;
CREATE POLICY "Staff can view store_returns" ON public.store_returns
  FOR SELECT USING (organization_id = current_org_id() AND (has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'yard_operator'::app_role) OR has_role(auth.uid(),'viewer'::app_role)));

DROP POLICY IF EXISTS "Staff can view repatriation_costs" ON public.repatriation_costs;
CREATE POLICY "Staff can view repatriation_costs" ON public.repatriation_costs
  FOR SELECT USING (organization_id = current_org_id() AND (has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'yard_operator'::app_role) OR has_role(auth.uid(),'viewer'::app_role)));

-- ===== Sensitive read restrictions =====
DROP POLICY IF EXISTS "edi_exports_select_org" ON public.edi_exports;
CREATE POLICY "edi_exports_select_org" ON public.edi_exports
  FOR SELECT USING (organization_id = current_org_id() AND (has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'accountant'::app_role) OR has_role(auth.uid(),'gate_clerk'::app_role)));

DROP POLICY IF EXISTS "Org members can read finance audit log" ON public.finance_audit_log;
CREATE POLICY "Org members can read finance audit log" ON public.finance_audit_log
  FOR SELECT USING (organization_id = current_org_id() AND (has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'accountant'::app_role)) OR is_platform_admin());

DROP POLICY IF EXISTS "Org members view payroll_runs" ON public.payroll_runs;
CREATE POLICY "Org members view payroll_runs" ON public.payroll_runs
  FOR SELECT USING (organization_id = current_org_id() AND (has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'hr_manager'::app_role) OR has_role(auth.uid(),'accountant'::app_role)) OR is_platform_admin());

-- ===== Expense claim writes restricted to admin/hr/accountant =====
DROP POLICY IF EXISTS "org write claims" ON public.expense_claims;
CREATE POLICY "org write claims" ON public.expense_claims
  FOR ALL USING (organization_id = current_org_id() AND (has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'hr_manager'::app_role) OR has_role(auth.uid(),'accountant'::app_role)))
  WITH CHECK (organization_id = current_org_id() AND (has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'hr_manager'::app_role) OR has_role(auth.uid(),'accountant'::app_role)));

-- ===== GL accounts writes admin-only =====
DROP POLICY IF EXISTS "gl_accounts_insert" ON public.gl_accounts;
CREATE POLICY "gl_accounts_insert" ON public.gl_accounts
  FOR INSERT WITH CHECK (organization_id = current_org_id() AND has_role(auth.uid(),'admin'::app_role));
DROP POLICY IF EXISTS "gl_accounts_update" ON public.gl_accounts;
CREATE POLICY "gl_accounts_update" ON public.gl_accounts
  FOR UPDATE USING (organization_id = current_org_id() AND (NOT is_system) AND has_role(auth.uid(),'admin'::app_role))
  WITH CHECK (organization_id = current_org_id() AND (NOT is_system) AND has_role(auth.uid(),'admin'::app_role));

-- ===== Revoke anon EXECUTE on SECURITY DEFINER RPC functions =====
REVOKE EXECUTE ON FUNCTION public.receive_po_with_variances(uuid, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.receive_po_with_variances(uuid, text, jsonb) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.decide_goods_receipt_variance(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.decide_goods_receipt_variance(uuid, text, text) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.link_supplier_invoice_to_consumption() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.link_supplier_invoice_to_consumption() TO authenticated, service_role;
