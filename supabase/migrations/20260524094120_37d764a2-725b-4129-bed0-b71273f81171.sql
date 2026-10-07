-- 1. Enum
DO $$ BEGIN
  CREATE TYPE public.app_action AS ENUM ('view','create','edit','delete','approve','post','export');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 2. Defaults (global, read-only baseline)
CREATE TABLE IF NOT EXISTS public.role_permission_defaults (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  role public.app_role NOT NULL,
  module text NOT NULL,
  action public.app_action NOT NULL,
  allowed boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (role, module, action)
);
ALTER TABLE public.role_permission_defaults ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "read defaults" ON public.role_permission_defaults;
CREATE POLICY "read defaults" ON public.role_permission_defaults FOR SELECT TO authenticated USING (true);

-- 3. Per-org overrides
CREATE TABLE IF NOT EXISTS public.role_permission_overrides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  role public.app_role NOT NULL,
  module text NOT NULL,
  action public.app_action NOT NULL,
  allowed boolean NOT NULL,
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, role, module, action)
);
ALTER TABLE public.role_permission_overrides ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "org read overrides" ON public.role_permission_overrides;
CREATE POLICY "org read overrides" ON public.role_permission_overrides FOR SELECT TO authenticated
  USING (organization_id = public.current_org_id() OR public.is_platform_admin());
DROP POLICY IF EXISTS "admin write overrides" ON public.role_permission_overrides;
CREATE POLICY "admin write overrides" ON public.role_permission_overrides FOR ALL TO authenticated
  USING ((organization_id = public.current_org_id() AND public.has_role(auth.uid(),'admin')) OR public.is_platform_admin())
  WITH CHECK ((organization_id = public.current_org_id() AND public.has_role(auth.uid(),'admin')) OR public.is_platform_admin());

-- 4. Notification preferences
CREATE TABLE IF NOT EXISTS public.notification_preferences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  organization_id uuid NOT NULL,
  event_category text NOT NULL,
  channel text NOT NULL CHECK (channel IN ('web_push','whatsapp','email')),
  enabled boolean NOT NULL DEFAULT true,
  whatsapp_phone text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, event_category, channel)
);
ALTER TABLE public.notification_preferences ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "self read prefs" ON public.notification_preferences;
CREATE POLICY "self read prefs" ON public.notification_preferences FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR (organization_id = public.current_org_id() AND public.has_role(auth.uid(),'admin')) OR public.is_platform_admin());
DROP POLICY IF EXISTS "self write prefs" ON public.notification_preferences;
CREATE POLICY "self write prefs" ON public.notification_preferences FOR ALL TO authenticated
  USING (user_id = auth.uid() OR public.is_platform_admin())
  WITH CHECK (user_id = auth.uid() OR public.is_platform_admin());

-- 5. has_permission helper (override first, then default)
CREATE OR REPLACE FUNCTION public.has_permission(_user_id uuid, _module text, _action public.app_action)
RETURNS boolean
LANGUAGE plpgsql
STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_org uuid;
  v_role public.app_role;
  v_allowed boolean;
BEGIN
  IF _user_id IS NULL THEN RETURN false; END IF;
  -- platform admin shortcut
  IF public.is_platform_admin() THEN RETURN true; END IF;
  v_org := public.current_org_id();
  -- pick highest staff role for the user
  SELECT role INTO v_role FROM public.user_roles WHERE user_id = _user_id
    ORDER BY CASE role
      WHEN 'admin' THEN 5 WHEN 'yard_operator' THEN 4 WHEN 'gate_clerk' THEN 3
      WHEN 'viewer' THEN 2 WHEN 'customer' THEN 1 ELSE 0 END DESC
    LIMIT 1;
  IF v_role IS NULL THEN RETURN false; END IF;
  IF v_role = 'admin' THEN RETURN true; END IF;
  -- override
  SELECT allowed INTO v_allowed FROM public.role_permission_overrides
    WHERE organization_id = v_org AND role = v_role AND module = _module AND action = _action;
  IF v_allowed IS NOT NULL THEN RETURN v_allowed; END IF;
  -- default
  SELECT allowed INTO v_allowed FROM public.role_permission_defaults
    WHERE role = v_role AND module = _module AND action = _action;
  RETURN COALESCE(v_allowed, false);
END $$;

-- 6. Seed defaults
WITH modules(m) AS (VALUES
  ('inventory'),('gate'),('mr'),('billing'),('accounting'),('crm'),
  ('manufacturing'),('procurement'),('leasing'),('logistics'),('hrm'),
  ('portal'),('whatsapp'),('sync_audit'),('release_instructions'),
  ('vendor_payments'),('sale_automation'),('repatriation')
), actions(a) AS (VALUES
  ('view'::public.app_action),('create'),('edit'),('delete'),('approve'),('post'),('export')
), roles(r) AS (VALUES
  ('admin'::public.app_role),('yard_operator'),('gate_clerk'),('viewer'),('customer')
), grid AS (
  SELECT r.r AS role, m.m AS module, a.a AS action FROM roles r CROSS JOIN modules m CROSS JOIN actions a
)
INSERT INTO public.role_permission_defaults (role, module, action, allowed)
SELECT role, module, action,
  CASE
    WHEN role = 'admin' THEN true
    WHEN role = 'yard_operator' AND module IN ('inventory','gate','mr','repatriation') THEN action <> 'delete'
    WHEN role = 'yard_operator' AND module IN ('billing','accounting','sync_audit') AND action IN ('view','export') THEN true
    WHEN role = 'gate_clerk' AND module = 'gate' THEN action IN ('view','create','edit')
    WHEN role = 'gate_clerk' AND module IN ('inventory','release_instructions') AND action = 'view' THEN true
    WHEN role = 'viewer' AND action IN ('view','export') AND module NOT IN ('portal','sync_audit','vendor_payments') THEN true
    WHEN role = 'customer' AND module = 'portal' AND action IN ('view') THEN true
    WHEN role = 'customer' AND module = 'release_instructions' AND action IN ('view','create') THEN true
    WHEN role = 'customer' AND module IN ('inventory','billing') AND action = 'view' THEN true
    ELSE false
  END
FROM grid
ON CONFLICT (role, module, action) DO NOTHING;