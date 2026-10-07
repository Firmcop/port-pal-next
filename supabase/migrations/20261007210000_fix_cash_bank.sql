-- =====================================================================
-- Cash & Bank fixes (finance audit, step 4)
--
--  1. Transfers: both accounts must belong to the company and be active; the
--     fee leaves the bank balance; each leg posts in its account's currency;
--     voiding mirrors every line (fee included) and is limited to the
--     company's admins/accountants.
--  2. Bank reconciliation: only entries from the statement's own account,
--     an entry can't be cleared on two statements, a completed reconciliation
--     is locked, and only admins/accountants of the company can reconcile.
--     (Write access previously went to yard operators instead of accountants.)
--  3. Bank/cash opening balances are recorded in the ledger against
--     Retained Earnings, so the Trial Balance agrees with the bank screen.
--  4. Petty cash: the float balance tracks vouchers, a voucher can't exceed
--     the float, posted vouchers can't be edited in place, and deleting one
--     reverses it.
--  5. Cash-flow forecast works again (it filtered on statuses that don't
--     exist) and now uses outstanding receivables and supplier bills by due
--     date, converted to the company's base currency.
-- Uses helpers from 20261007200000_fix_payables_posting.sql.
-- =====================================================================

-- ---------------------------------------------------------------- write access

DROP POLICY IF EXISTS "Org staff insert transfers" ON public.inter_account_transfers;
DO $$
DECLARE p record;
BEGIN
  -- Replace the yard_operator write policies with admin/accountant ones.
  FOR p IN SELECT polname, c.relname FROM pg_policy pol JOIN pg_class c ON c.oid = pol.polrelid
            WHERE c.relname IN ('inter_account_transfers', 'bank_reconciliations', 'bank_reconciliation_lines')
              AND pol.polcmd IN ('a', 'w', '*')
  LOOP
    EXECUTE format('DROP POLICY %I ON public.%I', p.polname, p.relname);
  END LOOP;
END $$;

CREATE POLICY "Finance staff insert transfers" ON public.inter_account_transfers FOR INSERT
  WITH CHECK (organization_id = current_org_id() AND (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'accountant')));
CREATE POLICY "Finance staff update transfers" ON public.inter_account_transfers FOR UPDATE
  USING (is_platform_admin() OR (organization_id = current_org_id() AND (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'accountant'))));
CREATE POLICY "Finance staff manage reconciliations" ON public.bank_reconciliations FOR ALL
  USING (is_platform_admin() OR (organization_id = current_org_id() AND (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'accountant'))))
  WITH CHECK (organization_id = current_org_id() AND (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'accountant')));
CREATE POLICY "Finance staff manage reconciliation lines" ON public.bank_reconciliation_lines FOR ALL
  USING (is_platform_admin() OR (organization_id = current_org_id() AND (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'accountant'))))
  WITH CHECK (organization_id = current_org_id() AND (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'accountant')));

-- Same company + same role rule for SECURITY DEFINER functions acting on a record.
CREATE OR REPLACE FUNCTION public.assert_finance_writer_for(_org uuid)
RETURNS void
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  IF auth.uid() IS NULL OR public.is_platform_admin() THEN RETURN; END IF;
  IF _org IS DISTINCT FROM public.current_org_id() THEN
    RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002';
  END IF;
  PERFORM public.assert_finance_writer();
END $$;

-- ---------------------------------------------------------------- transfers

CREATE OR REPLACE FUNCTION public.trg_validate_inter_account_transfer()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE _bad int;
BEGIN
  SELECT count(*) INTO _bad FROM financial_accounts fa
   WHERE fa.id IN (NEW.from_account_id, NEW.to_account_id)
     AND fa.organization_id = NEW.organization_id AND fa.is_active;
  IF _bad <> 2 THEN
    RAISE EXCEPTION 'invalid_financial_account: both accounts must be active accounts of this company' USING ERRCODE = '22023';
  END IF;
  IF COALESCE(NEW.fx_rate, 0) <= 0 THEN NEW.fx_rate := 1; END IF;
  PERFORM public.assert_period_open(NEW.organization_id, COALESCE(NEW.transfer_date, now())::date);
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS a_trg_validate_inter_account_transfer ON public.inter_account_transfers;
CREATE TRIGGER a_trg_validate_inter_account_transfer
  BEFORE INSERT OR UPDATE OF from_account_id, to_account_id, amount, fx_rate, fees, transfer_date ON public.inter_account_transfers
  FOR EACH ROW EXECUTE FUNCTION public.trg_validate_inter_account_transfer();

CREATE OR REPLACE FUNCTION public.post_inter_account_transfer(_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  t record; _base text; _from_cur text; _to_cur text; _on date;
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

  -- Money out of the source account: amount + fee, in the source currency.
  INSERT INTO public.accounting_transactions
    (transaction_number, transaction_date, account_type, category, description, debit_amount, credit_amount,
     reference_type, reference_id, organization_id, financial_account_id, currency, fx_rate, base_currency)
  VALUES ('TRF-OUT-' || substr(_id::text, 1, 8), t.transfer_date, 'asset', 'cash',
     COALESCE(NULLIF(t.description, ''), 'Transfer ' || t.transfer_number) || ' (out)',
     0, t.amount + COALESCE(t.fees, 0), 'inter_account_transfer', _id, t.organization_id, t.from_account_id,
     _from_cur, public.get_fx_rate(t.organization_id, _from_cur, _base, _on), _base);
  -- Money into the destination account, converted at the transfer rate.
  INSERT INTO public.accounting_transactions
    (transaction_number, transaction_date, account_type, category, description, debit_amount, credit_amount,
     reference_type, reference_id, organization_id, financial_account_id, currency, fx_rate, base_currency)
  VALUES ('TRF-IN-' || substr(_id::text, 1, 8), t.transfer_date, 'asset', 'cash',
     COALESCE(NULLIF(t.description, ''), 'Transfer ' || t.transfer_number) || ' (in)',
     round(t.amount * t.fx_rate, 2), 0, 'inter_account_transfer', _id, t.organization_id, t.to_account_id,
     _to_cur, public.get_fx_rate(t.organization_id, _to_cur, _base, _on), _base);
  -- The fee is an expense; it is NOT tagged to the bank account (that cancelled it out of the balance).
  IF COALESCE(t.fees, 0) > 0 THEN
    INSERT INTO public.accounting_transactions
      (transaction_number, transaction_date, account_type, category, description, debit_amount, credit_amount,
       reference_type, reference_id, organization_id, currency, fx_rate, base_currency)
    VALUES ('TRF-FEE-' || substr(_id::text, 1, 8), t.transfer_date, 'expense', 'bank_charges',
       'Bank fee for transfer ' || t.transfer_number, t.fees, 0, 'inter_account_transfer', _id, t.organization_id,
       _from_cur, public.get_fx_rate(t.organization_id, _from_cur, _base, _on), _base);
  END IF;
END $function$;

CREATE OR REPLACE FUNCTION public.void_inter_account_transfer(_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE t record;
BEGIN
  SELECT * INTO t FROM public.inter_account_transfers WHERE id = _id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Transfer not found'; END IF;
  PERFORM public.assert_finance_writer_for(t.organization_id);
  IF t.voided_at IS NOT NULL THEN RAISE EXCEPTION 'Already voided'; END IF;
  PERFORM public.assert_period_open(t.organization_id, current_date);

  -- Mirror every posted line (out, in and fee) so the void nets to zero.
  INSERT INTO public.accounting_transactions
    (transaction_number, transaction_date, account_type, category, description, debit_amount, credit_amount,
     reference_type, reference_id, organization_id, financial_account_id, currency, fx_rate, base_currency, gl_account_id)
  SELECT replace(a.transaction_number, 'TRF-', 'TRF-VOID-'), now(), a.account_type, a.category,
         'Reversal of transfer ' || t.transfer_number, a.credit_amount, a.debit_amount,
         'inter_account_transfer_void', _id, a.organization_id, a.financial_account_id, a.currency, a.fx_rate, a.base_currency, a.gl_account_id
    FROM public.accounting_transactions a
   WHERE a.reference_type = 'inter_account_transfer' AND a.reference_id = _id;

  UPDATE public.inter_account_transfers SET voided_at = now(), voided_by = auth.uid() WHERE id = _id;
END $function$;

-- ---------------------------------------------------------------- reconciliation

CREATE OR REPLACE FUNCTION public.trg_validate_reconciliation_line()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE r record; tx record;
BEGIN
  SELECT * INTO r FROM bank_reconciliations WHERE id = COALESCE(NEW.reconciliation_id, OLD.reconciliation_id);
  IF r.status = 'completed' THEN
    RAISE EXCEPTION 'reconciliation_completed: this statement is already reconciled and locked' USING ERRCODE = '55000';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;

  SELECT id, organization_id, financial_account_id, cleared_at, reconciliation_id INTO tx
    FROM accounting_transactions WHERE id = NEW.transaction_id;
  IF tx.id IS NULL OR tx.organization_id <> r.organization_id THEN
    RAISE EXCEPTION 'invalid_transaction' USING ERRCODE = '22023';
  END IF;
  IF tx.financial_account_id IS DISTINCT FROM r.account_id THEN
    RAISE EXCEPTION 'wrong_account: this entry belongs to a different bank/cash account than the statement' USING ERRCODE = '22023';
  END IF;
  IF tx.cleared_at IS NOT NULL AND tx.reconciliation_id IS DISTINCT FROM r.id THEN
    RAISE EXCEPTION 'already_reconciled: this entry was cleared on another statement' USING ERRCODE = '22023';
  END IF;
  NEW.organization_id := r.organization_id;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_validate_reconciliation_line ON public.bank_reconciliation_lines;
CREATE TRIGGER trg_validate_reconciliation_line
  BEFORE INSERT OR UPDATE OR DELETE ON public.bank_reconciliation_lines
  FOR EACH ROW EXECUTE FUNCTION public.trg_validate_reconciliation_line();

CREATE OR REPLACE FUNCTION public.trg_lock_completed_reconciliation()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  IF OLD.status = 'completed' THEN
    RAISE EXCEPTION 'reconciliation_completed: this statement is already reconciled and locked' USING ERRCODE = '55000';
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;

DROP TRIGGER IF EXISTS trg_lock_completed_reconciliation ON public.bank_reconciliations;
CREATE TRIGGER trg_lock_completed_reconciliation
  BEFORE UPDATE OR DELETE ON public.bank_reconciliations
  FOR EACH ROW EXECUTE FUNCTION public.trg_lock_completed_reconciliation();

CREATE OR REPLACE FUNCTION public.complete_bank_reconciliation(_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_recon record; v_cleared_total numeric; v_diff numeric;
BEGIN
  SELECT * INTO v_recon FROM public.bank_reconciliations WHERE id = _id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Reconciliation not found'; END IF;
  PERFORM public.assert_finance_writer_for(v_recon.organization_id);
  IF v_recon.status = 'completed' THEN RAISE EXCEPTION 'Already completed'; END IF;

  SELECT COALESCE(SUM(at.debit_amount - at.credit_amount), 0) INTO v_cleared_total
    FROM public.bank_reconciliation_lines l
    JOIN public.accounting_transactions at ON at.id = l.transaction_id
   WHERE l.reconciliation_id = _id AND l.cleared AND NOT COALESCE(l.excluded, false)
     AND at.financial_account_id = v_recon.account_id;
  v_diff := (v_recon.statement_opening_balance + v_cleared_total) - v_recon.statement_closing_balance;
  IF abs(v_diff) > 0.01 THEN
    RAISE EXCEPTION 'Reconciliation not balanced. Difference: %', v_diff;
  END IF;

  UPDATE public.accounting_transactions at
     SET cleared_at = now(), reconciliation_id = _id
    FROM public.bank_reconciliation_lines l
   WHERE l.reconciliation_id = _id AND l.cleared AND NOT COALESCE(l.excluded, false) AND at.id = l.transaction_id;
  UPDATE public.bank_reconciliations
     SET status = 'completed', completed_at = now(), completed_by = auth.uid()
   WHERE id = _id;
END $function$;

-- The bulk/undo/resolve helpers granted rights to yard operators instead of accountants.
DO $$
DECLARE f text; def text;
BEGIN
  FOREACH f IN ARRAY ARRAY['bulk_clear_reconciliation_lines_v2', 'undo_bulk_clear', 'resolve_reconciliation_conflict'] LOOP
    SELECT pg_get_functiondef(p.oid) INTO def FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = f LIMIT 1;
    IF def IS NOT NULL AND position('''yard_operator''::app_role' IN def) > 0 THEN
      EXECUTE replace(def, '''yard_operator''::app_role', '''accountant''::app_role');
    END IF;
  END LOOP;
END $$;

-- ---------------------------------------------------------------- opening balances

CREATE OR REPLACE FUNCTION public.trg_financial_account_opening_balance()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE _posted numeric; _delta numeric; _cash uuid; _re uuid; _base text; _cur text;
BEGIN
  SELECT COALESCE(sum(debit_amount - credit_amount), 0) INTO _posted
    FROM accounting_transactions
   WHERE reference_type = 'opening_balance' AND reference_id = NEW.id AND category = 'cash';
  _delta := COALESCE(NEW.opening_balance, 0) - _posted;
  IF abs(_delta) < 0.005 THEN RETURN NULL; END IF;

  SELECT currency INTO _base FROM organizations WHERE id = NEW.organization_id;
  _cur := upper(COALESCE(NEW.currency, _base));
  SELECT id INTO _re FROM gl_accounts WHERE organization_id = NEW.organization_id AND code = '3100' LIMIT 1;

  -- The account card already includes opening_balance, so these lines carry no
  -- financial_account_id (that would count the opening twice on the bank screen).
  INSERT INTO accounting_transactions(transaction_number, transaction_date, account_type, category, description,
    debit_amount, credit_amount, reference_type, reference_id, organization_id, gl_account_id, currency, fx_rate, base_currency)
  VALUES ('OB-'||substr(NEW.id::text,1,8)||'-'||to_char(now(),'YYYYMMDDHH24MISS'),
          COALESCE(NEW.opening_balance_date::timestamptz, NEW.created_at, now()), 'asset', 'cash',
          'Opening balance — '||NEW.name, GREATEST(_delta, 0), GREATEST(-_delta, 0),
          'opening_balance', NEW.id, NEW.organization_id, NEW.gl_account_id, _cur,
          public.get_fx_rate(NEW.organization_id, _cur, _base, COALESCE(NEW.opening_balance_date, current_date)), _base);
  INSERT INTO accounting_transactions(transaction_number, transaction_date, account_type, category, description,
    debit_amount, credit_amount, reference_type, reference_id, organization_id, gl_account_id, currency, fx_rate, base_currency)
  VALUES ('OB-EQ-'||substr(NEW.id::text,1,8)||'-'||to_char(now(),'YYYYMMDDHH24MISS'),
          COALESCE(NEW.opening_balance_date::timestamptz, NEW.created_at, now()), 'equity', 'opening_balance_equity',
          'Opening balance — '||NEW.name, GREATEST(-_delta, 0), GREATEST(_delta, 0),
          'opening_balance', NEW.id, NEW.organization_id, _re, _cur,
          public.get_fx_rate(NEW.organization_id, _cur, _base, COALESCE(NEW.opening_balance_date, current_date)), _base);
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS trg_financial_account_opening_balance ON public.financial_accounts;
CREATE TRIGGER trg_financial_account_opening_balance
  AFTER INSERT OR UPDATE OF opening_balance ON public.financial_accounts
  FOR EACH ROW EXECUTE FUNCTION public.trg_financial_account_opening_balance();

-- ---------------------------------------------------------------- petty cash

CREATE OR REPLACE FUNCTION public.trg_petty_cash_voucher_guard()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE _f petty_cash_floats%ROWTYPE; _delta numeric;
BEGIN
  IF TG_OP = 'UPDATE'
     AND (NEW.amount, NEW.gl_account_id, NEW.voucher_date, NEW.float_id)
         IS DISTINCT FROM (OLD.amount, OLD.gl_account_id, OLD.voucher_date, OLD.float_id)
     AND EXISTS (SELECT 1 FROM accounting_transactions WHERE reference_type = 'petty_cash_voucher' AND reference_id = OLD.id) THEN
    RAISE EXCEPTION 'voucher_posted: delete this voucher and raise it again to change the amount, account, date or float'
      USING ERRCODE = '55000';
  END IF;
  IF TG_OP = 'INSERT' THEN
    SELECT * INTO _f FROM petty_cash_floats WHERE id = NEW.float_id FOR UPDATE;
    IF _f.status = 'closed' THEN RAISE EXCEPTION 'float_closed' USING ERRCODE = '22023'; END IF;
    _delta := COALESCE(NEW.amount, 0);
    IF _delta > COALESCE(_f.current_balance, 0) + 0.005 THEN
      RAISE EXCEPTION 'insufficient_float: voucher % exceeds float balance %', _delta, _f.current_balance USING ERRCODE = '22023';
    END IF;
    PERFORM public.assert_period_open(_f.organization_id, COALESCE(NEW.voucher_date, current_date));
    UPDATE petty_cash_floats SET current_balance = COALESCE(current_balance, 0) - _delta WHERE id = NEW.float_id;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS a_trg_petty_cash_voucher_guard ON public.petty_cash_vouchers;
CREATE TRIGGER a_trg_petty_cash_voucher_guard
  BEFORE INSERT OR UPDATE ON public.petty_cash_vouchers
  FOR EACH ROW EXECUTE FUNCTION public.trg_petty_cash_voucher_guard();

CREATE OR REPLACE FUNCTION public.trg_petty_cash_voucher_on_delete()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  PERFORM public.post_reversal_of('petty_cash_voucher', OLD.id, 'voucher '||OLD.voucher_number||' deleted');
  UPDATE petty_cash_floats SET current_balance = COALESCE(current_balance, 0) + COALESCE(OLD.amount, 0) WHERE id = OLD.float_id;
  RETURN OLD;
END $$;

DROP TRIGGER IF EXISTS trg_petty_cash_voucher_on_delete ON public.petty_cash_vouchers;
CREATE TRIGGER trg_petty_cash_voucher_on_delete
  AFTER DELETE ON public.petty_cash_vouchers
  FOR EACH ROW EXECUTE FUNCTION public.trg_petty_cash_voucher_on_delete();

-- ---------------------------------------------------------------- cash-flow forecast

CREATE OR REPLACE FUNCTION public.cashflow_forecast(_weeks integer DEFAULT 13)
RETURNS TABLE(week_start date, expected_in numeric, expected_out numeric, net numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE org uuid := current_org_id(); start_d date := date_trunc('week', current_date)::date; end_d date;
BEGIN
  end_d := start_d + (_weeks * 7) - 1;
  RETURN QUERY
  WITH weeks AS (
    SELECT (start_d + n * 7)::date AS ws FROM generate_series(0, _weeks - 1) n
  ),
  -- Outstanding customer invoices by due date (overdue ones are expected this week).
  ar AS (
    SELECT GREATEST(date_trunc('week', COALESCE(i.due_at, i.issued_at + interval '30 days'))::date, start_d) AS ws,
           sum(public.convert_to_base(
                 i.total_amount - COALESCE((SELECT sum(p.amount) FROM payments p WHERE p.invoice_id = i.id), 0),
                 i.currency, org, current_date)) AS amt
      FROM invoices i
     WHERE i.organization_id = org AND i.status IN ('sent', 'overdue') AND i.voided_at IS NULL
       AND COALESCE(i.due_at, i.issued_at + interval '30 days')::date <= end_d
     GROUP BY 1
  ),
  -- Outstanding supplier bills by due date.
  ap AS (
    SELECT GREATEST(date_trunc('week', COALESCE(b.due_date, b.issue_date + 30))::date, start_d) AS ws,
           sum(public.convert_to_base(b.total_amount - COALESCE(b.paid_amount, 0), b.currency, org, current_date)) AS amt
      FROM supplier_invoices b
     WHERE b.organization_id = org AND b.status IN ('issued', 'partially_paid')
       AND COALESCE(b.due_date, b.issue_date + 30) <= end_d
     GROUP BY 1
  )
  SELECT w.ws, round(COALESCE(ar.amt, 0), 2), round(COALESCE(ap.amt, 0), 2),
         round(COALESCE(ar.amt, 0) - COALESCE(ap.amt, 0), 2)
    FROM weeks w LEFT JOIN ar ON ar.ws = w.ws LEFT JOIN ap ON ap.ws = w.ws
   ORDER BY w.ws;
END $function$;
