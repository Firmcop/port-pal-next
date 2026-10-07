
-- 1. Schema
ALTER TABLE public.attendance_lines
  ADD COLUMN IF NOT EXISTS work_date date,
  ADD COLUMN IF NOT EXISTS holiday_amount numeric NOT NULL DEFAULT 0;

ALTER TABLE public.organizations ADD COLUMN IF NOT EXISTS holiday_multiplier numeric NOT NULL DEFAULT 2.0;
ALTER TABLE public.employees ADD COLUMN IF NOT EXISTS holiday_multiplier numeric;

UPDATE public.attendance_lines l
SET work_date = COALESCE(
  NULLIF(substring(COALESCE(l.notes,'') from '^\d{4}-\d{2}-\d{2}'), '')::date,
  (SELECT w.week_start FROM public.attendance_weeks w WHERE w.id = l.week_id)
)
WHERE l.work_date IS NULL;

CREATE INDEX IF NOT EXISTS idx_attendance_lines_work_date ON public.attendance_lines(work_date);

CREATE TABLE IF NOT EXISTS public.public_holidays (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL DEFAULT public.current_org_id(),
  holiday_date date NOT NULL,
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, holiday_date)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.public_holidays TO authenticated;
GRANT ALL ON public.public_holidays TO service_role;
ALTER TABLE public.public_holidays ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "org members read holidays" ON public.public_holidays;
CREATE POLICY "org members read holidays" ON public.public_holidays
  FOR SELECT TO authenticated
  USING (organization_id = public.current_org_id() OR public.is_platform_admin());

DROP POLICY IF EXISTS "payroll manages holidays" ON public.public_holidays;
CREATE POLICY "payroll manages holidays" ON public.public_holidays
  FOR ALL TO authenticated
  USING (organization_id = public.current_org_id() AND public.can_manage_payroll())
  WITH CHECK (organization_id = public.current_org_id() AND public.can_manage_payroll());

DROP TRIGGER IF EXISTS trg_public_holidays_updated ON public.public_holidays;
CREATE TRIGGER trg_public_holidays_updated BEFORE UPDATE ON public.public_holidays
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 2. Components with holiday premium
DROP FUNCTION IF EXISTS public.attendance_line_components(uuid, text, numeric, numeric, numeric, numeric);

CREATE FUNCTION public.attendance_line_components(
  _employee_id uuid, _basis text, _days numeric, _hours numeric, _ot numeric, _allowance numeric,
  _work_date date DEFAULT NULL,
  OUT rate numeric, OUT base_amount numeric, OUT overtime_amount numeric,
  OUT allowance numeric, OUT holiday_amount numeric, OUT amount numeric)
RETURNS record
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE _e public.employees%ROWTYPE; _mult numeric; _is_hol boolean := false;
BEGIN
  SELECT * INTO _e FROM public.employees WHERE id = _employee_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Employee not found'; END IF;
  allowance := ROUND(COALESCE(_allowance,0), 2);
  IF COALESCE(_basis, _e.pay_basis) = 'hourly' THEN
    rate := COALESCE(NULLIF(_e.hourly_rate,0), COALESCE(_e.daily_rate,0)/8.0);
    base_amount := ROUND(COALESCE(_hours,0) * rate, 2);
    overtime_amount := ROUND(COALESCE(_ot,0) * rate * COALESCE(_e.overtime_multiplier,1.5), 2);
  ELSE
    rate := COALESCE(_e.daily_rate,0);
    base_amount := ROUND(COALESCE(_days,0) * rate, 2);
    overtime_amount := ROUND(COALESCE(_ot,0) * (rate/8.0) * COALESCE(_e.overtime_multiplier,1.5), 2);
  END IF;

  holiday_amount := 0;
  IF _work_date IS NOT NULL THEN
    SELECT EXISTS (
      SELECT 1 FROM public.public_holidays h
      WHERE h.holiday_date = _work_date AND h.organization_id = _e.organization_id
    ) INTO _is_hol;
    IF _is_hol THEN
      SELECT COALESCE(_e.holiday_multiplier, o.holiday_multiplier, 2.0) INTO _mult
      FROM public.organizations o WHERE o.id = _e.organization_id;
      holiday_amount := ROUND(base_amount * (COALESCE(_mult,2.0) - 1), 2);
    END IF;
  END IF;

  amount := ROUND(base_amount + overtime_amount + allowance + holiday_amount, 2);
END $function$;

REVOKE ALL ON FUNCTION public.attendance_line_components(uuid, text, numeric, numeric, numeric, numeric, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.attendance_line_components(uuid, text, numeric, numeric, numeric, numeric, date) TO authenticated;

-- 3. Upsert stores the work date
CREATE OR REPLACE FUNCTION public.upsert_attendance_line(_week_id uuid, _employee_id uuid, _days numeric DEFAULT 0, _hours numeric DEFAULT 0, _overtime_hours numeric DEFAULT 0, _project_id uuid DEFAULT NULL::uuid, _conversion_id uuid DEFAULT NULL::uuid, _notes text DEFAULT NULL::text, _line_id uuid DEFAULT NULL::uuid, _allowance numeric DEFAULT 0, _allowance_label text DEFAULT NULL::text, _work_date date DEFAULT NULL::date)
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

  IF _attendance_clerk AND NOT public.can_manage_payroll() THEN
    _allowance := 0;
    _allowance_label := NULL;
    _notes := NULL;
  END IF;

  IF _work_date IS NULL THEN
    _work_date := COALESCE(NULLIF(substring(COALESCE(_notes,'') from '^\d{4}-\d{2}-\d{2}'), '')::date, _w.week_start);
  END IF;
  IF _work_date < _w.week_start OR _work_date > _w.week_end THEN
    RAISE EXCEPTION 'Work date % is outside the week % → %', _work_date, _w.week_start, _w.week_end;
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
  FROM public.attendance_line_components(_employee_id, _basis, _days, _hours, _overtime_hours, _allowance, _work_date);

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
        work_date = _work_date,
        days = COALESCE(_days, 0),
        hours = COALESCE(_hours, 0),
        overtime_hours = COALESCE(_overtime_hours, 0),
        rate = _c.rate,
        base_amount = _c.base_amount,
        overtime_amount = _c.overtime_amount,
        allowance = _c.allowance,
        allowance_label = _allowance_label,
        holiday_amount = _c.holiday_amount,
        amount = _c.amount,
        notes = _notes
    WHERE id = _line_id AND week_id = _week_id AND organization_id = _w.organization_id
    RETURNING id INTO _id;
  ELSE
    INSERT INTO public.attendance_lines(
      week_id, organization_id, employee_id, project_id, conversion_id, basis, work_date,
      days, hours, overtime_hours, rate, base_amount, overtime_amount,
      allowance, allowance_label, holiday_amount, amount, notes
    )
    VALUES (
      _week_id, _w.organization_id, _employee_id, _project_id, _conversion_id, _basis, _work_date,
      COALESCE(_days, 0), COALESCE(_hours, 0), COALESCE(_overtime_hours, 0),
      _c.rate, _c.base_amount, _c.overtime_amount, _c.allowance,
      _allowance_label, _c.holiday_amount, _c.amount, _notes
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

-- 4. Approval recompute includes the holiday premium
CREATE OR REPLACE FUNCTION public.approve_attendance_week(_week_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE _w public.attendance_weeks%ROWTYPE; _l record; _curr text; _gross numeric; _ded numeric; _net numeric; _d record;
BEGIN
  IF NOT public.can_manage_payroll() THEN RAISE EXCEPTION 'Not authorised'; END IF;
  SELECT * INTO _w FROM public.attendance_weeks WHERE id=_week_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Week not found'; END IF;
  IF _w.status <> 'draft' THEN RETURN; END IF;

  FOR _l IN SELECT * FROM public.attendance_lines WHERE week_id=_week_id LOOP
    UPDATE public.attendance_lines l
    SET rate=c.rate, base_amount=c.base_amount, overtime_amount=c.overtime_amount,
        allowance=c.allowance, holiday_amount=c.holiday_amount, amount=c.amount
    FROM public.attendance_line_components(_l.employee_id, _l.basis, _l.days, _l.hours, _l.overtime_hours, _l.allowance, COALESCE(_l.work_date, _w.week_start)) c
    WHERE l.id=_l.id;
  END LOOP;

  UPDATE public.attendance_lines l SET project_id = cc.project_id
  FROM public.container_conversions cc
  WHERE l.week_id=_week_id AND l.conversion_id=cc.id AND l.project_id IS NULL AND cc.project_id IS NOT NULL;

  PERFORM public.recalc_attendance_week(_week_id);
  SELECT gross_amount, deduction_amount, net_amount,
         COALESCE(currency,(SELECT currency FROM organizations WHERE id=_w.organization_id))
    INTO _gross, _ded, _net, _curr FROM public.attendance_weeks WHERE id=_week_id;
  IF COALESCE(_gross,0) <= 0 THEN RAISE EXCEPTION 'Nothing to approve — no attendance recorded'; END IF;

  IF NOT EXISTS (SELECT 1 FROM public.accounting_transactions WHERE reference_type='attendance_week' AND reference_id=_week_id) THEN
    INSERT INTO public.cost_entries(production_order_id, cost_type, reference_id, reference_type, amount, description, organization_id)
    SELECT l.conversion_id, 'labour', l.id, 'attendance_line', l.amount,
           'Weekly wages ' || _w.week_start || ' — ' || e.name, _w.organization_id
    FROM public.attendance_lines l JOIN public.employees e ON e.id=l.employee_id
    WHERE l.week_id=_week_id AND l.conversion_id IS NOT NULL AND l.amount <> 0;

    FOR _l IN SELECT id FROM public.attendance_lines WHERE week_id=_week_id AND conversion_id IS NOT NULL AND amount <> 0 LOOP
      PERFORM public.sync_attendance_line_to_job(_l.id);
    END LOOP;

    INSERT INTO public.accounting_transactions(transaction_number, transaction_date, account_type, category, description,
      debit_amount, credit_amount, reference_type, reference_id, organization_id, project_id, currency)
    SELECT 'WGE-DR-'||substring(_week_id::text,1,8)||'-'||COALESCE(substring(l.project_id::text,1,4),'GEN'),
      _w.week_end, 'cost_of_goods',
      CASE WHEN l.project_id IS NOT NULL THEN 'project_labour' ELSE 'direct_labour' END,
      'Weekly wages '||_w.week_start||' → '||_w.week_end, SUM(l.base_amount + l.overtime_amount + l.holiday_amount), 0,
      'attendance_week', _week_id, _w.organization_id, l.project_id, _curr
    FROM public.attendance_lines l WHERE l.week_id=_week_id
    GROUP BY l.project_id HAVING SUM(l.base_amount + l.overtime_amount + l.holiday_amount) <> 0;

    INSERT INTO public.accounting_transactions(transaction_number, transaction_date, account_type, category, description,
      debit_amount, credit_amount, reference_type, reference_id, organization_id, project_id, currency)
    SELECT 'WGE-ALW-'||substring(_week_id::text,1,8)||'-'||COALESCE(substring(l.project_id::text,1,4),'GEN'),
      _w.week_end, 'expense', 'wage_allowances',
      'Weekly allowances '||_w.week_start||' → '||_w.week_end, SUM(l.allowance), 0,
      'attendance_week', _week_id, _w.organization_id, l.project_id, _curr
    FROM public.attendance_lines l WHERE l.week_id=_week_id
    GROUP BY l.project_id HAVING SUM(l.allowance) <> 0;

    FOR _d IN
      SELECT d.dtype, SUM(d.amount) amt
      FROM (SELECT employee_id, SUM(amount) g FROM public.attendance_lines WHERE week_id=_week_id GROUP BY employee_id) x
      CROSS JOIN LATERAL public.employee_deductions(x.employee_id, x.g, 'weekly') d
      WHERE x.g > 0 GROUP BY d.dtype HAVING SUM(d.amount) <> 0
    LOOP
      INSERT INTO public.accounting_transactions(transaction_number, transaction_date, account_type, category, description,
        debit_amount, credit_amount, reference_type, reference_id, organization_id, currency)
      VALUES ('WGE-DED-'||substring(_week_id::text,1,8)||'-'||upper(left(_d.dtype,3)), _w.week_end, 'liability',
        'payroll_'||_d.dtype||'_payable', 'Payroll '||_d.dtype||' withheld '||_w.week_start, 0, _d.amt,
        'attendance_week', _week_id, _w.organization_id, _curr);
    END LOOP;

    INSERT INTO public.accounting_transactions(transaction_number, transaction_date, account_type, category, description,
      debit_amount, credit_amount, reference_type, reference_id, organization_id, currency)
    VALUES ('WGE-CR-'||substring(_week_id::text,1,8), _w.week_end, 'liability','wages_payable',
      'Net wages payable '||_w.week_start||' → '||_w.week_end, 0, _net, 'attendance_week', _week_id, _w.organization_id, _curr);
  END IF;

  UPDATE public.attendance_weeks SET status='approved', approved_by=auth.uid(), approved_at=now() WHERE id=_week_id;
  INSERT INTO public.attendance_audit(organization_id, week_id, action, after)
  VALUES (_w.organization_id, _week_id, 'approve', jsonb_build_object('gross',_gross,'deductions',_ded,'net',_net));

  PERFORM public.assert_attendance_week_balanced(_week_id);
END $function$;

-- 5. Monthly payslip shows the holiday premium separately
CREATE OR REPLACE FUNCTION public.generate_monthly_wage_payslips(_month_start date)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE _org uuid := current_org_id(); _end date; _emp record; _slip uuid; _count integer := 0; _d record; _n numeric;
BEGIN
  IF NOT public.can_manage_payroll() THEN RAISE EXCEPTION 'Not authorised'; END IF;
  _month_start := date_trunc('month', _month_start)::date;
  _end := (_month_start + interval '1 month - 1 day')::date;

  FOR _emp IN
    SELECT l.employee_id, SUM(l.amount) total
    FROM public.attendance_lines l
    JOIN public.attendance_weeks w ON w.id = l.week_id
    WHERE w.organization_id = _org AND w.status IN ('approved','paid')
      AND w.week_start >= _month_start AND w.week_start <= _end
      AND l.payslip_id IS NULL
    GROUP BY l.employee_id HAVING SUM(l.amount) <> 0
  LOOP
    INSERT INTO public.payslips(organization_id, employee_id, pay_date, period_start, period_end, description,
      status, posting_mode)
    VALUES (_org, _emp.employee_id, _end, _month_start, _end,
      'Monthly wage summary '||to_char(_month_start,'Mon YYYY'), 'draft', 'summary')
    RETURNING id INTO _slip;

    INSERT INTO public.payslip_lines(payslip_id, line_type, label, amount, taxable, sort_order)
    SELECT _slip, 'earning',
      'Week '||to_char(w.week_start,'DD Mon')||' – '||to_char(w.week_end,'DD Mon')||
        CASE WHEN SUM(l.days) <> 0 THEN ' ('||SUM(l.days)||' days)' ELSE ' ('||SUM(l.hours + l.overtime_hours)||' hrs)' END,
      SUM(l.base_amount + l.overtime_amount), true, ROW_NUMBER() OVER (ORDER BY w.week_start)
    FROM public.attendance_lines l JOIN public.attendance_weeks w ON w.id=l.week_id
    WHERE l.employee_id=_emp.employee_id AND w.organization_id=_org AND w.status IN ('approved','paid')
      AND w.week_start >= _month_start AND w.week_start <= _end AND l.payslip_id IS NULL
    GROUP BY w.id, w.week_start, w.week_end HAVING SUM(l.base_amount + l.overtime_amount) <> 0;

    SELECT COALESCE(SUM(l.holiday_amount),0) INTO _n
    FROM public.attendance_lines l JOIN public.attendance_weeks w ON w.id=l.week_id
    WHERE l.employee_id=_emp.employee_id AND w.organization_id=_org AND w.status IN ('approved','paid')
      AND w.week_start >= _month_start AND w.week_start <= _end AND l.payslip_id IS NULL;
    IF COALESCE(_n,0) <> 0 THEN
      INSERT INTO public.payslip_lines(payslip_id, line_type, label, amount, taxable, sort_order)
      VALUES (_slip, 'earning', 'Holiday premium', _n, true, 85);
    END IF;

    SELECT COALESCE(SUM(l.allowance),0) INTO _n
    FROM public.attendance_lines l JOIN public.attendance_weeks w ON w.id=l.week_id
    WHERE l.employee_id=_emp.employee_id AND w.organization_id=_org AND w.status IN ('approved','paid')
      AND w.week_start >= _month_start AND w.week_start <= _end AND l.payslip_id IS NULL;
    IF COALESCE(_n,0) <> 0 THEN
      INSERT INTO public.payslip_lines(payslip_id, line_type, label, amount, taxable, sort_order)
      VALUES (_slip, 'earning', 'Allowances', _n, false, 90);
    END IF;

    FOR _d IN SELECT * FROM public.employee_deductions(_emp.employee_id, _emp.total, 'weekly') LOOP
      INSERT INTO public.payslip_lines(payslip_id, line_type, label, amount, taxable, sort_order)
      VALUES (_slip, 'deduction', _d.name, _d.amount, false, 100);
    END LOOP;
    FOR _d IN SELECT * FROM public.employee_deductions(_emp.employee_id, _emp.total, 'monthly') LOOP
      INSERT INTO public.payslip_lines(payslip_id, line_type, label, amount, taxable, sort_order)
      VALUES (_slip, 'deduction', _d.name, _d.amount, false, 110);
    END LOOP;

    UPDATE public.attendance_lines l SET payslip_id = _slip
    FROM public.attendance_weeks w
    WHERE w.id = l.week_id AND l.employee_id=_emp.employee_id AND w.organization_id=_org
      AND w.status IN ('approved','paid') AND w.week_start >= _month_start AND w.week_start <= _end
      AND l.payslip_id IS NULL;

    PERFORM public.payslips_recalc_totals(_slip);
    _count := _count + 1;
  END LOOP;

  RETURN _count;
END $function$;
