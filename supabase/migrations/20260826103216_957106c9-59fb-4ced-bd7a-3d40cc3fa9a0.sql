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
      AND (ur.organization_id IS NULL OR ur.organization_id = v_org)
    UNION
    SELECT DISTINCT CASE WHEN uo.module = 'hrm_attendance' THEN 'hrm' ELSE uo.module END
    FROM public.user_permission_overrides uo
    JOIN public.subscription_modules sm
      ON sm.organization_id = uo.organization_id
     AND sm.module_code = CASE WHEN uo.module = 'hrm_attendance' THEN 'hrm' ELSE uo.module END
     AND sm.enabled = true
    WHERE uo.organization_id = v_org
      AND uo.user_id = _user_id
      AND uo.action = 'view'::public.app_action
      AND uo.allowed = true;
END
$function$;

REVOKE ALL ON FUNCTION public.get_user_view_modules(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_user_view_modules(uuid) TO authenticated, service_role;