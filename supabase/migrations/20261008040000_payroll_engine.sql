-- =====================================================================
-- HR & payroll, step 1: Kenyan payroll engine, balanced posting, controls
--
--  1. Statutory rates live in payroll_statutory_rates (dated, so the next
--     KRA/NSSF/SHA change is a data update). Seeded with NSSF phase 3
--     (Feb 2025) and phase 4 (Feb 2026), PAYE bands, SHIF and Housing Levy.
--  2. kenya_statutory(gross, date) computes NSSF (Tier I/II), SHIF, AHL and
--     PAYE (after allowable deductions and personal relief) plus employer
--     NSSF and AHL.
--  3. Draft payslips fill themselves: basic salary for monthly-paid staff,
--     the employee's own fixed deductions, and statutory lines that
--     recalculate whenever earnings change.
--  4. Posting is a balanced journal: Dr salaries + employer costs; Cr PAYE,
--     NSSF, SHIF, Housing Levy, other deductions payable and net pay payable.
--     Paying clears net pay payable from the chosen bank. Monthly wage
--     summaries (already paid weekly) post nothing. Voiding reverses.
--  5. Controls: approval submission fixed (bad role names), no self-approval,
--     posted payslips locked, one payslip per employee per period, no
--     negative net pay. HR managers prepare; admins/accountants post and pay.
--  6. Payroll runs create the month's salary payslips, then post them.
--  7. Returns: payroll_statutory_return(month) (P10-style) and p9_card(year).
-- =====================================================================

-- ---------------------------------------------------------------- 1. rates

CREATE TABLE IF NOT EXISTS public.payroll_statutory_rates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  country text NOT NULL DEFAULT 'KE',
  effective_from date NOT NULL,
  label text,
  params jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (country, effective_from)
);
ALTER TABLE public.payroll_statutory_rates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS payroll_rates_read ON public.payroll_statutory_rates;
CREATE POLICY payroll_rates_read ON public.payroll_statutory_rates FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS payroll_rates_write ON public.payroll_statutory_rates;
CREATE POLICY payroll_rates_write ON public.payroll_statutory_rates FOR ALL TO authenticated
  USING (is_platform_admin()) WITH CHECK (is_platform_admin());

INSERT INTO public.payroll_statutory_rates(country, effective_from, label, params) VALUES
 ('KE', '2025-02-01', 'NSSF phase 3; Finance Act PAYE; SHIF; AHL', jsonb_build_object(
    'paye_bands', jsonb_build_array(jsonb_build_array(24000, 0.10), jsonb_build_array(8333, 0.25),
                                    jsonb_build_array(467667, 0.30), jsonb_build_array(300000, 0.325),
                                    jsonb_build_array(NULL, 0.35)),
    'personal_relief', 2400,
    'nssf_rate', 0.06, 'nssf_lel', 8000, 'nssf_uel', 72000,
    'shif_rate', 0.0275, 'shif_min', 300,
    'ahl_rate', 0.015, 'ahl_employer_rate', 0.015)),
 ('KE', '2026-02-01', 'NSSF phase 4 (LEL 9,000 / UEL 108,000)', jsonb_build_object(
    'paye_bands', jsonb_build_array(jsonb_build_array(24000, 0.10), jsonb_build_array(8333, 0.25),
                                    jsonb_build_array(467667, 0.30), jsonb_build_array(300000, 0.325),
                                    jsonb_build_array(NULL, 0.35)),
    'personal_relief', 2400,
    'nssf_rate', 0.06, 'nssf_lel', 9000, 'nssf_uel', 108000,
    'shif_rate', 0.0275, 'shif_min', 300,
    'ahl_rate', 0.015, 'ahl_employer_rate', 0.015))
ON CONFLICT (country, effective_from) DO NOTHING;

-- ---------------------------------------------------------------- 2. engine

CREATE OR REPLACE FUNCTION public.kenya_statutory(_gross numeric, _on date DEFAULT current_date)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE p jsonb; g numeric := greatest(COALESCE(_gross, 0), 0);
        nssf1 numeric; nssf2 numeric; shif numeric; ahl numeric; taxable numeric; tax numeric := 0;
        remaining numeric; band jsonb; width numeric; rate numeric; slice numeric; paye numeric;
BEGIN
  SELECT params INTO p FROM payroll_statutory_rates
   WHERE country = 'KE' AND effective_from <= COALESCE(_on, current_date)
   ORDER BY effective_from DESC LIMIT 1;
  IF p IS NULL THEN RAISE EXCEPTION 'No Kenyan payroll rates configured for %', _on; END IF;

  nssf1 := round(least(g, (p->>'nssf_lel')::numeric) * (p->>'nssf_rate')::numeric, 2);
  nssf2 := round(greatest(least(g, (p->>'nssf_uel')::numeric) - (p->>'nssf_lel')::numeric, 0) * (p->>'nssf_rate')::numeric, 2);
  shif := CASE WHEN g > 0 THEN greatest(round(g * (p->>'shif_rate')::numeric, 2), (p->>'shif_min')::numeric) ELSE 0 END;
  ahl := round(g * (p->>'ahl_rate')::numeric, 2);

  -- NSSF, SHIF and the employee Housing Levy are allowable deductions before PAYE.
  taxable := greatest(g - nssf1 - nssf2 - shif - ahl, 0);
  remaining := taxable;
  FOR band IN SELECT * FROM jsonb_array_elements(p->'paye_bands') LOOP
    EXIT WHEN remaining <= 0;
    width := NULLIF(band->>0, '')::numeric;
    rate := (band->>1)::numeric;
    slice := CASE WHEN width IS NULL THEN remaining ELSE least(remaining, width) END;
    tax := tax + slice * rate;
    remaining := remaining - slice;
  END LOOP;
  paye := greatest(round(tax - (p->>'personal_relief')::numeric, 2), 0);

  RETURN jsonb_build_object(
    'gross', g, 'nssf_tier1', nssf1, 'nssf_tier2', nssf2, 'nssf', nssf1 + nssf2,
    'shif', shif, 'ahl', ahl, 'taxable_pay', taxable, 'tax_before_relief', round(tax, 2),
    'personal_relief', (p->>'personal_relief')::numeric, 'paye', paye,
    'nssf_employer', nssf1 + nssf2, 'ahl_employer', round(g * (p->>'ahl_employer_rate')::numeric, 2),
    'net', g - (nssf1 + nssf2) - shif - ahl - paye);
END $$;
GRANT EXECUTE ON FUNCTION public.kenya_statutory(numeric, date) TO authenticated;

-- ---------------------------------------------------------------- 3. self-filling payslips

ALTER TABLE public.payslip_lines ADD COLUMN IF NOT EXISTS code text;
ALTER TABLE public.employees ADD COLUMN IF NOT EXISTS statutory_exempt boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.recalc_payslip_statutory(_payslip_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE ps payslips%ROWTYPE; emp employees%ROWTYPE; _country text; _gross numeric; _s jsonb;
BEGIN
  SELECT * INTO ps FROM payslips WHERE id = _payslip_id;
  IF NOT FOUND OR ps.status <> 'draft' OR COALESCE(ps.posting_mode, 'ledger') <> 'ledger' THEN RETURN; END IF;
  SELECT * INTO emp FROM employees WHERE id = ps.employee_id;
  SELECT country INTO _country FROM organizations WHERE id = ps.organization_id;

  PERFORM set_config('app.payslip_recalc', 'on', true);
  DELETE FROM payslip_lines WHERE payslip_id = _payslip_id AND code IN ('PAYE','NSSF','SHIF','AHL','NSSF_ER','AHL_ER');
  SELECT COALESCE(sum(amount), 0) INTO _gross FROM payslip_lines WHERE payslip_id = _payslip_id AND line_type = 'earning';

  IF COALESCE(_country, 'KE') = 'KE' AND NOT COALESCE(emp.statutory_exempt, false) AND _gross > 0 THEN
    _s := public.kenya_statutory(_gross, COALESCE(ps.period_end, ps.pay_date));
    INSERT INTO payslip_lines(payslip_id, line_type, label, amount, taxable, sort_order, code) VALUES
      (_payslip_id, 'deduction', 'PAYE', (_s->>'paye')::numeric, false, 200, 'PAYE'),
      (_payslip_id, 'deduction', 'NSSF (Tier I ' || (_s->>'nssf_tier1') || ' + Tier II ' || (_s->>'nssf_tier2') || ')', (_s->>'nssf')::numeric, false, 210, 'NSSF'),
      (_payslip_id, 'deduction', 'SHIF', (_s->>'shif')::numeric, false, 220, 'SHIF'),
      (_payslip_id, 'deduction', 'Housing Levy', (_s->>'ahl')::numeric, false, 230, 'AHL'),
      (_payslip_id, 'contribution', 'NSSF (employer)', (_s->>'nssf_employer')::numeric, false, 300, 'NSSF_ER'),
      (_payslip_id, 'contribution', 'Housing Levy (employer)', (_s->>'ahl_employer')::numeric, false, 310, 'AHL_ER');
    DELETE FROM payslip_lines WHERE payslip_id = _payslip_id AND code IS NOT NULL AND amount = 0
       AND code IN ('PAYE','NSSF','SHIF','AHL','NSSF_ER','AHL_ER');
  END IF;
  PERFORM set_config('app.payslip_recalc', '', true);
  PERFORM public.payslips_recalc_totals(_payslip_id);
END $$;
GRANT EXECUTE ON FUNCTION public.recalc_payslip_statutory(uuid) TO authenticated;

-- New draft payslip: basic salary + the employee's own fixed deductions, then statutory.
CREATE OR REPLACE FUNCTION public.trg_payslip_prefill()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE emp employees%ROWTYPE; _d record;
BEGIN
  IF NEW.status <> 'draft' OR COALESCE(NEW.posting_mode, 'ledger') <> 'ledger' THEN RETURN NEW; END IF;
  SELECT * INTO emp FROM employees WHERE id = NEW.employee_id;
  PERFORM set_config('app.payslip_recalc', 'on', true);
  IF COALESCE(emp.monthly_salary, 0) > 0 AND COALESCE(emp.pay_frequency, 'monthly') = 'monthly' THEN
    INSERT INTO payslip_lines(payslip_id, line_type, label, amount, taxable, sort_order, code)
    VALUES (NEW.id, 'earning', 'Basic salary', emp.monthly_salary, true, 10, 'BASIC');
    FOR _d IN SELECT * FROM public.employee_deductions(NEW.employee_id, emp.monthly_salary, 'monthly') LOOP
      INSERT INTO payslip_lines(payslip_id, line_type, label, amount, taxable, sort_order, code)
      VALUES (NEW.id, 'deduction', _d.name, _d.amount, false, 400, 'EMP_DED');
    END LOOP;
  END IF;
  PERFORM set_config('app.payslip_recalc', '', true);
  PERFORM public.recalc_payslip_statutory(NEW.id);
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_payslip_prefill ON public.payslips;
CREATE TRIGGER trg_payslip_prefill AFTER INSERT ON public.payslips
  FOR EACH ROW EXECUTE FUNCTION public.trg_payslip_prefill();

-- Lines: locked once posted; statutory lines are system-managed; earnings changes recalc statutory.
CREATE OR REPLACE FUNCTION public.trg_payslip_lines_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE _st text;
BEGIN
  SELECT status INTO _st FROM payslips WHERE id = COALESCE(NEW.payslip_id, OLD.payslip_id);
  IF auth.uid() IS NOT NULL AND _st IS DISTINCT FROM 'draft' THEN
    RAISE EXCEPTION 'payslip_locked: the payslip is %; void it and prepare a new one', _st USING ERRCODE = '22023';
  END IF;
  IF auth.uid() IS NOT NULL AND COALESCE(current_setting('app.payslip_recalc', true), '') <> 'on'
     AND (COALESCE(NEW.code, OLD.code) IN ('PAYE','NSSF','SHIF','AHL','NSSF_ER','AHL_ER')) THEN
    RAISE EXCEPTION 'Statutory lines are calculated automatically; change the earnings instead' USING ERRCODE = '22023';
  END IF;
  IF TG_OP <> 'DELETE' AND NEW.amount < 0 THEN
    RAISE EXCEPTION 'Line amounts must be positive' USING ERRCODE = '22023';
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;
DROP TRIGGER IF EXISTS trg_payslip_lines_guard ON public.payslip_lines;
CREATE TRIGGER trg_payslip_lines_guard BEFORE INSERT OR UPDATE OR DELETE ON public.payslip_lines
  FOR EACH ROW EXECUTE FUNCTION public.trg_payslip_lines_guard();

CREATE OR REPLACE FUNCTION public.payslip_lines_after_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  IF COALESCE(current_setting('app.payslip_recalc', true), '') <> 'on'
     AND COALESCE(NEW.line_type, OLD.line_type) = 'earning' THEN
    PERFORM public.recalc_payslip_statutory(COALESCE(NEW.payslip_id, OLD.payslip_id));
  ELSE
    PERFORM public.payslips_recalc_totals(COALESCE(NEW.payslip_id, OLD.payslip_id));
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;

-- ---------------------------------------------------------------- 4. posting, payment, void

DROP TRIGGER IF EXISTS trg_payslip_autopost ON public.payslips;

CREATE OR REPLACE FUNCTION public.assert_payroll_poster(_org uuid)
RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  IF public.is_platform_admin() THEN RETURN; END IF;
  IF _org IS DISTINCT FROM public.current_org_id() THEN RAISE EXCEPTION 'Payslip not found'; END IF;
  IF NOT (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'org_owner') OR has_role(auth.uid(), 'accountant')) THEN
    RAISE EXCEPTION 'not_authorized: only admins and accountants can post or pay payroll' USING ERRCODE = '42501';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.payroll_liability_gl(_org uuid, _code text)
RETURNS uuid LANGUAGE sql SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT CASE _code
    WHEN 'PAYE'    THEN public.ensure_gl_account(_org, '2320', 'PAYE Payable (KRA)', 'liability', 'paye_payable')
    WHEN 'NSSF'    THEN public.ensure_gl_account(_org, '2330', 'NSSF Payable', 'liability', 'nssf_payable')
    WHEN 'NSSF_ER' THEN public.ensure_gl_account(_org, '2330', 'NSSF Payable', 'liability', 'nssf_payable')
    WHEN 'SHIF'    THEN public.ensure_gl_account(_org, '2340', 'SHIF Payable (SHA)', 'liability', 'shif_payable')
    WHEN 'AHL'     THEN public.ensure_gl_account(_org, '2350', 'Housing Levy Payable', 'liability', 'ahl_payable')
    WHEN 'AHL_ER'  THEN public.ensure_gl_account(_org, '2350', 'Housing Levy Payable', 'liability', 'ahl_payable')
    WHEN 'NET'     THEN public.ensure_gl_account(_org, '2360', 'Net Pay Payable', 'liability', 'net_pay_payable')
    ELSE public.ensure_gl_account(_org, '2300', 'Payroll Liabilities', 'liability', 'payroll_liabilities') END
$$;

CREATE OR REPLACE FUNCTION public.post_payslip(_id uuid)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  ps payslips%ROWTYPE; emp employees%ROWTYPE; _base text; _require boolean; _jid uuid := gen_random_uuid();
  _date date; _seq int := 0; r record; _first uuid; _id1 uuid;
BEGIN
  SELECT * INTO ps FROM payslips WHERE id = _id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Payslip not found'; END IF;
  PERFORM public.assert_payroll_poster(ps.organization_id);
  IF ps.status <> 'draft' THEN RAISE EXCEPTION 'Only draft payslips can be posted'; END IF;

  SELECT COALESCE((config->>'payslip_requires_approval')::boolean, false), currency INTO _require, _base
    FROM organizations WHERE id = ps.organization_id;
  IF _require AND ps.approval_status <> 'approved' THEN
    RAISE EXCEPTION 'Payslip must be approved before posting';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM payslip_lines WHERE payslip_id = _id AND line_type = 'earning') THEN
    RAISE EXCEPTION 'The payslip has no earnings';
  END IF;
  IF ps.net_pay < 0 THEN
    RAISE EXCEPTION 'Net pay is negative (%); reduce the deductions', ps.net_pay USING ERRCODE = '22023';
  END IF;
  IF COALESCE(ps.posting_mode, 'ledger') = 'ledger' AND EXISTS (
       SELECT 1 FROM payslips o
        WHERE o.employee_id = ps.employee_id AND o.id <> ps.id AND o.status IN ('posted', 'paid')
          AND COALESCE(o.posting_mode, 'ledger') = 'ledger'
          AND o.period_start <= ps.period_end AND o.period_end >= ps.period_start
          AND EXISTS (SELECT 1 FROM payslip_lines l WHERE l.payslip_id = o.id AND l.code = 'BASIC')
          AND EXISTS (SELECT 1 FROM payslip_lines l WHERE l.payslip_id = ps.id AND l.code = 'BASIC')) THEN
    RAISE EXCEPTION 'duplicate_payslip: this employee already has a posted salary payslip for an overlapping period' USING ERRCODE = '23505';
  END IF;

  SELECT * INTO emp FROM employees WHERE id = ps.employee_id;
  _date := COALESCE(ps.pay_date, ps.period_end, current_date);

  -- Monthly wage summaries only record weeks that were already expensed and paid.
  IF COALESCE(ps.posting_mode, 'ledger') = 'ledger' THEN
    FOR r IN
      SELECT 'D' AS side, 'expense'::account_type AS t, 'expense_payroll' AS cat,
             public.ensure_gl_account(ps.organization_id, '6000', 'Salaries & Wages', 'expense', 'expense_payroll') AS gl,
             'Salaries & wages' AS descr, ps.gross_pay AS amt
      UNION ALL
      SELECT 'D', 'expense', 'payroll_employer_costs',
             public.ensure_gl_account(ps.organization_id, '6010', 'Employer Payroll Contributions', 'expense', 'payroll_employer_costs'),
             'Employer NSSF / Housing Levy', ps.total_contributions WHERE COALESCE(ps.total_contributions, 0) > 0
      UNION ALL
      SELECT 'C', 'liability', COALESCE(lower(l.code), 'payroll_deductions'), public.payroll_liability_gl(ps.organization_id, l.code),
             string_agg(l.label, ', '), sum(l.amount)
        FROM payslip_lines l WHERE l.payslip_id = _id AND l.line_type IN ('deduction', 'contribution') AND l.amount > 0
       GROUP BY l.code, public.payroll_liability_gl(ps.organization_id, l.code)
      UNION ALL
      SELECT 'C', 'liability', 'net_pay_payable', public.payroll_liability_gl(ps.organization_id, 'NET'), 'Net pay owed', ps.net_pay
       WHERE ps.net_pay > 0
    LOOP
      CONTINUE WHEN COALESCE(r.amt, 0) = 0;
      _seq := _seq + 1;
      INSERT INTO accounting_transactions(transaction_number, transaction_date, account_type, category, description,
        debit_amount, credit_amount, reference_type, reference_id, organization_id, gl_account_id, journal_id,
        currency, fx_rate, base_currency, created_by)
      VALUES (ps.reference || '-' || _seq, _date, r.t, r.cat,
              r.descr || ' — ' || COALESCE(emp.name, '') || ' (' || ps.reference || ')',
              CASE WHEN r.side = 'D' THEN r.amt ELSE 0 END, CASE WHEN r.side = 'C' THEN r.amt ELSE 0 END,
              'payslip', ps.id, ps.organization_id, r.gl, _jid, _base, 1, _base, auth.uid())
      RETURNING id INTO _id1;
      _first := COALESCE(_first, _id1);
    END LOOP;
  END IF;

  PERFORM set_config('app.payroll_action', 'on', true);
  UPDATE payslips SET status = 'posted', posted_at = now(), accounting_transaction_id = _first WHERE id = _id;
  PERFORM set_config('app.payroll_action', '', true);

  INSERT INTO public.org_lifecycle_events (organization_id, event_type, actor_user_id, details)
  VALUES (ps.organization_id, 'payslip_posted', auth.uid(),
          jsonb_build_object('payslip_id', ps.id, 'reference', ps.reference, 'net_pay', ps.net_pay));
  RETURN _first;
END $function$;

CREATE OR REPLACE FUNCTION public.pay_payslip(_id uuid, _from_account_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE ps payslips%ROWTYPE; emp employees%ROWTYPE; _fa record; _base text; _jid uuid := gen_random_uuid(); _cash uuid;
BEGIN
  SELECT * INTO ps FROM payslips WHERE id = _id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Payslip not found'; END IF;
  PERFORM public.assert_payroll_poster(ps.organization_id);
  IF ps.status <> 'posted' THEN RAISE EXCEPTION 'Only posted payslips can be paid'; END IF;
  IF COALESCE(ps.posting_mode, 'ledger') = 'summary' THEN
    RAISE EXCEPTION 'This wage summary was paid week by week from Attendance';
  END IF;
  SELECT currency INTO _base FROM organizations WHERE id = ps.organization_id;
  SELECT * INTO _fa FROM financial_accounts WHERE id = _from_account_id AND organization_id = ps.organization_id AND is_active;
  IF NOT FOUND THEN RAISE EXCEPTION 'Choose an active bank, cash or M-Pesa account'; END IF;
  IF upper(COALESCE(_fa.currency, _base)) <> upper(_base) THEN RAISE EXCEPTION 'Pay salaries from a % account', _base; END IF;
  SELECT * INTO emp FROM employees WHERE id = ps.employee_id;
  _cash := COALESCE(_fa.gl_account_id, (SELECT id FROM gl_accounts WHERE organization_id = ps.organization_id
                                          AND system_code IN ('bank','cash') ORDER BY CASE system_code WHEN 'bank' THEN 0 ELSE 1 END LIMIT 1));

  IF ps.net_pay > 0 THEN
    INSERT INTO accounting_transactions(transaction_number, transaction_date, account_type, category, description,
      debit_amount, credit_amount, reference_type, reference_id, organization_id, gl_account_id, journal_id,
      financial_account_id, currency, fx_rate, base_currency, created_by)
    VALUES
      (ps.reference || '-PAY-1', now(), 'liability', 'net_pay_payable', 'Net pay — ' || COALESCE(emp.name, '') || ' (' || ps.reference || ')',
       ps.net_pay, 0, 'payslip_payment', ps.id, ps.organization_id, public.payroll_liability_gl(ps.organization_id, 'NET'), _jid,
       NULL, _base, 1, _base, auth.uid()),
      (ps.reference || '-PAY-2', now(), 'asset', 'cash_out', 'Net pay — ' || COALESCE(emp.name, '') || ' (' || ps.reference || ')',
       0, ps.net_pay, 'payslip_payment', ps.id, ps.organization_id, _cash, _jid,
       _from_account_id, _base, 1, _base, auth.uid());
  END IF;

  PERFORM set_config('app.payroll_action', 'on', true);
  UPDATE payslips SET status = 'paid', paid_at = now(), paid_from_account_id = _from_account_id WHERE id = _id;
  PERFORM set_config('app.payroll_action', '', true);

  INSERT INTO public.org_lifecycle_events (organization_id, event_type, actor_user_id, details)
  VALUES (ps.organization_id, 'payslip_paid', auth.uid(),
          jsonb_build_object('payslip_id', ps.id, 'reference', ps.reference, 'net_pay', ps.net_pay, 'from_account', _from_account_id));
END $function$;

CREATE OR REPLACE FUNCTION public.void_payslip(_id uuid, _reason text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE ps payslips%ROWTYPE;
BEGIN
  SELECT * INTO ps FROM payslips WHERE id = _id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Payslip not found'; END IF;
  PERFORM public.assert_payroll_poster(ps.organization_id);
  IF ps.status = 'void' THEN RETURN; END IF;
  IF ps.status = 'paid' THEN
    RAISE EXCEPTION 'This payslip has been paid; recover the money or correct it on the next payslip instead of voiding';
  END IF;
  IF COALESCE(btrim(_reason), '') = '' THEN RAISE EXCEPTION 'A reason is required'; END IF;

  IF ps.status = 'posted' THEN
    INSERT INTO accounting_transactions(transaction_number, transaction_date, account_type, category, description,
      debit_amount, credit_amount, reference_type, reference_id, organization_id, gl_account_id, journal_id,
      financial_account_id, currency, fx_rate, base_currency, created_by)
    SELECT 'REV-' || a.transaction_number, now(), a.account_type, a.category, 'Void: ' || COALESCE(a.description, '') || ' — ' || _reason,
           a.credit_amount, a.debit_amount, 'payslip_reversal', a.reference_id, a.organization_id, a.gl_account_id, gen_random_uuid(),
           a.financial_account_id, a.currency, a.fx_rate, a.base_currency, auth.uid()
      FROM accounting_transactions a
     WHERE a.reference_type = 'payslip' AND a.reference_id = _id;
  END IF;

  PERFORM set_config('app.payroll_action', 'on', true);
  UPDATE payslips SET status = 'void', notes = COALESCE(notes || E'\n', '') || 'Voided: ' || _reason WHERE id = _id;
  -- release attendance lines so they can be summarised again
  UPDATE attendance_lines SET payslip_id = NULL WHERE payslip_id = _id;
  PERFORM set_config('app.payroll_action', '', true);

  INSERT INTO public.org_lifecycle_events (organization_id, event_type, actor_user_id, details)
  VALUES (ps.organization_id, 'payslip_voided', auth.uid(), jsonb_build_object('payslip_id', ps.id, 'reference', ps.reference, 'reason', _reason));
END $function$;

-- Status only changes through the functions; posted payslips can't be deleted.
CREATE OR REPLACE FUNCTION public.trg_payslip_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  IF auth.uid() IS NULL OR COALESCE(current_setting('app.payroll_action', true), '') = 'on' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'draft' THEN
      RAISE EXCEPTION 'payslip_locked: a % payslip cannot be deleted; void it instead', OLD.status USING ERRCODE = '22023';
    END IF;
    RETURN OLD;
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'draft' THEN RAISE EXCEPTION 'A new payslip starts as a draft' USING ERRCODE = '22023'; END IF;
    NEW.created_by := COALESCE(NEW.created_by, auth.uid());
    RETURN NEW;
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'Use Post / Pay / Void to change a payslip''s status' USING ERRCODE = '22023';
  END IF;
  IF OLD.status <> 'draft' AND (NEW.employee_id IS DISTINCT FROM OLD.employee_id OR NEW.pay_date IS DISTINCT FROM OLD.pay_date
       OR NEW.period_start IS DISTINCT FROM OLD.period_start OR NEW.period_end IS DISTINCT FROM OLD.period_end
       OR NEW.posting_mode IS DISTINCT FROM OLD.posting_mode) THEN
    RAISE EXCEPTION 'payslip_locked: the payslip is %; void it and prepare a new one', OLD.status USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_payslip_guard ON public.payslips;
CREATE TRIGGER trg_payslip_guard BEFORE INSERT OR UPDATE OR DELETE ON public.payslips
  FOR EACH ROW EXECUTE FUNCTION public.trg_payslip_guard();

-- ---------------------------------------------------------------- 5. approvals & roles

DO $$
DECLARE def text;
BEGIN
  SELECT pg_get_functiondef('public.notify_payslip_event'::regproc) INTO def;
  def := replace(def,
    'WHERE organization_id = _org AND status=''active'' AND role IN (''owner'',''admin'',''manager'') LOOP',
    'WHERE organization_id = _org AND status=''active'' AND (role IN (''org_owner'',''admin'')
                    OR user_id IN (SELECT ur.user_id FROM user_roles ur WHERE ur.organization_id = _org AND ur.role IN (''admin'',''accountant''))) LOOP');
  IF position('''manager''' IN def) > 0 THEN RAISE EXCEPTION 'notify_payslip_event patch did not apply'; END IF;
  EXECUTE def;
END $$;

CREATE OR REPLACE FUNCTION public.submit_payslip_for_approval(_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE ps payslips%ROWTYPE;
BEGIN
  SELECT * INTO ps FROM payslips WHERE id = _id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Payslip not found'; END IF;
  IF ps.organization_id <> current_org_id() AND NOT is_platform_admin() THEN RAISE EXCEPTION 'Payslip not found'; END IF;
  IF NOT (public.can_manage_payroll() OR has_role(auth.uid(), 'accountant')) THEN RAISE EXCEPTION 'Not authorized'; END IF;
  IF ps.status <> 'draft' THEN RAISE EXCEPTION 'Only draft payslips can be submitted'; END IF;
  IF NOT EXISTS (SELECT 1 FROM payslip_lines WHERE payslip_id = _id AND line_type = 'earning') THEN
    RAISE EXCEPTION 'Add at least one earning before submitting';
  END IF;
  UPDATE payslips
     SET approval_status = 'pending', submitted_for_approval_at = now(), submitted_by = auth.uid(),
         approved_by = NULL, approved_at = NULL, approval_comment = NULL
   WHERE id = _id;
  INSERT INTO public.org_lifecycle_events (organization_id, event_type, actor_user_id, details)
  VALUES (ps.organization_id, 'payslip_submitted_for_approval', auth.uid(), jsonb_build_object('payslip_id', ps.id, 'reference', ps.reference));
END $function$;

CREATE OR REPLACE FUNCTION public.approve_payslip(_id uuid, _comment text DEFAULT NULL::text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE ps payslips%ROWTYPE;
BEGIN
  SELECT * INTO ps FROM payslips WHERE id = _id;
  IF NOT FOUND OR (ps.organization_id <> current_org_id() AND NOT is_platform_admin()) THEN RAISE EXCEPTION 'Payslip not found'; END IF;
  IF NOT (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'org_owner') OR is_platform_admin()) THEN RAISE EXCEPTION 'Admin required'; END IF;
  IF ps.approval_status <> 'pending' THEN RAISE EXCEPTION 'Payslip is not awaiting approval'; END IF;
  IF auth.uid() IN (ps.submitted_by, ps.created_by) AND NOT is_platform_admin() THEN
    RAISE EXCEPTION 'self_approval: someone other than the person who prepared or submitted this payslip must approve it'
      USING ERRCODE = '42501';
  END IF;
  UPDATE payslips SET approval_status = 'approved', approved_by = auth.uid(), approved_at = now(), approval_comment = _comment WHERE id = _id;
  INSERT INTO public.org_lifecycle_events (organization_id, event_type, actor_user_id, details)
  VALUES (ps.organization_id, 'payslip_approved', auth.uid(), jsonb_build_object('payslip_id', ps.id, 'reference', ps.reference, 'comment', _comment));
END $function$;

CREATE OR REPLACE FUNCTION public.link_payslip_payment(_payslip_id uuid, _txn_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE _org uuid := current_org_id(); _account uuid; _date timestamptz;
BEGIN
  PERFORM public.assert_payroll_poster(_org);
  SELECT financial_account_id, transaction_date INTO _account, _date
    FROM accounting_transactions WHERE id = _txn_id AND organization_id = _org AND credit_amount > 0;
  IF _account IS NULL THEN RAISE EXCEPTION 'Bank payment not found'; END IF;
  PERFORM set_config('app.payroll_action', 'on', true);
  UPDATE payslips SET status = 'paid', paid_at = COALESCE(paid_at, _date), paid_from_account_id = _account,
                      accounting_transaction_id = _txn_id, updated_at = now()
   WHERE id = _payslip_id AND organization_id = _org AND status IN ('posted', 'paid');
  PERFORM set_config('app.payroll_action', '', true);
  PERFORM log_org_event(_org, 'payslip_payment_reconciled', jsonb_build_object('payslip_id', _payslip_id, 'transaction_id', _txn_id));
END $function$;

-- HR managers (and accountants) prepare payslips; only drafts can be removed.
DROP POLICY IF EXISTS "Org admins insert payslips" ON public.payslips;
CREATE POLICY "Org admins insert payslips" ON public.payslips FOR INSERT
  WITH CHECK (organization_id = current_org_id() AND (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'org_owner')
              OR has_role(auth.uid(), 'hr_manager') OR has_role(auth.uid(), 'accountant')));
DROP POLICY IF EXISTS "Org admins update payslips" ON public.payslips;
CREATE POLICY "Org admins update payslips" ON public.payslips FOR UPDATE
  USING (is_platform_admin() OR (organization_id = current_org_id() AND (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'org_owner')
         OR has_role(auth.uid(), 'hr_manager') OR has_role(auth.uid(), 'accountant'))));
DROP POLICY IF EXISTS "Org admins delete payslips" ON public.payslips;
CREATE POLICY "Org admins delete payslips" ON public.payslips FOR DELETE
  USING (is_platform_admin() OR (organization_id = current_org_id() AND (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'hr_manager'))));
DO $$
DECLARE pol text;
BEGIN
  FOREACH pol IN ARRAY ARRAY['Admins insert payslip lines', 'Admins update payslip lines', 'Admins delete payslip lines'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.payslip_lines', pol);
  END LOOP;
END $$;
CREATE POLICY "Admins insert payslip lines" ON public.payslip_lines FOR INSERT
  WITH CHECK (EXISTS (SELECT 1 FROM payslips p WHERE p.id = payslip_lines.payslip_id AND p.organization_id = current_org_id()
              AND (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'hr_manager') OR has_role(auth.uid(), 'accountant'))));
CREATE POLICY "Admins update payslip lines" ON public.payslip_lines FOR UPDATE
  USING (EXISTS (SELECT 1 FROM payslips p WHERE p.id = payslip_lines.payslip_id AND p.organization_id = current_org_id()
         AND (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'hr_manager') OR has_role(auth.uid(), 'accountant'))));
CREATE POLICY "Admins delete payslip lines" ON public.payslip_lines FOR DELETE
  USING (EXISTS (SELECT 1 FROM payslips p WHERE p.id = payslip_lines.payslip_id AND p.organization_id = current_org_id()
         AND (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'hr_manager') OR has_role(auth.uid(), 'accountant'))));

-- ---------------------------------------------------------------- 6. payroll runs

CREATE OR REPLACE FUNCTION public.generate_salary_payslips(_period_start date, _period_end date, _division text DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE _org uuid := current_org_id(); _n int := 0; e record;
BEGIN
  IF NOT (public.can_manage_payroll() OR has_role(auth.uid(), 'accountant')) THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  FOR e IN
    SELECT id FROM employees
     WHERE organization_id = _org AND is_active AND COALESCE(status, 'active') <> 'terminated'
       AND COALESCE(pay_frequency, 'monthly') = 'monthly' AND COALESCE(monthly_salary, 0) > 0
       AND (_division IS NULL OR division = _division)
       AND (hired_on IS NULL OR hired_on <= _period_end)
       AND NOT EXISTS (SELECT 1 FROM payslips p WHERE p.employee_id = employees.id AND p.status <> 'void'
                         AND COALESCE(p.posting_mode, 'ledger') = 'ledger'
                         AND p.period_start <= _period_end AND p.period_end >= _period_start)
  LOOP
    INSERT INTO payslips(organization_id, employee_id, pay_date, period_start, period_end, description, status, posting_mode)
    VALUES (_org, e.id, _period_end, _period_start, _period_end, 'Salary ' || to_char(_period_start, 'Mon YYYY'), 'draft', 'ledger');
    _n := _n + 1;
  END LOOP;
  RETURN _n;
END $$;
GRANT EXECUTE ON FUNCTION public.generate_salary_payslips(date, date, text) TO authenticated;

DO $$
DECLARE def text;
BEGIN
  SELECT pg_get_functiondef('public.execute_payroll_run'::regproc) INTO def;
  IF position('generate_salary_payslips' IN def) = 0 THEN
    def := replace(def, '  -- idempotency
  SELECT id INTO _existing FROM payroll_runs',
      '  IF NOT (public.can_manage_payroll() OR has_role(auth.uid(), ''accountant'')) THEN
    RAISE EXCEPTION ''not_authorized: only admins, HR managers and accountants can run payroll'' USING ERRCODE = ''42501'';
  END IF;
  -- idempotency
  SELECT id INTO _existing FROM payroll_runs');
    def := replace(def, '    RETURNING id INTO _run_id;
',
      '    RETURNING id INTO _run_id;
  -- create this period''s salary payslips for monthly staff who don''t have one yet
  PERFORM public.generate_salary_payslips(_period_start, _period_end, _division);
');
    IF position('generate_salary_payslips' IN def) = 0 OR position('not_authorized' IN def) = 0 THEN
      RAISE EXCEPTION 'execute_payroll_run patch did not apply';
    END IF;
    EXECUTE def;
  END IF;
END $$;

-- ---------------------------------------------------------------- 7. statutory returns

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
   ORDER BY e.name;
$$;
GRANT EXECUTE ON FUNCTION public.payroll_statutory_return(date) TO authenticated;

CREATE OR REPLACE FUNCTION public.p9_card(_year int, _employee_id uuid)
RETURNS TABLE(month date, gross_pay numeric, nssf numeric, shif numeric, ahl numeric, taxable_pay numeric,
              tax_charged numeric, personal_relief numeric, paye numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  WITH slips AS (
    SELECT p.id, date_trunc('month', p.period_end)::date AS m, p.period_end, p.gross_pay,
           COALESCE((SELECT sum(amount) FROM payslip_lines l WHERE l.payslip_id = p.id AND l.code = 'NSSF'), 0) AS nssf,
           COALESCE((SELECT sum(amount) FROM payslip_lines l WHERE l.payslip_id = p.id AND l.code = 'SHIF'), 0) AS shif,
           COALESCE((SELECT sum(amount) FROM payslip_lines l WHERE l.payslip_id = p.id AND l.code = 'AHL'), 0) AS ahl,
           COALESCE((SELECT sum(amount) FROM payslip_lines l WHERE l.payslip_id = p.id AND l.code = 'PAYE'), 0) AS paye
      FROM payslips p
     WHERE p.organization_id = current_org_id()
       AND (public.can_manage_payroll() OR has_role(auth.uid(), 'accountant'))
       AND p.employee_id = _employee_id AND p.status IN ('posted', 'paid')
       AND COALESCE(p.posting_mode, 'ledger') = 'ledger'
       AND extract(year FROM p.period_end) = _year
  ), m AS (
    SELECT m, max(period_end) AS on_date, sum(gross_pay) g, sum(nssf) nssf, sum(shif) shif, sum(ahl) ahl, sum(paye) paye
      FROM slips GROUP BY m
  )
  SELECT m.m, m.g, m.nssf, m.shif, m.ahl, m.g - m.nssf - m.shif - m.ahl,
         (public.kenya_statutory(m.g, m.on_date)->>'tax_before_relief')::numeric,
         least((public.kenya_statutory(m.g, m.on_date)->>'personal_relief')::numeric,
               (public.kenya_statutory(m.g, m.on_date)->>'tax_before_relief')::numeric),
         m.paye
    FROM m ORDER BY m.m;
$$;
GRANT EXECUTE ON FUNCTION public.p9_card(int, uuid) TO authenticated;

-- ---------------------------------------------------------------- 8. repair payslips posted the old way

-- Salary payments were mapped to a liability account; they left the bank.
UPDATE accounting_transactions a
   SET gl_account_id = COALESCE((SELECT fa.gl_account_id FROM financial_accounts fa WHERE fa.id = a.financial_account_id),
                                (SELECT g.id FROM gl_accounts g WHERE g.organization_id = a.organization_id AND g.system_code = 'bank' LIMIT 1))
 WHERE a.reference_type = 'payslip' AND a.category = 'payroll_payment';
UPDATE accounting_transactions a SET gl_account_id = public.payroll_liability_gl(a.organization_id, 'OTHER')
 WHERE a.reference_type = 'payslip' AND a.category = 'payroll_deductions' AND a.gl_account_id IS NULL;
UPDATE accounting_transactions a SET gl_account_id = public.payroll_liability_gl(a.organization_id, 'NET')
 WHERE a.reference_type = 'payslip' AND a.category = 'net_pay_payable' AND a.gl_account_id IS NULL;

-- Balance each old payslip: either the expense was booked twice (approval + posting),
-- or the deductions / unpaid net pay were never recorded as owed.
DO $$
DECLARE r record; _base text; _gap numeric; _paid numeric;
BEGIN
  FOR r IN
    SELECT p.id, p.organization_id, p.reference, p.status, p.total_deductions, p.total_contributions, p.net_pay,
           round(sum(a.debit_amount - a.credit_amount), 2) AS gap,
           bool_or(a.category IN ('payroll_deductions', 'net_pay_payable')) AS full_entry,
           bool_or(a.category = 'payroll') AS lump_entry,
           COALESCE(sum(a.credit_amount) FILTER (WHERE a.category IN ('payroll_payment', 'cash')), 0) AS paid_out
      FROM payslips p JOIN accounting_transactions a ON a.reference_type = 'payslip' AND a.reference_id = p.id
     GROUP BY p.id
    HAVING round(sum(a.debit_amount - a.credit_amount), 2) <> 0
  LOOP
    SELECT currency INTO _base FROM organizations WHERE id = r.organization_id;
    IF r.full_entry AND r.lump_entry THEN
      -- expensed twice: take the extra lump back out
      INSERT INTO accounting_transactions(transaction_number, transaction_date, account_type, category, description,
        debit_amount, credit_amount, reference_type, reference_id, organization_id, gl_account_id, currency, fx_rate, base_currency)
      VALUES (r.reference || '-FIX-1', now(), 'expense', 'expense_payroll', 'Correction: salary cost was booked twice',
        greatest(-r.gap, 0), greatest(r.gap, 0), 'payslip', r.id, r.organization_id,
        public.ensure_gl_account(r.organization_id, '6000', 'Salaries & Wages', 'expense', 'expense_payroll'), _base, 1, _base);
    ELSE
      _gap := r.gap;
      -- unpaid net pay is owed to the employee
      IF r.paid_out = 0 AND r.net_pay > 0 AND _gap >= r.net_pay THEN
        INSERT INTO accounting_transactions(transaction_number, transaction_date, account_type, category, description,
          debit_amount, credit_amount, reference_type, reference_id, organization_id, gl_account_id, currency, fx_rate, base_currency)
        VALUES (r.reference || '-FIX-NET', now(), 'liability', 'net_pay_payable', 'Correction: net pay owed was not recorded',
          0, r.net_pay, 'payslip', r.id, r.organization_id, public.payroll_liability_gl(r.organization_id, 'NET'), _base, 1, _base);
        _gap := _gap - r.net_pay;
      END IF;
      IF _gap <> 0 THEN
        INSERT INTO accounting_transactions(transaction_number, transaction_date, account_type, category, description,
          debit_amount, credit_amount, reference_type, reference_id, organization_id, gl_account_id, currency, fx_rate, base_currency)
        VALUES (r.reference || '-FIX-DED', now(), 'liability', 'payroll_deductions',
          'Correction: deductions / employer contributions owed were not recorded',
          greatest(-_gap, 0), greatest(_gap, 0), 'payslip', r.id, r.organization_id,
          public.payroll_liability_gl(r.organization_id, 'OTHER'), _base, 1, _base);
      END IF;
    END IF;
  END LOOP;
END $$;
