-- =====================================================================
-- Reporting & period-close fixes (finance audit, step 7)
--
--  1. Statements in base currency: v_account_balances converts each line with
--     its fx_rate, so the Trial Balance, P&L and balance sheet stop adding KES
--     and USD together and the balance sheet balances.
--     gl_account_balances(_from, _to) gives the same figures for a period
--     (P&L) or as at a date (balance sheet).
--  2. Legacy transfer lines get their GL account (they were invisible).
--  3. Dashboard: cash no longer counts each opening balance once per
--     transaction; receivables exclude drafts; month-to-date figures are net
--     of reversals.
--  4. Approvals: decide_approval_request works again (it wrote text into an
--     enum column and failed for every document), checks the company, and
--     stops people approving their own financial documents; act_on_approval
--     goes through the same checks. Payments awaiting approval are not posted
--     or counted against the invoice until approved.
--  5. Period control: only admins/accountants of the company may open years
--     or change period status, and a month can't be closed while items on its
--     close checklist are still open.
-- =====================================================================

-- ---------------------------------------------------------------- base currency

-- Factor that turns a ledger line's amount into the company's base currency.
CREATE OR REPLACE FUNCTION public.ledger_base_factor(_currency text, _base text, _fx numeric)
RETURNS numeric LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN _currency IS NULL OR _base IS NULL OR upper(_currency) = upper(_base) THEN 1
              ELSE COALESCE(NULLIF(_fx, 0), 1) END
$$;

CREATE OR REPLACE VIEW public.v_account_balances WITH (security_invoker = on) AS
SELECT a.id AS gl_account_id,
       a.organization_id,
       a.code,
       a.name,
       a.account_type,
       o.currency AS currency,
       round(COALESCE(sum(t.debit_amount  * public.ledger_base_factor(t.currency, COALESCE(t.base_currency, o.currency), t.fx_rate)), 0), 2) AS total_debit,
       round(COALESCE(sum(t.credit_amount * public.ledger_base_factor(t.currency, COALESCE(t.base_currency, o.currency), t.fx_rate)), 0), 2) AS total_credit,
       round(CASE WHEN a.account_type IN ('asset', 'expense', 'cost_of_goods')
                  THEN COALESCE(sum((t.debit_amount - t.credit_amount) * public.ledger_base_factor(t.currency, COALESCE(t.base_currency, o.currency), t.fx_rate)), 0)
                  ELSE COALESCE(sum((t.credit_amount - t.debit_amount) * public.ledger_base_factor(t.currency, COALESCE(t.base_currency, o.currency), t.fx_rate)), 0)
             END, 2) AS balance
  FROM gl_accounts a
  JOIN organizations o ON o.id = a.organization_id
  LEFT JOIN accounting_transactions t ON t.gl_account_id = a.id AND t.organization_id = a.organization_id
 GROUP BY a.id, o.currency;

-- Same figures for a date range: P&L uses (_from, _to); balance sheet uses (NULL, _to).
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
   WHERE a.organization_id = current_org_id()
   GROUP BY a.id, o.currency
   ORDER BY a.code
$$;
GRANT EXECUTE ON FUNCTION public.gl_account_balances(date, date) TO authenticated;

-- Legacy transfer lines (before 20261007210000) carried no GL account.
UPDATE public.accounting_transactions t
   SET gl_account_id = g.id
  FROM public.gl_accounts g
 WHERE t.gl_account_id IS NULL
   AND t.category IN ('inter_account_transfer', 'inter_account_transfer_void')
   AND g.organization_id = t.organization_id AND g.code = '1000';

-- ---------------------------------------------------------------- dashboard

CREATE OR REPLACE VIEW public.finance_dashboard_metrics WITH (security_invoker = on) AS
WITH cash AS (
  -- opening balance once per account, plus that account's movements
  SELECT fa.organization_id, fa.currency,
         sum(COALESCE(fa.opening_balance, 0)
             + COALESCE((SELECT sum(at.debit_amount - at.credit_amount) FROM accounting_transactions at
                          WHERE at.financial_account_id = fa.id), 0)) AS amount
    FROM financial_accounts fa
   WHERE fa.is_active AND fa.account_type IN ('bank', 'cash', 'mobile_money')
   GROUP BY fa.organization_id, fa.currency
), ar AS (
  SELECT i.organization_id, i.currency,
         COALESCE(sum(i.total_amount - COALESCE((SELECT sum(p.amount) FROM payments p WHERE p.invoice_id = i.id), 0)), 0) AS amount
    FROM invoices i
   WHERE i.status IN ('sent', 'overdue') AND i.voided_at IS NULL
   GROUP BY i.organization_id, i.currency
), mtd AS (
  SELECT at.organization_id, at.currency,
         COALESCE(sum(at.credit_amount - at.debit_amount) FILTER (WHERE at.account_type = 'revenue'), 0) AS revenue,
         COALESCE(sum(at.debit_amount - at.credit_amount) FILTER (WHERE at.account_type = 'expense'), 0) AS expense,
         COALESCE(sum(at.debit_amount - at.credit_amount) FILTER (WHERE at.account_type = 'cost_of_goods'), 0) AS cogs,
         COALESCE(sum(at.debit_amount - at.credit_amount) FILTER (WHERE at.category = 'input_tax'), 0) AS input_vat
    FROM accounting_transactions at
   WHERE at.transaction_date >= date_trunc('month', now())
   GROUP BY at.organization_id, at.currency
), recon AS (
  SELECT br.organization_id,
         count(*) FILTER (WHERE br.status = 'in_progress') AS in_progress_count,
         count(*) FILTER (WHERE br.status = 'completed') AS completed_count,
         count(*) FILTER (WHERE br.status = 'completed' AND br.completed_at >= now() - interval '30 days') AS recent_completed
    FROM bank_reconciliations br
   GROUP BY br.organization_id
)
SELECT o.id AS organization_id,
       COALESCE(o.currency, 'USD') AS base_currency,
       COALESCE((SELECT json_agg(json_build_object('currency', c.currency, 'amount', c.amount)) FROM cash c WHERE c.organization_id = o.id), '[]'::json) AS cash_on_hand,
       COALESCE((SELECT json_agg(json_build_object('currency', a.currency, 'amount', a.amount)) FROM ar a WHERE a.organization_id = o.id), '[]'::json) AS receivables,
       COALESCE((SELECT sum(convert_to_base(c.amount, c.currency, o.id)) FROM cash c WHERE c.organization_id = o.id), 0) AS cash_total,
       COALESCE((SELECT sum(convert_to_base(a.amount, a.currency, o.id)) FROM ar a WHERE a.organization_id = o.id), 0) AS receivables_total,
       COALESCE((SELECT sum(convert_to_base(m.revenue, m.currency, o.id)) FROM mtd m WHERE m.organization_id = o.id), 0) AS mtd_revenue,
       COALESCE((SELECT sum(convert_to_base(m.expense, m.currency, o.id)) FROM mtd m WHERE m.organization_id = o.id), 0) AS mtd_expense,
       COALESCE((SELECT sum(convert_to_base(m.cogs, m.currency, o.id)) FROM mtd m WHERE m.organization_id = o.id), 0) AS mtd_cogs,
       COALESCE((SELECT sum(convert_to_base(m.revenue - m.expense - m.cogs, m.currency, o.id)) FROM mtd m WHERE m.organization_id = o.id), 0) AS mtd_net,
       COALESCE((SELECT sum(convert_to_base(m.input_vat, m.currency, o.id)) FROM mtd m WHERE m.organization_id = o.id), 0) AS mtd_input_vat,
       COALESCE((SELECT r.in_progress_count FROM recon r WHERE r.organization_id = o.id), 0) AS recon_in_progress,
       COALESCE((SELECT r.completed_count FROM recon r WHERE r.organization_id = o.id), 0) AS recon_completed,
       COALESCE((SELECT r.recent_completed FROM recon r WHERE r.organization_id = o.id), 0) AS recon_recent
  FROM organizations o;

-- ---------------------------------------------------------------- approvals

-- Fix the enum write, add the company check and segregation of duties.
DO $$
DECLARE def text;
BEGIN
  SELECT pg_get_functiondef('public.decide_approval_request'::regproc) INTO def;
  IF position('EXECUTE sql USING new_status::text' IN def) > 0 THEN
    def := replace(def, 'EXECUTE sql USING new_status::text', 'EXECUTE sql USING new_status');
  END IF;
  IF position('approval_wrong_company' IN def) = 0 THEN
    def := replace(def,
      E'  IF req.status <> ''pending'' THEN RAISE EXCEPTION ''Already decided''; END IF;',
      E'  IF req.status <> ''pending'' THEN RAISE EXCEPTION ''Already decided''; END IF;\n'
      || E'  IF req.organization_id IS DISTINCT FROM public.current_org_id() AND NOT public.is_platform_admin() THEN\n'
      || E'    RAISE EXCEPTION ''Approval request not found'' USING HINT = ''approval_wrong_company'';\n'
      || E'  END IF;\n'
      || E'  IF req.doc_type IN (''payment'', ''vendor_payment'', ''purchase_order'', ''quote'', ''repatriation'', ''eir'')\n'
      || E'     AND req.requested_by = uid AND NOT public.is_platform_admin() THEN\n'
      || E'    RAISE EXCEPTION ''self_approval: someone other than the requester must approve this'' USING ERRCODE = ''42501'';\n'
      || E'  END IF;');
  END IF;
  -- `req.assigned_to = uid` is NULL when nobody is assigned, which made the
  -- authorisation check pass for anyone (NOT (false OR NULL) is NULL).
  def := replace(def, 'OR req.assigned_to = uid OR', 'OR COALESCE(req.assigned_to = uid, false) OR');
  EXECUTE def;
END $$;

-- act_on_approval had no checks at all; route it through decide_approval_request.
CREATE OR REPLACE FUNCTION public.act_on_approval(_request_id uuid, _decision text, _note text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  PERFORM public.decide_approval_request(_request_id, _decision, _note);
END $$;

-- Payments awaiting approval are not posted until approved.
CREATE OR REPLACE FUNCTION public.trg_vendor_payment_autopost()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE _po purchase_orders%ROWTYPE; _paid numeric;
BEGIN
  IF COALESCE(NEW.approval_status::text, 'not_required') IN ('pending', 'rejected') THEN RETURN NEW; END IF;
  PERFORM public.post_vendor_payment_to_ledger(NEW.id);
  -- an approved payment can complete the PO
  IF TG_OP = 'UPDATE' AND NEW.po_id IS NOT NULL THEN
    SELECT * INTO _po FROM purchase_orders WHERE id = NEW.po_id;
    SELECT COALESCE(sum(amount), 0) INTO _paid FROM vendor_payments
     WHERE po_id = NEW.po_id AND COALESCE(approval_status::text, 'not_required') NOT IN ('pending', 'rejected');
    IF _po.status = 'received' AND _paid >= COALESCE(_po.total_cost, 0) - 0.01 AND COALESCE(_po.total_cost, 0) > 0 THEN
      UPDATE purchase_orders SET status = 'paid' WHERE id = NEW.po_id;
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_vendor_payment_autopost_on_approval ON public.vendor_payments;
CREATE TRIGGER trg_vendor_payment_autopost_on_approval
  AFTER UPDATE OF approval_status ON public.vendor_payments
  FOR EACH ROW WHEN (NEW.approval_status IS DISTINCT FROM OLD.approval_status)
  EXECUTE FUNCTION public.trg_vendor_payment_autopost();

CREATE OR REPLACE FUNCTION public.trg_payment_autopost()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  IF COALESCE(NEW.approval_status::text, 'not_required') IN ('pending', 'rejected') THEN RETURN NEW; END IF;
  PERFORM public.post_payment_to_ledger(NEW.id);
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_payment_autopost_on_approval ON public.payments;
CREATE TRIGGER trg_payment_autopost_on_approval
  AFTER UPDATE OF approval_status ON public.payments
  FOR EACH ROW WHEN (NEW.approval_status IS DISTINCT FROM OLD.approval_status)
  EXECUTE FUNCTION public.trg_payment_autopost();

-- A payment awaiting approval doesn't mark the invoice paid yet.
DO $$
DECLARE def text;
BEGIN
  SELECT pg_get_functiondef('public.payments_reconcile_invoice'::regproc) INTO def;
  IF position('approval_status' IN def) = 0 THEN
    EXECUTE replace(def,
      'SELECT COALESCE(SUM(amount), 0) INTO _paid FROM payments WHERE invoice_id = _invoice_id;',
      'SELECT COALESCE(SUM(amount), 0) INTO _paid FROM payments WHERE invoice_id = _invoice_id'
      || ' AND COALESCE(approval_status::text, ''not_required'') NOT IN (''pending'', ''rejected'');');
  END IF;
END $$;

-- record_vendor_payment must not mark the PO paid while the payment awaits approval.
DO $$
DECLARE def text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO def FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'record_vendor_payment';
  IF position('approval_status' IN def) = 0 THEN
    EXECUTE replace(def,
      E'AND COALESCE(_po.total_cost, 0) > 0 AND _po.status = ''received'' THEN',
      E'AND COALESCE(_po.total_cost, 0) > 0 AND _po.status = ''received''\n'
      || E'     AND COALESCE((SELECT approval_status::text FROM vendor_payments WHERE id = _pid), ''not_required'') NOT IN (''pending'', ''rejected'') THEN');
  END IF;
END $$;

-- ---------------------------------------------------------------- period control

CREATE OR REPLACE FUNCTION public.open_fiscal_year(_year integer)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_org uuid := public.current_org_id(); m int; inserted int := 0; s date; e date;
BEGIN
  IF v_org IS NULL THEN RAISE EXCEPTION 'No organization context'; END IF;
  PERFORM public.assert_finance_writer_for(v_org);
  FOR m IN 1..12 LOOP
    s := make_date(_year, m, 1);
    e := (s + interval '1 month - 1 day')::date;
    BEGIN
      INSERT INTO public.fiscal_periods (organization_id, year, month, start_date, end_date) VALUES (v_org, _year, m, s, e);
      inserted := inserted + 1;
    EXCEPTION WHEN unique_violation THEN NULL; END;
  END LOOP;
  RETURN inserted;
END $function$;

CREATE OR REPLACE FUNCTION public.set_period_status(_period_id uuid, _status text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE _org uuid; _open_items int;
BEGIN
  IF _status NOT IN ('open', 'closed', 'locked') THEN RAISE EXCEPTION 'Invalid status'; END IF;
  SELECT organization_id INTO _org FROM fiscal_periods WHERE id = _period_id;
  IF _org IS NULL THEN RAISE EXCEPTION 'Period not found'; END IF;
  PERFORM public.assert_finance_writer_for(_org);
  IF _status <> 'open' THEN
    SELECT count(*) INTO _open_items FROM period_close_checklist
     WHERE period_id = _period_id AND COALESCE(status, '') NOT IN ('done', 'completed', 'skipped', 'not_applicable');
    IF _open_items > 0 THEN
      RAISE EXCEPTION 'checklist_open: % close-checklist item(s) are still open for this month', _open_items USING ERRCODE = '55000';
    END IF;
  END IF;
  UPDATE fiscal_periods
     SET status = _status,
         closed_at = CASE WHEN _status = 'open' THEN NULL ELSE now() END,
         closed_by = CASE WHEN _status = 'open' THEN NULL ELSE auth.uid() END
   WHERE id = _period_id;
END $function$;


-- ---------------------------------------------------------------- cross-currency transfers

-- A transfer between a KES and a USD account had no exchange rate on the
-- foreign leg (unless a rate was loaded for that day), so it did not balance in
-- base currency and the balance sheet was off. Value each leg from the transfer.
CREATE OR REPLACE FUNCTION public.post_inter_account_transfer(_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  t record; _base text; _from_cur text; _to_cur text; _on date; _rf numeric; _rt numeric;
BEGIN
  SELECT * INTO t FROM public.inter_account_transfers WHERE id = _id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Transfer not found'; END IF;
  IF t.voided_at IS NOT NULL THEN RAISE EXCEPTION 'Transfer is voided'; END IF;
  IF EXISTS (SELECT 1 FROM public.accounting_transactions
              WHERE reference_type = 'inter_account_transfer' AND reference_id = _id) THEN RETURN; END IF;

  _on := COALESCE(t.transfer_date, now())::date;
  SELECT currency INTO _base FROM organizations WHERE id = t.organization_id;
  SELECT upper(COALESCE(currency, _base)) INTO _from_cur FROM financial_accounts WHERE id = t.from_account_id;
  SELECT upper(COALESCE(currency, _base)) INTO _to_cur FROM financial_accounts WHERE id = t.to_account_id;

  -- Base-currency rates for each leg. The inbound leg is valued at what left
  -- the source account, so the transfer always balances in base currency.
  _rf := CASE WHEN _from_cur = upper(_base) THEN 1
              ELSE COALESCE(public.get_fx_rate(t.organization_id, _from_cur, _base, _on),
                            CASE WHEN _to_cur = upper(_base) THEN NULLIF(t.fx_rate, 0) END) END;
  _rt := CASE WHEN _to_cur = upper(_base) THEN 1
              WHEN _rf IS NOT NULL AND COALESCE(t.fx_rate, 0) > 0 THEN _rf / t.fx_rate
              ELSE public.get_fx_rate(t.organization_id, _to_cur, _base, _on) END;

  -- Money out of the source account: amount + fee, in the source currency.
  INSERT INTO public.accounting_transactions
    (transaction_number, transaction_date, account_type, category, description, debit_amount, credit_amount,
     reference_type, reference_id, organization_id, financial_account_id, currency, fx_rate, base_currency)
  VALUES ('TRF-OUT-' || substr(_id::text, 1, 8), t.transfer_date, 'asset', 'cash',
     COALESCE(NULLIF(t.description, ''), 'Transfer ' || t.transfer_number) || ' (out)',
     0, t.amount + COALESCE(t.fees, 0), 'inter_account_transfer', _id, t.organization_id, t.from_account_id,
     _from_cur, _rf, _base);
  -- Money into the destination account, converted at the transfer rate.
  INSERT INTO public.accounting_transactions
    (transaction_number, transaction_date, account_type, category, description, debit_amount, credit_amount,
     reference_type, reference_id, organization_id, financial_account_id, currency, fx_rate, base_currency)
  VALUES ('TRF-IN-' || substr(_id::text, 1, 8), t.transfer_date, 'asset', 'cash',
     COALESCE(NULLIF(t.description, ''), 'Transfer ' || t.transfer_number) || ' (in)',
     round(t.amount * t.fx_rate, 2), 0, 'inter_account_transfer', _id, t.organization_id, t.to_account_id,
     _to_cur, _rt, _base);
  -- The fee is an expense; it is NOT tagged to the bank account (that cancelled it out of the balance).
  IF COALESCE(t.fees, 0) > 0 THEN
    INSERT INTO public.accounting_transactions
      (transaction_number, transaction_date, account_type, category, description, debit_amount, credit_amount,
       reference_type, reference_id, organization_id, currency, fx_rate, base_currency)
    VALUES ('TRF-FEE-' || substr(_id::text, 1, 8), t.transfer_date, 'expense', 'bank_charges',
       'Bank fee for transfer ' || t.transfer_number, t.fees, 0, 'inter_account_transfer', _id, t.organization_id,
       _from_cur, _rf, _base);
  END IF;
END $function$;

-- Transfers posted before the step-5 fix stamped both legs in the source
-- currency (a 7.70 USD receipt was booked as 7.70 KES). Re-stamp each leg with
-- its own account's currency and let the rate backfill below value it.
UPDATE accounting_transactions a
   SET currency = upper(fa.currency), fx_rate = NULL
  FROM financial_accounts fa
 WHERE a.reference_type IN ('inter_account_transfer', 'inter_account_transfer_void')
   AND a.financial_account_id = fa.id
   AND (a.transaction_number LIKE '%-IN-%' OR a.transaction_number LIKE '%-OUT-%')
   AND fa.currency IS NOT NULL
   AND upper(a.currency) <> upper(fa.currency);

-- Voids made before the fix reversed the two cash legs but not the bank fee.
INSERT INTO accounting_transactions
  (transaction_number, transaction_date, account_type, category, description, debit_amount, credit_amount,
   reference_type, reference_id, organization_id, financial_account_id, currency, fx_rate, base_currency, gl_account_id)
SELECT replace(f.transaction_number, 'TRF-', 'TRF-VOID-'), COALESCE(x.voided_at, now()), f.account_type, f.category,
       'Reversal of transfer fee ' || x.transfer_number, f.credit_amount, f.debit_amount,
       'inter_account_transfer_void', x.id, f.organization_id, f.financial_account_id, f.currency, f.fx_rate, f.base_currency, f.gl_account_id
  FROM accounting_transactions f
  JOIN inter_account_transfers x ON x.id = f.reference_id
 WHERE f.reference_type = 'inter_account_transfer'
   AND f.transaction_number LIKE 'TRF-FEE-%'
   AND x.voided_at IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM accounting_transactions v
                    WHERE v.reference_type = 'inter_account_transfer_void' AND v.reference_id = x.id
                      AND v.transaction_number LIKE 'TRF-VOID-FEE-%');

-- Backfill posted transfers (and their voids) whose foreign leg has no rate.
WITH legs AS (
  SELECT t.id, t.amount, t.fx_rate AS trf_rate, o.currency AS base,
         upper(COALESCE(fa_f.currency, o.currency)) AS from_cur, upper(COALESCE(fa_t.currency, o.currency)) AS to_cur
    FROM inter_account_transfers t
    JOIN organizations o ON o.id = t.organization_id
    LEFT JOIN financial_accounts fa_f ON fa_f.id = t.from_account_id
    LEFT JOIN financial_accounts fa_t ON fa_t.id = t.to_account_id
), rates AS (
  SELECT l.*,
         CASE WHEN l.from_cur = upper(l.base) THEN 1
              ELSE COALESCE((SELECT a.fx_rate FROM accounting_transactions a
                              WHERE a.reference_type = 'inter_account_transfer' AND a.reference_id = l.id
                                AND a.transaction_number LIKE 'TRF-OUT-%' AND a.fx_rate IS NOT NULL LIMIT 1),
                            CASE WHEN l.to_cur = upper(l.base) THEN NULLIF(l.trf_rate, 0) END) END AS rf
    FROM legs l
   WHERE l.from_cur <> l.to_cur
)
UPDATE accounting_transactions a
   SET fx_rate = CASE WHEN a.transaction_number LIKE '%-IN-%' THEN
                        CASE WHEN r.to_cur = upper(r.base) THEN 1 WHEN COALESCE(r.trf_rate, 0) > 0 THEN r.rf / r.trf_rate END
                      ELSE r.rf END
  FROM rates r
 WHERE a.reference_id = r.id
   AND a.reference_type IN ('inter_account_transfer', 'inter_account_transfer_void')
   AND a.fx_rate IS NULL
   AND upper(a.currency) <> upper(r.base)
   AND r.rf IS NOT NULL;
