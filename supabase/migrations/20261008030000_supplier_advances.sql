-- =====================================================================
-- Supplier advances (prepayments)
--
-- A supplier payment made before the goods are received used to be debited
-- to accounts payable, so payables went negative until the goods arrived.
-- Now the part of a payment that exceeds what we owe on that PO goes to
-- 1300 Supplier Advances (an asset). When the goods receipt posts the
-- payable, the advance is applied against it automatically
-- (Dr Accounts Payable / Cr Supplier Advances).
-- =====================================================================

-- What we currently owe the supplier on one PO (in the PO's currency).
CREATE OR REPLACE FUNCTION public.po_payable_balance(_po_id uuid)
RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT COALESCE(sum(a.credit_amount - a.debit_amount), 0)
    FROM accounting_transactions a
   WHERE a.category = 'accounts_payable'
     AND (   (a.reference_type IN ('goods_receipt', 'goods_receipt_reversal')
              AND a.reference_id IN (SELECT id FROM goods_receipts WHERE po_id = _po_id))
          OR (a.reference_type IN ('vendor_payment', 'vendor_payment_reversal')
              AND a.reference_id IN (SELECT id FROM vendor_payments WHERE po_id = _po_id))
          OR (a.reference_type = 'supplier_advance_application' AND a.reference_id = _po_id))
$$;

-- Advances paid on one PO that have not yet been set against a payable.
CREATE OR REPLACE FUNCTION public.po_advance_balance(_po_id uuid)
RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT COALESCE(sum(a.debit_amount - a.credit_amount), 0)
    FROM accounting_transactions a
   WHERE a.category = 'supplier_advances'
     AND (   (a.reference_type IN ('vendor_payment', 'vendor_payment_reversal')
              AND a.reference_id IN (SELECT id FROM vendor_payments WHERE po_id = _po_id))
          OR (a.reference_type = 'supplier_advance_application' AND a.reference_id = _po_id))
$$;

CREATE OR REPLACE FUNCTION public.post_vendor_payment_to_ledger(_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
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

-- Set advances against the payable once goods are received.
CREATE OR REPLACE FUNCTION public.apply_supplier_advances(_po_id uuid)
RETURNS numeric
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE _po record; _amt numeric; _base text; _fx numeric; _cur text; _n int;
BEGIN
  SELECT id, organization_id, po_number INTO _po FROM purchase_orders WHERE id = _po_id;
  IF NOT FOUND THEN RETURN 0; END IF;
  _amt := round(least(greatest(public.po_advance_balance(_po_id), 0), greatest(public.po_payable_balance(_po_id), 0)), 2);
  IF _amt <= 0 THEN RETURN 0; END IF;

  SELECT currency INTO _base FROM organizations WHERE id = _po.organization_id;
  -- the advance is released at the rate it was paid at
  SELECT a.currency, a.fx_rate INTO _cur, _fx FROM accounting_transactions a
   WHERE a.category = 'supplier_advances' AND a.reference_type = 'vendor_payment'
     AND a.reference_id IN (SELECT id FROM vendor_payments WHERE po_id = _po_id)
   ORDER BY a.created_at LIMIT 1;
  SELECT count(*) + 1 INTO _n FROM accounting_transactions
   WHERE reference_type = 'supplier_advance_application' AND reference_id = _po_id;

  INSERT INTO accounting_transactions(transaction_number, transaction_date, account_type, category, description,
    debit_amount, credit_amount, reference_type, reference_id, organization_id, currency, fx_rate, base_currency, gl_account_id)
  VALUES
    ('ADV-APPLY-' || _po.po_number || '-' || _n, now(), 'liability', 'accounts_payable',
     'Advance applied to ' || _po.po_number, _amt, 0, 'supplier_advance_application', _po_id, _po.organization_id,
     _cur, _fx, _base, public.ensure_gl_account(_po.organization_id, '2000', 'Accounts Payable', 'liability', 'ap')),
    ('ADV-APPLY-' || _po.po_number || '-' || (_n + 1), now(), 'asset', 'supplier_advances',
     'Advance applied to ' || _po.po_number, 0, _amt, 'supplier_advance_application', _po_id, _po.organization_id,
     _cur, _fx, _base, public.ensure_gl_account(_po.organization_id, '1300', 'Supplier Advances', 'asset', 'supplier_advances'));
  RETURN _amt;
END $$;

CREATE OR REPLACE FUNCTION public.trg_gr_apply_advances()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.po_id IS NOT NULL THEN PERFORM public.apply_supplier_advances(NEW.po_id); END IF;
  RETURN NEW;
END $$;

-- Deferred like trg_gr_autopost and named to run after it, once the payable is posted.
DROP TRIGGER IF EXISTS trg_gr_zz_apply_advances ON public.goods_receipts;
CREATE CONSTRAINT TRIGGER trg_gr_zz_apply_advances AFTER INSERT ON public.goods_receipts
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.trg_gr_apply_advances();

-- Supplier balances: show unapplied advances on the PO list / statements.
CREATE OR REPLACE VIEW public.v_supplier_advances WITH (security_invoker = on) AS
SELECT po.id AS po_id, po.organization_id, po.po_number, po.supplier_id,
       public.po_advance_balance(po.id) AS advance_balance,
       public.po_payable_balance(po.id) AS payable_balance
  FROM purchase_orders po
 WHERE public.po_advance_balance(po.id) <> 0;
GRANT SELECT ON public.v_supplier_advances TO authenticated;
