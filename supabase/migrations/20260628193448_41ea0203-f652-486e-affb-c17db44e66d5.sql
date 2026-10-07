
CREATE OR REPLACE FUNCTION public.get_user_view_modules(_user_id uuid)
RETURNS SETOF text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org uuid;
  v_role text;
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

  SELECT role::text INTO v_role
  FROM public.user_roles
  WHERE user_id = _user_id
    AND (organization_id IS NULL OR organization_id = v_org)
  ORDER BY CASE role::text
    WHEN 'admin' THEN 100
    WHEN 'accountant' THEN 60
    WHEN 'hr_manager' THEN 60
    WHEN 'production_manager' THEN 60
    WHEN 'procurement_officer' THEN 60
    WHEN 'supply_chain_manager' THEN 60
    WHEN 'sales_manager' THEN 60
    WHEN 'leasing_manager' THEN 60
    WHEN 'mr_supervisor' THEN 60
    WHEN 'yard_operator' THEN 30
    WHEN 'gate_clerk' THEN 20
    WHEN 'viewer' THEN 10
    ELSE 0 END DESC
  LIMIT 1;

  -- Admin staff role: full access to enabled modules
  IF v_role = 'admin' THEN
    RETURN QUERY
      SELECT 'core'::text
      UNION
      SELECT sm.module_code
      FROM public.subscription_modules sm
      WHERE sm.organization_id = v_org AND sm.enabled = true;
    RETURN;
  END IF;

  -- Non-admin: only explicitly granted modules via role overrides, intersected with enabled modules
  RETURN QUERY
    SELECT 'core'::text
    UNION
    SELECT ro.module
    FROM public.role_permission_overrides ro
    JOIN public.subscription_modules sm
      ON sm.organization_id = ro.organization_id
     AND sm.module_code = ro.module
     AND sm.enabled = true
    WHERE ro.organization_id = v_org
      AND ro.role::text = COALESCE(v_role, '')
      AND ro.action = 'view'::public.app_action
      AND ro.allowed = true;
END $$;

REVOKE EXECUTE ON FUNCTION public.get_user_view_modules(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_user_view_modules(uuid) TO authenticated, service_role;
