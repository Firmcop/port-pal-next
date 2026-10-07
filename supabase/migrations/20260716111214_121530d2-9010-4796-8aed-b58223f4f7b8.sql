DROP POLICY IF EXISTS "Org members view goods_receipts" ON public.goods_receipts;
CREATE POLICY "Org members view goods_receipts" ON public.goods_receipts FOR SELECT
USING (
  is_platform_admin() OR (
    organization_id = current_org_id() AND (
      has_role(auth.uid(),'admin'::app_role) OR
      has_role(auth.uid(),'yard_operator'::app_role) OR
      has_role(auth.uid(),'gate_clerk'::app_role) OR
      has_role(auth.uid(),'viewer'::app_role) OR
      has_role(auth.uid(),'procurement_officer'::app_role) OR
      has_role(auth.uid(),'supply_chain_manager'::app_role) OR
      has_role(auth.uid(),'production_manager'::app_role) OR
      has_role(auth.uid(),'accountant'::app_role)
    )
  )
);

DROP POLICY IF EXISTS "Org members view purchase_orders" ON public.purchase_orders;
CREATE POLICY "Org members view purchase_orders" ON public.purchase_orders FOR SELECT
USING (
  is_platform_admin() OR (
    organization_id = current_org_id() AND (
      has_role(auth.uid(),'admin'::app_role) OR
      has_role(auth.uid(),'yard_operator'::app_role) OR
      has_role(auth.uid(),'gate_clerk'::app_role) OR
      has_role(auth.uid(),'viewer'::app_role) OR
      has_role(auth.uid(),'procurement_officer'::app_role) OR
      has_role(auth.uid(),'supply_chain_manager'::app_role) OR
      has_role(auth.uid(),'production_manager'::app_role) OR
      has_role(auth.uid(),'accountant'::app_role)
    )
  )
);