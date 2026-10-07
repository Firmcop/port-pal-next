
-- 1. Fix finance_dashboard_metrics view to use security_invoker
ALTER VIEW IF EXISTS public.finance_dashboard_metrics SET (security_invoker = true);

-- 2. Revoke EXECUTE from anon on SECURITY DEFINER functions (anon should never call these)
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.oid, p.proname, pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname='public' AND p.prosecdef
      AND has_function_privilege('anon', p.oid, 'EXECUTE')
      AND p.proname NOT IN ('has_role','has_permission','is_platform_admin','current_org_id','get_portal_customer_id')
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION public.%I(%s) FROM anon, PUBLIC;', r.proname, r.args);
  END LOOP;
END$$;

-- 3. conversion_labour: scope writes to org
DROP POLICY IF EXISTS "Admins and operators can insert conversion_labour" ON public.conversion_labour;
CREATE POLICY "Admins and operators can insert conversion_labour"
  ON public.conversion_labour FOR INSERT TO authenticated
  WITH CHECK (organization_id = current_org_id()
    AND (has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'yard_operator'::app_role)));
DROP POLICY IF EXISTS "Admins and operators can update conversion_labour" ON public.conversion_labour;
CREATE POLICY "Admins and operators can update conversion_labour"
  ON public.conversion_labour FOR UPDATE TO authenticated
  USING (organization_id = current_org_id()
    AND (has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'yard_operator'::app_role)))
  WITH CHECK (organization_id = current_org_id());

-- 4. conversion_materials
DROP POLICY IF EXISTS "Admins and operators can insert materials" ON public.conversion_materials;
CREATE POLICY "Admins and operators can insert materials"
  ON public.conversion_materials FOR INSERT TO authenticated
  WITH CHECK (organization_id = current_org_id()
    AND (has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'yard_operator'::app_role)));
DROP POLICY IF EXISTS "Admins and operators can update materials" ON public.conversion_materials;
CREATE POLICY "Admins and operators can update materials"
  ON public.conversion_materials FOR UPDATE TO authenticated
  USING (organization_id = current_org_id()
    AND (has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'yard_operator'::app_role)))
  WITH CHECK (organization_id = current_org_id());

-- 5. conversion_tasks
DROP POLICY IF EXISTS "Admins and operators can insert conversion_tasks" ON public.conversion_tasks;
CREATE POLICY "Admins and operators can insert conversion_tasks"
  ON public.conversion_tasks FOR INSERT TO authenticated
  WITH CHECK (organization_id = current_org_id()
    AND (has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'yard_operator'::app_role)));
DROP POLICY IF EXISTS "Admins and operators can update conversion_tasks" ON public.conversion_tasks;
CREATE POLICY "Admins and operators can update conversion_tasks"
  ON public.conversion_tasks FOR UPDATE TO authenticated
  USING (organization_id = current_org_id()
    AND (has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'yard_operator'::app_role)))
  WITH CHECK (organization_id = current_org_id());

-- 6. customer_portal_users: add org scope to admin writes/select
DROP POLICY IF EXISTS "Admins can insert portal users" ON public.customer_portal_users;
CREATE POLICY "Admins can insert portal users"
  ON public.customer_portal_users FOR INSERT TO authenticated
  WITH CHECK (has_role(auth.uid(),'admin'::app_role)
    AND organization_id = current_org_id());
DROP POLICY IF EXISTS "Admins can update portal users" ON public.customer_portal_users;
CREATE POLICY "Admins can update portal users"
  ON public.customer_portal_users FOR UPDATE TO authenticated
  USING (has_role(auth.uid(),'admin'::app_role) AND organization_id = current_org_id())
  WITH CHECK (has_role(auth.uid(),'admin'::app_role) AND organization_id = current_org_id());
DROP POLICY IF EXISTS "Admins can delete portal users" ON public.customer_portal_users;
CREATE POLICY "Admins can delete portal users"
  ON public.customer_portal_users FOR DELETE TO authenticated
  USING (has_role(auth.uid(),'admin'::app_role) AND organization_id = current_org_id());
DROP POLICY IF EXISTS "Staff can view all portal users" ON public.customer_portal_users;
CREATE POLICY "Staff can view all portal users"
  ON public.customer_portal_users FOR SELECT TO authenticated
  USING (has_role(auth.uid(),'admin'::app_role) AND organization_id = current_org_id());

-- 7. employees: restrict SELECT to admin/hr_manager/accountant
DROP POLICY IF EXISTS "Org members view employees" ON public.employees;
CREATE POLICY "Org HR view employees"
  ON public.employees FOR SELECT TO authenticated
  USING (is_platform_admin() OR (
    organization_id = current_org_id() AND (
      has_role(auth.uid(),'admin'::app_role)
      OR has_role(auth.uid(),'hr_manager'::app_role)
      OR has_role(auth.uid(),'accountant'::app_role)
    )
  ));

-- 8. fiscal_periods: require admin for writes
DROP POLICY IF EXISTS "fiscal_periods_insert" ON public.fiscal_periods;
CREATE POLICY "fiscal_periods_insert"
  ON public.fiscal_periods FOR INSERT TO authenticated
  WITH CHECK (organization_id = current_org_id() AND has_role(auth.uid(),'admin'::app_role));
DROP POLICY IF EXISTS "fiscal_periods_update" ON public.fiscal_periods;
CREATE POLICY "fiscal_periods_update"
  ON public.fiscal_periods FOR UPDATE TO authenticated
  USING (organization_id = current_org_id() AND has_role(auth.uid(),'admin'::app_role))
  WITH CHECK (organization_id = current_org_id() AND has_role(auth.uid(),'admin'::app_role));

-- 9. gl_accounts: admin-only DELETE
DROP POLICY IF EXISTS "gl_accounts_delete" ON public.gl_accounts;
CREATE POLICY "gl_accounts_delete"
  ON public.gl_accounts FOR DELETE TO authenticated
  USING (organization_id = current_org_id() AND NOT is_system AND has_role(auth.uid(),'admin'::app_role));

-- 10. goods_receipt_items
DROP POLICY IF EXISTS "Admins and operators can insert goods_receipt_items" ON public.goods_receipt_items;
CREATE POLICY "Admins and operators can insert goods_receipt_items"
  ON public.goods_receipt_items FOR INSERT TO authenticated
  WITH CHECK (organization_id = current_org_id()
    AND (has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'yard_operator'::app_role)));
DROP POLICY IF EXISTS "Admins and operators can update goods_receipt_items" ON public.goods_receipt_items;
CREATE POLICY "Admins and operators can update goods_receipt_items"
  ON public.goods_receipt_items FOR UPDATE TO authenticated
  USING (organization_id = current_org_id()
    AND (has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'yard_operator'::app_role)))
  WITH CHECK (organization_id = current_org_id());

-- 11. lease_invoices_run: scope staff SELECT to org
DROP POLICY IF EXISTS "Staff view lease billing runs" ON public.lease_invoices_run;
CREATE POLICY "Staff view lease billing runs"
  ON public.lease_invoices_run FOR SELECT TO authenticated
  USING (
    (lease_id IN (SELECT id FROM public.lease_agreements WHERE organization_id = current_org_id()))
    AND (has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'yard_operator'::app_role)
      OR has_role(auth.uid(),'gate_clerk'::app_role) OR has_role(auth.uid(),'viewer'::app_role))
  );

-- 12. material_stock
DROP POLICY IF EXISTS "Admins and operators can insert material_stock" ON public.material_stock;
CREATE POLICY "Admins and operators can insert material_stock"
  ON public.material_stock FOR INSERT TO authenticated
  WITH CHECK (organization_id = current_org_id()
    AND (has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'yard_operator'::app_role)));
DROP POLICY IF EXISTS "Admins and operators can update material_stock" ON public.material_stock;
CREATE POLICY "Admins and operators can update material_stock"
  ON public.material_stock FOR UPDATE TO authenticated
  USING (organization_id = current_org_id()
    AND (has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'yard_operator'::app_role)))
  WITH CHECK (organization_id = current_org_id());
DROP POLICY IF EXISTS "Admins can delete material_stock" ON public.material_stock;
CREATE POLICY "Admins can delete material_stock"
  ON public.material_stock FOR DELETE TO authenticated
  USING (organization_id = current_org_id() AND has_role(auth.uid(),'admin'::app_role));

-- 13. notification_log
DROP POLICY IF EXISTS "Admins operators clerks can insert notification logs" ON public.notification_log;
CREATE POLICY "Admins operators clerks can insert notification logs"
  ON public.notification_log FOR INSERT TO authenticated
  WITH CHECK (organization_id = current_org_id()
    AND (has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'yard_operator'::app_role)
      OR has_role(auth.uid(),'gate_clerk'::app_role)));

-- 14. payslips: restrict SELECT to admin/hr_manager/accountant
DROP POLICY IF EXISTS "Org members view payslips" ON public.payslips;
CREATE POLICY "Org HR view payslips"
  ON public.payslips FOR SELECT TO authenticated
  USING (is_platform_admin() OR (
    organization_id = current_org_id() AND (
      has_role(auth.uid(),'admin'::app_role)
      OR has_role(auth.uid(),'hr_manager'::app_role)
      OR has_role(auth.uid(),'accountant'::app_role)
    )
  ));

-- 15. repatriation_costs
DROP POLICY IF EXISTS "Admins and operators can insert repatriation_costs" ON public.repatriation_costs;
CREATE POLICY "Admins and operators can insert repatriation_costs"
  ON public.repatriation_costs FOR INSERT TO authenticated
  WITH CHECK (organization_id = current_org_id()
    AND (has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'yard_operator'::app_role)));
DROP POLICY IF EXISTS "Admins and operators can update repatriation_costs" ON public.repatriation_costs;
CREATE POLICY "Admins and operators can update repatriation_costs"
  ON public.repatriation_costs FOR UPDATE TO authenticated
  USING (organization_id = current_org_id()
    AND (has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'yard_operator'::app_role)))
  WITH CHECK (organization_id = current_org_id());

-- 16. store_issues
DROP POLICY IF EXISTS "Admins and operators can insert store_issues" ON public.store_issues;
CREATE POLICY "Admins and operators can insert store_issues"
  ON public.store_issues FOR INSERT TO authenticated
  WITH CHECK (organization_id = current_org_id()
    AND (has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'yard_operator'::app_role)));
DROP POLICY IF EXISTS "Admins and operators can update store_issues" ON public.store_issues;
CREATE POLICY "Admins and operators can update store_issues"
  ON public.store_issues FOR UPDATE TO authenticated
  USING (organization_id = current_org_id()
    AND (has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'yard_operator'::app_role)))
  WITH CHECK (organization_id = current_org_id());

-- 17. store_returns
DROP POLICY IF EXISTS "Admins and operators can insert store_returns" ON public.store_returns;
CREATE POLICY "Admins and operators can insert store_returns"
  ON public.store_returns FOR INSERT TO authenticated
  WITH CHECK (organization_id = current_org_id()
    AND (has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'yard_operator'::app_role)));
DROP POLICY IF EXISTS "Admins and operators can update store_returns" ON public.store_returns;
CREATE POLICY "Admins and operators can update store_returns"
  ON public.store_returns FOR UPDATE TO authenticated
  USING (organization_id = current_org_id()
    AND (has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'yard_operator'::app_role)))
  WITH CHECK (organization_id = current_org_id());
