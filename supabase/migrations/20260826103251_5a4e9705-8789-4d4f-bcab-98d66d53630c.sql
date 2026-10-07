CREATE OR REPLACE FUNCTION public.has_permission(_user_id uuid, _module text, _action public.app_action)
RETURNS boolean
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_org uuid;
  v_user_override boolean;
  v_role_module text := CASE WHEN _module = 'hrm_attendance' THEN 'hrm' ELSE _module END;
BEGIN
  IF _user_id IS NULL THEN RETURN false; END IF;
  IF public.is_platform_admin() THEN RETURN true; END IF;

  v_org := public.current_org_id();

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

  SELECT uo.allowed INTO v_user_override
  FROM public.user_permission_overrides uo
  WHERE uo.organization_id = v_org
    AND uo.user_id = _user_id
    AND uo.module = _module
    AND uo.action = _action
  LIMIT 1;
  IF v_user_override IS NOT NULL THEN RETURN v_user_override; END IF;

  IF EXISTS (
    SELECT 1
    FROM public.user_roles ur
    JOIN public.role_permission_overrides ro
      ON ro.role = ur.role
     AND ro.organization_id = v_org
     AND ro.module = v_role_module
     AND ro.action = _action
     AND ro.allowed = true
    WHERE ur.user_id = _user_id
      AND (ur.organization_id IS NULL OR ur.organization_id = v_org)
  ) THEN
    RETURN true;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.user_roles ur
    JOIN public.role_permission_defaults rd
      ON rd.role = ur.role
     AND rd.module = v_role_module
     AND rd.action = _action
     AND rd.allowed = true
    LEFT JOIN public.role_permission_overrides ro
      ON ro.role = ur.role
     AND ro.organization_id = v_org
     AND ro.module = v_role_module
     AND ro.action = _action
    WHERE ur.user_id = _user_id
      AND (ur.organization_id IS NULL OR ur.organization_id = v_org)
      AND (ro.allowed IS NULL OR ro.allowed = true)
  ) THEN
    RETURN true;
  END IF;

  RETURN false;
END
$function$;

REVOKE ALL ON FUNCTION public.has_permission(uuid, text, public.app_action) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_permission(uuid, text, public.app_action) TO authenticated, service_role;