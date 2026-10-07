
-- =========================================================
-- get_user_view_modules: union across ALL the user's roles
-- =========================================================
CREATE OR REPLACE FUNCTION public.get_user_view_modules(_user_id uuid)
RETURNS SETOF text
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_org uuid;
  v_is_admin boolean;
BEGIN
  IF _user_id IS NULL THEN RETURN; END IF;

  IF public.is_platform_admin() THEN
    RETURN QUERY
      SELECT 'core'::text
      UNION
      SELECT sm.module_code
      FROM public.subscription_modules sm
      WHERE sm.enabled = true;
    RETURN;
  END IF;

  v_org := public.current_org_id();

  -- Admin (staff role) in this org OR org_owner gets full access to enabled modules
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id
      AND role::text = 'admin'
      AND (organization_id IS NULL OR organization_id = v_org)
  ) OR EXISTS (
    SELECT 1 FROM public.organization_members
    WHERE user_id = _user_id
      AND organization_id = v_org
      AND role IN ('org_owner','admin')
  )
  INTO v_is_admin;

  IF v_is_admin THEN
    RETURN QUERY
      SELECT 'core'::text
      UNION
      SELECT sm.module_code
      FROM public.subscription_modules sm
      WHERE sm.organization_id = v_org AND sm.enabled = true;
    RETURN;
  END IF;

  -- Non-admin: union of view-allowed modules across ALL roles the user holds
  RETURN QUERY
    SELECT 'core'::text
    UNION
    SELECT DISTINCT ro.module
    FROM public.user_roles ur
    JOIN public.role_permission_overrides ro
      ON ro.role = ur.role
     AND ro.organization_id = v_org
     AND ro.action = 'view'::public.app_action
     AND ro.allowed = true
    JOIN public.subscription_modules sm
      ON sm.organization_id = v_org
     AND sm.module_code = ro.module
     AND sm.enabled = true
    WHERE ur.user_id = _user_id
      AND (ur.organization_id IS NULL OR ur.organization_id = v_org);
END $function$;

-- =========================================================
-- has_permission: allow if ANY held role grants the action
-- (explicit per-role override denials still apply for that role)
-- =========================================================
CREATE OR REPLACE FUNCTION public.has_permission(_user_id uuid, _module text, _action app_action)
RETURNS boolean
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_org uuid;
BEGIN
  IF _user_id IS NULL THEN RETURN false; END IF;
  IF public.is_platform_admin() THEN RETURN true; END IF;

  v_org := public.current_org_id();

  -- Admin staff role or org owner/admin in this org = full access
  IF EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id
      AND role::text = 'admin'
      AND (organization_id IS NULL OR organization_id = v_org)
  ) OR EXISTS (
    SELECT 1 FROM public.organization_members
    WHERE user_id = _user_id
      AND organization_id = v_org
      AND role IN ('org_owner','admin')
  ) THEN
    RETURN true;
  END IF;

  -- Allow if ANY role the user holds is granted via override
  IF EXISTS (
    SELECT 1
    FROM public.user_roles ur
    JOIN public.role_permission_overrides ro
      ON ro.role = ur.role
     AND ro.organization_id = v_org
     AND ro.module = _module
     AND ro.action = _action
     AND ro.allowed = true
    WHERE ur.user_id = _user_id
      AND (ur.organization_id IS NULL OR ur.organization_id = v_org)
  ) THEN
    RETURN true;
  END IF;

  -- Fall back to role defaults if no override grants it
  IF EXISTS (
    SELECT 1
    FROM public.user_roles ur
    JOIN public.role_permission_defaults rd
      ON rd.role = ur.role
     AND rd.module = _module
     AND rd.action = _action
     AND rd.allowed = true
    LEFT JOIN public.role_permission_overrides ro
      ON ro.role = ur.role
     AND ro.organization_id = v_org
     AND ro.module = _module
     AND ro.action = _action
    WHERE ur.user_id = _user_id
      AND (ur.organization_id IS NULL OR ur.organization_id = v_org)
      AND (ro.allowed IS NULL OR ro.allowed = true)  -- no explicit deny for this role
  ) THEN
    RETURN true;
  END IF;

  RETURN false;
END $function$;
