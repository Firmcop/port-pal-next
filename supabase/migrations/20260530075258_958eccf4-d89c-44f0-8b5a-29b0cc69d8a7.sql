-- 1) Add organization_id to user_roles
ALTER TABLE public.user_roles
  ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_user_roles_user_org ON public.user_roles(user_id, organization_id);

-- 2) Backfill organization_id for existing rows
-- Staff roles (everything except 'customer') use the user's primary active org,
-- or fall back to the Default Organization.
UPDATE public.user_roles ur
SET organization_id = COALESCE(
  (
    SELECT om.organization_id
    FROM public.organization_members om
    WHERE om.user_id = ur.user_id AND om.status = 'active'
    ORDER BY om.created_at ASC
    LIMIT 1
  ),
  '00000000-0000-0000-0000-000000000001'::uuid
)
WHERE ur.organization_id IS NULL
  AND ur.role <> 'customer'::app_role;

-- Customer (portal) role: derive org from customer_portal_users -> customers
UPDATE public.user_roles ur
SET organization_id = c.organization_id
FROM public.customer_portal_users cpu
JOIN public.customers c ON c.id = cpu.customer_id
WHERE ur.user_id = cpu.user_id
  AND ur.role = 'customer'::app_role
  AND ur.organization_id IS NULL;

-- 3) Org-scoped has_role
CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role app_role)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles ur
    WHERE ur.user_id = _user_id
      AND ur.role = _role
      AND ur.organization_id IS NOT DISTINCT FROM public.current_org_id()
  )
$$;

-- 4) Tighten "Admins can manage roles" policy to current org
DROP POLICY IF EXISTS "Admins can manage roles" ON public.user_roles;
CREATE POLICY "Admins can manage roles" ON public.user_roles
  FOR ALL TO authenticated
  USING (
    organization_id = public.current_org_id()
    AND public.has_role(auth.uid(), 'admin'::app_role)
  )
  WITH CHECK (
    organization_id = public.current_org_id()
    AND public.has_role(auth.uid(), 'admin'::app_role)
  );

-- 5) set_user_staff_roles: write organization_id
CREATE OR REPLACE FUNCTION public.set_user_staff_roles(_target_user_id uuid, _roles public.app_role[])
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
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

  _is_platform_admin := public.is_platform_admin();
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

  IF _org_id IS NULL THEN
    RAISE EXCEPTION 'Target user has no active organization membership';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _target_user_id AND role = 'admin'::public.app_role
      AND organization_id = _org_id
  ) INTO _was_admin;

  _will_be_admin := 'admin'::public.app_role = ANY(_roles);

  IF _was_admin AND NOT _will_be_admin THEN
    SELECT COUNT(*) INTO _admin_count
    FROM public.user_roles ur
    WHERE ur.role = 'admin'::public.app_role
      AND ur.organization_id = _org_id;
    IF _admin_count <= 1 THEN
      RAISE EXCEPTION 'Cannot remove the last admin in this organization';
    END IF;
  END IF;

  DELETE FROM public.user_roles
  WHERE user_id = _target_user_id
    AND role = ANY(_valid)
    AND (organization_id = _org_id OR organization_id IS NULL);

  INSERT INTO public.user_roles (user_id, role, organization_id)
  SELECT _target_user_id, unnest(_roles), _org_id
  ON CONFLICT (user_id, role) DO UPDATE SET organization_id = EXCLUDED.organization_id;
END;
$$;

-- 6) upsert_user_staff_role: write organization_id
CREATE OR REPLACE FUNCTION public.upsert_user_staff_role(_target_user_id uuid, _new_role public.app_role)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  _caller uuid := auth.uid();
  _can_manage boolean;
  _is_platform_admin boolean;
  _org_id uuid;
  _was_admin boolean;
  _admin_count int;
BEGIN
  IF _caller IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  _is_platform_admin := public.is_platform_admin();
  _can_manage := public.can_manage_user_in_org(_caller, _target_user_id);
  IF NOT (_is_platform_admin OR _can_manage) THEN
    RAISE EXCEPTION 'You are not allowed to change this user''s role';
  END IF;

  IF _new_role NOT IN ('admin'::app_role, 'yard_operator'::app_role, 'gate_clerk'::app_role, 'viewer'::app_role) THEN
    RAISE EXCEPTION 'Invalid staff role: %', _new_role;
  END IF;

  SELECT organization_id INTO _org_id
  FROM public.organization_members
  WHERE user_id = _target_user_id AND status = 'active'
  ORDER BY created_at ASC LIMIT 1;

  IF _org_id IS NULL THEN
    RAISE EXCEPTION 'Target user has no active organization membership';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _target_user_id AND role = 'admin'::app_role
      AND organization_id = _org_id
  ) INTO _was_admin;

  IF _was_admin AND _new_role <> 'admin'::app_role THEN
    SELECT COUNT(*) INTO _admin_count
    FROM public.user_roles ur
    WHERE ur.role = 'admin'::app_role
      AND ur.organization_id = _org_id;
    IF _admin_count <= 1 THEN
      RAISE EXCEPTION 'Cannot remove the last admin in this organization';
    END IF;
  END IF;

  DELETE FROM public.user_roles
  WHERE user_id = _target_user_id
    AND role IN ('admin'::app_role, 'yard_operator'::app_role, 'gate_clerk'::app_role, 'viewer'::app_role)
    AND (organization_id = _org_id OR organization_id IS NULL);

  INSERT INTO public.user_roles (user_id, role, organization_id)
  VALUES (_target_user_id, _new_role, _org_id)
  ON CONFLICT (user_id, role) DO UPDATE SET organization_id = EXCLUDED.organization_id;
END;
$$;

-- 7) Realtime: protect payments/payslips topics
DROP POLICY IF EXISTS "Authenticated users can use realtime" ON realtime.messages;
CREATE POLICY "Authenticated users can use realtime" ON realtime.messages
  FOR SELECT TO authenticated
  USING (
    auth.uid() IS NOT NULL
    AND (
      realtime.topic() LIKE ('user:' || auth.uid()::text || ':%')
      OR (
        realtime.topic() LIKE (public.current_org_id()::text || ':%')
        AND (
          (
            realtime.topic() NOT LIKE (public.current_org_id()::text || ':payments%')
            AND realtime.topic() NOT LIKE (public.current_org_id()::text || ':payslips%')
          )
          OR public.has_role(auth.uid(), 'admin'::app_role)
          OR public.has_role(auth.uid(), 'accountant'::app_role)
          OR public.has_role(auth.uid(), 'hr_manager'::app_role)
        )
      )
    )
  );

DROP POLICY IF EXISTS "Authenticated users can send realtime" ON realtime.messages;
CREATE POLICY "Authenticated users can send realtime" ON realtime.messages
  FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() IS NOT NULL
    AND (
      realtime.topic() LIKE ('user:' || auth.uid()::text || ':%')
      OR (
        realtime.topic() LIKE (public.current_org_id()::text || ':%')
        AND (
          (
            realtime.topic() NOT LIKE (public.current_org_id()::text || ':payments%')
            AND realtime.topic() NOT LIKE (public.current_org_id()::text || ':payslips%')
          )
          OR public.has_role(auth.uid(), 'admin'::app_role)
          OR public.has_role(auth.uid(), 'accountant'::app_role)
          OR public.has_role(auth.uid(), 'hr_manager'::app_role)
        )
      )
    )
  );