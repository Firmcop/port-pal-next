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
  WHERE (t.reference_type LIKE 'attendance_week%' AND t.reference_id=_week_id)
     OR (t.reference_type='attendance_correction'
         AND t.reference_id IN (SELECT id FROM public.attendance_lines WHERE week_id=_week_id));

  IF round(_dr,2) <> round(_cr,2) THEN
    RAISE EXCEPTION 'Payroll journal for this week does not balance (debits %, credits %)', round(_dr,2), round(_cr,2);
  END IF;
END $$;

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
        AND ((t.reference_type LIKE 'attendance_week%' AND t.reference_id=_week_id)
          OR (t.reference_type='attendance_correction'
              AND t.reference_id IN (SELECT id FROM public.attendance_lines WHERE week_id=_week_id)))
    ) j ON true
  ) s;

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
    WHERE (t.reference_type LIKE 'attendance_week%' AND t.reference_id=_week_id)
       OR (t.reference_type='attendance_correction'
           AND t.reference_id IN (SELECT id FROM public.attendance_lines WHERE week_id=_week_id))
    GROUP BY t.account_type, t.category
  ) s;

  SELECT COALESCE(SUM(t.debit_amount),0), COALESCE(SUM(t.credit_amount),0) INTO _dr, _cr
  FROM public.accounting_transactions t
  WHERE (t.reference_type LIKE 'attendance_week%' AND t.reference_id=_week_id)
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