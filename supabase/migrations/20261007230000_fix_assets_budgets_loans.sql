-- =====================================================================
-- Fixed assets, budgets and loans fixes (finance audit, step 6)
--
--  1. Depreciation: once per period, company admins/accountants only, only
--     assets owned by the end of the period, final month takes the exact
--     remainder, and the journal is dated at the end of the period.
--  2. Asset disposal posts to the ledger: removes cost (1500) and accumulated
--     depreciation (1510), books proceeds to 1150 "Asset Disposal Proceeds
--     Receivable" and the gain/loss to 4900 / 6900.
--  3. Capitalising assets: supplier bills may name the GL account they are
--     booked to (e.g. 1500 Fixed Assets); capitalise_existing_assets() puts
--     assets registered before this fix onto the balance sheet once.
--  4. Budget vs actual: company check, the last day of the period counts,
--     revenue/liability/equity actuals are positive, variance = actual - budget.
--  5. Loans: every loan function checks the company and role; deleting a loan
--     transaction reverses its ledger lines instead of erasing them; the
--     schedule calculates the instalment when none is given.
-- Uses helpers from the earlier finance fix migrations.
-- =====================================================================

-- ---------------------------------------------------------------- depreciation

-- Not a unique index: production may already hold duplicate runs from before
-- this fix. The function serialises on the period and refuses a second run.

CREATE OR REPLACE FUNCTION public.run_depreciation(_period_id uuid)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE org uuid; p_start date; p_end date; rid uuid; rec record; total numeric := 0; cnt integer := 0;
        monthly numeric; remaining numeric;
BEGIN
  SELECT organization_id, start_date, end_date INTO org, p_start, p_end FROM fiscal_periods WHERE id = _period_id;
  IF org IS NULL THEN RAISE EXCEPTION 'Period not found'; END IF;
  PERFORM public.assert_finance_writer_for(org);
  PERFORM public.assert_period_open(org, p_end);
  PERFORM pg_advisory_xact_lock(hashtext('depreciation:' || _period_id::text));
  IF EXISTS (SELECT 1 FROM fixed_asset_depreciation_runs WHERE organization_id = org AND period_id = _period_id) THEN
    RAISE EXCEPTION 'already_run: depreciation for % has already been run', to_char(p_start, 'Mon YYYY') USING ERRCODE = '23505';
  END IF;

  FOR rec IN SELECT * FROM fixed_assets
              WHERE organization_id = org AND status = 'active'
                AND COALESCE(acquisition_date, p_start) <= p_end
              FOR UPDATE LOOP
    remaining := GREATEST(COALESCE(rec.cost, 0) - COALESCE(rec.salvage_value, 0) - COALESCE(rec.accumulated_depreciation, 0), 0);
    IF rec.method = 'straight_line' THEN
      monthly := GREATEST(COALESCE(rec.cost, 0) - COALESCE(rec.salvage_value, 0), 0) / NULLIF(rec.useful_life_months, 0);
    ELSE
      monthly := GREATEST(COALESCE(rec.cost, 0) - COALESCE(rec.accumulated_depreciation, 0), 0) * (2.0 / NULLIF(rec.useful_life_months, 0));
    END IF;
    monthly := round(LEAST(COALESCE(monthly, 0), remaining), 2);   -- last month takes the exact remainder
    IF monthly > 0 THEN
      UPDATE fixed_assets SET accumulated_depreciation = COALESCE(accumulated_depreciation, 0) + monthly WHERE id = rec.id;
      total := total + monthly;
      cnt := cnt + 1;
    END IF;
  END LOOP;

  INSERT INTO fixed_asset_depreciation_runs (organization_id, period_id, total_depreciation, asset_count, notes, run_at)
  VALUES (org, _period_id, total, cnt, 'Depreciation for ' || to_char(p_start, 'Mon YYYY'), now())
  RETURNING id INTO rid;
  RETURN rid;
END $function$;

CREATE OR REPLACE FUNCTION public.post_depreciation_run_to_ledger(_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE _r fixed_asset_depreciation_runs%ROWTYPE; _curr text; _on timestamptz;
BEGIN
  SELECT * INTO _r FROM fixed_asset_depreciation_runs WHERE id = _id;
  IF NOT FOUND OR COALESCE(_r.total_depreciation, 0) <= 0 THEN RETURN; END IF;
  IF EXISTS (SELECT 1 FROM accounting_transactions WHERE reference_type = 'depreciation_run' AND reference_id = _id) THEN RETURN; END IF;
  _curr := COALESCE((SELECT currency FROM organizations WHERE id = _r.organization_id), 'USD');
  -- Dated in the period it belongs to, not on the day it was run.
  SELECT (end_date + time '12:00')::timestamptz INTO _on FROM fiscal_periods WHERE id = _r.period_id;
  _on := COALESCE(_on, _r.run_at, now());
  INSERT INTO accounting_transactions(transaction_number, transaction_date, account_type, category, description,
    debit_amount, credit_amount, reference_type, reference_id, organization_id, currency)
  VALUES ('DEP-DR-'||substring(_r.id::text,1,8), _on, 'expense', 'depreciation',
    'Depreciation run — '||_r.asset_count||' assets', _r.total_depreciation, 0, 'depreciation_run', _r.id, _r.organization_id, _curr);
  INSERT INTO accounting_transactions(transaction_number, transaction_date, account_type, category, description,
    debit_amount, credit_amount, reference_type, reference_id, organization_id, currency)
  VALUES ('DEP-CR-'||substring(_r.id::text,1,8), _on, 'asset', 'accumulated_depreciation',
    'Accumulated depreciation', 0, _r.total_depreciation, 'depreciation_run', _r.id, _r.organization_id, _curr);
END $function$;

-- ---------------------------------------------------------------- disposal

CREATE OR REPLACE FUNCTION public.post_asset_disposal(_disposal_id uuid)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE d record; a record; nbv numeric; gl numeric; _curr text; _on timestamptz;
        _fa uuid; _acc uuid; _proc uuid; _gain uuid; _loss uuid;
BEGIN
  SELECT * INTO d FROM asset_disposals WHERE id = _disposal_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Disposal not found'; END IF;
  PERFORM public.assert_finance_writer_for(d.organization_id);
  IF d.status = 'posted' THEN RETURN d.id; END IF;
  SELECT * INTO a FROM fixed_assets WHERE id = d.asset_id AND organization_id = d.organization_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Asset not found'; END IF;
  IF a.status = 'disposed' THEN RAISE EXCEPTION 'asset_already_disposed' USING ERRCODE = '22023'; END IF;
  _on := COALESCE(d.disposed_on::timestamptz, now());
  PERFORM public.assert_period_open(d.organization_id, _on::date);

  nbv := COALESCE(a.cost, 0) - COALESCE(a.accumulated_depreciation, 0);
  gl := COALESCE(d.proceeds, 0) - nbv;
  _curr := COALESCE(d.currency, (SELECT currency FROM organizations WHERE id = d.organization_id));
  _fa   := public.ensure_gl_account(d.organization_id, '1500', 'Fixed Assets', 'asset', 'fixed_assets');
  _acc  := public.ensure_gl_account(d.organization_id, '1510', 'Accumulated Depreciation', 'asset', 'accumulated_depreciation');
  _proc := public.ensure_gl_account(d.organization_id, '1150', 'Asset Disposal Proceeds Receivable', 'asset', 'disposal_proceeds');
  _gain := public.ensure_gl_account(d.organization_id, '4900', 'Other Income', 'revenue', 'other_income');
  _loss := public.ensure_gl_account(d.organization_id, '6900', 'Other Expenses', 'expense', 'other_expense');

  INSERT INTO accounting_transactions(transaction_number, transaction_date, account_type, category, description,
    debit_amount, credit_amount, reference_type, reference_id, organization_id, gl_account_id, currency)
  SELECT 'DISP-'||n||'-'||substr(d.id::text,1,8), _on, t::account_type, c, 'Disposal of '||a.code||' '||a.name||' — '||lbl,
         dr, cr, 'asset_disposal', d.id, d.organization_id, g, _curr
    FROM (VALUES
      (1, 'asset', 'accumulated_depreciation', 'remove accumulated depreciation', COALESCE(a.accumulated_depreciation, 0), 0::numeric, _acc),
      (2, 'asset', 'disposal_proceeds', 'proceeds receivable', COALESCE(d.proceeds, 0), 0::numeric, _proc),
      (3, 'asset', 'fixed_assets', 'remove cost', 0::numeric, COALESCE(a.cost, 0), _fa),
      (4, CASE WHEN gl >= 0 THEN 'revenue' ELSE 'expense' END, CASE WHEN gl >= 0 THEN 'disposal_gain' ELSE 'disposal_loss' END,
          CASE WHEN gl >= 0 THEN 'gain on disposal' ELSE 'loss on disposal' END,
          GREATEST(-gl, 0), GREATEST(gl, 0), CASE WHEN gl >= 0 THEN _gain ELSE _loss END)
    ) v(n, t, c, lbl, dr, cr, g)
   WHERE dr <> 0 OR cr <> 0;

  UPDATE asset_disposals SET nbv_at_disposal = nbv, gain_loss = gl, status = 'posted', posted_at = now(), updated_at = now() WHERE id = _disposal_id;
  UPDATE fixed_assets SET status = 'disposed', disposed_at = d.disposed_on, disposal_method = d.method,
         disposal_proceeds = d.proceeds, disposal_gain_loss = gl, updated_at = now() WHERE id = d.asset_id;
  RETURN d.id;
END $function$;

-- ---------------------------------------------------------------- capitalisation

-- A supplier bill can be booked to a chosen account (e.g. 1500 Fixed Assets)
-- instead of the default 6900 Other Expenses.
ALTER TABLE public.supplier_invoices ADD COLUMN IF NOT EXISTS gl_account_id uuid REFERENCES public.gl_accounts(id);

CREATE OR REPLACE FUNCTION public.post_supplier_bill_to_ledger(_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE _b supplier_invoices%ROWTYPE; _net numeric; _tax numeric; _sup text; _on date; _t account_type;
BEGIN
  SELECT * INTO _b FROM supplier_invoices WHERE id = _id;
  IF NOT FOUND THEN RETURN; END IF;
  IF _b.purchase_order_id IS NOT NULL OR _b.container_id IS NOT NULL
     OR COALESCE(_b.acquisition_component, 'other') <> 'other' THEN RETURN; END IF;
  IF _b.status NOT IN ('issued', 'partially_paid', 'paid') THEN RETURN; END IF;
  IF COALESCE(_b.total_amount, 0) <= 0 THEN RETURN; END IF;
  IF EXISTS (SELECT 1 FROM accounting_transactions
              WHERE reference_id = _id AND reference_type IN ('supplier_invoices', 'supplier_invoice')) THEN RETURN; END IF;

  _on := COALESCE(_b.issue_date, current_date);
  PERFORM public.assert_period_open(_b.organization_id, _on);
  _tax := COALESCE(_b.tax_amount, 0);
  _net := COALESCE(_b.subtotal, _b.total_amount - _tax);
  SELECT name INTO _sup FROM suppliers WHERE id = _b.supplier_id;
  SELECT account_type INTO _t FROM gl_accounts WHERE id = _b.gl_account_id AND organization_id = _b.organization_id;

  INSERT INTO accounting_transactions(transaction_number, transaction_date, account_type, category, description,
    debit_amount, credit_amount, reference_type, reference_id, organization_id, gl_account_id)
  VALUES ('BILL-'||left(_b.invoice_number, 30)||'-'||substring(_b.id::text,1,8), _on, COALESCE(_t, 'expense'), 'other',
    'Supplier bill '||_b.invoice_number||COALESCE(' — '||_sup, ''), _net, 0, 'supplier_invoices', _b.id, _b.organization_id,
    CASE WHEN _t IS NOT NULL THEN _b.gl_account_id END);
  IF _tax > 0 THEN
    INSERT INTO accounting_transactions(transaction_number, transaction_date, account_type, category, description,
      debit_amount, credit_amount, reference_type, reference_id, organization_id)
    VALUES ('BILL-VAT-'||left(_b.invoice_number, 30)||'-'||substring(_b.id::text,1,8), _on, 'asset', 'input_tax',
      'Input VAT — bill '||_b.invoice_number, _tax, 0, 'supplier_invoices', _b.id, _b.organization_id);
  END IF;
  INSERT INTO accounting_transactions(transaction_number, transaction_date, account_type, category, description,
    debit_amount, credit_amount, reference_type, reference_id, organization_id)
  VALUES ('BILL-AP-'||left(_b.invoice_number, 30)||'-'||substring(_b.id::text,1,8), _on, 'liability', 'accounts_payable',
    'AP — bill '||_b.invoice_number||COALESCE(' — '||_sup, ''), 0, _b.total_amount, 'supplier_invoices', _b.id, _b.organization_id);
END $$;

-- One-off: put assets registered before this fix onto the balance sheet
-- (Dr 1500 cost / Cr 1510 accumulated depreciation / Cr 3100 net book value).
-- Run it once per company, after checking the asset register is complete.
CREATE OR REPLACE FUNCTION public.capitalise_existing_assets()
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE org uuid := current_org_id(); a record; n integer := 0; _fa uuid; _acc uuid; _re uuid; _curr text;
BEGIN
  PERFORM public.assert_finance_writer_for(org);
  _fa  := public.ensure_gl_account(org, '1500', 'Fixed Assets', 'asset', 'fixed_assets');
  _acc := public.ensure_gl_account(org, '1510', 'Accumulated Depreciation', 'asset', 'accumulated_depreciation');
  _re  := public.ensure_gl_account(org, '3100', 'Retained Earnings', 'equity', 'retained_earnings');
  _curr := (SELECT currency FROM organizations WHERE id = org);
  FOR a IN SELECT * FROM fixed_assets f WHERE f.organization_id = org AND f.status = 'active'
             AND NOT EXISTS (SELECT 1 FROM accounting_transactions t WHERE t.reference_type = 'asset_capitalisation' AND t.reference_id = f.id)
  LOOP
    INSERT INTO accounting_transactions(transaction_number, transaction_date, account_type, category, description,
      debit_amount, credit_amount, reference_type, reference_id, organization_id, gl_account_id, currency)
    VALUES ('CAP-1-'||substr(a.id::text,1,8), now(), 'asset', 'fixed_assets', 'Capitalise '||a.code||' '||a.name, a.cost, 0, 'asset_capitalisation', a.id, org, _fa, _curr),
           ('CAP-2-'||substr(a.id::text,1,8), now(), 'asset', 'accumulated_depreciation', 'Capitalise '||a.code||' — accumulated depreciation to date', 0, COALESCE(a.accumulated_depreciation, 0), 'asset_capitalisation', a.id, org, _acc, _curr),
           ('CAP-3-'||substr(a.id::text,1,8), now(), 'equity', 'opening_balance_equity', 'Capitalise '||a.code||' — net book value', 0, a.cost - COALESCE(a.accumulated_depreciation, 0), 'asset_capitalisation', a.id, org, _re, _curr);
    n := n + 1;
  END LOOP;
  RETURN n;
END $$;

-- ---------------------------------------------------------------- budgets

CREATE OR REPLACE FUNCTION public.budget_variance(_period_id uuid)
RETURNS TABLE(gl_account_id uuid, code text, name text, account_type text, budget_amount numeric, actual_amount numeric, variance numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE p_start date; p_end date; org uuid;
BEGIN
  SELECT start_date, end_date, organization_id INTO p_start, p_end, org FROM fiscal_periods WHERE id = _period_id;
  IF p_start IS NULL OR (org IS DISTINCT FROM current_org_id() AND NOT is_platform_admin()) THEN
    RAISE EXCEPTION 'Period not found';
  END IF;
  RETURN QUERY
  WITH act AS (
    SELECT t.gl_account_id,
           sum((t.debit_amount - t.credit_amount)
               * CASE WHEN t.base_currency IS NULL OR upper(t.currency) = upper(t.base_currency) THEN 1 ELSE COALESCE(t.fx_rate, 1) END) AS dr_cr
      FROM accounting_transactions t
     WHERE t.organization_id = org
       AND t.transaction_date >= p_start AND t.transaction_date < p_end + 1   -- whole last day
     GROUP BY t.gl_account_id
  ), bud AS (
    SELECT b.gl_account_id, sum(b.amount) AS amt FROM budgets b
     WHERE b.organization_id = org AND b.period_id = _period_id GROUP BY b.gl_account_id
  )
  SELECT a.id, a.code, a.name, a.account_type::text,
         round(COALESCE(bud.amt, 0), 2),
         -- natural sign: revenue, liabilities and equity are credits
         round(COALESCE(act.dr_cr, 0) * CASE WHEN a.account_type IN ('revenue', 'liability', 'equity') THEN -1 ELSE 1 END, 2),
         round(COALESCE(act.dr_cr, 0) * CASE WHEN a.account_type IN ('revenue', 'liability', 'equity') THEN -1 ELSE 1 END - COALESCE(bud.amt, 0), 2)
    FROM gl_accounts a
    LEFT JOIN act ON act.gl_account_id = a.id
    LEFT JOIN bud ON bud.gl_account_id = a.id
   WHERE a.organization_id = org
   ORDER BY a.code;
END $function$;

-- ---------------------------------------------------------------- loans

-- Add a company + role check right after each function loads its loan.
DO $$
DECLARE f text; def text; anchor text := E'IF NOT FOUND THEN RAISE EXCEPTION ''loan_not_found''; END IF;';
BEGIN
  FOREACH f IN ARRAY ARRAY['post_loan_transaction', 'pay_loan_instalment', 'generate_loan_schedule'] LOOP
    SELECT pg_get_functiondef(p.oid) INTO def FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = f LIMIT 1;
    IF def IS NOT NULL AND position(anchor IN def) > 0 AND position('assert_finance_writer_for' IN def) = 0 THEN
      EXECUTE replace(def, anchor, anchor || E'\n  PERFORM public.assert_finance_writer_for(_l.organization_id);');
    END IF;
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.delete_loan_transaction(_txn_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE _x loan_transactions%ROWTYPE;
BEGIN
  SELECT * INTO _x FROM loan_transactions WHERE id = _txn_id;
  IF NOT FOUND THEN RETURN; END IF;
  PERFORM public.assert_finance_writer_for(_x.organization_id);
  -- Keep the audit trail: reverse the ledger lines rather than deleting them.
  PERFORM public.post_reversal_of('loan_transaction', _txn_id, 'loan transaction deleted');
  DELETE FROM loan_transactions WHERE id = _txn_id;
  PERFORM public.apply_loan_payments_to_schedule(_x.loan_id);
END $function$;

-- Work out the instalment (annuity) when the user leaves it blank.
DO $$
DECLARE def text; anchor text := E'  IF _bal <= 0 OR _inst <= 0 THEN RETURN 0; END IF;';
BEGIN
  SELECT pg_get_functiondef('public.generate_loan_schedule'::regproc) INTO def;
  IF position(anchor IN def) > 0 AND position('annuity' IN def) = 0 THEN
    EXECUTE replace(def, anchor, E'  -- annuity: instalment that repays principal + interest by maturity\n'
      || E'  IF _inst <= 0 AND _bal > 0 AND _l.maturity_date IS NOT NULL THEN\n'
      || E'    _i := GREATEST(1, round(EXTRACT(EPOCH FROM (_l.maturity_date::timestamp - _l.date_granted::timestamp)) / EXTRACT(EPOCH FROM _step))::int);\n'
      || E'    _inst := CASE WHEN _rate > 0 THEN ceil(_bal * _rate / (1 - power(1 + _rate, -_i)) * 100) / 100 ELSE ceil(_bal / _i * 100) / 100 END;\n'
      || E'    UPDATE public.loan_facilities SET repayment_amount = _inst WHERE id = _loan_id;\n'
      || E'    _i := 0;\n'
      || E'  END IF;\n' || anchor);
  END IF;
END $$;
