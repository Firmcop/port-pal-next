-- 1. Columns
ALTER TABLE public.attendance_lines
  ADD COLUMN IF NOT EXISTS allowance numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS allowance_label text,
  ADD COLUMN IF NOT EXISTS base_amount numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS overtime_amount numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS reverses_line_id uuid REFERENCES public.attendance_lines(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS correction_reason text,
  ADD COLUMN IF NOT EXISTS is_correction boolean NOT NULL DEFAULT false;

ALTER TABLE public.attendance_weeks
  ADD COLUMN IF NOT EXISTS gross_amount numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS deduction_amount numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS net_amount numeric NOT NULL DEFAULT 0;

ALTER TABLE public.employees
  ADD COLUMN IF NOT EXISTS deductions jsonb NOT NULL DEFAULT '[]'::jsonb;

-- 2. Audit table
CREATE TABLE IF NOT EXISTS public.attendance_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  week_id uuid NOT NULL,
  line_id uuid,
  action text NOT NULL,
  before jsonb,
  after jsonb,
  reason text,
  actor uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.attendance_audit TO authenticated;
GRANT ALL ON public.attendance_audit TO service_role;
ALTER TABLE public.attendance_audit ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "HR view attendance audit" ON public.attendance_audit;
CREATE POLICY "HR view attendance audit" ON public.attendance_audit FOR SELECT TO authenticated
USING (is_platform_admin() OR (organization_id = current_org_id() AND public.can_manage_payroll()));
DROP POLICY IF EXISTS "HR insert attendance audit" ON public.attendance_audit;
CREATE POLICY "HR insert attendance audit" ON public.attendance_audit FOR INSERT TO authenticated
WITH CHECK (organization_id = current_org_id() AND public.can_manage_payroll());
CREATE INDEX IF NOT EXISTS idx_attendance_audit_week ON public.attendance_audit(week_id, created_at DESC);

-- 3. Line amount helper (v2 with allowance + component split)
CREATE OR REPLACE FUNCTION public.attendance_line_components(
  _employee_id uuid, _basis text, _days numeric, _hours numeric, _ot numeric, _allowance numeric,
  OUT rate numeric, OUT base_amount numeric, OUT overtime_amount numeric, OUT allowance numeric, OUT amount numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE _e public.employees%ROWTYPE;
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
  amount := ROUND(base_amount + overtime_amount + allowance, 2);
END $$;

-- 4. Deduction resolver from employees.deductions jsonb
CREATE OR REPLACE FUNCTION public.employee_deductions(_employee_id uuid, _gross numeric, _freq text)
RETURNS TABLE(name text, dtype text, amount numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(d->>'name','Deduction')::text,
         COALESCE(d->>'type','other')::text,
         ROUND(CASE WHEN COALESCE(d->>'method','percent') = 'percent'
                    THEN COALESCE(_gross,0) * COALESCE((d->>'value')::numeric,0) / 100.0
                    ELSE COALESCE((d->>'value')::numeric,0) END, 2)
  FROM public.employees e, jsonb_array_elements(COALESCE(e.deductions,'[]'::jsonb)) d
  WHERE e.id = _employee_id
    AND COALESCE(d->>'frequency','both') IN (_freq, 'both')
    AND COALESCE((d->>'value')::numeric,0) <> 0;
$$;

-- 5. Recalc week totals incl. deductions
CREATE OR REPLACE FUNCTION public.recalc_attendance_week(_week_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _gross numeric := 0; _ded numeric := 0;
BEGIN
  SELECT COALESCE(SUM(amount),0) INTO _gross FROM public.attendance_lines WHERE week_id = _week_id;
  SELECT COALESCE(SUM(d.amount),0) INTO _ded
  FROM (SELECT employee_id, SUM(amount) g FROM public.attendance_lines WHERE week_id=_week_id GROUP BY employee_id) x
  CROSS JOIN LATERAL public.employee_deductions(x.employee_id, x.g, 'weekly') d
  WHERE x.g > 0;
  UPDATE public.attendance_weeks
  SET total_amount = _gross, gross_amount = _gross, deduction_amount = _ded, net_amount = _gross - _ded
  WHERE id = _week_id;
END $$;

-- 6. Upsert line with allowance
DROP FUNCTION IF EXISTS public.upsert_attendance_line(uuid,uuid,numeric,numeric,numeric,uuid,uuid,text,uuid);
CREATE OR REPLACE FUNCTION public.upsert_attendance_line(
  _week_id uuid, _employee_id uuid, _days numeric DEFAULT 0, _hours numeric DEFAULT 0,
  _overtime_hours numeric DEFAULT 0, _project_id uuid DEFAULT NULL, _conversion_id uuid DEFAULT NULL,
  _notes text DEFAULT NULL, _line_id uuid DEFAULT NULL, _allowance numeric DEFAULT 0,
  _allowance_label text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _w public.attendance_weeks%ROWTYPE; _basis text; _c record; _id uuid; _before jsonb;
BEGIN
  IF NOT public.can_manage_payroll() THEN RAISE EXCEPTION 'Not authorised'; END IF;
  SELECT * INTO _w FROM public.attendance_weeks WHERE id = _week_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Week not found'; END IF;
  IF _w.status <> 'draft' THEN RAISE EXCEPTION 'Week is % — locked. Use Correct entry to adjust it.', _w.status; END IF;

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
END $$;

-- 7. Delete line (audit)
CREATE OR REPLACE FUNCTION public.delete_attendance_line(_line_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _week uuid; _status text; _org uuid; _before jsonb;
BEGIN
  IF NOT public.can_manage_payroll() THEN RAISE EXCEPTION 'Not authorised'; END IF;
  SELECT l.week_id, w.status, w.organization_id, to_jsonb(l) INTO _week, _status, _org, _before
  FROM public.attendance_lines l JOIN public.attendance_weeks w ON w.id=l.week_id WHERE l.id=_line_id;
  IF _week IS NULL THEN RETURN; END IF;
  IF _status <> 'draft' THEN RAISE EXCEPTION 'Week is % — locked. Use Correct entry to adjust it.', _status; END IF;
  DELETE FROM public.attendance_lines WHERE id=_line_id;
  INSERT INTO public.attendance_audit(organization_id, week_id, line_id, action, before) VALUES (_org,_week,_line_id,'delete',_before);
  PERFORM public.recalc_attendance_week(_week);
END $$;

-- 8. Approve week: labour / allowance / deductions / net payable
CREATE OR REPLACE FUNCTION public.approve_attendance_week(_week_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _w public.attendance_weeks%ROWTYPE; _l record; _curr text; _gross numeric; _ded numeric; _net numeric; _d record;
BEGIN
  IF NOT public.can_manage_payroll() THEN RAISE EXCEPTION 'Not authorised'; END IF;
  SELECT * INTO _w FROM public.attendance_weeks WHERE id=_week_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Week not found'; END IF;
  IF _w.status <> 'draft' THEN RETURN; END IF;

  FOR _l IN SELECT * FROM public.attendance_lines WHERE week_id=_week_id LOOP
    UPDATE public.attendance_lines l
    SET rate=c.rate, base_amount=c.base_amount, overtime_amount=c.overtime_amount, allowance=c.allowance, amount=c.amount
    FROM public.attendance_line_components(_l.employee_id, _l.basis, _l.days, _l.hours, _l.overtime_hours, _l.allowance) c
    WHERE l.id=_l.id;
  END LOOP;
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

    -- labour (base + overtime) by project
    INSERT INTO public.accounting_transactions(transaction_number, transaction_date, account_type, category, description,
      debit_amount, credit_amount, reference_type, reference_id, organization_id, project_id, currency)
    SELECT 'WGE-DR-'||substring(_week_id::text,1,8)||'-'||COALESCE(substring(l.project_id::text,1,4),'GEN'),
      _w.week_end, 'cost_of_goods',
      CASE WHEN l.project_id IS NOT NULL THEN 'project_labour' ELSE 'direct_labour' END,
      'Weekly wages '||_w.week_start||' → '||_w.week_end, SUM(l.base_amount + l.overtime_amount), 0,
      'attendance_week', _week_id, _w.organization_id, l.project_id, _curr
    FROM public.attendance_lines l WHERE l.week_id=_week_id
    GROUP BY l.project_id HAVING SUM(l.base_amount + l.overtime_amount) <> 0;

    -- allowances to their own expense category
    INSERT INTO public.accounting_transactions(transaction_number, transaction_date, account_type, category, description,
      debit_amount, credit_amount, reference_type, reference_id, organization_id, project_id, currency)
    SELECT 'WGE-ALW-'||substring(_week_id::text,1,8)||'-'||COALESCE(substring(l.project_id::text,1,4),'GEN'),
      _w.week_end, 'expense', 'wage_allowances',
      'Weekly allowances '||_w.week_start||' → '||_w.week_end, SUM(l.allowance), 0,
      'attendance_week', _week_id, _w.organization_id, l.project_id, _curr
    FROM public.attendance_lines l WHERE l.week_id=_week_id
    GROUP BY l.project_id HAVING SUM(l.allowance) <> 0;

    -- statutory / custom deductions as liabilities
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

    -- net wages payable
    INSERT INTO public.accounting_transactions(transaction_number, transaction_date, account_type, category, description,
      debit_amount, credit_amount, reference_type, reference_id, organization_id, currency)
    VALUES ('WGE-CR-'||substring(_week_id::text,1,8), _w.week_end, 'liability','wages_payable',
      'Net wages payable '||_w.week_start||' → '||_w.week_end, 0, _net, 'attendance_week', _week_id, _w.organization_id, _curr);
  END IF;

  UPDATE public.attendance_weeks SET status='approved', approved_by=auth.uid(), approved_at=now() WHERE id=_week_id;
  INSERT INTO public.attendance_audit(organization_id, week_id, action, after)
  VALUES (_w.organization_id, _week_id, 'approve', jsonb_build_object('gross',_gross,'deductions',_ded,'net',_net));
END $$;

-- 9. Pay net
CREATE OR REPLACE FUNCTION public.pay_attendance_week(_week_id uuid, _from_account_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _w public.attendance_weeks%ROWTYPE; _curr text; _net numeric;
BEGIN
  IF NOT public.can_manage_payroll() THEN RAISE EXCEPTION 'Not authorised'; END IF;
  SELECT * INTO _w FROM public.attendance_weeks WHERE id=_week_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Week not found'; END IF;
  IF _w.status = 'paid' THEN RETURN; END IF;
  IF _w.status <> 'approved' THEN RAISE EXCEPTION 'Approve the week before paying'; END IF;
  IF _from_account_id IS NULL THEN RAISE EXCEPTION 'Select a paying account'; END IF;
  _curr := COALESCE(_w.currency,(SELECT currency FROM organizations WHERE id=_w.organization_id));
  _net := COALESCE(NULLIF(_w.net_amount,0), _w.total_amount);

  IF NOT EXISTS (SELECT 1 FROM public.accounting_transactions WHERE reference_type='attendance_week_payment' AND reference_id=_week_id) THEN
    INSERT INTO public.accounting_transactions(transaction_number, transaction_date, account_type, category, description,
      debit_amount, credit_amount, reference_type, reference_id, organization_id, financial_account_id, currency)
    VALUES ('WGE-PAY-DR-'||substring(_week_id::text,1,8), now(), 'liability','wages_payable',
      'Net wages settled '||_w.week_start, _net, 0, 'attendance_week_payment', _week_id, _w.organization_id, NULL, _curr);
    INSERT INTO public.accounting_transactions(transaction_number, transaction_date, account_type, category, description,
      debit_amount, credit_amount, reference_type, reference_id, organization_id, financial_account_id, currency)
    VALUES ('WGE-PAY-CR-'||substring(_week_id::text,1,8), now(), 'asset','cash',
      'Net wages paid '||_w.week_start, 0, _net, 'attendance_week_payment', _week_id, _w.organization_id, _from_account_id, _curr);
  END IF;

  UPDATE public.attendance_weeks SET status='paid', paid_by=auth.uid(), paid_at=now(), paid_from_account_id=_from_account_id WHERE id=_week_id;
  INSERT INTO public.attendance_audit(organization_id, week_id, action, after, reason)
  VALUES (_w.organization_id, _week_id, 'pay', jsonb_build_object('net',_net,'account',_from_account_id), NULL);
END $$;

-- 10. Correct a locked line: reversal + replacement + adjusting journal
CREATE OR REPLACE FUNCTION public.correct_attendance_line(
  _line_id uuid, _days numeric, _hours numeric, _overtime_hours numeric, _allowance numeric,
  _allowance_label text, _project_id uuid, _conversion_id uuid, _reason text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _o public.attendance_lines%ROWTYPE; _w public.attendance_weeks%ROWTYPE; _c record;
        _rev uuid; _new uuid; _curr text; _delta numeric;
BEGIN
  IF NOT public.can_manage_payroll() THEN RAISE EXCEPTION 'Not authorised'; END IF;
  IF COALESCE(btrim(_reason),'') = '' THEN RAISE EXCEPTION 'A reason is required for corrections'; END IF;
  SELECT * INTO _o FROM public.attendance_lines WHERE id=_line_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Entry not found'; END IF;
  SELECT * INTO _w FROM public.attendance_weeks WHERE id=_o.week_id FOR UPDATE;
  IF _w.status = 'draft' THEN RAISE EXCEPTION 'Week is still open — edit the entry directly'; END IF;
  _curr := COALESCE(_w.currency,(SELECT currency FROM organizations WHERE id=_w.organization_id));

  -- reversal of the original
  INSERT INTO public.attendance_lines(week_id, organization_id, employee_id, project_id, conversion_id, basis,
    days, hours, overtime_hours, rate, base_amount, overtime_amount, allowance, allowance_label, amount,
    notes, reverses_line_id, correction_reason, is_correction)
  VALUES (_o.week_id, _o.organization_id, _o.employee_id, _o.project_id, _o.conversion_id, _o.basis,
    -_o.days, -_o.hours, -_o.overtime_hours, _o.rate, -_o.base_amount, -_o.overtime_amount, -_o.allowance,
    _o.allowance_label, -_o.amount, 'Reversal of corrected entry', _o.id, _reason, true)
  RETURNING id INTO _rev;

  -- corrected replacement
  SELECT * INTO _c FROM public.attendance_line_components(_o.employee_id, _o.basis, _days, _hours, _overtime_hours, _allowance);
  INSERT INTO public.attendance_lines(week_id, organization_id, employee_id, project_id, conversion_id, basis,
    days, hours, overtime_hours, rate, base_amount, overtime_amount, allowance, allowance_label, amount,
    notes, correction_reason, is_correction)
  VALUES (_o.week_id, _o.organization_id, _o.employee_id, _project_id, _conversion_id, _o.basis,
    COALESCE(_days,0), COALESCE(_hours,0), COALESCE(_overtime_hours,0), _c.rate, _c.base_amount, _c.overtime_amount,
    _c.allowance, _allowance_label, _c.amount, _o.notes, _reason, true)
  RETURNING id INTO _new;

  _delta := _c.amount - _o.amount;

  -- job costing adjustments
  IF _o.conversion_id IS NOT NULL THEN
    INSERT INTO public.cost_entries(production_order_id, cost_type, reference_id, reference_type, amount, description, organization_id)
    VALUES (_o.conversion_id, 'labour', _rev, 'attendance_line', -_o.amount, 'Reversal — wage correction '||_w.week_start, _o.organization_id);
  END IF;
  IF _conversion_id IS NOT NULL AND _c.amount <> 0 THEN
    INSERT INTO public.cost_entries(production_order_id, cost_type, reference_id, reference_type, amount, description, organization_id)
    VALUES (_conversion_id, 'labour', _new, 'attendance_line', _c.amount, 'Corrected wage '||_w.week_start, _o.organization_id);
  END IF;

  -- adjusting journal (expense vs payable) for the net difference
  IF _delta <> 0 THEN
    INSERT INTO public.accounting_transactions(transaction_number, transaction_date, account_type, category, description,
      debit_amount, credit_amount, reference_type, reference_id, organization_id, project_id, currency)
    VALUES ('WGE-ADJ-DR-'||substring(_new::text,1,8), CURRENT_DATE, 'cost_of_goods',
      CASE WHEN _project_id IS NOT NULL THEN 'project_labour' ELSE 'direct_labour' END,
      'Wage correction '||_w.week_start||' — '||_reason,
      GREATEST(_delta,0), GREATEST(-_delta,0), 'attendance_correction', _new, _o.organization_id, _project_id, _curr);
    INSERT INTO public.accounting_transactions(transaction_number, transaction_date, account_type, category, description,
      debit_amount, credit_amount, reference_type, reference_id, organization_id, currency)
    VALUES ('WGE-ADJ-CR-'||substring(_new::text,1,8), CURRENT_DATE, 'liability','wages_payable',
      'Wage correction payable '||_w.week_start, GREATEST(-_delta,0), GREATEST(_delta,0),
      'attendance_correction', _new, _o.organization_id, _curr);
  END IF;

  PERFORM public.recalc_attendance_week(_o.week_id);
  INSERT INTO public.attendance_audit(organization_id, week_id, line_id, action, before, after, reason)
  SELECT _o.organization_id, _o.week_id, _new, 'correct', to_jsonb(_o), to_jsonb(l), _reason
  FROM public.attendance_lines l WHERE l.id=_new;
  RETURN _new;
END $$;

-- 11. Monthly summaries with allowances + deductions
CREATE OR REPLACE FUNCTION public.generate_monthly_wage_payslips(_month_start date)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _org uuid := current_org_id(); _end date; _emp record; _slip uuid; _count integer := 0; _d record; _n integer;
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
END $$;

-- 12. Backfill components for existing lines
UPDATE public.attendance_lines SET base_amount = amount WHERE base_amount = 0 AND amount <> 0;
UPDATE public.attendance_weeks w SET gross_amount = total_amount, net_amount = total_amount WHERE gross_amount = 0;