-- =====================================================================
-- Finance fix 1 (audit of 6 Nov 2026): payables and bank accounts.
--
-- 1. Cancelled supplier bills: 23 bills cancelled in Aug–Sep 2026 still
--    carried KES 36.3M in payables (2010) and container stock (1200)
--    because their reversal never posted. The remaining amount on each
--    account is reversed now, on the cancellation date.
-- 2. Supplier payments settle the payables account their bills were
--    posted to: payments for container bills (2010) no longer clear 2000.
--    The 10 past USD payments (USD 44,800) are re-classified.
-- 3. Each bank, mobile-money and cash account gets its own ledger account
--    (under 1010 Bank Accounts / 1000 Cash on Hand); its lines move there
--    and new lines follow automatically.
-- Re-classifications change only the ledger account of a line, never an
-- amount; every change is recorded in the finance audit log.
-- Idempotent.
-- =====================================================================

-- 1. Reverse what cancelled bills still hold, account by account.
INSERT INTO public.accounting_transactions
  (transaction_number, transaction_date, account_type, category, description, debit_amount, credit_amount,
   reference_type, reference_id, organization_id, gl_account_id, currency, fx_rate, base_currency, depot_id, project_id)
SELECT 'CXLFIX-' || left(s.id::text, 8) || '-' || g.code || '-' || row_number() OVER (PARTITION BY s.id, g.code ORDER BY x.currency, x.fx_rate),
       s.updated_at::date, g.account_type, 'cancellation_reversal',
       'Reversal of cancelled bill ' || s.invoice_number || ' (posting missed at cancellation)',
       greatest(-x.net, 0), greatest(x.net, 0),
       'supplier_invoices_reversal', s.id, s.organization_id, g.id, x.currency, x.fx_rate, x.base_currency, NULL, NULL
  FROM public.supplier_invoices s
  JOIN LATERAL (
    SELECT a.gl_account_id, a.currency, a.fx_rate, a.base_currency, sum(a.debit_amount - a.credit_amount) AS net
      FROM public.accounting_transactions a
     WHERE a.reference_id = s.id AND a.reference_type IN ('supplier_invoices', 'supplier_invoices_reversal')
     GROUP BY 1, 2, 3, 4
    HAVING abs(sum(a.debit_amount - a.credit_amount)) > 0.005
  ) x ON true
  JOIN public.gl_accounts g ON g.id = x.gl_account_id
 WHERE s.status = 'cancelled'
   AND NOT EXISTS (SELECT 1 FROM public.accounting_transactions d
                    WHERE d.reference_id = s.id AND d.transaction_number LIKE 'CXLFIX-%');

-- 2a. New supplier payments settle the bill's own payables account.
CREATE OR REPLACE FUNCTION public.post_vendor_payment_to_ledger(_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _v vendor_payments%ROWTYPE; _base text; _pay_cur text; _acct_cur text;
        _pay_fx numeric; _bank_amount numeric; _bank_fx numeric; _on date;
        _owed numeric; _ap_part numeric; _adv_part numeric; _adv_gl uuid; _ap_gl uuid;
BEGIN
  SELECT * INTO _v FROM vendor_payments WHERE id = _id;
  IF NOT FOUND OR COALESCE(_v.amount, 0) <= 0 THEN RETURN; END IF;
  IF EXISTS (SELECT 1 FROM accounting_transactions WHERE reference_type = 'vendor_payment' AND reference_id = _id) THEN RETURN; END IF;

  _on := COALESCE(_v.paid_at, now())::date;
  PERFORM public.assert_period_open(_v.organization_id, _on);

  SELECT currency INTO _base FROM organizations WHERE id = _v.organization_id;
  _pay_cur := upper(COALESCE(NULLIF(btrim(_v.currency), ''), _base, 'USD'));
  SELECT upper(currency) INTO _acct_cur FROM financial_accounts WHERE id = _v.financial_account_id;
  _acct_cur := COALESCE(_acct_cur, _pay_cur);

  IF _acct_cur = _pay_cur THEN
    _bank_amount := _v.amount;
  ELSE
    _bank_amount := round(_v.amount * _v.fx_rate, 2);
  END IF;
  _pay_fx := CASE WHEN _pay_cur = upper(_base) THEN 1
                  WHEN _acct_cur = upper(_base) AND COALESCE(_v.fx_rate, 0) > 0 THEN _v.fx_rate
                  ELSE public.get_fx_rate(_v.organization_id, _pay_cur, _base, _on) END;
  _bank_fx := public.get_fx_rate(_v.organization_id, _acct_cur, _base, _on);

  -- Only what we owe on the PO settles payables; the rest is an advance.
  IF _v.po_id IS NOT NULL THEN
    _owed := greatest(public.po_payable_balance(_v.po_id), 0);
    _ap_part := least(_v.amount, _owed);
  ELSE
    _ap_part := _v.amount;
  END IF;
  _adv_part := _v.amount - _ap_part;
  _ap_gl := public.ensure_gl_account(_v.organization_id, '2000', 'Accounts Payable', 'liability', 'ap');
  -- A payment for container bills settles the account those bills were posted to (2010).
  IF EXISTS (SELECT 1 FROM vendor_payment_allocations x WHERE x.payment_id = _v.id)
     AND NOT EXISTS (
       SELECT 1 FROM vendor_payment_allocations x
        WHERE x.payment_id = _v.id
          AND NOT EXISTS (SELECT 1 FROM accounting_transactions a JOIN gl_accounts g ON g.id = a.gl_account_id
                           WHERE a.reference_type = 'supplier_invoices' AND a.reference_id = x.supplier_invoice_id
                             AND g.code = '2010' AND a.credit_amount > 0)) THEN
    _ap_gl := public.ensure_gl_account(_v.organization_id, '2010', 'Container Acquisition Payable', 'liability', 'container_ap');
  END IF;

  IF _ap_part > 0 THEN
    INSERT INTO accounting_transactions(transaction_number, transaction_date, account_type, category, description,
      debit_amount, credit_amount, reference_type, reference_id, organization_id, currency, fx_rate, base_currency, gl_account_id)
    VALUES ('AP-'||substring(_v.payment_number from 1 for 30)||'-'||substring(_v.id::text,1,8),
      COALESCE(_v.paid_at, now()), 'liability', 'accounts_payable',
      'AP settlement — Vendor payment '||_v.payment_number, _ap_part, 0,
      'vendor_payment', _v.id, _v.organization_id, _pay_cur, _pay_fx, _base, _ap_gl);
  END IF;
  IF _adv_part > 0 THEN
    _adv_gl := public.ensure_gl_account(_v.organization_id, '1300', 'Supplier Advances', 'asset', 'supplier_advances');
    INSERT INTO accounting_transactions(transaction_number, transaction_date, account_type, category, description,
      debit_amount, credit_amount, reference_type, reference_id, organization_id, currency, fx_rate, base_currency, gl_account_id)
    VALUES ('ADV-'||substring(_v.payment_number from 1 for 30)||'-'||substring(_v.id::text,1,8),
      COALESCE(_v.paid_at, now()), 'asset', 'supplier_advances',
      'Advance to supplier — Vendor payment '||_v.payment_number, _adv_part, 0,
      'vendor_payment', _v.id, _v.organization_id, _pay_cur, _pay_fx, _base, _adv_gl);
  END IF;
  INSERT INTO accounting_transactions(transaction_number, transaction_date, account_type, category, description,
    debit_amount, credit_amount, reference_type, reference_id, organization_id, currency, fx_rate, base_currency, financial_account_id)
  VALUES ('CASH-OUT-'||substring(_v.payment_number from 1 for 30)||'-'||substring(_v.id::text,1,8),
    COALESCE(_v.paid_at, now()), 'asset', 'cash',
    'Cash payment — Vendor payment '||_v.payment_number
      || CASE WHEN _acct_cur <> _pay_cur THEN ' ('||_pay_cur||' '||_v.amount||' @ '||_v.fx_rate||')' ELSE '' END,
    0, _bank_amount, 'vendor_payment', _v.id, _v.organization_id, _acct_cur, _bank_fx, _base, _v.financial_account_id);
END $function$;

-- 2b. Past payments whose every allocation is a container bill: AP line 2000 -> 2010.
UPDATE public.accounting_transactions a
   SET gl_account_id = g2010.id
  FROM public.gl_accounts g2000, public.gl_accounts g2010
 WHERE a.reference_type = 'vendor_payment' AND a.category = 'accounts_payable'
   AND g2000.id = a.gl_account_id AND g2000.code = '2000'
   AND g2010.organization_id = a.organization_id AND g2010.code = '2010'
   AND EXISTS (SELECT 1 FROM public.vendor_payment_allocations x WHERE x.payment_id = a.reference_id)
   AND NOT EXISTS (
     SELECT 1 FROM public.vendor_payment_allocations x
      WHERE x.payment_id = a.reference_id
        AND NOT EXISTS (SELECT 1 FROM public.accounting_transactions b JOIN public.gl_accounts g ON g.id = b.gl_account_id
                         WHERE b.reference_type = 'supplier_invoices' AND b.reference_id = x.supplier_invoice_id
                           AND g.code = '2010' AND b.credit_amount > 0));

-- 3a. A ledger account for every bank, mobile-money and cash account.
CREATE OR REPLACE FUNCTION public.ensure_financial_account_gl(_fa uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
DECLARE _f financial_accounts%ROWTYPE; _parent_code text; _parent uuid; _code text; _id uuid; _i int;
BEGIN
  SELECT * INTO _f FROM financial_accounts WHERE id = _fa;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF _f.gl_account_id IS NOT NULL THEN RETURN _f.gl_account_id; END IF;
  _parent_code := CASE WHEN _f.account_type::text = 'cash' THEN '1000' ELSE '1010' END;
  _parent := public.ensure_gl_account(_f.organization_id, _parent_code,
               CASE _parent_code WHEN '1000' THEN 'Cash on Hand' ELSE 'Bank Accounts' END, 'asset', NULL);
  FOR _i IN 1..9 LOOP
    _code := left(_parent_code, 3) || _i::text;
    IF NOT EXISTS (SELECT 1 FROM gl_accounts WHERE organization_id = _f.organization_id AND code = _code) THEN
      INSERT INTO gl_accounts(organization_id, code, name, account_type, parent_id, currency, description)
      VALUES (_f.organization_id, _code, _f.name, 'asset', _parent, _f.currency, 'Ledger account for ' || _f.name)
      RETURNING id INTO _id;
      EXIT;
    END IF;
  END LOOP;
  _id := COALESCE(_id, _parent);   -- all nine codes taken: use the parent account
  UPDATE financial_accounts SET gl_account_id = _id WHERE id = _fa;
  RETURN _id;
END $$;
REVOKE ALL ON FUNCTION public.ensure_financial_account_gl(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.trg_financial_account_gl()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.gl_account_id IS NULL THEN PERFORM public.ensure_financial_account_gl(NEW.id); END IF;
  RETURN NULL;
END $$;
CREATE OR REPLACE TRIGGER trg_financial_account_gl AFTER INSERT ON public.financial_accounts
  FOR EACH ROW EXECUTE FUNCTION public.trg_financial_account_gl();

SELECT public.ensure_financial_account_gl(id) FROM public.financial_accounts WHERE gl_account_id IS NULL;

-- 3b. Bank-side lines post to their bank's ledger account (runs after the category mapping).
CREATE OR REPLACE FUNCTION public.trg_set_gl_bank_account()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $$
DECLARE _bank uuid;
BEGIN
  IF NEW.financial_account_id IS NULL THEN RETURN NEW; END IF;
  SELECT gl_account_id INTO _bank FROM financial_accounts WHERE id = NEW.financial_account_id;
  IF _bank IS NULL THEN RETURN NEW; END IF;
  IF NEW.gl_account_id IS NULL OR EXISTS (SELECT 1 FROM gl_accounts g WHERE g.id = NEW.gl_account_id AND g.code IN ('1000', '1010')) THEN
    NEW.gl_account_id := _bank;
  END IF;
  RETURN NEW;
END $$;
CREATE OR REPLACE TRIGGER trg_set_gl_bank_account BEFORE INSERT ON public.accounting_transactions
  FOR EACH ROW EXECUTE FUNCTION public.trg_set_gl_bank_account();

-- 3c. Past bank-side lines move from the generic accounts to their bank's account.
UPDATE public.accounting_transactions a
   SET gl_account_id = f.gl_account_id
  FROM public.financial_accounts f, public.gl_accounts g
 WHERE f.id = a.financial_account_id AND f.gl_account_id IS NOT NULL
   AND g.id = a.gl_account_id AND g.code IN ('1000', '1010')
   AND a.gl_account_id <> f.gl_account_id;
