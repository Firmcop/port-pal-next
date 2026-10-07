DROP POLICY IF EXISTS "Org members view projects" ON public.projects;
CREATE POLICY "Org members view projects" ON public.projects FOR SELECT
USING (
  is_platform_admin() OR (
    organization_id = current_org_id() AND (
      has_role(auth.uid(),'admin'::app_role) OR
      has_role(auth.uid(),'org_owner'::app_role) OR
      has_role(auth.uid(),'yard_operator'::app_role) OR
      has_role(auth.uid(),'gate_clerk'::app_role) OR
      has_role(auth.uid(),'viewer'::app_role) OR
      has_role(auth.uid(),'sales_manager'::app_role) OR
      has_role(auth.uid(),'production_manager'::app_role) OR
      has_role(auth.uid(),'procurement_officer'::app_role) OR
      has_role(auth.uid(),'supply_chain_manager'::app_role) OR
      has_role(auth.uid(),'accountant'::app_role) OR
      has_role(auth.uid(),'asset_manager'::app_role)
    )
  )
);

DROP POLICY IF EXISTS "Org staff update projects" ON public.projects;
CREATE POLICY "Org staff update projects" ON public.projects FOR UPDATE
USING (
  is_platform_admin() OR (
    organization_id = current_org_id() AND (
      has_role(auth.uid(),'admin'::app_role) OR
      has_role(auth.uid(),'org_owner'::app_role) OR
      has_role(auth.uid(),'yard_operator'::app_role) OR
      has_role(auth.uid(),'sales_manager'::app_role) OR
      has_role(auth.uid(),'production_manager'::app_role)
    )
  )
);

-- Guard: never let new jobs/projects land in the legacy default organisation
CREATE OR REPLACE FUNCTION public.prevent_legacy_org_assignment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _legacy uuid := '00000000-0000-0000-0000-000000000001';
  _resolved uuid;
BEGIN
  IF NEW.organization_id IS DISTINCT FROM _legacy THEN
    RETURN NEW;
  END IF;
  SELECT om.organization_id INTO _resolved
  FROM public.organization_members om
  WHERE om.user_id = COALESCE(NEW.created_by, auth.uid())
    AND om.organization_id <> _legacy
    AND om.status = 'active'
  ORDER BY om.created_at
  LIMIT 1;
  IF _resolved IS NOT NULL THEN
    NEW.organization_id := _resolved;
  END IF;
  RETURN NEW;
END $$;

REVOKE ALL ON FUNCTION public.prevent_legacy_org_assignment() FROM PUBLIC, anon;

DROP TRIGGER IF EXISTS trg_no_legacy_org_conversions ON public.container_conversions;
CREATE TRIGGER trg_no_legacy_org_conversions
BEFORE INSERT ON public.container_conversions
FOR EACH ROW EXECUTE FUNCTION public.prevent_legacy_org_assignment();

DROP TRIGGER IF EXISTS trg_no_legacy_org_projects ON public.projects;
CREATE TRIGGER trg_no_legacy_org_projects
BEFORE INSERT ON public.projects
FOR EACH ROW EXECUTE FUNCTION public.prevent_legacy_org_assignment();