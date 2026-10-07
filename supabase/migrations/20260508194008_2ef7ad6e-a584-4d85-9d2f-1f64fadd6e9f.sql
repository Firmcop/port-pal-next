-- Fix infinite recursion on organization_members RLS

-- Helper: is_org_admin (security definer to bypass RLS)
CREATE OR REPLACE FUNCTION public.is_org_admin(_org_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.organization_members
    WHERE organization_id = _org_id
      AND user_id = auth.uid()
      AND role IN ('org_owner','admin')
      AND status = 'active'
  )
$$;

DROP POLICY IF EXISTS "Members read own org roster" ON public.organization_members;
DROP POLICY IF EXISTS "Org admins manage members" ON public.organization_members;

-- Non-recursive SELECT: a user can always read their own membership rows;
-- platform admins see everything; org admins see roster of orgs they admin.
CREATE POLICY "Members read own membership rows" ON public.organization_members
  FOR SELECT USING (
    user_id = auth.uid()
    OR public.is_platform_admin()
    OR public.is_org_admin(organization_id)
  );

CREATE POLICY "Org admins manage members" ON public.organization_members
  FOR ALL USING (
    public.is_platform_admin() OR public.is_org_admin(organization_id)
  ) WITH CHECK (
    public.is_platform_admin() OR public.is_org_admin(organization_id)
  );
