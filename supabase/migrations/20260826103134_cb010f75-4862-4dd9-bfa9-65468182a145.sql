CREATE POLICY "Attendance clerks view weeks"
ON public.attendance_weeks
FOR SELECT
TO authenticated
USING (
  organization_id = public.current_org_id()
  AND public.has_permission(auth.uid(), 'hrm_attendance', 'view'::public.app_action)
);

CREATE POLICY "Attendance clerks view lines"
ON public.attendance_lines
FOR SELECT
TO authenticated
USING (
  organization_id = public.current_org_id()
  AND public.has_permission(auth.uid(), 'hrm_attendance', 'view'::public.app_action)
);

CREATE POLICY "Attendance clerks view employees"
ON public.employees
FOR SELECT
TO authenticated
USING (
  organization_id = public.current_org_id()
  AND public.has_permission(auth.uid(), 'hrm_attendance', 'view'::public.app_action)
);

CREATE OR REPLACE FUNCTION public.ensure_attendance_week(_week_start date)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _id uuid;
  _org uuid := public.current_org_id();
BEGIN
  IF NOT (
    public.can_manage_payroll()
    OR public.has_permission(auth.uid(), 'hrm_attendance', 'create'::public.app_action)
  ) THEN
    RAISE EXCEPTION 'Not authorised';
  END IF;

  SELECT id INTO _id
  FROM public.attendance_weeks
  WHERE organization_id = _org AND week_start = _week_start;

  IF _id IS NOT NULL THEN RETURN _id; END IF;

  INSERT INTO public.attendance_weeks(organization_id, week_start, week_end)
  VALUES (_org, _week_start, _week_start + 6)
  RETURNING id INTO _id;

  RETURN _id;
END
$function$;

CREATE OR REPLACE FUNCTION public.upsert_attendance_line(
  _week_id uuid,
  _employee_id uuid,
  _days numeric DEFAULT 0,
  _hours numeric DEFAULT 0,
  _overtime_hours numeric DEFAULT 0,
  _project_id uuid DEFAULT NULL::uuid,
  _conversion_id uuid DEFAULT NULL::uuid,
  _notes text DEFAULT NULL::text,
  _line_id uuid DEFAULT NULL::uuid,
  _allowance numeric DEFAULT 0,
  _allowance_label text DEFAULT NULL::text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _w public.attendance_weeks%ROWTYPE;
  _basis text;
  _c record;
  _id uuid;
  _before jsonb;
  _attendance_clerk boolean :=
    public.has_permission(auth.uid(), 'hrm_attendance', 'create'::public.app_action)
    OR public.has_permission(auth.uid(), 'hrm_attendance', 'edit'::public.app_action);
BEGIN
  IF NOT (public.can_manage_payroll() OR _attendance_clerk) THEN
    RAISE EXCEPTION 'Not authorised';
  END IF;

  SELECT * INTO _w FROM public.attendance_weeks WHERE id = _week_id;
  IF NOT FOUND OR _w.organization_id <> public.current_org_id() THEN
    RAISE EXCEPTION 'Week not found';
  END IF;
  IF _w.status <> 'draft' THEN
    RAISE EXCEPTION 'Week is % — locked.', _w.status;
  END IF;

  IF _attendance_clerk THEN
    _overtime_hours := 0;
    _allowance := 0;
    _allowance_label := NULL;
    _notes := NULL;
  END IF;

  IF _project_id IS NULL AND _conversion_id IS NOT NULL THEN
    SELECT project_id INTO _project_id
    FROM public.container_conversions
    WHERE id = _conversion_id AND organization_id = _w.organization_id;
  END IF;

  SELECT pay_basis INTO _basis
  FROM public.employees
  WHERE id = _employee_id AND organization_id = _w.organization_id AND status = 'active';
  IF NOT FOUND THEN RAISE EXCEPTION 'Employee not found'; END IF;

  SELECT * INTO _c
  FROM public.attendance_line_components(_employee_id, _basis, _days, _hours, _overtime_hours, _allowance);

  IF _line_id IS NOT NULL THEN
    SELECT to_jsonb(l) INTO _before
    FROM public.attendance_lines l
    WHERE l.id = _line_id AND l.week_id = _week_id AND l.organization_id = _w.organization_id;
    IF _before IS NULL THEN RAISE EXCEPTION 'Attendance entry not found'; END IF;

    UPDATE public.attendance_lines
    SET employee_id = _employee_id,
        project_id = _project_id,
        conversion_id = _conversion_id,
        basis = _basis,
        days = COALESCE(_days, 0),
        hours = COALESCE(_hours, 0),
        overtime_hours = COALESCE(_overtime_hours, 0),
        rate = _c.rate,
        base_amount = _c.base_amount,
        overtime_amount = _c.overtime_amount,
        allowance = _c.allowance,
        allowance_label = _allowance_label,
        amount = _c.amount,
        notes = _notes
    WHERE id = _line_id AND week_id = _week_id AND organization_id = _w.organization_id
    RETURNING id INTO _id;
  ELSE
    INSERT INTO public.attendance_lines(
      week_id, organization_id, employee_id, project_id, conversion_id, basis,
      days, hours, overtime_hours, rate, base_amount, overtime_amount,
      allowance, allowance_label, amount, notes
    )
    VALUES (
      _week_id, _w.organization_id, _employee_id, _project_id, _conversion_id, _basis,
      COALESCE(_days, 0), COALESCE(_hours, 0), COALESCE(_overtime_hours, 0),
      _c.rate, _c.base_amount, _c.overtime_amount, _c.allowance,
      _allowance_label, _c.amount, _notes
    )
    RETURNING id INTO _id;
  END IF;

  INSERT INTO public.attendance_audit(organization_id, week_id, line_id, action, before, after)
  SELECT _w.organization_id, _week_id, _id,
         CASE WHEN _line_id IS NULL THEN 'create' ELSE 'update' END,
         _before, to_jsonb(l)
  FROM public.attendance_lines l
  WHERE l.id = _id;

  PERFORM public.recalc_attendance_week(_week_id);
  RETURN _id;
END
$function$;