
-- 1. Backfill: org_owners get admin staff role
INSERT INTO public.user_roles (user_id, role)
SELECT DISTINCT om.user_id, 'admin'::app_role
FROM public.organization_members om
WHERE om.role = 'org_owner'
  AND om.status = 'active'
  AND om.organization_id <> '00000000-0000-0000-0000-000000000001'::uuid
  AND NOT EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = om.user_id
      AND ur.role IN ('admin','yard_operator','gate_clerk','viewer')
  )
ON CONFLICT (user_id, role) DO NOTHING;

-- 2. Helper: is caller an org_owner/admin in the same org as a target user?
CREATE OR REPLACE FUNCTION public.can_manage_user_in_org(_caller uuid, _target uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.organization_members caller_m
    JOIN public.organization_members target_m
      ON target_m.organization_id = caller_m.organization_id
    WHERE caller_m.user_id = _caller
      AND caller_m.status = 'active'
      AND caller_m.role IN ('org_owner','admin')
      AND target_m.user_id = _target
      AND target_m.status = 'active'
  );
$$;

-- 3. Replace change_user_staff_role to allow org owners/admins
CREATE OR REPLACE FUNCTION public.change_user_staff_role(_target_user_id uuid, _new_role app_role)
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
BEGIN
  IF _caller IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  _is_platform_admin := public.has_role(_caller, 'admin'::app_role);
  _can_manage := public.can_manage_user_in_org(_caller, _target_user_id);

  IF NOT (_is_platform_admin OR _can_manage) THEN
    RAISE EXCEPTION 'You are not allowed to change this user''s role';
  END IF;

  IF _new_role NOT IN ('admin'::app_role, 'yard_operator'::app_role, 'gate_clerk'::app_role, 'viewer'::app_role) THEN
    RAISE EXCEPTION 'Invalid staff role: %', _new_role;
  END IF;

  -- Determine org for last-admin guard (target's primary active org)
  SELECT organization_id INTO _org_id
  FROM public.organization_members
  WHERE user_id = _target_user_id AND status = 'active'
  ORDER BY created_at ASC
  LIMIT 1;

  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _target_user_id AND role = 'admin'::app_role
  ) INTO _was_admin;

  IF _was_admin AND _new_role <> 'admin'::app_role AND _org_id IS NOT NULL THEN
    SELECT COUNT(*) INTO _admin_count
    FROM public.user_roles ur
    JOIN public.organization_members om
      ON om.user_id = ur.user_id AND om.status = 'active'
    WHERE ur.role = 'admin'::app_role
      AND om.organization_id = _org_id;
    IF _admin_count <= 1 THEN
      RAISE EXCEPTION 'Cannot remove the last admin in this organization';
    END IF;
  END IF;

  DELETE FROM public.user_roles
  WHERE user_id = _target_user_id
    AND role IN ('admin'::app_role, 'yard_operator'::app_role, 'gate_clerk'::app_role, 'viewer'::app_role);

  INSERT INTO public.user_roles (user_id, role)
  VALUES (_target_user_id, _new_role)
  ON CONFLICT (user_id, role) DO NOTHING;
END;
$$;
