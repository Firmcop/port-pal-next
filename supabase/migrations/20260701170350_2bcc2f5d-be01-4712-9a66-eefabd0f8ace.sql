
-- Functional-area visibility helper for the Users directory.
-- Returns NULL when the viewer can see every member of the current org
-- (admin, org_owner, hr_manager, platform admin), an empty array when
-- they have no directory access, otherwise the set of staff roles they
-- may view.
CREATE OR REPLACE FUNCTION public.user_directory_visible_roles(_user_id uuid)
RETURNS text[]
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org uuid := public.current_org_id();
BEGIN
  IF public.is_platform_admin() THEN
    RETURN NULL;
  END IF;
  IF v_org IS NULL THEN
    RETURN ARRAY[]::text[];
  END IF;
  IF public.is_org_admin(v_org) THEN
    RETURN NULL;
  END IF;
  IF EXISTS (SELECT 1 FROM public.user_roles
             WHERE user_id = _user_id AND organization_id = v_org
               AND role::text = 'hr_manager') THEN
    RETURN NULL;
  END IF;
  IF EXISTS (SELECT 1 FROM public.user_roles
             WHERE user_id = _user_id AND organization_id = v_org
               AND role::text = 'sales_manager') THEN
    RETURN ARRAY['sales_manager','leasing_manager','viewer'];
  END IF;
  IF EXISTS (SELECT 1 FROM public.user_roles
             WHERE user_id = _user_id AND organization_id = v_org
               AND role::text = 'supply_chain_manager') THEN
    RETURN ARRAY['supply_chain_manager','procurement_officer','yard_operator','gate_clerk','viewer'];
  END IF;
  IF EXISTS (SELECT 1 FROM public.user_roles
             WHERE user_id = _user_id AND organization_id = v_org
               AND role::text = 'production_manager') THEN
    RETURN ARRAY['production_manager','mr_supervisor','yard_operator','viewer'];
  END IF;
  IF EXISTS (SELECT 1 FROM public.user_roles
             WHERE user_id = _user_id AND organization_id = v_org
               AND role::text = 'leasing_manager') THEN
    RETURN ARRAY['leasing_manager','sales_manager','viewer'];
  END IF;
  IF EXISTS (SELECT 1 FROM public.user_roles
             WHERE user_id = _user_id AND organization_id = v_org
               AND role::text = 'mr_supervisor') THEN
    RETURN ARRAY['mr_supervisor','production_manager','yard_operator','viewer'];
  END IF;
  RETURN ARRAY[]::text[];
END;
$$;

REVOKE ALL ON FUNCTION public.user_directory_visible_roles(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.user_directory_visible_roles(uuid) TO authenticated, service_role;

-- Broaden SELECT on profiles: managers see own row + teammates whose roles
-- intersect their functional-area scope. Admin/owner policy already exists.
DROP POLICY IF EXISTS "Managers can view scoped org profiles" ON public.profiles;
CREATE POLICY "Managers can view scoped org profiles"
ON public.profiles FOR SELECT
USING (
  auth.uid() = user_id
  OR EXISTS (
    SELECT 1
    FROM public.organization_members om
    WHERE om.user_id = profiles.user_id
      AND om.organization_id = public.current_org_id()
      AND om.status = 'active'
  )
  AND (
    public.user_directory_visible_roles(auth.uid()) IS NULL
    OR (
      cardinality(public.user_directory_visible_roles(auth.uid())) > 0
      AND EXISTS (
        SELECT 1 FROM public.user_roles ur
        WHERE ur.user_id = profiles.user_id
          AND ur.organization_id = public.current_org_id()
          AND ur.role::text = ANY (public.user_directory_visible_roles(auth.uid()))
      )
    )
  )
);

-- Broaden SELECT on user_roles similarly.
DROP POLICY IF EXISTS "Managers can view scoped org roles" ON public.user_roles;
CREATE POLICY "Managers can view scoped org roles"
ON public.user_roles FOR SELECT
USING (
  organization_id = public.current_org_id()
  AND (
    user_id = auth.uid()
    OR public.user_directory_visible_roles(auth.uid()) IS NULL
    OR (
      cardinality(public.user_directory_visible_roles(auth.uid())) > 0
      AND role::text = ANY (public.user_directory_visible_roles(auth.uid()))
    )
  )
);
