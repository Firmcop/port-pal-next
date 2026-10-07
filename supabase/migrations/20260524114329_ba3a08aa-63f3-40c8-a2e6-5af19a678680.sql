
-- Seed defaults for new roles
-- Helper: insert rows for a (role, module, actions[]) tuple
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      -- accountant
      ('accountant','accounting',           ARRAY['view','create','edit','post','export']),
      ('accountant','billing',              ARRAY['view','create','edit','post','export']),
      ('accountant','vendor_payments',      ARRAY['view','create','edit','approve','post']),
      ('accountant','sync_audit',           ARRAY['view','export']),
      ('accountant','procurement',          ARRAY['view','export']),
      ('accountant','sale_automation',      ARRAY['view','export']),
      ('accountant','leasing',              ARRAY['view','export']),

      -- hr_manager
      ('hr_manager','hrm',                  ARRAY['view','create','edit','delete','approve','post','export']),

      -- production_manager
      ('production_manager','manufacturing',ARRAY['view','create','edit','delete','approve','post','export']),
      ('production_manager','procurement',  ARRAY['view']),
      ('production_manager','inventory',    ARRAY['view']),

      -- procurement_officer
      ('procurement_officer','procurement', ARRAY['view','create','edit','delete','approve','post','export']),
      ('procurement_officer','vendor_payments', ARRAY['view','create','edit','approve']),

      -- supply_chain_manager
      ('supply_chain_manager','logistics',  ARRAY['view','create','edit','delete','approve','post','export']),
      ('supply_chain_manager','procurement',ARRAY['view','create','edit','export']),
      ('supply_chain_manager','inventory',  ARRAY['view','export']),
      ('supply_chain_manager','repatriation',ARRAY['view','create','edit','approve','export']),

      -- sales_manager
      ('sales_manager','crm',               ARRAY['view','create','edit','delete','approve','post','export']),
      ('sales_manager','sale_automation',   ARRAY['view','create','edit','approve','post','export']),
      ('sales_manager','release_instructions', ARRAY['view','create','edit','approve']),

      -- leasing_manager
      ('leasing_manager','leasing',         ARRAY['view','create','edit','delete','approve','post','export']),
      ('leasing_manager','billing',         ARRAY['view','export']),

      -- mr_supervisor
      ('mr_supervisor','mr',                ARRAY['view','create','edit','delete','approve','post','export']),
      ('mr_supervisor','inventory',         ARRAY['view']),
      ('mr_supervisor','procurement',       ARRAY['view'])
    ) AS t(role, module, actions)
  LOOP
    INSERT INTO public.role_permission_defaults (role, module, action, allowed)
    SELECT r.role::public.app_role, r.module, a::public.app_action, true
    FROM unnest(r.actions) AS a
    ON CONFLICT (role, module, action) DO UPDATE SET allowed = EXCLUDED.allowed;
  END LOOP;
END $$;

-- Multi-role setter
CREATE OR REPLACE FUNCTION public.set_user_staff_roles(_target_user_id uuid, _roles public.app_role[])
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _caller uuid := auth.uid();
  _is_platform_admin boolean;
  _can_manage boolean;
  _org_id uuid;
  _admin_count int;
  _was_admin boolean;
  _will_be_admin boolean;
  _r public.app_role;
  _valid public.app_role[] := ARRAY[
    'admin','yard_operator','gate_clerk','viewer',
    'accountant','hr_manager','production_manager','procurement_officer',
    'supply_chain_manager','sales_manager','leasing_manager','mr_supervisor'
  ]::public.app_role[];
BEGIN
  IF _caller IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF _roles IS NULL OR array_length(_roles, 1) IS NULL THEN
    RAISE EXCEPTION 'At least one role is required';
  END IF;

  _is_platform_admin := public.has_role(_caller, 'admin'::public.app_role);
  _can_manage := public.can_manage_user_in_org(_caller, _target_user_id);
  IF NOT (_is_platform_admin OR _can_manage) THEN
    RAISE EXCEPTION 'You are not allowed to change this user''s roles';
  END IF;

  FOREACH _r IN ARRAY _roles LOOP
    IF NOT (_r = ANY(_valid)) THEN
      RAISE EXCEPTION 'Invalid staff role: %', _r;
    END IF;
  END LOOP;

  SELECT organization_id INTO _org_id
  FROM public.organization_members
  WHERE user_id = _target_user_id AND status = 'active'
  ORDER BY created_at ASC LIMIT 1;

  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _target_user_id AND role = 'admin'::public.app_role
  ) INTO _was_admin;

  _will_be_admin := 'admin'::public.app_role = ANY(_roles);

  IF _was_admin AND NOT _will_be_admin AND _org_id IS NOT NULL THEN
    SELECT COUNT(*) INTO _admin_count
    FROM public.user_roles ur
    JOIN public.organization_members om
      ON om.user_id = ur.user_id AND om.status = 'active'
    WHERE ur.role = 'admin'::public.app_role
      AND om.organization_id = _org_id;
    IF _admin_count <= 1 THEN
      RAISE EXCEPTION 'Cannot remove the last admin in this organization';
    END IF;
  END IF;

  DELETE FROM public.user_roles
  WHERE user_id = _target_user_id AND role = ANY(_valid);

  INSERT INTO public.user_roles (user_id, role)
  SELECT _target_user_id, unnest(_roles)
  ON CONFLICT (user_id, role) DO NOTHING;
END;
$$;

REVOKE ALL ON FUNCTION public.set_user_staff_roles(uuid, public.app_role[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_user_staff_roles(uuid, public.app_role[]) TO authenticated;
