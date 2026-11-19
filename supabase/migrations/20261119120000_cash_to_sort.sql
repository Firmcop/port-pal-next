-- =====================================================================
-- Cash to sort (19 Nov 2026) — gap analysis, phase 1.
-- Two holding accounts were filling up with money nobody had placed:
--   2150 Customer receipts on account — 143 M-Pesa receipts (KES 6.97M)
--        imported from statements but never matched to an invoice
--   1099 Bank suspense — 34 payments, expenses and wages (KES 1.27M)
--        recorded without saying which account paid them
-- This adds a worklist for the accountant:
--   * apply a receipt to an invoice -> a customer payment that clears the
--     receipt (Dr 2150 / Cr Receivables) instead of counting the cash twice
--   * or say what the money was (own transfer, director, loan, other
--     income, refund...) -> Dr 2150 / Cr that account
--   * for a suspense line, pick the account that paid -> Dr 1099 / Cr bank
-- Each line can be split across several actions; what is left stays listed.
-- Supplier payments and expenses can no longer be saved without an account.
-- =====================================================================

-- 1. a customer payment can clear a receipt already in the books
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS source_ledger_id uuid REFERENCES public.accounting_transactions(id) ON DELETE RESTRICT;
COMMENT ON COLUMN public.payments.source_ledger_id IS 'The imported bank/M-Pesa receipt (a 2150 ledger line) this payment applies. Posts Dr 2150 instead of Dr bank.';

CREATE TABLE IF NOT EXISTS public.cash_sort_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  ledger_line_id uuid NOT NULL REFERENCES public.accounting_transactions(id) ON DELETE RESTRICT,
  action text NOT NULL CHECK (action IN ('apply_invoice', 'reclass', 'pick_account')),
  amount numeric(14,2) NOT NULL CHECK (amount > 0),
  payment_id uuid REFERENCES public.payments(id) ON DELETE SET NULL,
  target_gl_code text,
  financial_account_id uuid,
  note text,
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  reversed_at timestamptz
);
CREATE INDEX IF NOT EXISTS cash_sort_actions_line_idx ON public.cash_sort_actions (ledger_line_id);
ALTER TABLE public.cash_sort_actions ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY cash_sort_actions_select ON public.cash_sort_actions FOR SELECT TO authenticated
    USING (organization_id = public.current_org_id() OR public.is_platform_admin());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
GRANT SELECT ON public.cash_sort_actions TO authenticated;
GRANT ALL ON public.cash_sort_actions TO service_role;

-- 2. payments that apply a receipt: no new approval (the money is already in), no new cash
DO $$
DECLARE _def text; _anchor text := 'BEGIN
  EXECUTE format(''SELECT ($1).%I, ($1).%I, ($1).%I'', ''created_by'',''organization_id'', amount_col)';
BEGIN
  SELECT pg_get_functiondef('public.flag_document_for_approval'::regproc) INTO _def;
  IF position('source_ledger_id' IN _def) = 0 THEN
    IF position(_anchor IN _def) = 0 THEN RAISE EXCEPTION 'flag_document_for_approval: anchor not found'; END IF;
    EXECUTE replace(_def, _anchor, 'BEGIN
  -- applying money already received (cash to sort) is not a new payment to approve
  IF (to_jsonb(NEW) ->> ''source_ledger_id'') IS NOT NULL THEN
    NEW.approval_status := ''not_required'';
    RETURN NEW;
  END IF;
  EXECUTE format(''SELECT ($1).%I, ($1).%I, ($1).%I'', ''created_by'',''organization_id'', amount_col)');
  END IF;
END $$;

DO $$
DECLARE _def text;
        _old text := 'jsonb_build_object(''category'', ''cash'', ''account_type'', ''asset'', ''amount'', _p.amount, ''currency'', _cur,
                         ''fx_rate'', _fx_pay, ''financial_account_id'', _p.financial_account_id),';
        _new text := 'CASE WHEN _p.source_ledger_id IS NOT NULL THEN
        jsonb_build_object(''category'', ''receipt_on_account'', ''account_type'', ''liability'', ''amount'', _p.amount, ''currency'', _cur,
                           ''fx_rate'', _fx_pay, ''gl_account_id'', (SELECT gl_account_id FROM accounting_transactions WHERE id = _p.source_ledger_id))
      ELSE
        jsonb_build_object(''category'', ''cash'', ''account_type'', ''asset'', ''amount'', _p.amount, ''currency'', _cur,
                           ''fx_rate'', _fx_pay, ''financial_account_id'', _p.financial_account_id) END,';
BEGIN
  SELECT pg_get_functiondef('public.sync_payment_ledger(uuid,uuid)'::regprocedure) INTO _def;
  IF position('receipt_on_account' IN _def) = 0 THEN
    IF position(_old IN _def) = 0 THEN RAISE EXCEPTION 'sync_payment_ledger: anchor not found'; END IF;
    EXECUTE replace(_def, _old, _new);
  END IF;
END $$;

-- 3. what is still to sort
CREATE OR REPLACE VIEW public.v_cash_to_sort WITH (security_invoker = on) AS
SELECT at.id AS ledger_line_id, at.organization_id, g.code AS holding_code,
       CASE g.code WHEN '2150' THEN 'receipt' ELSE 'missing_account' END AS kind,
       at.transaction_date::date AS on_date,
       at.credit_amount + at.debit_amount AS amount,
       (at.credit_amount + at.debit_amount)
         - COALESCE((SELECT sum(a.amount) FROM cash_sort_actions a WHERE a.ledger_line_id = at.id AND a.reversed_at IS NULL), 0) AS remaining,
       regexp_replace(at.description, '^\[review\] ', '') AS description,
       at.reference_type, at.reference_id, at.financial_account_id, at.currency,
       substring(at.description FROM '\(M-Pesa ([A-Z0-9]+)\)') AS mpesa_code
  FROM accounting_transactions at
  JOIN gl_accounts g ON g.id = at.gl_account_id
 WHERE (g.code = '2150' AND at.credit_amount > 0 AND at.reference_type = 'bank_statement_import')
    OR (g.code = '1099' AND at.credit_amount > 0);
GRANT SELECT ON public.v_cash_to_sort TO authenticated;

-- suggestions: customers whose name words appear in the receipt, with their open invoices
CREATE OR REPLACE FUNCTION public.cash_to_sort_suggestions(_ledger_line_id uuid)
RETURNS TABLE(customer_id uuid, customer_name text, invoice_id uuid, invoice_number text, balance numeric, score int)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  WITH l AS (SELECT upper(description) d, organization_id org, credit_amount amt FROM accounting_transactions WHERE id = _ledger_line_id),
  c AS (
    SELECT cu.id, cu.company_name,
           (SELECT count(*) FROM regexp_split_to_table(upper(regexp_replace(cu.company_name, '[^A-Za-z ]', ' ', 'g')), '\s+') w, l
             WHERE length(w) >= 3 AND w NOT IN ('LTD','LIMITED','MR','MRS','MADAM','THE','AND','KENYA','COMPANY','ENTERPRISES','ENT','CALL')
               AND l.d ~ ('\m' || w || '\M'))::int AS hits
      FROM customers cu, l WHERE cu.organization_id = l.org)
  SELECT c.id, c.company_name, i.id, i.invoice_number,
         round(i.total_amount - COALESCE((SELECT sum(p.amount) FROM payments p WHERE p.invoice_id = i.id AND p.reversed_at IS NULL
                                           AND COALESCE(p.approval_status::text, '') NOT IN ('pending', 'rejected')), 0), 2),
         c.hits * 10 + CASE WHEN abs(i.total_amount - (SELECT amt FROM l)) < 1 THEN 5 ELSE 0 END
    FROM c JOIN invoices i ON i.customer_id = c.id AND i.status::text IN ('sent', 'overdue')
   WHERE c.hits >= 1
   ORDER BY 6 DESC, i.issued_at
   LIMIT 8;
$$;
GRANT EXECUTE ON FUNCTION public.cash_to_sort_suggestions(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.cash_sort_remaining(_line uuid)
RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT (at.credit_amount + at.debit_amount)
         - COALESCE((SELECT sum(a.amount) FROM cash_sort_actions a WHERE a.ledger_line_id = at.id AND a.reversed_at IS NULL), 0)
    FROM accounting_transactions at WHERE at.id = _line;
$$;

-- the date a sorting entry goes on: the money's own date, or today if that month is closed
CREATE OR REPLACE FUNCTION public.cash_sort_post_date(_org uuid, _on timestamptz)
RETURNS timestamptz LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  PERFORM public.assert_period_open(_org, _on::date);
  RETURN _on;
EXCEPTION WHEN OTHERS THEN
  RETURN now();
END $$;

-- 4a. apply a receipt to an invoice
CREATE OR REPLACE FUNCTION public.cash_sort_apply_to_invoice(_ledger_line_id uuid, _invoice_id uuid, _amount numeric)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE l accounting_transactions%ROWTYPE; _code text; _inv invoices%ROWTYPE; _pay uuid; _fa uuid; _ref text;
BEGIN
  SELECT * INTO l FROM accounting_transactions WHERE id = _ledger_line_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Receipt not found'; END IF;
  PERFORM public.assert_finance_writer_for(l.organization_id);
  SELECT g.code INTO _code FROM gl_accounts g WHERE g.id = l.gl_account_id;
  IF _code <> '2150' THEN RAISE EXCEPTION 'Only receipts held on account can be applied to an invoice'; END IF;
  IF _amount IS NULL OR _amount <= 0 THEN RAISE EXCEPTION 'Enter the amount to apply'; END IF;
  IF _amount > public.cash_sort_remaining(_ledger_line_id) + 0.005 THEN
    RAISE EXCEPTION 'Only % of this receipt is left to apply', public.cash_sort_remaining(_ledger_line_id);
  END IF;
  SELECT * INTO _inv FROM invoices WHERE id = _invoice_id AND organization_id = l.organization_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Invoice not found'; END IF;
  IF upper(COALESCE(_inv.currency, l.currency)) <> upper(l.currency) THEN
    RAISE EXCEPTION 'Invoice % is in % but the receipt is in %', _inv.invoice_number, _inv.currency, l.currency;
  END IF;

  SELECT b.account_id INTO _fa FROM bank_statement_imports b WHERE b.id = l.reference_id;
  _fa := COALESCE(_fa, l.financial_account_id);
  _ref := COALESCE(substring(l.description FROM '\(M-Pesa ([A-Z0-9]+)\)'), l.transaction_number);

  INSERT INTO payments (payment_number, invoice_id, amount, payment_method, reference_number, paid_at, notes,
                        organization_id, financial_account_id, currency, recorded_by, created_by, source_ledger_id)
  VALUES ('RCPT-' || upper(substring(md5(_ledger_line_id::text || _invoice_id::text || clock_timestamp()::text), 1, 8)),
          _invoice_id, round(_amount, 2), 'other', _ref, public.cash_sort_post_date(l.organization_id, l.transaction_date),
          'Applied from receipt: ' || regexp_replace(l.description, '^\[review\] ', ''),
          l.organization_id, _fa, l.currency, auth.uid(), auth.uid(), _ledger_line_id)
  RETURNING id INTO _pay;

  INSERT INTO cash_sort_actions (organization_id, ledger_line_id, action, amount, payment_id, note)
  VALUES (l.organization_id, _ledger_line_id, 'apply_invoice', round(_amount, 2), _pay, 'Applied to ' || _inv.invoice_number);
  RETURN _pay;
END $$;

-- 4b. say what the money was / which account paid
CREATE OR REPLACE FUNCTION public.cash_sort_reclass(_ledger_line_id uuid, _amount numeric, _target_gl_code text,
                                                    _financial_account_id uuid DEFAULT NULL, _note text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE l accounting_transactions%ROWTYPE; _code text; _act uuid; _gl uuid; _tgt_type account_type; _hold_type account_type;
        _num text; _on timestamptz; _kind text;
BEGIN
  SELECT * INTO l FROM accounting_transactions WHERE id = _ledger_line_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Line not found'; END IF;
  PERFORM public.assert_finance_writer_for(l.organization_id);
  SELECT g.code, g.account_type INTO _code, _hold_type FROM gl_accounts g WHERE g.id = l.gl_account_id;
  IF _code NOT IN ('2150', '1099') THEN RAISE EXCEPTION 'This line is not waiting to be sorted'; END IF;
  IF _amount IS NULL OR _amount <= 0 THEN RAISE EXCEPTION 'Enter the amount'; END IF;
  IF _amount > public.cash_sort_remaining(_ledger_line_id) + 0.005 THEN
    RAISE EXCEPTION 'Only % of this line is left to sort', public.cash_sort_remaining(_ledger_line_id);
  END IF;
  IF NULLIF(btrim(COALESCE(_note, '')), '') IS NULL THEN RAISE EXCEPTION 'Say what the money was'; END IF;

  IF _financial_account_id IS NOT NULL THEN
    _gl := NULL; _tgt_type := 'asset'; _kind := 'pick_account';
  ELSE
    IF _target_gl_code IS NULL OR _target_gl_code IN ('2150', '1099', '1100', '2000', '2010') THEN
      RAISE EXCEPTION 'Pick an account (receivables and payables go through invoices and bills)';
    END IF;
    SELECT id, account_type INTO _gl, _tgt_type FROM gl_accounts WHERE organization_id = l.organization_id AND code = _target_gl_code;
    IF _gl IS NULL THEN RAISE EXCEPTION 'Account % not found', _target_gl_code; END IF;
    _kind := 'reclass';
  END IF;

  INSERT INTO cash_sort_actions (organization_id, ledger_line_id, action, amount, target_gl_code, financial_account_id, note)
  VALUES (l.organization_id, _ledger_line_id, _kind, round(_amount, 2), _target_gl_code, _financial_account_id, btrim(_note))
  RETURNING id INTO _act;

  _num := 'SORT-' || upper(substring(_act::text, 1, 8));
  _on := public.cash_sort_post_date(l.organization_id, l.transaction_date);   -- in the month the money moved
  -- clear the holding line (opposite side), then the real account
  INSERT INTO accounting_transactions (transaction_number, transaction_date, account_type, category, description,
    debit_amount, credit_amount, reference_type, reference_id, organization_id, gl_account_id, financial_account_id,
    currency, fx_rate, base_currency, depot_id, project_id)
  VALUES (_num || '-1', _on, _hold_type, 'cash_sort', 'Sorted: ' || btrim(_note) || ' — ' || left(regexp_replace(l.description, '^\[review\] ', ''), 120),
          CASE WHEN l.credit_amount > 0 THEN round(_amount, 2) ELSE 0 END, CASE WHEN l.debit_amount > 0 THEN round(_amount, 2) ELSE 0 END,
          'cash_sort', _act, l.organization_id, l.gl_account_id, NULL, l.currency, l.fx_rate, l.base_currency, l.depot_id, l.project_id),
         (_num || '-2', _on, _tgt_type, CASE WHEN _financial_account_id IS NOT NULL THEN 'cash' ELSE 'cash_sort' END,
          'Sorted: ' || btrim(_note) || ' — ' || left(regexp_replace(l.description, '^\[review\] ', ''), 120),
          CASE WHEN l.debit_amount > 0 THEN round(_amount, 2) ELSE 0 END, CASE WHEN l.credit_amount > 0 THEN round(_amount, 2) ELSE 0 END,
          'cash_sort', _act, l.organization_id, _gl, _financial_account_id, l.currency, l.fx_rate, l.base_currency, l.depot_id, l.project_id);
  RETURN _act;
END $$;

REVOKE ALL ON FUNCTION public.cash_sort_apply_to_invoice(uuid, uuid, numeric) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.cash_sort_reclass(uuid, numeric, text, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cash_sort_apply_to_invoice(uuid, uuid, numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cash_sort_reclass(uuid, numeric, text, uuid, text) TO authenticated;

-- 5. no more payments without an account
CREATE OR REPLACE FUNCTION public.require_payment_account()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  IF NEW.financial_account_id IS NULL THEN
    RAISE EXCEPTION 'financial_account_required'
      USING HINT = 'Select the bank, cash, or mobile-money account used for this payment.';
  END IF;
  RETURN NEW;
END $$;
CREATE OR REPLACE TRIGGER trg_require_payment_account BEFORE INSERT ON public.vendor_payments
  FOR EACH ROW EXECUTE FUNCTION public.require_payment_account();
