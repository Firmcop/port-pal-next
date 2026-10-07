
DROP POLICY IF EXISTS "Org members view bank_reconciliations" ON public.bank_reconciliations;
CREATE POLICY "Finance roles view bank_reconciliations" ON public.bank_reconciliations
FOR SELECT TO authenticated
USING (is_platform_admin() OR (organization_id = current_org_id() AND (
  has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'org_owner'::app_role) OR has_role(auth.uid(),'accountant'::app_role))));

DROP POLICY IF EXISTS "Org members view recon_lines" ON public.bank_reconciliation_lines;
CREATE POLICY "Finance roles view recon_lines" ON public.bank_reconciliation_lines
FOR SELECT TO authenticated
USING (is_platform_admin() OR (organization_id = current_org_id() AND (
  has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'org_owner'::app_role) OR has_role(auth.uid(),'accountant'::app_role))));

DROP POLICY IF EXISTS "Org members view stmt_imports" ON public.bank_statement_imports;
CREATE POLICY "Finance roles view stmt_imports" ON public.bank_statement_imports
FOR SELECT TO authenticated
USING (is_platform_admin() OR (organization_id = current_org_id() AND (
  has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'org_owner'::app_role) OR has_role(auth.uid(),'accountant'::app_role))));

DROP POLICY IF EXISTS "Org members view financial_accounts" ON public.financial_accounts;
CREATE POLICY "Finance roles view financial_accounts" ON public.financial_accounts
FOR SELECT TO authenticated
USING (is_platform_admin() OR (organization_id = current_org_id() AND (
  has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'org_owner'::app_role) OR has_role(auth.uid(),'accountant'::app_role))));

DROP POLICY IF EXISTS "Org members view transfers" ON public.inter_account_transfers;
CREATE POLICY "Finance roles view transfers" ON public.inter_account_transfers
FOR SELECT TO authenticated
USING (is_platform_admin() OR (organization_id = current_org_id() AND (
  has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'org_owner'::app_role) OR has_role(auth.uid(),'accountant'::app_role))));

DROP POLICY IF EXISTS "audit_org_select" ON public.goods_receipt_audit;
CREATE POLICY "audit_org_select" ON public.goods_receipt_audit
FOR SELECT TO authenticated
USING (is_platform_admin() OR (organization_id = current_org_id() AND (
  has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'org_owner'::app_role)
  OR has_role(auth.uid(),'procurement_officer'::app_role) OR has_role(auth.uid(),'supply_chain_manager'::app_role))));
