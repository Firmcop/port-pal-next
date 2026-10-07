-- =====================================================================
-- Payables fixes (finance audit, step 3)
--
--  1. Goods receipts post to the ledger (the AFTER INSERT trigger fired before
--     the receipt lines existed, so nothing was ever posted). Input VAT from
--     the PO line is carried over, and receipts post in the PO currency.
--  2. Supplier bills entered without a PO post Dr expense / Dr input VAT /
--     Cr payables; cancelling a bill reverses it.
--  3. Supplier payments: only admins/accountants may pay; overpaying a PO is
--     blocked; a PO can be prepaid in full; foreign-currency payments convert
--     the bank leg at the entered rate; deleting a payment reverses its ledger
--     lines and reopens the PO; posted payments can't be edited in place.
--  4. Closed fiscal periods block payables postings.
--  5. Supplier bill numbers are unique per supplier, not per company.
--
-- Shared helpers (assert_finance_writer, assert_period_open,
-- post_reversal_of) are written so later finance fixes can reuse them.
-- =====================================================================

-- ---------------------------------------------------------------- helpers

CREATE OR REPLACE FUNCTION public.assert_finance_writer()
RETURNS void
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  -- Server-side jobs (cron, service role, migrations) run without a user.
  IF auth.uid() IS NULL OR public.is_platform_admin() THEN RETURN; END IF;
  IF public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'accountant') THEN RETURN; END IF;
  RAISE EXCEPTION 'not_authorized: only admins and accountants can do this'
    USING ERRCODE = '42501';
END $$;

CREATE OR REPLACE FUNCTION public.assert_period_open(_org uuid, _on date)
RETURNS void
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE _status text; _label text;
BEGIN
  SELECT status, to_char(start_date, 'Mon YYYY') INTO _status, _label
    FROM public.fiscal_periods
   WHERE organization_id = _org AND _on BETWEEN start_date AND end_date
   LIMIT 1;
  -- Companies that haven't set up fiscal periods yet are not blocked.
  IF _status IS NOT NULL AND _status <> 'open' THEN
    RAISE EXCEPTION 'period_closed: % is %; reopen it or use a date in an open period', _label, _status
      USING ERRCODE = '22023';
  END IF;
END $$;

-- Posts the mirror image of every ledger line for a document, dated _on.
-- Idempotent: does nothing if a reversal for this document already exists.
CREATE OR REPLACE FUNCTION public.post_reversal_of(_reference_type text, _reference_id uuid, _reason text, _on timestamptz DEFAULT now())
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE _n integer := 0; _org uuid;
BEGIN
  IF EXISTS (SELECT 1 FROM accounting_transactions
              WHERE reference_type = _reference_type || '_reversal' AND reference_id = _reference_id) THEN
    RETURN 0;
  END IF;
  SELECT organization_id INTO _org FROM accounting_transactions
   WHERE reference_type = _reference_type AND reference_id = _reference_id LIMIT 1;
  IF _org IS NULL THEN RETURN 0; END IF;
  PERFORM public.assert_period_open(_org, _on::date);

  INSERT INTO accounting_transactions(
    transaction_number, transaction_date, account_type, category, description,
    debit_amount, credit_amount, reference_type, reference_id, organization_id,
    currency, fx_rate, base_currency, financial_account_id, gl_account_id, project_id, depot_id, created_by)
  SELECT left(coalesce(t.transaction_number, 'TXN'), 60) || '-REV', _on, t.account_type, t.category,
         'Reversal — ' || coalesce(_reason, '') || ' — ' || coalesce(t.description, ''),
         t.credit_amount, t.debit_amount, _reference_type || '_reversal', _reference_id, t.organization_id,
         t.currency, t.fx_rate, t.base_currency, t.financial_account_id, t.gl_account_id, t.project_id, t.depot_id, auth.uid()
    FROM accounting_transactions t
   WHERE t.reference_type = _reference_type AND t.reference_id = _reference_id;
  GET DIAGNOSTICS _n = ROW_COUNT;
  RETURN _n;
END $$;

REVOKE ALL ON FUNCTION public.post_reversal_of(text, uuid, text, timestamptz) FROM PUBLIC, anon, authenticated;

-- Bank/cash legs of supplier payments stay in the bank account's currency.
CREATE OR REPLACE FUNCTION public.stamp_txn_currency_from_source()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE _cur text; _base text;
BEGIN
  IF NEW.reference_id IS NULL THEN RETURN NEW; END IF;

  IF NEW.reference_type = 'vendor_payment' AND NEW.financial_account_id IS NOT NULL THEN
    RETURN NEW;  -- set explicitly by post_vendor_payment_to_ledger
  END IF;

  IF NEW.reference_type IN ('supplier_invoices','supplier_invoice') THEN
    SELECT currency INTO _cur FROM public.supplier_invoices WHERE id = NEW.reference_id;
  ELSIF NEW.reference_type = 'invoice' THEN
    SELECT currency INTO _cur FROM public.invoices WHERE id = NEW.reference_id;
  ELSIF NEW.reference_type = 'container_sales' THEN
    SELECT currency INTO _cur FROM public.container_sales WHERE id = NEW.reference_id;
  ELSIF NEW.reference_type = 'vendor_payment' THEN
    SELECT currency INTO _cur FROM public.vendor_payments WHERE id = NEW.reference_id;
  END IF;

  IF _cur IS NULL OR btrim(_cur) = '' THEN RETURN NEW; END IF;
  NEW.currency := _cur;

  SELECT currency INTO _base FROM public.organizations WHERE id = NEW.organization_id;
  NEW.base_currency := COALESCE(NEW.base_currency, _base);
  IF NEW.fx_rate IS NULL AND _base IS NOT NULL THEN
    NEW.fx_rate := public.get_fx_rate(NEW.organization_id, _cur, _base, COALESCE(NEW.transaction_date::date, current_date));
  END IF;
  RETURN NEW;
END $function$;

-- ------------------------------------------------------- goods receipts

CREATE OR REPLACE FUNCTION public.post_goods_receipt_to_ledger(_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  _gr goods_receipts%ROWTYPE;
  _net numeric := 0;
  _tax numeric := 0;
  _curr text; _base text; _fx numeric; _on date;
BEGIN
  SELECT * INTO _gr FROM goods_receipts WHERE id = _id;
  IF NOT FOUND THEN RETURN; END IF;
  IF EXISTS (SELECT 1 FROM accounting_transactions WHERE reference_type = 'goods_receipt' AND reference_id = _id) THEN RETURN; END IF;

  -- A receipt line inherits the PO line's VAT treatment unless it was set explicitly.
  SELECT COALESCE(sum(round(gri.received_qty * COALESCE(pi.unit_price, 0), 2)), 0),
         COALESCE(sum(CASE WHEN (gri.is_vatable OR (COALESCE(gri.tax_rate, 0) = 0 AND pi.is_vatable))
                           THEN round(gri.received_qty * COALESCE(pi.unit_price, 0)
                                      * COALESCE(NULLIF(gri.tax_rate, 0), pi.tax_rate, 0) / 100.0, 2)
                           ELSE 0 END), 0)
    INTO _net, _tax
    FROM goods_receipt_items gri
    LEFT JOIN po_items pi ON pi.id = gri.po_item_id
   WHERE gri.receipt_id = _id;
  IF (_net + _tax) <= 0 THEN RETURN; END IF;

  _on := COALESCE(_gr.received_at, now())::date;
  PERFORM public.assert_period_open(_gr.organization_id, _on);

  SELECT currency INTO _base FROM organizations WHERE id = _gr.organization_id;
  SELECT COALESCE(NULLIF(btrim(po.currency), ''), _base) INTO _curr FROM purchase_orders po WHERE po.id = _gr.po_id;
  _curr := COALESCE(_curr, _base, 'USD');
  _fx := public.get_fx_rate(_gr.organization_id, _curr, _base, _on);

  INSERT INTO accounting_transactions(transaction_number, transaction_date, account_type, category, description,
    debit_amount, credit_amount, reference_type, reference_id, organization_id, currency, fx_rate, base_currency)
  VALUES ('INV-'||substring(_gr.id::text,1,8), COALESCE(_gr.received_at, now()),
    'asset', 'inventory', 'Inventory received — GR '||substring(_gr.id::text,1,8),
    _net, 0, 'goods_receipt', _gr.id, _gr.organization_id, _curr, _fx, _base);
  IF _tax > 0 THEN
    INSERT INTO accounting_transactions(transaction_number, transaction_date, account_type, category, description,
      debit_amount, credit_amount, reference_type, reference_id, organization_id, currency, fx_rate, base_currency)
    VALUES ('VAT-IN-'||substring(_gr.id::text,1,8), COALESCE(_gr.received_at, now()),
      'asset', 'input_tax', 'Input VAT — GR '||substring(_gr.id::text,1,8),
      _tax, 0, 'goods_receipt', _gr.id, _gr.organization_id, _curr, _fx, _base);
  END IF;
  INSERT INTO accounting_transactions(transaction_number, transaction_date, account_type, category, description,
    debit_amount, credit_amount, reference_type, reference_id, organization_id, currency, fx_rate, base_currency)
  VALUES ('AP-'||substring(_gr.id::text,1,8), COALESCE(_gr.received_at, now()),
    'liability', 'accounts_payable', 'AP — GR '||substring(_gr.id::text,1,8),
    0, _net + _tax, 'goods_receipt', _gr.id, _gr.organization_id, _curr, _fx, _base);
END $function$;

-- Post when the transaction commits, i.e. after receive_po_with_variances has
-- written the receipt lines (an ordinary AFTER INSERT trigger saw none).
DROP TRIGGER IF EXISTS trg_gr_autopost ON public.goods_receipts;
CREATE CONSTRAINT TRIGGER trg_gr_autopost
  AFTER INSERT ON public.goods_receipts
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION public.trg_gr_autopost();

-- ------------------------------------------------------- supplier bills

CREATE OR REPLACE FUNCTION public.post_supplier_bill_to_ledger(_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE _b supplier_invoices%ROWTYPE; _net numeric; _tax numeric; _sup text; _on date;
BEGIN
  SELECT * INTO _b FROM supplier_invoices WHERE id = _id;
  IF NOT FOUND THEN RETURN; END IF;
  -- PO bills are covered by the goods receipt; container bills post through their own functions.
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

  INSERT INTO accounting_transactions(transaction_number, transaction_date, account_type, category, description,
    debit_amount, credit_amount, reference_type, reference_id, organization_id)
  VALUES ('BILL-'||left(_b.invoice_number, 30)||'-'||substring(_b.id::text,1,8), _on, 'expense', 'other',
    'Supplier bill '||_b.invoice_number||COALESCE(' — '||_sup, ''), _net, 0, 'supplier_invoices', _b.id, _b.organization_id);
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

CREATE OR REPLACE FUNCTION public.trg_supplier_bill_autopost()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.status = 'cancelled' AND OLD.status IS DISTINCT FROM 'cancelled' THEN
    PERFORM public.post_reversal_of('supplier_invoices', NEW.id, 'bill '||NEW.invoice_number||' cancelled');
    RETURN NULL;
  END IF;
  PERFORM public.post_supplier_bill_to_ledger(NEW.id);
  RETURN NULL;
END $$;

-- Deferred, so functions that create a bill and post it themselves in the same
-- transaction (container acquisitions, bundled bills) are seen as already posted.
DROP TRIGGER IF EXISTS trg_supplier_bill_autopost ON public.supplier_invoices;
CREATE CONSTRAINT TRIGGER trg_supplier_bill_autopost
  AFTER INSERT OR UPDATE OF status ON public.supplier_invoices
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION public.trg_supplier_bill_autopost();

-- Bill numbers repeat across suppliers ("INV-001"); uniqueness is per supplier.
ALTER TABLE public.supplier_invoices DROP CONSTRAINT IF EXISTS supplier_invoices_organization_id_invoice_number_key;
ALTER TABLE public.supplier_invoices DROP CONSTRAINT IF EXISTS supplier_invoices_org_supplier_number_key;
ALTER TABLE public.supplier_invoices
  ADD CONSTRAINT supplier_invoices_org_supplier_number_key UNIQUE (organization_id, supplier_id, invoice_number);

-- ------------------------------------------------------- supplier payments

CREATE OR REPLACE FUNCTION public.record_vendor_payment(
  _po_id uuid, _amount numeric, _account_id uuid, _method payment_method, _reference text,
  _paid_at timestamp with time zone, _notes text, _currency text DEFAULT NULL, _fx_rate numeric DEFAULT NULL,
  _bank_charge numeric DEFAULT 0, _bank_charge_note text DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE _po purchase_orders%ROWTYPE; _pid uuid; _num text; _paid numeric; _cur text;
        _acct_cur text; _charge_expense uuid;
BEGIN
  PERFORM public.assert_finance_writer();
  IF _amount IS NULL OR _amount <= 0 THEN RAISE EXCEPTION 'invalid_amount'; END IF;
  IF _account_id IS NULL THEN RAISE EXCEPTION 'financial_account_required'; END IF;
  SELECT * INTO _po FROM purchase_orders WHERE id = _po_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'po_not_found'; END IF;
  IF _po.organization_id IS DISTINCT FROM public.current_org_id() AND NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'po_not_found';
  END IF;
  IF _po.status = 'cancelled' THEN RAISE EXCEPTION 'po_cancelled'; END IF;

  SELECT COALESCE(sum(amount), 0) INTO _paid FROM vendor_payments WHERE po_id = _po_id;
  IF COALESCE(_po.total_cost, 0) > 0 AND _paid + _amount > _po.total_cost + 0.01 THEN
    RAISE EXCEPTION 'overpayment_not_allowed: PO total %, already paid %, attempted %', _po.total_cost, _paid, _amount
      USING ERRCODE = '22023';
  END IF;

  _cur := NULLIF(btrim(COALESCE(_currency, _po.currency, '')), '');
  SELECT upper(currency) INTO _acct_cur FROM public.financial_accounts WHERE id = _account_id;
  IF _acct_cur IS NOT NULL AND _cur IS NOT NULL AND upper(_cur) <> _acct_cur
     AND COALESCE(_fx_rate, 0) <= 0 THEN
    RAISE EXCEPTION 'fx_rate_required';
  END IF;

  _num := 'VPAY-'||to_char(now(),'YYYYMMDD')||'-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,6));
  INSERT INTO public.vendor_payments(
    payment_number, po_id, supplier_id, amount, payment_method, reference_number,
    paid_at, notes, recorded_by, organization_id, financial_account_id, conversion_id,
    currency, fx_rate, bank_charge_amount
  ) VALUES (
    _num, _po_id, _po.supplier_id, _amount, _method, _reference, COALESCE(_paid_at, now()), _notes,
    auth.uid(), _po.organization_id, _account_id, _po.conversion_id,
    _cur, _fx_rate, COALESCE(_bank_charge, 0)
  )
  RETURNING id INTO _pid;

  IF COALESCE(_bank_charge, 0) > 0 THEN
    _charge_expense := public.post_bank_charge_expense(
      _account_id, _bank_charge, COALESCE(_paid_at, now())::date, _num,
      COALESCE(_bank_charge_note, 'Bank charges on supplier payment ' || _num), NULL, NULL, _po.supplier_id);
    UPDATE public.vendor_payments SET bank_charge_expense_id = _charge_expense WHERE id = _pid;
  END IF;

  -- Only a received PO moves to paid; a prepaid PO becomes paid when the goods arrive.
  IF _paid + _amount >= COALESCE(_po.total_cost, 0) AND COALESCE(_po.total_cost, 0) > 0 AND _po.status = 'received' THEN
    UPDATE purchase_orders SET status = 'paid' WHERE id = _po_id;
  END IF;
  RETURN _pid;
END;
$function$;

CREATE OR REPLACE FUNCTION public.trg_po_mark_paid_on_receipt()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE _paid numeric;
BEGIN
  IF NEW.status = 'received' AND OLD.status IS DISTINCT FROM 'received' AND COALESCE(NEW.total_cost, 0) > 0 THEN
    SELECT COALESCE(sum(amount), 0) INTO _paid FROM vendor_payments WHERE po_id = NEW.id;
    IF _paid >= NEW.total_cost - 0.01 THEN NEW.status := 'paid'; END IF;
  END IF;
  RETURN NEW;
END $$;

-- Named to run after trg_enforce_po_status_transition has validated the move to 'received'.
DROP TRIGGER IF EXISTS trg_zz_po_mark_paid_on_receipt ON public.purchase_orders;
CREATE TRIGGER trg_zz_po_mark_paid_on_receipt
  BEFORE UPDATE OF status ON public.purchase_orders
  FOR EACH ROW EXECUTE FUNCTION public.trg_po_mark_paid_on_receipt();

CREATE OR REPLACE FUNCTION public.post_vendor_payment_to_ledger(_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE _v vendor_payments%ROWTYPE; _base text; _pay_cur text; _acct_cur text;
        _pay_fx numeric; _bank_amount numeric; _bank_fx numeric; _on date;
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

  -- Payable leg: in the bill's currency. Bank leg: what actually left the account.
  IF _acct_cur = _pay_cur THEN
    _bank_amount := _v.amount;
  ELSE
    _bank_amount := round(_v.amount * _v.fx_rate, 2);   -- record_vendor_payment requires the rate
  END IF;
  _pay_fx := CASE WHEN _pay_cur = upper(_base) THEN 1
                  WHEN _acct_cur = upper(_base) AND COALESCE(_v.fx_rate, 0) > 0 THEN _v.fx_rate
                  ELSE public.get_fx_rate(_v.organization_id, _pay_cur, _base, _on) END;
  _bank_fx := public.get_fx_rate(_v.organization_id, _acct_cur, _base, _on);

  INSERT INTO accounting_transactions(transaction_number, transaction_date, account_type, category, description,
    debit_amount, credit_amount, reference_type, reference_id, organization_id, currency, fx_rate, base_currency)
  VALUES ('AP-'||substring(_v.payment_number from 1 for 30)||'-'||substring(_v.id::text,1,8),
    COALESCE(_v.paid_at, now()), 'liability', 'accounts_payable',
    'AP settlement — Vendor payment '||_v.payment_number, _v.amount, 0,
    'vendor_payment', _v.id, _v.organization_id, _pay_cur, _pay_fx, _base);
  INSERT INTO accounting_transactions(transaction_number, transaction_date, account_type, category, description,
    debit_amount, credit_amount, reference_type, reference_id, organization_id, currency, fx_rate, base_currency, financial_account_id)
  VALUES ('CASH-OUT-'||substring(_v.payment_number from 1 for 30)||'-'||substring(_v.id::text,1,8),
    COALESCE(_v.paid_at, now()), 'asset', 'cash',
    'Cash payment — Vendor payment '||_v.payment_number
      || CASE WHEN _acct_cur <> _pay_cur THEN ' ('||_pay_cur||' '||_v.amount||' @ '||_v.fx_rate||')' ELSE '' END,
    0, _bank_amount, 'vendor_payment', _v.id, _v.organization_id, _acct_cur, _bank_fx, _base, _v.financial_account_id);
END $function$;

-- Deleting a payment reverses it and reopens the PO.
CREATE OR REPLACE FUNCTION public.trg_vendor_payment_on_delete()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE _po purchase_orders%ROWTYPE; _paid numeric;
BEGIN
  PERFORM public.post_reversal_of('vendor_payment', OLD.id, 'payment '||OLD.payment_number||' deleted');
  IF OLD.po_id IS NOT NULL THEN
    SELECT * INTO _po FROM purchase_orders WHERE id = OLD.po_id;
    SELECT COALESCE(sum(amount), 0) INTO _paid FROM vendor_payments WHERE po_id = OLD.po_id AND id <> OLD.id;
    IF _po.status = 'paid' AND _paid < COALESCE(_po.total_cost, 0) - 0.01 THEN
      PERFORM set_config('app.po_status_admin_reset', 'on', true);
      PERFORM set_config('app.po_status_reset_reason', 'supplier payment '||OLD.payment_number||' deleted', true);
      UPDATE purchase_orders SET status = 'received' WHERE id = OLD.po_id;
      PERFORM set_config('app.po_status_admin_reset', 'off', true);
    END IF;
  END IF;
  RETURN OLD;
END $$;

DROP TRIGGER IF EXISTS trg_vendor_payment_on_delete ON public.vendor_payments;
CREATE TRIGGER trg_vendor_payment_on_delete
  AFTER DELETE ON public.vendor_payments
  FOR EACH ROW EXECUTE FUNCTION public.trg_vendor_payment_on_delete();

-- Posted payments are corrected by deleting and re-entering, never edited in place.
CREATE OR REPLACE FUNCTION public.trg_vendor_payment_lock_posted()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  IF (NEW.amount, NEW.currency, NEW.fx_rate, NEW.financial_account_id, NEW.paid_at, NEW.po_id)
     IS DISTINCT FROM (OLD.amount, OLD.currency, OLD.fx_rate, OLD.financial_account_id, OLD.paid_at, OLD.po_id)
     AND EXISTS (SELECT 1 FROM accounting_transactions WHERE reference_type = 'vendor_payment' AND reference_id = OLD.id) THEN
    RAISE EXCEPTION 'payment_posted: delete this payment and record it again to change its amount, currency, account or date'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_vendor_payment_lock_posted ON public.vendor_payments;
CREATE TRIGGER trg_vendor_payment_lock_posted
  BEFORE UPDATE ON public.vendor_payments
  FOR EACH ROW EXECUTE FUNCTION public.trg_vendor_payment_lock_posted();

-- ------------------------------------------------ PO bills include VAT
-- Auto-raised PO bills used landed_total (net of VAT), so a 11,600 PO produced a
-- 10,000 bill and payables/aging were understated by the VAT.
CREATE OR REPLACE FUNCTION public.ensure_supplier_invoice_for_po(_po_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _po public.purchase_orders%ROWTYPE; _inv_id uuid; _num text; _amt numeric; _tax numeric; _sub numeric;
BEGIN
  IF _po_id IS NULL THEN RETURN NULL; END IF;
  SELECT id INTO _inv_id FROM public.supplier_invoices WHERE purchase_order_id = _po_id LIMIT 1;
  IF _inv_id IS NOT NULL THEN RETURN _inv_id; END IF;

  SELECT * INTO _po FROM public.purchase_orders WHERE id = _po_id;
  IF NOT FOUND OR _po.supplier_id IS NULL THEN RETURN NULL; END IF;

  -- The bill must equal what is owed: the PO grand total (incl. VAT), which is also
  -- what supplier payments are checked against. landed_total excludes VAT.
  _amt := round(COALESCE(NULLIF(_po.total_cost,0), NULLIF(_po.landed_total,0) + COALESCE(_po.tax_total,0), 0), 2);
  IF _amt <= 0 THEN RETURN NULL; END IF;

  _tax := round(COALESCE(_po.tax_total,0), 2);
  IF _tax < 0 OR _tax >= _amt THEN _tax := 0; END IF;
  _sub := round(_amt - _tax, 2);

  _num := 'PINV-' || to_char(COALESCE(_po.order_date, current_date),'YYYYMMDD') || '-' || substr(replace(gen_random_uuid()::text,'-',''),1,6);

  INSERT INTO public.supplier_invoices (
    organization_id, invoice_number, supplier_id, purchase_order_id, reason, reference,
    issue_date, due_date, subtotal, tax_amount, total_amount, currency, status, notes
  ) VALUES (
    _po.organization_id, _num, _po.supplier_id, _po.id, 'purchase', _po.po_number,
    COALESCE(_po.order_date, current_date), COALESCE(_po.order_date, current_date) + INTERVAL '30 days',
    _sub, _tax, _amt, _po.currency, 'issued', 'Auto-generated from ' || _po.po_number
  ) RETURNING id INTO _inv_id;

  INSERT INTO public.supplier_invoice_lines (organization_id, invoice_id, description, quantity, unit_price, line_total)
  SELECT _po.organization_id, _inv_id, i.description, i.quantity, i.unit_price, i.total_cost
    FROM public.po_items i WHERE i.po_id = _po.id;

  RETURN _inv_id;
END $function$;
