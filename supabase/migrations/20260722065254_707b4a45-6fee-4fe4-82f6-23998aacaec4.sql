
-- 1. approval_events INSERT
DROP POLICY IF EXISTS "approval_events service insert" ON public.approval_events;
CREATE POLICY "approval_events privileged insert" ON public.approval_events
  FOR INSERT TO authenticated
  WITH CHECK (
    organization_id = current_org_id()
    AND (
      is_platform_admin()
      OR has_role(auth.uid(), 'admin'::app_role)
      OR has_role(auth.uid(), 'accountant'::app_role)
    )
  );

-- 2. asset_chargeback_payments write
DROP POLICY IF EXISTS "org write chargeback payments" ON public.asset_chargeback_payments;
CREATE POLICY "org write chargeback payments" ON public.asset_chargeback_payments
  FOR ALL TO authenticated
  USING (
    organization_id = current_org_id()
    AND (
      is_platform_admin()
      OR has_role(auth.uid(), 'admin'::app_role)
      OR has_role(auth.uid(), 'accountant'::app_role)
      OR has_role(auth.uid(), 'yard_operator'::app_role)
    )
  )
  WITH CHECK (
    organization_id = current_org_id()
    AND (
      is_platform_admin()
      OR has_role(auth.uid(), 'admin'::app_role)
      OR has_role(auth.uid(), 'accountant'::app_role)
      OR has_role(auth.uid(), 'yard_operator'::app_role)
    )
  );

-- 3. finance_audit_log INSERT
DROP POLICY IF EXISTS "System can insert finance audit log" ON public.finance_audit_log;
CREATE POLICY "Privileged insert finance audit log" ON public.finance_audit_log
  FOR INSERT TO authenticated
  WITH CHECK (
    (organization_id = current_org_id() AND (
      has_role(auth.uid(), 'admin'::app_role)
      OR has_role(auth.uid(), 'accountant'::app_role)
    ))
    OR is_platform_admin()
  );

-- 4. goods_receipt_audit INSERT
DROP POLICY IF EXISTS "audit_org_insert" ON public.goods_receipt_audit;
CREATE POLICY "audit_org_insert" ON public.goods_receipt_audit
  FOR INSERT TO authenticated
  WITH CHECK (
    (organization_id = current_org_id() AND (
      has_role(auth.uid(), 'admin'::app_role)
      OR has_role(auth.uid(), 'procurement_officer'::app_role)
      OR has_role(auth.uid(), 'supply_chain_manager'::app_role)
    ))
    OR is_platform_admin()
  );

-- 5. recurring_transfer_runs INSERT
DROP POLICY IF EXISTS "System inserts recurring_transfer_runs" ON public.recurring_transfer_runs;
CREATE POLICY "Privileged inserts recurring_transfer_runs" ON public.recurring_transfer_runs
  FOR INSERT TO authenticated
  WITH CHECK (
    organization_id = current_org_id()
    AND (
      is_platform_admin()
      OR has_role(auth.uid(), 'admin'::app_role)
      OR has_role(auth.uid(), 'accountant'::app_role)
    )
  );

-- 6. Revoke anon EXECUTE on SECURITY DEFINER functions
REVOKE EXECUTE ON FUNCTION public.generate_invoice_from_quote(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.invoice_balance(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.prevent_invoice_overpayment() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.generate_invoice_from_quote(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.invoice_balance(uuid) TO authenticated;
