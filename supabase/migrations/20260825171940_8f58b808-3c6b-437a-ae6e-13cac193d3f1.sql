GRANT INSERT ON public.repatriation_handling_invoice_lines TO authenticated;
CREATE POLICY "Admins and yard operators can create repatriation handling links"
ON public.repatriation_handling_invoice_lines FOR INSERT TO authenticated
WITH CHECK (
  organization_id=public.current_org_id()
  AND (public.is_platform_admin() OR public.has_role(auth.uid(),'admin'::app_role) OR public.has_role(auth.uid(),'yard_operator'::app_role))
);
ALTER FUNCTION public.generate_repatriation_handling_invoice(uuid[],text,numeric,text) SECURITY INVOKER;
ALTER FUNCTION public.preview_repatriation_handling_invoice(uuid[],text) SECURITY INVOKER;
ALTER FUNCTION public.repatriation_handling_reconciliation() SECURITY INVOKER;