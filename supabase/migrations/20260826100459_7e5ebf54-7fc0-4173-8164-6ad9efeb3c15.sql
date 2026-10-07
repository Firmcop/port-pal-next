
-- ============ 1. Per-user permission overrides ============
CREATE TABLE public.user_permission_overrides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  module text NOT NULL,
  action public.app_action NOT NULL,
  allowed boolean NOT NULL DEFAULT true,
  updated_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, user_id, module, action)
);
GRANT SELECT ON public.user_permission_overrides TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.user_permission_overrides TO authenticated;
GRANT ALL ON public.user_permission_overrides TO service_role;
ALTER TABLE public.user_permission_overrides ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own permission overrides"
  ON public.user_permission_overrides FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Admins manage permission overrides"
  ON public.user_permission_overrides FOR ALL TO authenticated
  USING (
    public.is_platform_admin()
    OR public.has_role(auth.uid(), 'admin')
    OR EXISTS (
      SELECT 1 FROM public.organization_members om
      WHERE om.user_id = auth.uid()
        AND om.organization_id = user_permission_overrides.organization_id
        AND om.role IN ('org_owner','admin')
    )
  )
  WITH CHECK (
    public.is_platform_admin()
    OR public.has_role(auth.uid(), 'admin')
    OR EXISTS (
      SELECT 1 FROM public.organization_members om
      WHERE om.user_id = auth.uid()
        AND om.organization_id = user_permission_overrides.organization_id
        AND om.role IN ('org_owner','admin')
    )
  );

CREATE OR REPLACE FUNCTION public._touch_user_permission_overrides()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END $$;
CREATE TRIGGER trg_touch_user_permission_overrides
  BEFORE UPDATE ON public.user_permission_overrides
  FOR EACH ROW EXECUTE FUNCTION public._touch_user_permission_overrides();

-- ============ 2. has_permission: user override wins over role rules ============
CREATE OR REPLACE FUNCTION public.has_permission(_user_id uuid, _module text, _action public.app_action)
RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_org uuid;
  v_user_override boolean;
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

  -- Per-user override: explicit grant or deny wins over role-based rules
  SELECT uo.allowed INTO v_user_override
  FROM public.user_permission_overrides uo
  WHERE uo.organization_id = v_org
    AND uo.user_id = _user_id
    AND uo.module = _module
    AND uo.action = _action
  LIMIT 1;
  IF v_user_override IS NOT NULL THEN
    RETURN v_user_override;
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
      AND (ro.allowed IS NULL OR ro.allowed = true)
  ) THEN
    RETURN true;
  END IF;

  RETURN false;
END $function$;

-- ============ 3. get_user_view_modules: include per-user view grants ============
CREATE OR REPLACE FUNCTION public.get_user_view_modules(_user_id uuid)
RETURNS SETOF text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
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

  -- Non-admin: role-based view grants + per-user view overrides
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
    SELECT DISTINCT uo.module
    FROM public.user_permission_overrides uo
    JOIN public.subscription_modules sm
      ON sm.organization_id = uo.organization_id
     AND sm.module_code = uo.module
     AND sm.enabled = true
    WHERE uo.organization_id = v_org
      AND uo.user_id = _user_id
      AND uo.action = 'view'::public.app_action
      AND uo.allowed = true;
END $function$;

-- ============ 4. upsert_attendance_line: allow per-user hrm create/edit grant ============
CREATE OR REPLACE FUNCTION public.upsert_attendance_line(_week_id uuid, _employee_id uuid, _days numeric DEFAULT 0, _hours numeric DEFAULT 0, _overtime_hours numeric DEFAULT 0, _project_id uuid DEFAULT NULL::uuid, _conversion_id uuid DEFAULT NULL::uuid, _notes text DEFAULT NULL::text, _line_id uuid DEFAULT NULL::uuid, _allowance numeric DEFAULT 0, _allowance_label text DEFAULT NULL::text)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE _w public.attendance_weeks%ROWTYPE; _basis text; _c record; _id uuid; _before jsonb;
BEGIN
  IF NOT (
    public.can_manage_payroll()
    OR public.has_permission(auth.uid(), 'hrm', 'create')
    OR public.has_permission(auth.uid(), 'hrm', 'edit')
  ) THEN RAISE EXCEPTION 'Not authorised'; END IF;
  SELECT * INTO _w FROM public.attendance_weeks WHERE id = _week_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Week not found'; END IF;
  IF _w.status <> 'draft' THEN RAISE EXCEPTION 'Week is % — locked. Use Correct entry to adjust it.', _w.status; END IF;

  IF _project_id IS NULL AND _conversion_id IS NOT NULL THEN
    SELECT project_id INTO _project_id FROM public.container_conversions WHERE id=_conversion_id;
  END IF;

  SELECT pay_basis INTO _basis FROM public.employees WHERE id = _employee_id;
  SELECT * INTO _c FROM public.attendance_line_components(_employee_id, _basis, _days, _hours, _overtime_hours, _allowance);

  IF _line_id IS NOT NULL THEN
    SELECT to_jsonb(l) INTO _before FROM public.attendance_lines l WHERE l.id=_line_id;
    UPDATE public.attendance_lines SET employee_id=_employee_id, project_id=_project_id, conversion_id=_conversion_id,
      basis=_basis, days=COALESCE(_days,0), hours=COALESCE(_hours,0), overtime_hours=COALESCE(_overtime_hours,0),
      rate=_c.rate, base_amount=_c.base_amount, overtime_amount=_c.overtime_amount,
      allowance=_c.allowance, allowance_label=_allowance_label, amount=_c.amount, notes=_notes
    WHERE id=_line_id AND week_id=_week_id RETURNING id INTO _id;
  ELSE
    INSERT INTO public.attendance_lines(week_id, organization_id, employee_id, project_id, conversion_id, basis,
      days, hours, overtime_hours, rate, base_amount, overtime_amount, allowance, allowance_label, amount, notes)
    VALUES (_week_id, _w.organization_id, _employee_id, _project_id, _conversion_id, _basis,
      COALESCE(_days,0), COALESCE(_hours,0), COALESCE(_overtime_hours,0), _c.rate, _c.base_amount,
      _c.overtime_amount, _c.allowance, _allowance_label, _c.amount, _notes)
    RETURNING id INTO _id;
  END IF;

  INSERT INTO public.attendance_audit(organization_id, week_id, line_id, action, before, after)
  SELECT _w.organization_id, _week_id, _id, CASE WHEN _line_id IS NULL THEN 'create' ELSE 'update' END,
         _before, to_jsonb(l) FROM public.attendance_lines l WHERE l.id=_id;

  PERFORM public.recalc_attendance_week(_week_id);
  RETURN _id;
END $function$;

-- ============ 5. Seed Sharon's attendance-clerk grant ============
INSERT INTO public.user_permission_overrides (organization_id, user_id, module, action, allowed)
SELECT '6b29b65b-fa63-4dcf-9854-ede5c9a8320b', 'e3b7c483-fd25-44a3-83d9-85eb9e110b49', 'hrm', a, true
FROM (VALUES ('view'::public.app_action), ('create'::public.app_action), ('edit'::public.app_action)) v(a)
ON CONFLICT (organization_id, user_id, module, action) DO UPDATE SET allowed = EXCLUDED.allowed, updated_at = now();
