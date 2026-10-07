REVOKE ALL ON FUNCTION public.enforce_po_status_transition() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.guard_profile_privileged_columns() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.post_store_issue_movement() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.post_store_return_movement() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.sync_material_stock_mirror() FROM PUBLIC, anon, authenticated;

DROP POLICY IF EXISTS "org read pc" ON public.petty_cash_floats;
CREATE POLICY "org read pc" ON public.petty_cash_floats
FOR SELECT TO authenticated
USING (
  (organization_id = current_org_id()
   AND (public.has_role(auth.uid(),'admin'::app_role) OR public.has_role(auth.uid(),'accountant'::app_role)))
  OR public.is_platform_admin()
);