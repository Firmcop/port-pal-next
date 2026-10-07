CREATE POLICY rbac_delete ON public.quote_template_items
  FOR DELETE USING (
    is_platform_admin()
    OR (organization_id = current_org_id() AND can_write_module(auth.uid(), 'crm'))
  );

CREATE POLICY rbac_delete ON public.quote_template_sections
  FOR DELETE USING (
    is_platform_admin()
    OR (organization_id = current_org_id() AND can_write_module(auth.uid(), 'crm'))
  );