-- 1. Balance assertion helper -------------------------------------------------
CREATE OR REPLACE FUNCTION public.assert_attendance_week_balanced(_week_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE _dr numeric; _cr numeric;
BEGIN
  SELECT COALESCE(SUM(t.debit_amount),0), COALESCE(SUM(t.credit_amount),0)
    INTO _dr, _cr
  FROM public.accounting_transactions t
  WHERE (t.reference_type='attendance_week' AND t.reference_id=_week_id)
     OR (t.reference_type='attendance_correction'
         AND t.reference_id IN (SELECT id FROM public.attendance_lines WHERE week_id=_week_id));

  IF round(_dr,2) <> round(_cr,2) THEN
    RAISE EXCEPTION 'Payroll journal for this week does not balance (debits %, credits %)', round(_dr,2), round(_cr,2);
  END IF;
END $$;

REVOKE ALL ON FUNCTION public.assert_attendance_week_balanced(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.assert_attendance_week_balanced(uuid) TO authenticated, service_role;

-- 2. Reconciliation report -----------------------------------------------------
CREATE OR REPLACE FUNCTION public.reconcile_attendance_week(_week_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _w public.attendance_weeks%ROWTYPE;
  _curr text;
  _totals jsonb; _jobs jsonb; _projects jsonb; _accounts jsonb;
  _dr numeric; _cr numeric;
BEGIN
  SELECT * INTO _w FROM public.attendance_weeks WHERE id=_week_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Week not found'; END IF;
  IF _w.organization_id <> public.current_org_id() AND NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Not authorised';
  END IF;
  IF NOT public.can_manage_payroll() THEN RAISE EXCEPTION 'Not authorised'; END IF;

  _curr := COALESCE(_w.currency,(SELECT currency FROM organizations WHERE id=_w.organization_id));

  SELECT jsonb_build_object(
    'base', COALESCE(SUM(base_amount),0),
    'overtime', COALESCE(SUM(overtime_amount),0),
    'allowance', COALESCE(SUM(allowance),0),
    'gross', COALESCE(SUM(amount),0),
    'deductions', COALESCE(_w.deduction_amount,0),
    'net', COALESCE(_w.net_amount,0),
    'line_count', COUNT(*),
    'correction_count', COUNT(*) FILTER (WHERE is_correction)
  ) INTO _totals
  FROM public.attendance_lines WHERE week_id=_week_id;

  -- per conversion job: attendance vs mirrored job labour vs cost entries
  SELECT COALESCE(jsonb_agg(x ORDER BY x->>'job_number'), '[]'::jsonb) INTO _jobs
  FROM (
    SELECT jsonb_build_object(
      'conversion_id', a.conversion_id,
      'job_number', cc.conversion_number,
      'project_id', cc.project_id,
      'project_name', p.name,
      'attendance_amount', a.amt,
      'job_labour_amount', COALESCE(cl.amt,0),
      'cost_entry_amount', COALESCE(ce.amt,0),
      'variance', round(a.amt - COALESCE(cl.amt,0), 2)
    ) AS x
    FROM (
      SELECT conversion_id, SUM(amount) amt
      FROM public.attendance_lines WHERE week_id=_week_id AND conversion_id IS NOT NULL
      GROUP BY conversion_id
    ) a
    LEFT JOIN public.container_conversions cc ON cc.id = a.conversion_id
    LEFT JOIN public.projects p ON p.id = cc.project_id
    LEFT JOIN LATERAL (
      SELECT SUM(l.total_cost) amt FROM public.conversion_labour l
      WHERE l.conversion_id = a.conversion_id AND l.source='payroll'
        AND l.attendance_line_id IN (SELECT id FROM public.attendance_lines WHERE week_id=_week_id)
    ) cl ON true
    LEFT JOIN LATERAL (
      SELECT SUM(c.amount) amt FROM public.cost_entries c
      WHERE c.production_order_id = a.conversion_id AND c.reference_type='attendance_line'
        AND c.reference_id IN (SELECT id FROM public.attendance_lines WHERE week_id=_week_id)
    ) ce ON true
  ) s;

  -- per project: attendance labour vs COGS journal
  SELECT COALESCE(jsonb_agg(x ORDER BY x->>'project_name' NULLS FIRST), '[]'::jsonb) INTO _projects
  FROM (
    SELECT jsonb_build_object(
      'project_id', a.project_id,
      'project_name', COALESCE(p.name,'Unassigned'),
      'labour_amount', a.labour,
      'allowance_amount', a.allow,
      'cogs_posted', COALESCE(j.dr,0),
      'variance', round(a.labour - COALESCE(j.dr,0), 2)
    ) AS x
    FROM (
      SELECT project_id,
             SUM(base_amount + overtime_amount) labour,
             SUM(allowance) allow
      FROM public.attendance_lines WHERE week_id=_week_id
      GROUP BY project_id
    ) a
    LEFT JOIN public.projects p ON p.id = a.project_id
    LEFT JOIN LATERAL (
      SELECT SUM(t.debit_amount - t.credit_amount) dr
      FROM public.accounting_transactions t
      WHERE t.account_type='cost_of_goods'
        AND t.project_id IS NOT DISTINCT FROM a.project_id
        AND ((t.reference_type='attendance_week' AND t.reference_id=_week_id)
          OR (t.reference_type='attendance_correction'
              AND t.reference_id IN (SELECT id FROM public.attendance_lines WHERE week_id=_week_id)))
    ) j ON true
  ) s;

  -- per ledger account/category
  SELECT COALESCE(jsonb_agg(x ORDER BY x->>'account_type', x->>'category'), '[]'::jsonb) INTO _accounts
  FROM (
    SELECT jsonb_build_object(
      'account_type', t.account_type,
      'category', t.category,
      'debit', SUM(t.debit_amount),
      'credit', SUM(t.credit_amount),
      'entries', COUNT(*)
    ) AS x
    FROM public.accounting_transactions t
    WHERE (t.reference_type='attendance_week' AND t.reference_id=_week_id)
       OR (t.reference_type='attendance_correction'
           AND t.reference_id IN (SELECT id FROM public.attendance_lines WHERE week_id=_week_id))
    GROUP BY t.account_type, t.category
  ) s;

  SELECT COALESCE(SUM(t.debit_amount),0), COALESCE(SUM(t.credit_amount),0) INTO _dr, _cr
  FROM public.accounting_transactions t
  WHERE (t.reference_type='attendance_week' AND t.reference_id=_week_id)
     OR (t.reference_type='attendance_correction'
         AND t.reference_id IN (SELECT id FROM public.attendance_lines WHERE week_id=_week_id));

  RETURN jsonb_build_object(
    'week', jsonb_build_object('id',_w.id,'week_start',_w.week_start,'week_end',_w.week_end,
                               'status',_w.status,'currency',_curr,'paid_at',_w.paid_at),
    'totals', _totals,
    'jobs', _jobs,
    'projects', _projects,
    'accounts', _accounts,
    'ledger', jsonb_build_object('debit',_dr,'credit',_cr,'difference', round(_dr-_cr,2),
                                 'balanced', round(_dr,2) = round(_cr,2))
  );
END $$;

REVOKE ALL ON FUNCTION public.reconcile_attendance_week(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.reconcile_attendance_week(uuid) TO authenticated, service_role;

-- 3. Assert balance after approval and after corrections -----------------------
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
    SET rate=c.rate, base_amount=c.base_amount, overtime_amount=c.overtime_amount, allowance=c.allowance, amount=c.amount
    FROM public.attendance_line_components(_l.employee_id, _l.basis, _l.days, _l.hours, _l.overtime_hours, _l.allowance) c
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

  PERFORM public.assert_attendance_week_balanced(_week_id);
END $function$;

CREATE OR REPLACE FUNCTION public.correct_attendance_line(_line_id uuid, _days numeric, _hours numeric, _overtime_hours numeric, _allowance numeric, _allowance_label text, _project_id uuid, _conversion_id uuid, _reason text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
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

  -- reverse the original COGS attribution and post the replacement, so project
  -- totals stay net-correct even when the job/project changed
  IF COALESCE(_o.base_amount,0) + COALESCE(_o.overtime_amount,0) <> 0 THEN
    INSERT INTO public.accounting_transactions(transaction_number, transaction_date, account_type, category, description,
      debit_amount, credit_amount, reference_type, reference_id, organization_id, project_id, currency)
    VALUES ('WGE-REV-'||substring(_rev::text,1,8), CURRENT_DATE, 'cost_of_goods',
      CASE WHEN _o.project_id IS NOT NULL THEN 'project_labour' ELSE 'direct_labour' END,
      'Reversal of wage entry '||_w.week_start||' — '||_reason,
      0, COALESCE(_o.base_amount,0) + COALESCE(_o.overtime_amount,0),
      'attendance_correction', _rev, _o.organization_id, _o.project_id, _curr);
  END IF;
  IF COALESCE(_c.base_amount,0) + COALESCE(_c.overtime_amount,0) <> 0 THEN
    INSERT INTO public.accounting_transactions(transaction_number, transaction_date, account_type, category, description,
      debit_amount, credit_amount, reference_type, reference_id, organization_id, project_id, currency)
    VALUES ('WGE-RPL-'||substring(_new::text,1,8), CURRENT_DATE, 'cost_of_goods',
      CASE WHEN _project_id IS NOT NULL THEN 'project_labour' ELSE 'direct_labour' END,
      'Corrected wage entry '||_w.week_start||' — '||_reason,
      COALESCE(_c.base_amount,0) + COALESCE(_c.overtime_amount,0), 0,
      'attendance_correction', _new, _o.organization_id, _project_id, _curr);
  END IF;

  -- allowance side
  IF COALESCE(_o.allowance,0) <> 0 THEN
    INSERT INTO public.accounting_transactions(transaction_number, transaction_date, account_type, category, description,
      debit_amount, credit_amount, reference_type, reference_id, organization_id, project_id, currency)
    VALUES ('WGE-REVA-'||substring(_rev::text,1,8), CURRENT_DATE, 'expense','wage_allowances',
      'Reversal of allowance '||_w.week_start||' — '||_reason, 0, _o.allowance,
      'attendance_correction', _rev, _o.organization_id, _o.project_id, _curr);
  END IF;
  IF COALESCE(_c.allowance,0) <> 0 THEN
    INSERT INTO public.accounting_transactions(transaction_number, transaction_date, account_type, category, description,
      debit_amount, credit_amount, reference_type, reference_id, organization_id, project_id, currency)
    VALUES ('WGE-RPLA-'||substring(_new::text,1,8), CURRENT_DATE, 'expense','wage_allowances',
      'Corrected allowance '||_w.week_start||' — '||_reason, _c.allowance, 0,
      'attendance_correction', _new, _o.organization_id, _project_id, _curr);
  END IF;

  -- net payable movement
  IF _delta <> 0 THEN
    INSERT INTO public.accounting_transactions(transaction_number, transaction_date, account_type, category, description,
      debit_amount, credit_amount, reference_type, reference_id, organization_id, currency)
    VALUES ('WGE-ADJ-CR-'||substring(_new::text,1,8), CURRENT_DATE, 'liability','wages_payable',
      'Wage correction payable '||_w.week_start||' — '||_reason, GREATEST(-_delta,0), GREATEST(_delta,0),
      'attendance_correction', _new, _o.organization_id, _curr);
  END IF;

  PERFORM public.recalc_attendance_week(_o.week_id);
  INSERT INTO public.attendance_audit(organization_id, week_id, line_id, action, before, after, reason)
  SELECT _o.organization_id, _o.week_id, _new, 'correct', to_jsonb(_o), to_jsonb(l), _reason
  FROM public.attendance_lines l WHERE l.id=_new;

  PERFORM public.assert_attendance_week_balanced(_o.week_id);
  RETURN _new;
END $function$;