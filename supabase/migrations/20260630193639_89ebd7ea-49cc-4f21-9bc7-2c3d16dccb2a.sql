DROP POLICY IF EXISTS "Org admins can view org member profiles" ON public.profiles;
CREATE POLICY "Org admins can view org member profiles"
ON public.profiles FOR SELECT
USING (
  is_platform_admin()
  OR EXISTS (
    SELECT 1 FROM public.organization_members om
    WHERE om.user_id = profiles.user_id
      AND om.status = 'active'
      AND is_org_admin(om.organization_id)
  )
);

DROP POLICY IF EXISTS "Org admins can view member roles" ON public.user_roles;
CREATE POLICY "Org admins can view member roles"
ON public.user_roles FOR SELECT
USING (
  is_platform_admin()
  OR (organization_id IS NOT NULL AND is_org_admin(organization_id))
);