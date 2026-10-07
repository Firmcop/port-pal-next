-- 1. Track payroll-sourced job labour
ALTER TABLE public.conversion_labour
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS attendance_line_id uuid;

CREATE UNIQUE INDEX IF NOT EXISTS conversion_labour_attendance_line_uniq
  ON public.conversion_labour(attendance_line_id) WHERE attendance_line_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.guard_payroll_labour()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF COALESCE(current_setting('app.payroll_sync', true),'') = 'on' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  IF COALESCE(OLD.source,'manual') = 'payroll' THEN
    RAISE EXCEPTION 'This labour entry comes from payroll — correct it on the attendance week instead.';
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;

DROP TRIGGER IF EXISTS trg_guard_payroll_labour ON public.conversion_labour;
CREATE TRIGGER trg_guard_payroll_labour
  BEFORE UPDATE OR DELETE ON public.conversion_labour
  FOR EACH ROW EXECUTE FUNCTION public.guard_payroll_labour();

-- 2. Helper: mirror an attendance line onto its conversion job
CREATE OR REPLACE FUNCTION public.sync_attendance_line_to_job(_line_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _l public.attendance_lines%ROWTYPE; _w public.attendance_weeks%ROWTYPE; _name text;
BEGIN
  SELECT * INTO _l FROM public.attendance_lines WHERE id=_line_id;
  IF NOT FOUND OR _l.conversion_id IS NULL OR COALESCE(_l.amount,0) = 0 THEN RETURN; END IF;
  SELECT * INTO _w FROM public.attendance_weeks WHERE id=_l.week_id;
  SELECT name INTO _name FROM public.employees WHERE id=_l.employee_id;

  PERFORM set_config('app.payroll_sync','on',true);
  INSERT INTO public.conversion_labour(conversion_id, worker_name, role, hours, rate, total_cost,
                                       organization_id, source, attendance_line_id)
  VALUES (_l.conversion_id, COALESCE(_name,'Employee'),
          'Payroll — week of '||_w.week_start,
          COALESCE(_l.hours,0) + COALESCE(_l.overtime_hours,0), COALESCE(_l.rate,0), _l.amount,
          _l.organization_id, 'payroll', _l.id)
  ON CONFLICT (attendance_line_id) WHERE attendance_line_id IS NOT NULL
  DO UPDATE SET conversion_id = EXCLUDED.conversion_id, worker_name = EXCLUDED.worker_name,
                role = EXCLUDED.role, hours = EXCLUDED.hours, rate = EXCLUDED.rate,
                total_cost = EXCLUDED.total_cost;
  PERFORM set_config('app.payroll_sync','off',true);
END $$;

-- 3. Default the project from the job on save
CREATE OR REPLACE FUNCTION public.upsert_attendance_line(_week_id uuid, _employee_id uuid, _days numeric DEFAULT 0, _hours numeric DEFAULT 0, _overtime_hours numeric DEFAULT 0, _project_id uuid DEFAULT NULL::uuid, _conversion_id uuid DEFAULT NULL::uuid, _notes text DEFAULT NULL::text, _line_id uuid DEFAULT NULL::uuid, _allowance numeric DEFAULT 0, _allowance_label text DEFAULT NULL::text)
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE _w public.attendance_weeks%ROWTYPE; _basis text; _c record; _id uuid; _before jsonb;
BEGIN
  IF NOT public.can_manage_payroll() THEN RAISE EXCEPTION 'Not authorised'; END IF;
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

-- 4. Approval posts job labour and derives projects
CREATE OR REPLACE FUNCTION public.approve_attendance_week(_week_id uuid)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
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

  -- derive project from the assigned job when missing
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

    -- mirror onto the conversion jobs so job costing picks wages up
    FOR _l IN SELECT id FROM public.attendance_lines WHERE week_id=_week_id AND conversion_id IS NOT NULL AND amount <> 0 LOOP
      PERFORM public.sync_attendance_line_to_job(_l.id);
    END LOOP;

    INSERT INTO public.accounting_transactions(transaction_number, transaction_date, account_type, category, description,
      debit_amount, credit_amount, reference_type, reference_id, organization_id, project_id, currency)
    SELECT 'WGE-DR-'||substring(_week_id::text,1,8)||'-'||COALESCE(substring(l.project_id::text,1,4),'GEN'),
      _w.week_end, 'cost_of_goods',
      CASE WHEN l.project_id IS NOT NULL THEN 'project_labour' ELSE 'direct_labour' END,
      'Weekly wages '||_w.week_start||' → '||_w.week_end, SUM(l.base_amount + l.overtime_amount), 0,
      'attendance_week', _week_id, _w.organization_id, l.project_id, _curr
    FROM public.attendance_lines l WHERE l.week_id=_week_id
    GROUP BY l.project_id HAVING SUM(l.base_amount + l.overtime_amount) <> 0;

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
END $function$;

-- 5. Corrections mirror onto the job too
CREATE OR REPLACE FUNCTION public.correct_attendance_line(_line_id uuid, _days numeric, _hours numeric, _overtime_hours numeric, _allowance numeric, _allowance_label text, _project_id uuid, _conversion_id uuid, _reason text)
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
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

  IF _project_id IS NULL AND _conversion_id IS NOT NULL THEN
    SELECT project_id INTO _project_id FROM public.container_conversions WHERE id=_conversion_id;
  END IF;

  INSERT INTO public.attendance_lines(week_id, organization_id, employee_id, project_id, conversion_id, basis,
    days, hours, overtime_hours, rate, base_amount, overtime_amount, allowance, allowance_label, amount,
    notes, reverses_line_id, correction_reason, is_correction)
  VALUES (_o.week_id, _o.organization_id, _o.employee_id, _o.project_id, _o.conversion_id, _o.basis,
    -_o.days, -_o.hours, -_o.overtime_hours, _o.rate, -_o.base_amount, -_o.overtime_amount, -_o.allowance,
    _o.allowance_label, -_o.amount, 'Reversal of corrected entry', _o.id, _reason, true)
  RETURNING id INTO _rev;

  SELECT * INTO _c FROM public.attendance_line_components(_o.employee_id, _o.basis, _days, _hours, _overtime_hours, _allowance);
  INSERT INTO public.attendance_lines(week_id, organization_id, employee_id, project_id, conversion_id, basis,
    days, hours, overtime_hours, rate, base_amount, overtime_amount, allowance, allowance_label, amount,
    notes, correction_reason, is_correction)
  VALUES (_o.week_id, _o.organization_id, _o.employee_id, _project_id, _conversion_id, _o.basis,
    COALESCE(_days,0), COALESCE(_hours,0), COALESCE(_overtime_hours,0), _c.rate, _c.base_amount, _c.overtime_amount,
    _c.allowance, _allowance_label, _c.amount, _o.notes, _reason, true)
  RETURNING id INTO _new;

  _delta := _c.amount - _o.amount;

  IF _o.conversion_id IS NOT NULL THEN
    INSERT INTO public.cost_entries(production_order_id, cost_type, reference_id, reference_type, amount, description, organization_id)
    VALUES (_o.conversion_id, 'labour', _rev, 'attendance_line', -_o.amount, 'Reversal — wage correction '||_w.week_start, _o.organization_id);
    PERFORM public.sync_attendance_line_to_job(_rev);
  END IF;
  IF _conversion_id IS NOT NULL AND _c.amount <> 0 THEN
    INSERT INTO public.cost_entries(production_order_id, cost_type, reference_id, reference_type, amount, description, organization_id)
    VALUES (_conversion_id, 'labour', _new, 'attendance_line', _c.amount, 'Corrected wage '||_w.week_start, _o.organization_id);
    PERFORM public.sync_attendance_line_to_job(_new);
  END IF;

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
END $function$;

-- 6. Restate weeks already approved/paid
DO $$
DECLARE _w record; _l record; _p record; _curr text; _amt numeric;
BEGIN
  FOR _w IN SELECT * FROM public.attendance_weeks WHERE status IN ('approved','paid') LOOP
    _curr := COALESCE(_w.currency,(SELECT currency FROM public.organizations WHERE id=_w.organization_id));

    -- reclassify generic labour to project labour where the job carries a project
    FOR _p IN
      SELECT cc.project_id, SUM(l.base_amount + l.overtime_amount) amt
      FROM public.attendance_lines l JOIN public.container_conversions cc ON cc.id=l.conversion_id
      WHERE l.week_id=_w.id AND l.project_id IS NULL AND cc.project_id IS NOT NULL
      GROUP BY cc.project_id HAVING SUM(l.base_amount + l.overtime_amount) <> 0
    LOOP
      INSERT INTO public.accounting_transactions(transaction_number, transaction_date, account_type, category, description,
        debit_amount, credit_amount, reference_type, reference_id, organization_id, project_id, currency)
      VALUES ('WGE-RCL-DR-'||substring(_w.id::text,1,8)||'-'||substring(_p.project_id::text,1,4), _w.week_end,
        'cost_of_goods','project_labour','Wage reclass to project — week '||_w.week_start,
        _p.amt, 0, 'attendance_week_reclass', _w.id, _w.organization_id, _p.project_id, _curr);
      INSERT INTO public.accounting_transactions(transaction_number, transaction_date, account_type, category, description,
        debit_amount, credit_amount, reference_type, reference_id, organization_id, currency)
      VALUES ('WGE-RCL-CR-'||substring(_w.id::text,1,8)||'-'||substring(_p.project_id::text,1,4), _w.week_end,
        'cost_of_goods','direct_labour','Wage reclass out of general labour — week '||_w.week_start,
        0, _p.amt, 'attendance_week_reclass', _w.id, _w.organization_id, _curr);
    END LOOP;

    UPDATE public.attendance_lines l SET project_id = cc.project_id
    FROM public.container_conversions cc
    WHERE l.week_id=_w.id AND l.conversion_id=cc.id AND l.project_id IS NULL AND cc.project_id IS NOT NULL;

    FOR _l IN SELECT id FROM public.attendance_lines WHERE week_id=_w.id AND conversion_id IS NOT NULL AND amount <> 0 LOOP
      PERFORM public.sync_attendance_line_to_job(_l.id);
    END LOOP;

    INSERT INTO public.attendance_audit(organization_id, week_id, action, reason, after)
    VALUES (_w.organization_id, _w.id, 'restate', 'Wages attributed to jobs and projects',
            jsonb_build_object('week_start',_w.week_start));
  END LOOP;
END $$;