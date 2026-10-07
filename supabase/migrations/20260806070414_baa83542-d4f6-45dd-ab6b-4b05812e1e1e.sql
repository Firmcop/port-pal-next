-- asset_assignments: role-restricted writes
DROP POLICY IF EXISTS "asset_assignments org write" ON public.asset_assignments;
CREATE POLICY "asset_assignments org write" ON public.asset_assignments
FOR ALL TO authenticated
USING (
  is_platform_admin() OR (
    organization_id = current_org_id() AND (
      has_role(auth.uid(), 'admin'::app_role)
      OR has_role(auth.uid(), 'org_owner'::app_role)
      OR has_role(auth.uid(), 'asset_manager'::app_role)
      OR has_role(auth.uid(), 'mr_supervisor'::app_role)
    )
  )
)
WITH CHECK (
  is_platform_admin() OR (
    organization_id = current_org_id() AND (
      has_role(auth.uid(), 'admin'::app_role)
      OR has_role(auth.uid(), 'org_owner'::app_role)
      OR has_role(auth.uid(), 'asset_manager'::app_role)
      OR has_role(auth.uid(), 'mr_supervisor'::app_role)
    )
  )
);

-- edi_exports: drop yard_operator from UPDATE
DROP POLICY IF EXISTS "edi_exports_update_admin" ON public.edi_exports;
CREATE POLICY "edi_exports_update_admin" ON public.edi_exports
FOR UPDATE TO authenticated
USING (
  organization_id = current_org_id() AND (
    has_role(auth.uid(), 'admin'::app_role)
    OR has_role(auth.uid(), 'accountant'::app_role)
    OR has_role(auth.uid(), 'gate_clerk'::app_role)
  )
)
WITH CHECK (
  organization_id = current_org_id() AND (
    has_role(auth.uid(), 'admin'::app_role)
    OR has_role(auth.uid(), 'accountant'::app_role)
    OR has_role(auth.uid(), 'gate_clerk'::app_role)
  )
);

-- sub-assembly BOM tables: role-restricted writes
DROP POLICY IF EXISTS "sabm_write" ON public.sub_assembly_bom_materials;
CREATE POLICY "sabm_write" ON public.sub_assembly_bom_materials
FOR ALL TO authenticated
USING (is_platform_admin() OR (organization_id = current_org_id() AND (has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'org_owner'::app_role) OR has_role(auth.uid(),'production_manager'::app_role) OR can_write_module(auth.uid(),'conversions'))))
WITH CHECK (is_platform_admin() OR (organization_id = current_org_id() AND (has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'org_owner'::app_role) OR has_role(auth.uid(),'production_manager'::app_role) OR can_write_module(auth.uid(),'conversions'))));

DROP POLICY IF EXISTS "sabl_write" ON public.sub_assembly_bom_labor;
CREATE POLICY "sabl_write" ON public.sub_assembly_bom_labor
FOR ALL TO authenticated
USING (is_platform_admin() OR (organization_id = current_org_id() AND (has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'org_owner'::app_role) OR has_role(auth.uid(),'production_manager'::app_role) OR can_write_module(auth.uid(),'conversions'))))
WITH CHECK (is_platform_admin() OR (organization_id = current_org_id() AND (has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'org_owner'::app_role) OR has_role(auth.uid(),'production_manager'::app_role) OR can_write_module(auth.uid(),'conversions'))));

DROP POLICY IF EXISTS "sabo_write" ON public.sub_assembly_bom_overheads;
CREATE POLICY "sabo_write" ON public.sub_assembly_bom_overheads
FOR ALL TO authenticated
USING (is_platform_admin() OR (organization_id = current_org_id() AND (has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'org_owner'::app_role) OR has_role(auth.uid(),'production_manager'::app_role) OR can_write_module(auth.uid(),'conversions'))))
WITH CHECK (is_platform_admin() OR (organization_id = current_org_id() AND (has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'org_owner'::app_role) OR has_role(auth.uid(),'production_manager'::app_role) OR can_write_module(auth.uid(),'conversions'))));

DROP POLICY IF EXISTS "sal_write" ON public.sub_assembly_lots;
CREATE POLICY "sal_write" ON public.sub_assembly_lots
FOR ALL TO authenticated
USING (is_platform_admin() OR (organization_id = current_org_id() AND (has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'org_owner'::app_role) OR has_role(auth.uid(),'production_manager'::app_role) OR can_write_module(auth.uid(),'conversions'))))
WITH CHECK (is_platform_admin() OR (organization_id = current_org_id() AND (has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'org_owner'::app_role) OR has_role(auth.uid(),'production_manager'::app_role) OR can_write_module(auth.uid(),'conversions'))));