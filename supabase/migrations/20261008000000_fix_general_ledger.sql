-- =====================================================================
-- Finance audit, step 1 follow-up: General ledger
--
--  1. The ledger is append-only for app users: nobody writes, edits or
--     deletes ledger lines directly any more. Every posting goes through a
--     database function that validates it; corrections are reversals.
--     The two screens that wrote ledger lines directly (container sale COGS,
--     repatriation costs) now call functions that post both sides.
--  2. No posting (from any screen or function) can land in a closed period
--     or a closed year.
--  3. Manual journals: only admins/accountants; no negative amounts, no line
--     with both a debit and a credit, no inactive accounts; the reference is
--     stored on every line.
--  4. Chart of accounts: accountants can add and edit accounts; system
--     accounts and accounts that already have postings cannot be deleted.
--  5. Year-end close works on the real ledger: it moves each income and
--     expense account's balance for the year into retained earnings (per
--     currency, at the rates the lines were booked at), then closes the
--     year's periods. P&L reports for a date range ignore the closing entry.
-- =====================================================================

-- ---------------------------------------------------------------- 1. append-only ledger

ALTER TABLE public.accounting_transactions ADD COLUMN IF NOT EXISTS external_reference text;

DROP POLICY IF EXISTS "Finance staff insert accounting_transactions" ON public.accounting_transactions;
DROP POLICY IF EXISTS "Finance staff update accounting_transactions" ON public.accounting_transactions;
DROP POLICY IF EXISTS "Org admins delete accounting_transactions" ON public.accounting_transactions;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.accounting_transactions FROM anon, authenticated;

-- Container sale: cost of sale (Dr COGS / Cr container stock via the contra rule).
CREATE OR REPLACE FUNCTION public.post_container_sale_cogs(_sale_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE s record; _base text; _cur text; _fx numeric; _amt numeric; _num text;
BEGIN
  SELECT cs.*, c.container_number INTO s
    FROM container_sales cs LEFT JOIN containers c ON c.id = cs.container_id
   WHERE cs.id = _sale_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Sale not found'; END IF;
  IF s.organization_id IS DISTINCT FROM public.current_org_id() AND NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Sale not found';
  END IF;
  IF EXISTS (SELECT 1 FROM accounting_transactions
              WHERE reference_type = 'container_sales' AND reference_id = _sale_id
                AND category = 'container_sale_cogs') THEN
    RETURN;  -- already posted
  END IF;
  _amt := COALESCE(s.entry_price, 0) + COALESCE(s.transport_offloading_cost, 0);
  IF _amt <= 0 THEN RETURN; END IF;

  SELECT currency INTO _base FROM organizations WHERE id = s.organization_id;
  _cur := upper(COALESCE(s.currency, _base));
  _fx := CASE WHEN _cur = upper(_base) THEN 1 ELSE public.get_fx_rate(s.organization_id, _cur, _base, now()::date) END;
  IF _fx IS NULL THEN
    RAISE EXCEPTION 'Missing FX rate % → %. Add it under Finance → FX Rates.', _cur, _base;
  END IF;
  _num := 'TXN-COGS-' || upper(substr(_sale_id::text, 1, 8));

  INSERT INTO accounting_transactions
    (transaction_number, transaction_date, account_type, category, description, debit_amount, credit_amount,
     reference_type, reference_id, organization_id, created_by, currency, fx_rate, base_currency)
  VALUES (_num, now(), 'expense', 'container_sale_cogs',
          'COGS — ' || COALESCE(s.container_number, s.sale_number) || ' sold to ' || COALESCE(s.buyer_name, ''),
          _amt, 0, 'container_sales', _sale_id, s.organization_id, auth.uid(), _cur, _fx, _base);
  -- the contra (Cr container stock) is added by trg_post_ledger_counter_leg
END $$;
GRANT EXECUTE ON FUNCTION public.post_container_sale_cogs(uuid) TO authenticated;

-- Repatriation: costs incurred (Dr cost of sales / Cr accrued expenses until the bills arrive).
CREATE OR REPLACE FUNCTION public.post_repatriation_costs(_repatriation_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE r record; _amt numeric; _cogs uuid; _accr uuid; _num text; _base text;
BEGIN
  SELECT * INTO r FROM repatriations WHERE id = _repatriation_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Repatriation not found'; END IF;
  IF r.organization_id IS DISTINCT FROM public.current_org_id() AND NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Repatriation not found';
  END IF;
  IF EXISTS (SELECT 1 FROM accounting_transactions
              WHERE reference_type = 'repatriation' AND reference_id = _repatriation_id
                AND category = 'repatriation_cost') THEN
    RETURN;
  END IF;
  SELECT COALESCE(sum(amount), 0) INTO _amt FROM repatriation_costs WHERE repatriation_id = _repatriation_id;
  IF _amt <= 0 THEN RETURN; END IF;

  SELECT currency INTO _base FROM organizations WHERE id = r.organization_id;
  _cogs := public.ensure_gl_account(r.organization_id, '5000', 'Cost of Goods Sold', 'cost_of_goods', 'cogs');
  _accr := public.ensure_gl_account(r.organization_id, '2100', 'Accrued Expenses', 'liability', 'accrued_expenses');
  _num := 'TXN-REPC-' || upper(substr(_repatriation_id::text, 1, 8));

  INSERT INTO accounting_transactions
    (transaction_number, transaction_date, account_type, category, description, debit_amount, credit_amount,
     reference_type, reference_id, organization_id, created_by, currency, fx_rate, base_currency, gl_account_id)
  VALUES
    (_num, now(), 'cost_of_goods', 'repatriation_cost', 'Repatriation costs ' || r.repatriation_number,
     _amt, 0, 'repatriation', _repatriation_id, r.organization_id, auth.uid(), _base, 1, _base, _cogs),
    (_num || '-ACR', now(), 'liability', 'accrued_expenses', 'Repatriation costs accrued ' || r.repatriation_number,
     0, _amt, 'repatriation', _repatriation_id, r.organization_id, auth.uid(), _base, 1, _base, _accr);
END $$;
GRANT EXECUTE ON FUNCTION public.post_repatriation_costs(uuid) TO authenticated;

-- ---------------------------------------------------------------- 2. closed periods block every posting

CREATE OR REPLACE FUNCTION public.trg_ledger_period_guard()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  -- Only user actions are checked; data migrations and system jobs run without a user.
  IF auth.uid() IS NULL THEN RETURN NEW; END IF;
  -- The year-end closing entry is written just before the periods close.
  IF NEW.reference_type = 'year_end_close' THEN RETURN NEW; END IF;
  PERFORM public.assert_period_open(NEW.organization_id, NEW.transaction_date::date);
  IF EXISTS (SELECT 1 FROM year_end_closes y
              WHERE y.organization_id = NEW.organization_id
                AND y.fiscal_year = extract(year FROM NEW.transaction_date)::int) THEN
    RAISE EXCEPTION 'period_closed: financial year % has been closed', extract(year FROM NEW.transaction_date)::int
      USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_ledger_period_guard ON public.accounting_transactions;
CREATE TRIGGER trg_ledger_period_guard
  BEFORE INSERT ON public.accounting_transactions
  FOR EACH ROW EXECUTE FUNCTION public.trg_ledger_period_guard();

-- ---------------------------------------------------------------- 3. manual journals

CREATE OR REPLACE FUNCTION public.post_journal(_entry_date timestamp with time zone, _description text, _reference text, _currency text, _lines jsonb)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_org uuid := public.current_org_id();
  v_journal_id uuid := gen_random_uuid();
  v_total_debit numeric := 0;
  v_total_credit numeric := 0;
  v_period public.fiscal_periods%ROWTYPE;
  line jsonb;
  v_acct public.gl_accounts%ROWTYPE;
  v_txn_no text;
  v_seq int := 0;
  v_d numeric; v_c numeric;
  v_base text; v_cur text; v_fx numeric;
BEGIN
  IF v_org IS NULL THEN RAISE EXCEPTION 'No organization context'; END IF;
  PERFORM public.assert_finance_writer_for(v_org);
  IF jsonb_typeof(_lines) <> 'array' OR jsonb_array_length(_lines) < 2 THEN
    RAISE EXCEPTION 'A journal must have at least 2 lines';
  END IF;

  SELECT * INTO v_period FROM public.fiscal_periods
   WHERE organization_id = v_org AND _entry_date::date BETWEEN start_date AND end_date
   LIMIT 1;
  IF v_period.id IS NULL THEN
    RAISE EXCEPTION 'No fiscal period covers %; open the period first', _entry_date::date;
  END IF;
  IF v_period.status <> 'open' THEN
    RAISE EXCEPTION 'Fiscal period % is %', to_char(_entry_date,'YYYY-MM'), v_period.status;
  END IF;

  FOR line IN SELECT * FROM jsonb_array_elements(_lines) LOOP
    v_seq := v_seq + 1;
    v_d := COALESCE(NULLIF(line->>'debit', '')::numeric, 0);
    v_c := COALESCE(NULLIF(line->>'credit', '')::numeric, 0);
    IF v_d < 0 OR v_c < 0 THEN
      RAISE EXCEPTION 'Line %: amounts cannot be negative — put the amount on the other side instead', v_seq;
    END IF;
    IF v_d > 0 AND v_c > 0 THEN
      RAISE EXCEPTION 'Line %: a line can have a debit or a credit, not both', v_seq;
    END IF;
    IF v_d = 0 AND v_c = 0 THEN
      RAISE EXCEPTION 'Line %: enter a debit or a credit amount', v_seq;
    END IF;
    v_total_debit := v_total_debit + v_d;
    v_total_credit := v_total_credit + v_c;
  END LOOP;
  IF round(v_total_debit, 2) <> round(v_total_credit, 2) THEN
    RAISE EXCEPTION 'Journal not balanced: debit % vs credit %', v_total_debit, v_total_credit;
  END IF;

  SELECT currency INTO v_base FROM organizations WHERE id = v_org;
  v_cur := upper(COALESCE(NULLIF(_currency, ''), v_base));
  v_fx := CASE WHEN v_cur = upper(v_base) THEN 1 ELSE public.get_fx_rate(v_org, v_cur, v_base, _entry_date::date) END;
  IF v_fx IS NULL THEN
    RAISE EXCEPTION 'Missing FX rate % → % for %. Add it under Finance → FX Rates.', v_cur, v_base, _entry_date::date;
  END IF;

  v_seq := 0;
  FOR line IN SELECT * FROM jsonb_array_elements(_lines) LOOP
    v_seq := v_seq + 1;
    v_txn_no := 'JE-' || to_char(now(),'YYYYMMDD') || '-' || substr(v_journal_id::text,1,8) || '-' || v_seq;
    SELECT * INTO v_acct FROM public.gl_accounts
     WHERE id = NULLIF(line->>'gl_account_id','')::uuid AND organization_id = v_org;
    IF v_acct.id IS NULL THEN
      RAISE EXCEPTION 'Invalid gl_account_id on line %', v_seq;
    END IF;
    IF NOT COALESCE(v_acct.is_active, true) THEN
      RAISE EXCEPTION 'Line %: account % % is inactive', v_seq, v_acct.code, v_acct.name;
    END IF;

    INSERT INTO public.accounting_transactions (
      transaction_number, transaction_date, account_type, category, description,
      debit_amount, credit_amount, reference_type, reference_id,
      organization_id, financial_account_id, project_id,
      gl_account_id, journal_id, currency, fx_rate, base_currency, external_reference, created_by
    ) VALUES (
      v_txn_no, _entry_date, v_acct.account_type,
      COALESCE(v_acct.system_code, 'manual'),
      COALESCE(NULLIF(line->>'description', ''), _description),
      COALESCE(NULLIF(line->>'debit', '')::numeric, 0),
      COALESCE(NULLIF(line->>'credit', '')::numeric, 0),
      'manual_journal', v_journal_id,
      v_org,
      NULLIF(line->>'financial_account_id','')::uuid,
      NULLIF(line->>'project_id','')::uuid,
      v_acct.id, v_journal_id, v_cur, v_fx, v_base, NULLIF(_reference, ''), auth.uid()
    );
  END LOOP;

  RETURN v_journal_id;
END $function$;

-- Reverse a manual journal (the correction route now that lines can't be edited).
CREATE OR REPLACE FUNCTION public.reverse_journal(_journal_id uuid, _reason text DEFAULT NULL, _on date DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_org uuid; v_new uuid := gen_random_uuid(); v_date date := COALESCE(_on, current_date);
BEGIN
  SELECT organization_id INTO v_org FROM accounting_transactions
   WHERE journal_id = _journal_id AND reference_type = 'manual_journal' LIMIT 1;
  IF v_org IS NULL OR (v_org IS DISTINCT FROM public.current_org_id() AND NOT public.is_platform_admin()) THEN
    RAISE EXCEPTION 'Journal not found';
  END IF;
  PERFORM public.assert_finance_writer_for(v_org);
  IF EXISTS (SELECT 1 FROM accounting_transactions WHERE reference_type = 'manual_journal_reversal' AND reference_id = _journal_id) THEN
    RAISE EXCEPTION 'This journal has already been reversed';
  END IF;
  INSERT INTO accounting_transactions
    (transaction_number, transaction_date, account_type, category, description, debit_amount, credit_amount,
     reference_type, reference_id, organization_id, financial_account_id, project_id, gl_account_id, journal_id,
     currency, fx_rate, base_currency, external_reference, created_by)
  SELECT 'REV-' || a.transaction_number, v_date, a.account_type, a.category,
         'Reversal: ' || COALESCE(a.description, '') || COALESCE(' — ' || NULLIF(_reason, ''), ''),
         a.credit_amount, a.debit_amount, 'manual_journal_reversal', _journal_id, a.organization_id,
         a.financial_account_id, a.project_id, a.gl_account_id, v_new, a.currency, a.fx_rate, a.base_currency,
         a.external_reference, auth.uid()
    FROM accounting_transactions a
   WHERE a.journal_id = _journal_id AND a.reference_type = 'manual_journal';
  RETURN v_new;
END $$;
GRANT EXECUTE ON FUNCTION public.reverse_journal(uuid, text, date) TO authenticated;

-- ---------------------------------------------------------------- 4. chart of accounts

DROP POLICY IF EXISTS gl_accounts_insert ON public.gl_accounts;
CREATE POLICY gl_accounts_insert ON public.gl_accounts FOR INSERT TO authenticated
  WITH CHECK (organization_id = current_org_id()
              AND (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'accountant'::app_role)));
DROP POLICY IF EXISTS gl_accounts_update ON public.gl_accounts;
CREATE POLICY gl_accounts_update ON public.gl_accounts FOR UPDATE TO authenticated
  USING (organization_id = current_org_id() AND NOT is_system
         AND (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'accountant'::app_role)))
  WITH CHECK (organization_id = current_org_id() AND NOT is_system
              AND (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'accountant'::app_role)));

CREATE OR REPLACE FUNCTION public.trg_gl_account_delete_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  IF auth.uid() IS NULL THEN RETURN OLD; END IF;
  IF OLD.is_system THEN
    RAISE EXCEPTION 'Account % % is a system account and cannot be deleted', OLD.code, OLD.name;
  END IF;
  IF EXISTS (SELECT 1 FROM accounting_transactions WHERE gl_account_id = OLD.id) THEN
    RAISE EXCEPTION 'Account % % has postings; deactivate it instead of deleting', OLD.code, OLD.name;
  END IF;
  RETURN OLD;
END $$;
DROP TRIGGER IF EXISTS trg_gl_account_delete_guard ON public.gl_accounts;
CREATE TRIGGER trg_gl_account_delete_guard BEFORE DELETE ON public.gl_accounts
  FOR EACH ROW EXECUTE FUNCTION public.trg_gl_account_delete_guard();

-- ---------------------------------------------------------------- 5. year-end close

CREATE OR REPLACE FUNCTION public.close_fiscal_year(_fiscal_year integer, _retained_earnings_account uuid)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  org uuid := current_org_id();
  v_re gl_accounts%ROWTYPE;
  v_base text;
  v_start date := make_date(_fiscal_year, 1, 1);
  v_end date := make_date(_fiscal_year, 12, 31);
  v_jid uuid := gen_random_uuid();
  yec_id uuid := gen_random_uuid();
  v_ni numeric := 0;
  rec record;
  v_seq int := 0;
BEGIN
  IF org IS NULL THEN RAISE EXCEPTION 'No organization context'; END IF;
  IF NOT (has_role(auth.uid(),'admin') OR is_platform_admin()) THEN
    RAISE EXCEPTION 'Only admins can close the fiscal year';
  END IF;
  IF EXISTS (SELECT 1 FROM public.year_end_closes WHERE organization_id = org AND fiscal_year = _fiscal_year) THEN
    RAISE EXCEPTION 'Fiscal year % already closed', _fiscal_year;
  END IF;
  SELECT * INTO v_re FROM gl_accounts WHERE id = _retained_earnings_account AND organization_id = org;
  IF v_re.id IS NULL OR v_re.account_type::text <> 'equity' THEN
    RAISE EXCEPTION 'Choose an equity account of this company for retained earnings';
  END IF;
  IF EXISTS (SELECT 1 FROM year_end_closes WHERE organization_id = org AND fiscal_year > _fiscal_year) THEN
    RAISE EXCEPTION 'A later year is already closed';
  END IF;
  SELECT currency INTO v_base FROM organizations WHERE id = org;

  -- Zero every income/expense account for the year, per currency, at the booked rates.
  FOR rec IN
    SELECT t.gl_account_id, a.account_type, a.system_code, upper(COALESCE(t.currency, v_base)) AS cur,
           sum(t.debit_amount - t.credit_amount) AS net,
           sum((t.debit_amount - t.credit_amount) * ledger_base_factor(t.currency, COALESCE(t.base_currency, v_base), t.fx_rate)) AS net_base
      FROM accounting_transactions t
      JOIN gl_accounts a ON a.id = t.gl_account_id
     WHERE t.organization_id = org
       AND a.account_type::text IN ('revenue', 'expense', 'cost_of_goods')
       AND t.transaction_date >= v_start AND t.transaction_date < v_end + 1
     GROUP BY 1, 2, 3, 4
    HAVING round(sum(t.debit_amount - t.credit_amount), 2) <> 0
  LOOP
    v_seq := v_seq + 1;
    INSERT INTO accounting_transactions
      (transaction_number, transaction_date, account_type, category, description, debit_amount, credit_amount,
       reference_type, reference_id, organization_id, gl_account_id, journal_id, currency, fx_rate, base_currency, created_by)
    VALUES ('YEC-' || _fiscal_year || '-' || v_seq, v_end::timestamptz + interval '23 hours 59 minutes', rec.account_type,
            COALESCE(rec.system_code, 'year_end_close'), 'Year-end close ' || _fiscal_year,
            CASE WHEN rec.net < 0 THEN -rec.net ELSE 0 END, CASE WHEN rec.net > 0 THEN rec.net ELSE 0 END,
            'year_end_close', yec_id, org, rec.gl_account_id, v_jid, rec.cur,
            CASE WHEN rec.cur = upper(v_base) THEN 1 ELSE abs(rec.net_base / rec.net) END, v_base, auth.uid());
    v_ni := v_ni - rec.net_base;  -- credit balances (income) increase earnings
  END LOOP;

  -- Retained earnings: one balancing line per currency.
  FOR rec IN
    SELECT currency AS cur, sum(debit_amount - credit_amount) AS net, sum((debit_amount - credit_amount) * fx_rate) AS net_base
      FROM accounting_transactions
     WHERE reference_type = 'year_end_close' AND reference_id = yec_id
     GROUP BY 1
  LOOP
    v_seq := v_seq + 1;
    INSERT INTO accounting_transactions
      (transaction_number, transaction_date, account_type, category, description, debit_amount, credit_amount,
       reference_type, reference_id, organization_id, gl_account_id, journal_id, currency, fx_rate, base_currency, created_by)
    VALUES ('YEC-' || _fiscal_year || '-' || v_seq, v_end::timestamptz + interval '23 hours 59 minutes', 'equity',
            COALESCE(v_re.system_code, 'retained_earnings'), 'Year-end close ' || _fiscal_year || ' — net result',
            CASE WHEN rec.net < 0 THEN -rec.net ELSE 0 END, CASE WHEN rec.net > 0 THEN rec.net ELSE 0 END,
            'year_end_close', yec_id, org, v_re.id, v_jid, rec.cur,
            CASE WHEN rec.cur = upper(v_base) OR rec.net = 0 THEN 1 ELSE abs(rec.net_base / rec.net) END, v_base, auth.uid());
  END LOOP;

  UPDATE public.fiscal_periods
     SET status = 'closed', closed_at = now()
   WHERE organization_id = org AND EXTRACT(YEAR FROM start_date)::int = _fiscal_year AND status <> 'closed';

  INSERT INTO public.year_end_closes (id, organization_id, fiscal_year, closed_by, net_income, retained_earnings_account, journal_id, notes)
  VALUES (yec_id, org, _fiscal_year, auth.uid(), round(v_ni, 2), _retained_earnings_account, v_jid, 'Year-end close');

  RETURN yec_id;
END $function$;

-- P&L for a date range shows trading results, not the closing entry.
CREATE OR REPLACE FUNCTION public.gl_account_balances(_from date DEFAULT NULL, _to date DEFAULT NULL)
RETURNS TABLE(gl_account_id uuid, code text, name text, account_type text, currency text,
              total_debit numeric, total_credit numeric, balance numeric)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path TO 'public'
AS $$
  SELECT a.id, a.code, a.name, a.account_type::text, o.currency,
         round(COALESCE(sum(t.debit_amount  * ledger_base_factor(t.currency, COALESCE(t.base_currency, o.currency), t.fx_rate)), 0), 2),
         round(COALESCE(sum(t.credit_amount * ledger_base_factor(t.currency, COALESCE(t.base_currency, o.currency), t.fx_rate)), 0), 2),
         round(CASE WHEN a.account_type IN ('asset', 'expense', 'cost_of_goods')
                    THEN COALESCE(sum((t.debit_amount - t.credit_amount) * ledger_base_factor(t.currency, COALESCE(t.base_currency, o.currency), t.fx_rate)), 0)
                    ELSE COALESCE(sum((t.credit_amount - t.debit_amount) * ledger_base_factor(t.currency, COALESCE(t.base_currency, o.currency), t.fx_rate)), 0)
               END, 2)
    FROM gl_accounts a
    JOIN organizations o ON o.id = a.organization_id
    LEFT JOIN accounting_transactions t
           ON t.gl_account_id = a.id AND t.organization_id = a.organization_id
          AND (_from IS NULL OR t.transaction_date >= _from)
          AND (_to IS NULL OR t.transaction_date < _to + 1)
          AND NOT (_from IS NOT NULL AND t.reference_type = 'year_end_close')
   WHERE a.organization_id = current_org_id()
   GROUP BY a.id, o.currency
   ORDER BY a.code
$$;
