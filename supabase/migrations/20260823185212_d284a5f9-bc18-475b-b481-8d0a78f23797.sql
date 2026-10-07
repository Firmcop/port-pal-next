-- helper: can manage payroll
CREATE OR REPLACE FUNCTION public.can_manage_payroll()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT is_platform_admin() OR has_role(auth.uid(),'admin') OR has_role(auth.uid(),'hr_manager')
$$;

-- compute a line amount from the employee's pay setup
CREATE OR REPLACE FUNCTION public.attendance_line_amount(_employee_id uuid, _basis text, _days numeric, _hours numeric, _ot numeric, OUT rate numeric, OUT amount numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE _e public.employees%ROWTYPE;
BEGIN
  SELECT * INTO _e FROM public.employees WHERE id = _employee_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Employee not found'; END IF;
  IF COALESCE(_basis, _e.pay_basis) = 'hourly' THEN
    rate := COALESCE(NULLIF(_e.hourly_rate,0), COALESCE(_e.daily_rate,0)/8.0);
    amount := ROUND((COALESCE(_hours,0) + COALESCE(_ot,0) * COALESCE(_e.overtime_multiplier,1.5)) * rate, 2);
  ELSE
    rate := COALESCE(_e.daily_rate,0);
    amount := ROUND(COALESCE(_days,0) * rate
      + CASE WHEN COALESCE(_ot,0) > 0 THEN COALESCE(_ot,0) * (rate/8.0) * COALESCE(_e.overtime_multiplier,1.5) ELSE 0 END, 2);
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.recalc_attendance_week(_week_id uuid)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE public.attendance_weeks w
  SET total_amount = COALESCE((SELECT SUM(amount) FROM public.attendance_lines l WHERE l.week_id = w.id),0)
  WHERE w.id = _week_id;
$$;

-- get or create a week sheet
CREATE OR REPLACE FUNCTION public.ensure_attendance_week(_week_start date)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _id uuid; _org uuid := current_org_id();
BEGIN
  IF NOT public.can_manage_payroll() THEN RAISE EXCEPTION 'Not authorised'; END IF;
  SELECT id INTO _id FROM public.attendance_weeks WHERE organization_id = _org AND week_start = _week_start;
  IF _id IS NOT NULL THEN RETURN _id; END IF;
  INSERT INTO public.attendance_weeks(organization_id, week_start, week_end)
  VALUES (_org, _week_start, _week_start + 6) RETURNING id INTO _id;
  RETURN _id;
END $$;

CREATE OR REPLACE FUNCTION public.upsert_attendance_line(
  _week_id uuid, _employee_id uuid, _days numeric DEFAULT 0, _hours numeric DEFAULT 0,
  _overtime_hours numeric DEFAULT 0, _project_id uuid DEFAULT NULL, _conversion_id uuid DEFAULT NULL,
  _notes text DEFAULT NULL, _line_id uuid DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _w public.attendance_weeks%ROWTYPE; _basis text; _rate numeric; _amount numeric; _id uuid;
BEGIN
  IF NOT public.can_manage_payroll() THEN RAISE EXCEPTION 'Not authorised'; END IF;
  SELECT * INTO _w FROM public.attendance_weeks WHERE id = _week_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Week not found'; END IF;
  IF _w.status <> 'draft' THEN RAISE EXCEPTION 'Week is % and can no longer be edited', _w.status; END IF;

  SELECT pay_basis INTO _basis FROM public.employees WHERE id = _employee_id;
  SELECT rate, amount INTO _rate, _amount FROM public.attendance_line_amount(_employee_id, _basis, _days, _hours, _overtime_hours);

  IF _line_id IS NOT NULL THEN
    UPDATE public.attendance_lines SET employee_id=_employee_id, project_id=_project_id, conversion_id=_conversion_id,
      basis=_basis, days=COALESCE(_days,0), hours=COALESCE(_hours,0), overtime_hours=COALESCE(_overtime_hours,0),
      rate=_rate, amount=_amount, notes=_notes
    WHERE id=_line_id AND week_id=_week_id RETURNING id INTO _id;
  ELSE
    INSERT INTO public.attendance_lines(week_id, organization_id, employee_id, project_id, conversion_id, basis,
      days, hours, overtime_hours, rate, amount, notes)
    VALUES (_week_id, _w.organization_id, _employee_id, _project_id, _conversion_id, _basis,
      COALESCE(_days,0), COALESCE(_hours,0), COALESCE(_overtime_hours,0), _rate, _amount, _notes)
    RETURNING id INTO _id;
  END IF;
  PERFORM public.recalc_attendance_week(_week_id);
  RETURN _id;
END $$;

CREATE OR REPLACE FUNCTION public.delete_attendance_line(_line_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _week uuid; _status text;
BEGIN
  IF NOT public.can_manage_payroll() THEN RAISE EXCEPTION 'Not authorised'; END IF;
  SELECT l.week_id, w.status INTO _week, _status FROM public.attendance_lines l JOIN public.attendance_weeks w ON w.id=l.week_id WHERE l.id=_line_id;
  IF _week IS NULL THEN RETURN; END IF;
  IF _status <> 'draft' THEN RAISE EXCEPTION 'Week is % and can no longer be edited', _status; END IF;
  DELETE FROM public.attendance_lines WHERE id=_line_id;
  PERFORM public.recalc_attendance_week(_week);
END $$;

CREATE OR REPLACE FUNCTION public.approve_attendance_week(_week_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _w public.attendance_weeks%ROWTYPE; _l record; _curr text; _total numeric := 0;
BEGIN
  IF NOT public.can_manage_payroll() THEN RAISE EXCEPTION 'Not authorised'; END IF;
  SELECT * INTO _w FROM public.attendance_weeks WHERE id=_week_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Week not found'; END IF;
  IF _w.status <> 'draft' THEN RETURN; END IF;

  -- recompute every line server-side from current employee rates
  FOR _l IN SELECT * FROM public.attendance_lines WHERE week_id=_week_id LOOP
    UPDATE public.attendance_lines l
    SET rate = a.rate, amount = a.amount
    FROM public.attendance_line_amount(_l.employee_id, _l.basis, _l.days, _l.hours, _l.overtime_hours) a
    WHERE l.id = _l.id;
  END LOOP;
  PERFORM public.recalc_attendance_week(_week_id);
  SELECT total_amount, COALESCE(currency,(SELECT currency FROM organizations WHERE id=_w.organization_id))
    INTO _total, _curr FROM public.attendance_weeks WHERE id=_week_id;
  IF COALESCE(_total,0) <= 0 THEN RAISE EXCEPTION 'Nothing to approve — no attendance recorded'; END IF;

  IF NOT EXISTS (SELECT 1 FROM public.accounting_transactions WHERE reference_type='attendance_week' AND reference_id=_week_id) THEN
    -- job costing for lines tied to a conversion job
    INSERT INTO public.cost_entries(production_order_id, cost_type, reference_id, reference_type, amount, description, organization_id)
    SELECT l.conversion_id, 'labour', l.id, 'attendance_line', l.amount,
           'Weekly wages ' || _w.week_start || ' — ' || e.name, _w.organization_id
    FROM public.attendance_lines l JOIN public.employees e ON e.id=l.employee_id
    WHERE l.week_id=_week_id AND l.conversion_id IS NOT NULL AND l.amount > 0;

    -- expense side, split by project assignment
    INSERT INTO public.accounting_transactions(transaction_number, transaction_date, account_type, category, description,
      debit_amount, credit_amount, reference_type, reference_id, organization_id, project_id, currency)
    SELECT 'WGE-DR-'||substring(_week_id::text,1,8)||'-'||COALESCE(substring(l.project_id::text,1,4),'GEN'),
      _w.week_end, 'cost_of_goods',
      CASE WHEN l.project_id IS NOT NULL THEN 'project_labour' ELSE 'direct_labour' END,
      'Weekly wages '||_w.week_start||' → '||_w.week_end, SUM(l.amount), 0,
      'attendance_week', _week_id, _w.organization_id, l.project_id, _curr
    FROM public.attendance_lines l WHERE l.week_id=_week_id AND l.amount > 0
    GROUP BY l.project_id;

    -- wages payable
    INSERT INTO public.accounting_transactions(transaction_number, transaction_date, account_type, category, description,
      debit_amount, credit_amount, reference_type, reference_id, organization_id, currency)
    VALUES ('WGE-CR-'||substring(_week_id::text,1,8), _w.week_end, 'liability','wages_payable',
      'Wages payable '||_w.week_start||' → '||_w.week_end, 0, _total, 'attendance_week', _week_id, _w.organization_id, _curr);
  END IF;

  UPDATE public.attendance_weeks SET status='approved', approved_by=auth.uid(), approved_at=now() WHERE id=_week_id;
END $$;

CREATE OR REPLACE FUNCTION public.pay_attendance_week(_week_id uuid, _from_account_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _w public.attendance_weeks%ROWTYPE; _curr text;
BEGIN
  IF NOT public.can_manage_payroll() THEN RAISE EXCEPTION 'Not authorised'; END IF;
  SELECT * INTO _w FROM public.attendance_weeks WHERE id=_week_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Week not found'; END IF;
  IF _w.status = 'paid' THEN RETURN; END IF;
  IF _w.status <> 'approved' THEN RAISE EXCEPTION 'Approve the week before paying'; END IF;
  IF _from_account_id IS NULL THEN RAISE EXCEPTION 'Select a paying account'; END IF;
  _curr := COALESCE(_w.currency,(SELECT currency FROM organizations WHERE id=_w.organization_id));

  IF NOT EXISTS (SELECT 1 FROM public.accounting_transactions WHERE reference_type='attendance_week_payment' AND reference_id=_week_id) THEN
    INSERT INTO public.accounting_transactions(transaction_number, transaction_date, account_type, category, description,
      debit_amount, credit_amount, reference_type, reference_id, organization_id, financial_account_id, currency)
    VALUES ('WGE-PAY-DR-'||substring(_week_id::text,1,8), now(), 'liability','wages_payable',
      'Wages settled '||_w.week_start, _w.total_amount, 0, 'attendance_week_payment', _week_id, _w.organization_id, NULL, _curr);
    INSERT INTO public.accounting_transactions(transaction_number, transaction_date, account_type, category, description,
      debit_amount, credit_amount, reference_type, reference_id, organization_id, financial_account_id, currency)
    VALUES ('WGE-PAY-CR-'||substring(_week_id::text,1,8), now(), 'asset','cash',
      'Wages paid '||_w.week_start, 0, _w.total_amount, 'attendance_week_payment', _week_id, _w.organization_id, _from_account_id, _curr);
  END IF;

  UPDATE public.attendance_weeks SET status='paid', paid_by=auth.uid(), paid_at=now(), paid_from_account_id=_from_account_id WHERE id=_week_id;
END $$;

-- month-end summary payslips for weekly staff
CREATE OR REPLACE FUNCTION public.generate_monthly_wage_payslips(_month_start date)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _org uuid := current_org_id(); _end date; _emp record; _slip uuid; _count integer := 0; _n integer;
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
      AND l.payslip_id IS NULL AND l.amount > 0
    GROUP BY l.employee_id
  LOOP
    INSERT INTO public.payslips(organization_id, employee_id, pay_date, period_start, period_end, description,
      status, posting_mode)
    VALUES (_org, _emp.employee_id, _end, _month_start, _end,
      'Monthly wage summary '||to_char(_month_start,'Mon YYYY'), 'draft', 'summary')
    RETURNING id INTO _slip;

    _n := 0;
    INSERT INTO public.payslip_lines(payslip_id, line_type, label, amount, taxable, sort_order)
    SELECT _slip, 'earning',
      'Week '||to_char(w.week_start,'DD Mon')||' – '||to_char(w.week_end,'DD Mon')||
        CASE WHEN SUM(l.days) > 0 THEN ' ('||SUM(l.days)||' days)' ELSE ' ('||SUM(l.hours + l.overtime_hours)||' hrs)' END,
      SUM(l.amount), true, ROW_NUMBER() OVER (ORDER BY w.week_start)
    FROM public.attendance_lines l JOIN public.attendance_weeks w ON w.id=l.week_id
    WHERE l.employee_id=_emp.employee_id AND w.organization_id=_org AND w.status IN ('approved','paid')
      AND w.week_start >= _month_start AND w.week_start <= _end AND l.payslip_id IS NULL AND l.amount > 0
    GROUP BY w.id, w.week_start, w.week_end;

    UPDATE public.attendance_lines l SET payslip_id = _slip
    FROM public.attendance_weeks w
    WHERE w.id = l.week_id AND l.employee_id=_emp.employee_id AND w.organization_id=_org
      AND w.status IN ('approved','paid') AND w.week_start >= _month_start AND w.week_start <= _end
      AND l.payslip_id IS NULL AND l.amount > 0;

    PERFORM public.payslips_recalc_totals(_slip);
    _count := _count + 1;
  END LOOP;

  RETURN _count;
END $$;

REVOKE EXECUTE ON FUNCTION public.can_manage_payroll() FROM anon;
REVOKE EXECUTE ON FUNCTION public.attendance_line_amount(uuid,text,numeric,numeric,numeric) FROM anon;
REVOKE EXECUTE ON FUNCTION public.recalc_attendance_week(uuid) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.ensure_attendance_week(date) FROM anon;
REVOKE EXECUTE ON FUNCTION public.upsert_attendance_line(uuid,uuid,numeric,numeric,numeric,uuid,uuid,text,uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.delete_attendance_line(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.approve_attendance_week(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.pay_attendance_week(uuid,uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.generate_monthly_wage_payslips(date) FROM anon;