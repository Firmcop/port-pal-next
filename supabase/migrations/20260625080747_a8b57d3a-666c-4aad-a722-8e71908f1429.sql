
-- 1) Updated has_permission: scope to current org and rank extended roles correctly
CREATE OR REPLACE FUNCTION public.has_permission(_user_id uuid, _module text, _action public.app_action)
RETURNS boolean
LANGUAGE plpgsql
STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_org uuid;
  v_role text;
  v_allowed boolean;
BEGIN
  IF _user_id IS NULL THEN RETURN false; END IF;
  IF public.is_platform_admin() THEN RETURN true; END IF;
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
    WHEN 'customer' THEN 5
    ELSE 0 END DESC
  LIMIT 1;

  IF v_role IS NULL THEN RETURN false; END IF;
  IF v_role = 'admin' THEN RETURN true; END IF;

  SELECT allowed INTO v_allowed FROM public.role_permission_overrides
    WHERE organization_id = v_org AND role::text = v_role AND module = _module AND action = _action;
  IF v_allowed IS NOT NULL THEN RETURN v_allowed; END IF;

  SELECT allowed INTO v_allowed FROM public.role_permission_defaults
    WHERE role::text = v_role AND module = _module AND action = _action;
  RETURN COALESCE(v_allowed, false);
END $$;

-- 2) Backfill defaults for extended roles (idempotent, only inserts missing rows)
WITH modules(m) AS (VALUES
  ('inventory'),('gate'),('mr'),('billing'),('accounting'),('crm'),
  ('manufacturing'),('procurement'),('leasing'),('logistics'),('hrm'),
  ('portal'),('whatsapp'),('sync_audit'),('release_instructions'),
  ('vendor_payments'),('sale_automation'),('repatriation')
), actions(a) AS (VALUES
  ('view'::public.app_action),('create'),('edit'),('delete'),('approve'),('post'),('export')
), roles(r) AS (VALUES
  ('accountant'::public.app_role),('hr_manager'),('production_manager'),
  ('procurement_officer'),('supply_chain_manager'),('sales_manager'),
  ('leasing_manager'),('mr_supervisor')
), grid AS (
  SELECT r.r AS role, m.m AS module, a.a AS action
  FROM roles r CROSS JOIN modules m CROSS JOIN actions a
)
INSERT INTO public.role_permission_defaults (role, module, action, allowed)
SELECT role, module, action,
  CASE
    -- Accountant: full finance/billing minus delete/post/approve
    WHEN role = 'accountant' AND module IN ('billing','accounting','vendor_payments') AND action IN ('view','create','edit','export') THEN true
    WHEN role = 'accountant' AND module IN ('inventory','crm','procurement','leasing','logistics','manufacturing','hrm','repatriation','sync_audit') AND action IN ('view','export') THEN true

    -- HR manager
    WHEN role = 'hr_manager' AND module = 'hrm' AND action IN ('view','create','edit','export','approve') THEN true
    WHEN role = 'hr_manager' AND module IN ('accounting','billing') AND action IN ('view','export') THEN true

    -- Production manager
    WHEN role = 'production_manager' AND module IN ('manufacturing','inventory') AND action IN ('view','create','edit','export') THEN true
    WHEN role = 'production_manager' AND module IN ('procurement','mr','gate','sale_automation') AND action IN ('view','export') THEN true

    -- Procurement officer
    WHEN role = 'procurement_officer' AND module IN ('procurement','vendor_payments') AND action IN ('view','create','edit','export') THEN true
    WHEN role = 'procurement_officer' AND module IN ('inventory','manufacturing','accounting') AND action IN ('view','export') THEN true

    -- Supply chain manager
    WHEN role = 'supply_chain_manager' AND module IN ('logistics','inventory','gate','repatriation','procurement') AND action IN ('view','create','edit','export') THEN true
    WHEN role = 'supply_chain_manager' AND module IN ('manufacturing','crm','billing','accounting') AND action IN ('view','export') THEN true

    -- Sales manager
    WHEN role = 'sales_manager' AND module IN ('crm','sale_automation') AND action IN ('view','create','edit','export','approve') THEN true
    WHEN role = 'sales_manager' AND module IN ('inventory','billing','leasing','manufacturing','portal') AND action IN ('view','export') THEN true

    -- Leasing manager
    WHEN role = 'leasing_manager' AND module IN ('leasing','billing') AND action IN ('view','create','edit','export','approve') THEN true
    WHEN role = 'leasing_manager' AND module IN ('inventory','crm','accounting','portal') AND action IN ('view','export') THEN true

    -- M&R supervisor
    WHEN role = 'mr_supervisor' AND module IN ('mr','inventory') AND action IN ('view','create','edit','export','approve') THEN true
    WHEN role = 'mr_supervisor' AND module IN ('gate','procurement','billing') AND action IN ('view','export') THEN true

    ELSE false
  END
FROM grid
ON CONFLICT (role, module, action) DO NOTHING;

-- 3) get_user_view_modules: intersect with the org's enabled subscription modules
CREATE OR REPLACE FUNCTION public.get_user_view_modules(_user_id uuid)
RETURNS SETOF text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT DISTINCT m.module
  FROM (
    SELECT module FROM public.role_permission_defaults WHERE action = 'view' AND allowed = true
    UNION
    SELECT module FROM public.role_permission_overrides WHERE action = 'view' AND allowed = true
  ) m
  WHERE public.has_permission(_user_id, m.module, 'view'::public.app_action)
    AND (
      public.is_platform_admin()
      OR m.module = 'core'
      OR EXISTS (
        SELECT 1 FROM public.subscription_modules sm
        WHERE sm.organization_id = public.current_org_id()
          AND sm.module_code = m.module
          AND sm.enabled = true
      )
    );
$$;

REVOKE EXECUTE ON FUNCTION public.get_user_view_modules(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_user_view_modules(uuid) TO authenticated, service_role;

-- 4) Seat-capacity helper for invite flows
CREATE OR REPLACE FUNCTION public.check_seat_capacity(_org uuid)
RETURNS TABLE(used integer, seat_limit integer, can_add boolean)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH s AS (
    SELECT seat_limit FROM public.subscriptions WHERE organization_id = _org LIMIT 1
  ),
  m AS (
    SELECT COUNT(*)::int AS active_members
    FROM public.organization_members
    WHERE organization_id = _org AND status = 'active'
  ),
  i AS (
    SELECT COUNT(*)::int AS open_invites
    FROM public.staff_invitations
    WHERE organization_id = _org
      AND accepted_at IS NULL
      AND revoked_at IS NULL
      AND expires_at > now()
  )
  SELECT (m.active_members + i.open_invites) AS used,
         COALESCE(s.seat_limit, 0) AS seat_limit,
         CASE
           WHEN s.seat_limit IS NULL OR s.seat_limit = 0 THEN true
           ELSE (m.active_members + i.open_invites) < s.seat_limit
         END AS can_add
  FROM m, i LEFT JOIN s ON true;
$$;

REVOKE EXECUTE ON FUNCTION public.check_seat_capacity(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.check_seat_capacity(uuid) TO authenticated, service_role;
