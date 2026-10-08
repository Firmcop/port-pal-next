-- =====================================================================
-- HR & payroll, step 2: weekly attendance & casual wages
--
--  1. Every attendance action checks the week belongs to the caller's
--     company; wages can only be paid from the company's own accounts.
--  2. Approved/paid weeks are locked: lines can't be edited, status only
--     changes through Approve/Pay, only draft weeks can be deleted.
--  3. Pay settles whatever is still owed on the week, so amounts added by
--     corrections after payment can be paid ("Pay balance").
--  4. Casual workers get SHIF, Housing Levy, NSSF and PAYE: the week's pay
--     is scaled to a monthly equivalent, run through kenya_statutory() and
--     scaled back. Posted to the same KRA/NSSF/SHA/AHL accounts and shown on
--     the monthly statutory return and P9. Workers marked statutory_exempt
--     are skipped.
--  5. Entries: 0–7 days and 0–168 hours per person per week (corrections
--     excepted); the person who entered a week can't approve it; accountants
--     can pay.
-- =====================================================================

-- ---------------------------------------------------------------- statutory engine: no rates → no statutory

-- Dates before the first configured rate set (historic entries) get no statutory
-- figures instead of an error.
DO $$
DECLARE def text;
BEGIN
  SELECT pg_get_functiondef('public.kenya_statutory(numeric,date)'::regprocedure) INTO def;
  def := replace(def, $r$IF p IS NULL THEN RAISE EXCEPTION 'No Kenyan payroll rates configured for %', _on; END IF;$r$,
    $r$IF p IS NULL THEN
    RETURN jsonb_build_object('gross', g, 'nssf_tier1', 0, 'nssf_tier2', 0, 'nssf', 0, 'shif', 0, 'ahl', 0,
      'taxable_pay', g, 'tax_before_relief', 0, 'personal_relief', 0, 'paye', 0, 'nssf_employer', 0, 'ahl_employer', 0,
      'net', g, 'no_rates', true);
  END IF;$r$);
  IF position('no_rates' IN def) = 0 THEN RAISE EXCEPTION 'kenya_statutory patch did not apply'; END IF;
  EXECUTE def;
END $$;

-- ---------------------------------------------------------------- statutory for casual workers

CREATE TABLE IF NOT EXISTS public.attendance_statutory (
  week_id uuid NOT NULL REFERENCES public.attendance_weeks(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL,
  organization_id uuid NOT NULL,
  week_end date NOT NULL,
  gross numeric NOT NULL DEFAULT 0,
  paye numeric NOT NULL DEFAULT 0,
  nssf numeric NOT NULL DEFAULT 0,
  shif numeric NOT NULL DEFAULT 0,
  ahl numeric NOT NULL DEFAULT 0,
  nssf_employer numeric NOT NULL DEFAULT 0,
  ahl_employer numeric NOT NULL DEFAULT 0,
  PRIMARY KEY (week_id, employee_id)
);
ALTER TABLE public.attendance_statutory ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS attendance_statutory_read ON public.attendance_statutory;
CREATE POLICY attendance_statutory_read ON public.attendance_statutory FOR SELECT
  USING (organization_id = current_org_id() AND (can_manage_payroll() OR has_role(auth.uid(), 'accountant')));

-- Live per-employee statutory for a week (monthly-equivalent method).
CREATE OR REPLACE FUNCTION public.attendance_week_statutory(_week_id uuid)
RETURNS TABLE(employee_id uuid, gross numeric, paye numeric, nssf numeric, shif numeric, ahl numeric,
              nssf_employer numeric, ahl_employer numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  WITH w AS (SELECT * FROM attendance_weeks WHERE id = _week_id),
  g AS (
    SELECT l.employee_id, sum(l.amount) AS gross
      FROM attendance_lines l WHERE l.week_id = _week_id
     GROUP BY l.employee_id HAVING sum(l.amount) > 0
  ), s AS (
    SELECT g.employee_id, g.gross,
           public.kenya_statutory(g.gross * 52 / 12.0, (SELECT week_end FROM w)) AS k
      FROM g
      JOIN employees e ON e.id = g.employee_id
      JOIN organizations o ON o.id = e.organization_id
     WHERE COALESCE(o.country, 'KE') = 'KE' AND NOT COALESCE(e.statutory_exempt, false)
  )
  SELECT s.employee_id, s.gross,
         round((s.k->>'paye')::numeric * 12 / 52, 2), round((s.k->>'nssf')::numeric * 12 / 52, 2),
         round((s.k->>'shif')::numeric * 12 / 52, 2), round((s.k->>'ahl')::numeric * 12 / 52, 2),
         round((s.k->>'nssf_employer')::numeric * 12 / 52, 2), round((s.k->>'ahl_employer')::numeric * 12 / 52, 2)
    FROM s
$$;

CREATE OR REPLACE FUNCTION public.recalc_attendance_week(_week_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE _gross numeric := 0; _ded numeric := 0; _stat numeric := 0; _status text;
        _prev text := COALESCE(current_setting('app.attendance_action', true), '');
BEGIN
  SELECT status INTO _status FROM attendance_weeks WHERE id = _week_id;
  SELECT COALESCE(SUM(amount),0) INTO _gross FROM public.attendance_lines WHERE week_id = _week_id;
  SELECT COALESCE(SUM(d.amount),0) INTO _ded
    FROM (SELECT employee_id, SUM(amount) g FROM public.attendance_lines WHERE week_id=_week_id GROUP BY employee_id) x
    CROSS JOIN LATERAL public.employee_deductions(x.employee_id, x.g, 'weekly') d
   WHERE x.g > 0;
  -- statutory is fixed at approval; draft weeks show the live figure
  IF _status = 'draft' THEN
    SELECT COALESCE(sum(paye + nssf + shif + ahl), 0) INTO _stat FROM public.attendance_week_statutory(_week_id);
  ELSE
    SELECT COALESCE(sum(paye + nssf + shif + ahl), 0) INTO _stat FROM public.attendance_statutory WHERE week_id = _week_id;
  END IF;
  PERFORM set_config('app.attendance_action', 'on', true);
  UPDATE public.attendance_weeks
     SET total_amount = _gross, gross_amount = _gross, deduction_amount = _ded + _stat, net_amount = _gross - _ded - _stat
   WHERE id = _week_id;
  PERFORM set_config('app.attendance_action', _prev, true);
END $function$;

-- ---------------------------------------------------------------- access helpers

CREATE OR REPLACE FUNCTION public.assert_attendance_week_access(_week_id uuid)
RETURNS attendance_weeks
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE w attendance_weeks%ROWTYPE;
BEGIN
  SELECT * INTO w FROM attendance_weeks WHERE id = _week_id FOR UPDATE;
  IF NOT FOUND OR (w.organization_id IS DISTINCT FROM public.current_org_id() AND NOT public.is_platform_admin()) THEN
    RAISE EXCEPTION 'Week not found';
  END IF;
  RETURN w;
END $$;

-- ---------------------------------------------------------------- approve

CREATE OR REPLACE FUNCTION public.approve_attendance_week(_week_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE _w public.attendance_weeks%ROWTYPE; _l record; _base text; _gross numeric; _ded numeric; _net numeric; _d record;
        _st record; _jid uuid := gen_random_uuid(); _n int := 0;
BEGIN
  IF NOT public.can_manage_payroll() THEN RAISE EXCEPTION 'Not authorised'; END IF;
  _w := public.assert_attendance_week_access(_week_id);
  IF _w.status <> 'draft' THEN RETURN; END IF;
  IF EXISTS (SELECT 1 FROM attendance_audit a WHERE a.week_id = _week_id AND a.actor = auth.uid()
               AND a.action IN ('create', 'update')) AND NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'self_approval: someone other than the person who entered this week must approve it' USING ERRCODE = '42501';
  END IF;
  SELECT currency INTO _base FROM organizations WHERE id = _w.organization_id;

  PERFORM set_config('app.attendance_action', 'on', true);
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

  -- fix the statutory figures for this week
  DELETE FROM attendance_statutory WHERE week_id = _week_id;
  INSERT INTO attendance_statutory(week_id, employee_id, organization_id, week_end, gross, paye, nssf, shif, ahl, nssf_employer, ahl_employer)
  SELECT _week_id, s.employee_id, _w.organization_id, _w.week_end, s.gross, s.paye, s.nssf, s.shif, s.ahl, s.nssf_employer, s.ahl_employer
    FROM public.attendance_week_statutory(_week_id) s;

  UPDATE attendance_weeks SET status = 'approved', approved_by = auth.uid(), approved_at = now() WHERE id = _week_id;
  PERFORM public.recalc_attendance_week(_week_id);
  SELECT gross_amount, deduction_amount, net_amount INTO _gross, _ded, _net FROM public.attendance_weeks WHERE id=_week_id;
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

    -- wages (by project) and allowances
    INSERT INTO public.accounting_transactions(transaction_number, transaction_date, account_type, category, description,
      debit_amount, credit_amount, reference_type, reference_id, organization_id, project_id, currency, fx_rate, base_currency, journal_id)
    SELECT 'WGE-DR-'||substring(_week_id::text,1,8)||'-'||COALESCE(substring(l.project_id::text,1,4),'GEN'),
      _w.week_end, 'cost_of_goods', CASE WHEN l.project_id IS NOT NULL THEN 'project_labour' ELSE 'direct_labour' END,
      'Weekly wages '||_w.week_start||' → '||_w.week_end, SUM(l.base_amount + l.overtime_amount + l.holiday_amount), 0,
      'attendance_week', _week_id, _w.organization_id, l.project_id, _base, 1, _base, _jid
      FROM public.attendance_lines l WHERE l.week_id=_week_id
     GROUP BY l.project_id HAVING SUM(l.base_amount + l.overtime_amount + l.holiday_amount) <> 0;
    INSERT INTO public.accounting_transactions(transaction_number, transaction_date, account_type, category, description,
      debit_amount, credit_amount, reference_type, reference_id, organization_id, project_id, currency, fx_rate, base_currency, journal_id)
    SELECT 'WGE-ALW-'||substring(_week_id::text,1,8)||'-'||COALESCE(substring(l.project_id::text,1,4),'GEN'),
      _w.week_end, 'expense', 'wage_allowances', 'Weekly allowances '||_w.week_start||' → '||_w.week_end, SUM(l.allowance), 0,
      'attendance_week', _week_id, _w.organization_id, l.project_id, _base, 1, _base, _jid
      FROM public.attendance_lines l WHERE l.week_id=_week_id
     GROUP BY l.project_id HAVING SUM(l.allowance) <> 0;

    -- the employee's own fixed deductions
    FOR _d IN
      SELECT d.dtype, SUM(d.amount) amt
        FROM (SELECT employee_id, SUM(amount) g FROM public.attendance_lines WHERE week_id=_week_id GROUP BY employee_id) x
        CROSS JOIN LATERAL public.employee_deductions(x.employee_id, x.g, 'weekly') d
       WHERE x.g > 0 GROUP BY d.dtype HAVING SUM(d.amount) <> 0
    LOOP
      INSERT INTO public.accounting_transactions(transaction_number, transaction_date, account_type, category, description,
        debit_amount, credit_amount, reference_type, reference_id, organization_id, currency, fx_rate, base_currency, gl_account_id, journal_id)
      VALUES ('WGE-DED-'||substring(_week_id::text,1,8)||'-'||upper(left(_d.dtype,3)), _w.week_end, 'liability',
        'payroll_'||_d.dtype||'_payable', 'Payroll '||_d.dtype||' withheld '||_w.week_start, 0, _d.amt,
        'attendance_week', _week_id, _w.organization_id, _base, 1, _base, public.payroll_liability_gl(_w.organization_id, 'OTHER'), _jid);
    END LOOP;

    -- statutory: employer cost, and what is owed to KRA / NSSF / SHA / Housing Levy
    SELECT COALESCE(sum(paye),0) paye, COALESCE(sum(nssf),0) nssf, COALESCE(sum(shif),0) shif, COALESCE(sum(ahl),0) ahl,
           COALESCE(sum(nssf_employer),0) nssf_er, COALESCE(sum(ahl_employer),0) ahl_er
      INTO _st FROM attendance_statutory WHERE week_id = _week_id;
    IF _st.nssf_er + _st.ahl_er > 0 THEN
      INSERT INTO public.accounting_transactions(transaction_number, transaction_date, account_type, category, description,
        debit_amount, credit_amount, reference_type, reference_id, organization_id, currency, fx_rate, base_currency, gl_account_id, journal_id)
      VALUES ('WGE-ER-'||substring(_week_id::text,1,8), _w.week_end, 'expense', 'payroll_employer_costs',
        'Employer NSSF / Housing Levy '||_w.week_start, _st.nssf_er + _st.ahl_er, 0, 'attendance_week', _week_id, _w.organization_id,
        _base, 1, _base, public.ensure_gl_account(_w.organization_id, '6010', 'Employer Payroll Contributions', 'expense', 'payroll_employer_costs'), _jid);
    END IF;
    FOR _d IN SELECT * FROM (VALUES ('PAYE', _st.paye), ('NSSF', _st.nssf + _st.nssf_er), ('SHIF', _st.shif), ('AHL', _st.ahl + _st.ahl_er)) v(code, amt)
               WHERE amt > 0 LOOP
      _n := _n + 1;
      INSERT INTO public.accounting_transactions(transaction_number, transaction_date, account_type, category, description,
        debit_amount, credit_amount, reference_type, reference_id, organization_id, currency, fx_rate, base_currency, gl_account_id, journal_id)
      VALUES ('WGE-STAT-'||substring(_week_id::text,1,8)||'-'||_d.code, _w.week_end, 'liability', lower(_d.code),
        _d.code || ' on weekly wages '||_w.week_start, 0, _d.amt, 'attendance_week', _week_id, _w.organization_id,
        _base, 1, _base, public.payroll_liability_gl(_w.organization_id, _d.code), _jid);
    END LOOP;

    INSERT INTO public.accounting_transactions(transaction_number, transaction_date, account_type, category, description,
      debit_amount, credit_amount, reference_type, reference_id, organization_id, currency, fx_rate, base_currency, journal_id)
    VALUES ('WGE-CR-'||substring(_week_id::text,1,8), _w.week_end, 'liability','wages_payable',
      'Net wages payable '||_w.week_start||' → '||_w.week_end, 0, _net, 'attendance_week', _week_id, _w.organization_id,
      _base, 1, _base, _jid);
  END IF;

  INSERT INTO public.attendance_audit(organization_id, week_id, action, after)
  VALUES (_w.organization_id, _week_id, 'approve', jsonb_build_object('gross',_gross,'deductions',_ded,'net',_net));
  PERFORM public.assert_attendance_week_balanced(_week_id);
END $function$;

-- ---------------------------------------------------------------- pay (and pay balance)

CREATE OR REPLACE FUNCTION public.attendance_week_balance_due(_week_id uuid)
RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT round(COALESCE(sum(t.credit_amount - t.debit_amount), 0), 2)
    FROM accounting_transactions t
   WHERE t.category = 'wages_payable'
     AND ((t.reference_type LIKE 'attendance_week%' AND t.reference_id = _week_id)
          OR (t.reference_type = 'attendance_correction'
              AND t.reference_id IN (SELECT id FROM attendance_lines WHERE week_id = _week_id)))
     AND t.organization_id = current_org_id()
$$;
GRANT EXECUTE ON FUNCTION public.attendance_week_balance_due(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.pay_attendance_week(_week_id uuid, _from_account_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE _w public.attendance_weeks%ROWTYPE; _base text; _due numeric; _fa record; _cash uuid; _n int;
BEGIN
  IF NOT (public.can_manage_payroll() OR has_role(auth.uid(), 'accountant')) THEN RAISE EXCEPTION 'Not authorised'; END IF;
  _w := public.assert_attendance_week_access(_week_id);
  IF _w.status NOT IN ('approved', 'paid') THEN RAISE EXCEPTION 'Approve the week before paying'; END IF;
  IF _from_account_id IS NULL THEN RAISE EXCEPTION 'Select a paying account'; END IF;
  SELECT * INTO _fa FROM financial_accounts WHERE id = _from_account_id AND organization_id = _w.organization_id AND is_active;
  IF NOT FOUND THEN RAISE EXCEPTION 'Choose one of your company''s active bank, cash or M-Pesa accounts'; END IF;
  SELECT currency INTO _base FROM organizations WHERE id = _w.organization_id;
  IF upper(COALESCE(_fa.currency, _base)) <> upper(_base) THEN RAISE EXCEPTION 'Pay wages from a % account', _base; END IF;

  _due := public.attendance_week_balance_due(_week_id);
  IF _due <= 0 THEN
    IF _w.status = 'paid' THEN RAISE EXCEPTION 'Nothing is owed on this week'; END IF;
    RAISE EXCEPTION 'Nothing to pay';
  END IF;
  _cash := COALESCE(_fa.gl_account_id, (SELECT id FROM gl_accounts WHERE organization_id = _w.organization_id
                                          AND system_code IN ('bank','cash') ORDER BY CASE system_code WHEN 'bank' THEN 0 ELSE 1 END LIMIT 1));
  SELECT count(*) / 2 + 1 INTO _n FROM accounting_transactions WHERE reference_type = 'attendance_week_payment' AND reference_id = _week_id;

  INSERT INTO public.accounting_transactions(transaction_number, transaction_date, account_type, category, description,
    debit_amount, credit_amount, reference_type, reference_id, organization_id, financial_account_id, currency, fx_rate, base_currency, gl_account_id)
  VALUES
    ('WGE-PAY-DR-'||substring(_week_id::text,1,8)||'-'||_n, now(), 'liability','wages_payable',
     CASE WHEN _w.status = 'paid' THEN 'Balance of wages settled ' ELSE 'Net wages settled ' END || _w.week_start, _due, 0,
     'attendance_week_payment', _week_id, _w.organization_id, NULL, _base, 1, _base, NULL),
    ('WGE-PAY-CR-'||substring(_week_id::text,1,8)||'-'||_n, now(), 'asset','cash',
     CASE WHEN _w.status = 'paid' THEN 'Balance of wages paid ' ELSE 'Net wages paid ' END || _w.week_start, 0, _due,
     'attendance_week_payment', _week_id, _w.organization_id, _from_account_id, _base, 1, _base, _cash);

  PERFORM set_config('app.attendance_action', 'on', true);
  UPDATE public.attendance_weeks SET status='paid', paid_by=auth.uid(), paid_at=COALESCE(paid_at, now()),
         paid_from_account_id=COALESCE(paid_from_account_id, _from_account_id) WHERE id=_week_id;
  INSERT INTO public.attendance_audit(organization_id, week_id, action, after, reason)
  VALUES (_w.organization_id, _week_id, 'pay', jsonb_build_object('amount',_due,'account',_from_account_id),
          CASE WHEN _w.status = 'paid' THEN 'balance after correction' END);
END $function$;

-- ---------------------------------------------------------------- correct / delete: company check + allowed through the lock

DO $$
DECLARE def text;
BEGIN
  SELECT pg_get_functiondef('public.correct_attendance_line'::regproc) INTO def;
  IF position('assert_attendance_week_access' IN def) = 0 THEN
    def := replace(def, 'SELECT * INTO _w FROM public.attendance_weeks WHERE id=_o.week_id FOR UPDATE;',
      '_w := public.assert_attendance_week_access(_o.week_id);
  PERFORM set_config(''app.attendance_action'', ''on'', true);');
    IF position('assert_attendance_week_access' IN def) = 0 THEN RAISE EXCEPTION 'correct_attendance_line patch did not apply'; END IF;
    EXECUTE def;
  END IF;

  SELECT pg_get_functiondef('public.delete_attendance_line'::regproc) INTO def;
  IF position('current_org_id' IN def) = 0 THEN
    def := replace(def, 'IF _week IS NULL THEN RETURN; END IF;',
      'IF _week IS NULL OR (_org IS DISTINCT FROM public.current_org_id() AND NOT public.is_platform_admin()) THEN RAISE EXCEPTION ''Entry not found''; END IF;');
    IF position('current_org_id' IN def) = 0 THEN RAISE EXCEPTION 'delete_attendance_line patch did not apply'; END IF;
    EXECUTE def;
  END IF;
END $$;

-- ---------------------------------------------------------------- locks & validation

CREATE OR REPLACE FUNCTION public.trg_attendance_lines_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE _st text; _days numeric;
BEGIN
  SELECT status INTO _st FROM attendance_weeks WHERE id = COALESCE(NEW.week_id, OLD.week_id);

  IF auth.uid() IS NOT NULL AND _st IS DISTINCT FROM 'draft'
     AND COALESCE(current_setting('app.attendance_action', true), '') <> 'on' THEN
    -- linking a line to a monthly wage summary payslip is the only change allowed
    IF NOT (TG_OP = 'UPDATE'
            AND (to_jsonb(NEW) - 'payslip_id') = (to_jsonb(OLD) - 'payslip_id')) THEN
      RAISE EXCEPTION 'The week is %; use Correct entry instead', _st USING ERRCODE = '22023';
    END IF;
  END IF;

  IF TG_OP <> 'DELETE' AND NOT COALESCE(NEW.is_correction, false) THEN
    IF NEW.days < 0 OR NEW.hours < 0 OR NEW.overtime_hours < 0 OR COALESCE(NEW.allowance, 0) < 0 THEN
      RAISE EXCEPTION 'Days, hours and allowances can''t be negative; use Correct entry to reduce an approved week' USING ERRCODE = '22023';
    END IF;
    IF NEW.days > 7 OR NEW.hours + NEW.overtime_hours > 168 THEN
      RAISE EXCEPTION 'A week has at most 7 days / 168 hours' USING ERRCODE = '22023';
    END IF;
    SELECT COALESCE(sum(days), 0) INTO _days FROM attendance_lines
     WHERE week_id = NEW.week_id AND employee_id = NEW.employee_id AND id IS DISTINCT FROM NEW.id;
    IF _days + NEW.days > 7 THEN
      RAISE EXCEPTION 'This would give the employee % days in one week', _days + NEW.days USING ERRCODE = '22023';
    END IF;
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;
DROP TRIGGER IF EXISTS trg_attendance_lines_guard ON public.attendance_lines;
CREATE TRIGGER trg_attendance_lines_guard BEFORE INSERT OR UPDATE OR DELETE ON public.attendance_lines
  FOR EACH ROW EXECUTE FUNCTION public.trg_attendance_lines_guard();

CREATE OR REPLACE FUNCTION public.trg_attendance_weeks_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  IF auth.uid() IS NULL OR COALESCE(current_setting('app.attendance_action', true), '') = 'on' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'draft' THEN
      RAISE EXCEPTION 'An % week can''t be deleted', OLD.status USING ERRCODE = '22023';
    END IF;
    RETURN OLD;
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status OR NEW.paid_at IS DISTINCT FROM OLD.paid_at
     OR NEW.approved_at IS DISTINCT FROM OLD.approved_at OR NEW.paid_from_account_id IS DISTINCT FROM OLD.paid_from_account_id
     OR (OLD.status <> 'draft' AND (NEW.gross_amount IS DISTINCT FROM OLD.gross_amount OR NEW.net_amount IS DISTINCT FROM OLD.net_amount
                                    OR NEW.deduction_amount IS DISTINCT FROM OLD.deduction_amount OR NEW.organization_id IS DISTINCT FROM OLD.organization_id)) THEN
    RAISE EXCEPTION 'Use Approve / Pay to change a week' USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_attendance_weeks_guard ON public.attendance_weeks;
CREATE TRIGGER trg_attendance_weeks_guard BEFORE UPDATE OR DELETE ON public.attendance_weeks
  FOR EACH ROW EXECUTE FUNCTION public.trg_attendance_weeks_guard();

-- generate_monthly_wage_payslips links lines on approved weeks; void releases them.
-- Both are allowed by the payslip_id-only rule above.

-- ---------------------------------------------------------------- statutory return & P9 include casual wages

CREATE OR REPLACE FUNCTION public.payroll_statutory_return(_month date)
RETURNS TABLE(employee_id uuid, employee_name text, kra_pin text, payslip_reference text, gross_pay numeric,
              nssf_employee numeric, nssf_employer numeric, shif numeric, ahl_employee numeric, ahl_employer numeric,
              taxable_pay numeric, paye numeric, net_pay numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT e.id, e.name, e.tax_id, p.reference, p.gross_pay,
         COALESCE(sum(l.amount) FILTER (WHERE l.code = 'NSSF'), 0),
         COALESCE(sum(l.amount) FILTER (WHERE l.code = 'NSSF_ER'), 0),
         COALESCE(sum(l.amount) FILTER (WHERE l.code = 'SHIF'), 0),
         COALESCE(sum(l.amount) FILTER (WHERE l.code = 'AHL'), 0),
         COALESCE(sum(l.amount) FILTER (WHERE l.code = 'AHL_ER'), 0),
         p.gross_pay - COALESCE(sum(l.amount) FILTER (WHERE l.code IN ('NSSF', 'SHIF', 'AHL')), 0),
         COALESCE(sum(l.amount) FILTER (WHERE l.code = 'PAYE'), 0),
         p.net_pay
    FROM payslips p
    JOIN employees e ON e.id = p.employee_id
    LEFT JOIN payslip_lines l ON l.payslip_id = p.id
   WHERE p.organization_id = current_org_id()
     AND (public.can_manage_payroll() OR has_role(auth.uid(), 'accountant'))
     AND p.status IN ('posted', 'paid') AND COALESCE(p.posting_mode, 'ledger') = 'ledger'
     AND date_trunc('month', p.period_end) = date_trunc('month', _month)
   GROUP BY e.id, e.name, e.tax_id, p.id, p.reference, p.gross_pay, p.net_pay
  UNION ALL
  SELECT e.id, e.name, e.tax_id, 'Weekly wages (' || count(*) || ' wk)', sum(s.gross),
         sum(s.nssf), sum(s.nssf_employer), sum(s.shif), sum(s.ahl), sum(s.ahl_employer),
         sum(s.gross - s.nssf - s.shif - s.ahl), sum(s.paye), sum(s.gross - s.nssf - s.shif - s.ahl - s.paye)
    FROM attendance_statutory s
    JOIN employees e ON e.id = s.employee_id
   WHERE s.organization_id = current_org_id()
     AND (public.can_manage_payroll() OR has_role(auth.uid(), 'accountant'))
     AND date_trunc('month', s.week_end) = date_trunc('month', _month)
   GROUP BY e.id, e.name, e.tax_id
   ORDER BY 2;
$$;

CREATE OR REPLACE FUNCTION public.p9_card(_year int, _employee_id uuid)
RETURNS TABLE(month date, gross_pay numeric, nssf numeric, shif numeric, ahl numeric, taxable_pay numeric,
              tax_charged numeric, personal_relief numeric, paye numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  WITH slips AS (
    SELECT date_trunc('month', p.period_end)::date AS m, p.period_end AS on_date, p.gross_pay AS g,
           COALESCE((SELECT sum(amount) FROM payslip_lines l WHERE l.payslip_id = p.id AND l.code = 'NSSF'), 0) AS nssf,
           COALESCE((SELECT sum(amount) FROM payslip_lines l WHERE l.payslip_id = p.id AND l.code = 'SHIF'), 0) AS shif,
           COALESCE((SELECT sum(amount) FROM payslip_lines l WHERE l.payslip_id = p.id AND l.code = 'AHL'), 0) AS ahl,
           COALESCE((SELECT sum(amount) FROM payslip_lines l WHERE l.payslip_id = p.id AND l.code = 'PAYE'), 0) AS paye
      FROM payslips p
     WHERE p.organization_id = current_org_id()
       AND p.employee_id = _employee_id AND p.status IN ('posted', 'paid')
       AND COALESCE(p.posting_mode, 'ledger') = 'ledger'
       AND extract(year FROM p.period_end) = _year
    UNION ALL
    SELECT date_trunc('month', s.week_end)::date, s.week_end, s.gross, s.nssf, s.shif, s.ahl, s.paye
      FROM attendance_statutory s
     WHERE s.organization_id = current_org_id() AND s.employee_id = _employee_id
       AND extract(year FROM s.week_end) = _year
  ), m AS (
    SELECT m, max(on_date) AS on_date, sum(g) g, sum(nssf) nssf, sum(shif) shif, sum(ahl) ahl, sum(paye) paye
      FROM slips GROUP BY m
  )
  SELECT m.m, m.g, m.nssf, m.shif, m.ahl, m.g - m.nssf - m.shif - m.ahl,
         m.paye + least((public.kenya_statutory(m.g, m.on_date)->>'personal_relief')::numeric,
                        (public.kenya_statutory(m.g, m.on_date)->>'tax_before_relief')::numeric),
         least((public.kenya_statutory(m.g, m.on_date)->>'personal_relief')::numeric,
               (public.kenya_statutory(m.g, m.on_date)->>'tax_before_relief')::numeric),
         m.paye
    FROM m
   WHERE public.can_manage_payroll() OR has_role(auth.uid(), 'accountant')
   ORDER BY m.m;
$$;
