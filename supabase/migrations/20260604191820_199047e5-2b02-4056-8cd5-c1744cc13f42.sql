
-- =========================================================
-- A. New ledger-posting functions and triggers
-- =========================================================

-- Payslips
CREATE OR REPLACE FUNCTION public.post_payslip_to_ledger(_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _p payslips%ROWTYPE; _curr text;
BEGIN
  SELECT * INTO _p FROM payslips WHERE id=_id;
  IF NOT FOUND OR COALESCE(_p.gross_pay,0) <= 0 THEN RETURN; END IF;
  IF _p.status NOT IN ('approved','posted','paid') AND _p.approval_status <> 'approved' THEN RETURN; END IF;
  IF EXISTS (SELECT 1 FROM accounting_transactions WHERE reference_type='payslip' AND reference_id=_id) THEN RETURN; END IF;
  _curr := COALESCE((SELECT currency FROM organizations WHERE id=_p.organization_id),'USD');

  INSERT INTO accounting_transactions(transaction_number, transaction_date, account_type, category, description,
    debit_amount, credit_amount, reference_type, reference_id, organization_id, currency)
  VALUES ('PAY-DR-'||substring(_p.id::text,1,8), COALESCE(_p.posted_at, _p.pay_date, now()),
    'expense','payroll','Wages — '||COALESCE(_p.reference,_p.id::text), _p.gross_pay, 0,
    'payslip', _p.id, _p.organization_id, _curr);

  IF COALESCE(_p.total_deductions,0) > 0 THEN
    INSERT INTO accounting_transactions(transaction_number, transaction_date, account_type, category, description,
      debit_amount, credit_amount, reference_type, reference_id, organization_id, currency)
    VALUES ('PAY-DED-'||substring(_p.id::text,1,8), COALESCE(_p.posted_at,_p.pay_date,now()),
      'liability','payroll_deductions','Statutory deductions — '||COALESCE(_p.reference,_p.id::text),
      0, _p.total_deductions, 'payslip', _p.id, _p.organization_id, _curr);
  END IF;

  IF _p.paid_at IS NOT NULL AND _p.paid_from_account_id IS NOT NULL THEN
    INSERT INTO accounting_transactions(transaction_number, transaction_date, account_type, category, description,
      debit_amount, credit_amount, reference_type, reference_id, organization_id, financial_account_id, currency)
    VALUES ('PAY-CR-'||substring(_p.id::text,1,8), _p.paid_at, 'asset','cash',
      'Net pay disbursed — '||COALESCE(_p.reference,_p.id::text), 0, _p.net_pay,
      'payslip', _p.id, _p.organization_id, _p.paid_from_account_id, _curr);
  ELSE
    INSERT INTO accounting_transactions(transaction_number, transaction_date, account_type, category, description,
      debit_amount, credit_amount, reference_type, reference_id, organization_id, currency)
    VALUES ('PAY-NP-'||substring(_p.id::text,1,8), COALESCE(_p.posted_at,_p.pay_date,now()),
      'liability','net_pay_payable','Net pay payable — '||COALESCE(_p.reference,_p.id::text),
      0, _p.net_pay, 'payslip', _p.id, _p.organization_id, _curr);
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.trg_payslip_autopost() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN PERFORM public.post_payslip_to_ledger(NEW.id); RETURN NEW; END $$;

DROP TRIGGER IF EXISTS trg_payslip_autopost ON public.payslips;
CREATE TRIGGER trg_payslip_autopost AFTER INSERT OR UPDATE ON public.payslips
FOR EACH ROW EXECUTE FUNCTION public.trg_payslip_autopost();

-- Logistics trip costs
CREATE OR REPLACE FUNCTION public.post_trip_cost_to_ledger(_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _c logistics_trip_costs%ROWTYPE; _curr text;
BEGIN
  SELECT * INTO _c FROM logistics_trip_costs WHERE id=_id;
  IF NOT FOUND OR COALESCE(_c.amount,0) <= 0 THEN RETURN; END IF;
  IF EXISTS (SELECT 1 FROM accounting_transactions WHERE reference_type='trip_cost' AND reference_id=_id) THEN RETURN; END IF;
  _curr := COALESCE(_c.currency, (SELECT currency FROM organizations WHERE id=_c.organization_id),'USD');

  INSERT INTO accounting_transactions(transaction_number, transaction_date, account_type, category, description,
    debit_amount, credit_amount, reference_type, reference_id, organization_id, currency)
  VALUES ('TC-DR-'||substring(_c.id::text,1,8), COALESCE(_c.created_at,now()),
    'expense', COALESCE(_c.category::text,'logistics'),
    'Trip cost — '||COALESCE(_c.description,_c.category::text,'logistics'),
    _c.amount, 0, 'trip_cost', _c.id, _c.organization_id, _curr);

  INSERT INTO accounting_transactions(transaction_number, transaction_date, account_type, category, description,
    debit_amount, credit_amount, reference_type, reference_id, organization_id, currency)
  VALUES ('TC-CR-'||substring(_c.id::text,1,8), COALESCE(_c.created_at,now()),
    'liability','accounts_payable','Trip cost payable', 0, _c.amount,
    'trip_cost', _c.id, _c.organization_id, _curr);
END $$;

CREATE OR REPLACE FUNCTION public.trg_trip_cost_autopost() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN PERFORM public.post_trip_cost_to_ledger(NEW.id); RETURN NEW; END $$;

DROP TRIGGER IF EXISTS trg_trip_cost_autopost ON public.logistics_trip_costs;
CREATE TRIGGER trg_trip_cost_autopost AFTER INSERT OR UPDATE ON public.logistics_trip_costs
FOR EACH ROW EXECUTE FUNCTION public.trg_trip_cost_autopost();

-- Repatriation costs
CREATE OR REPLACE FUNCTION public.post_repatriation_cost_to_ledger(_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _c repatriation_costs%ROWTYPE; _curr text;
BEGIN
  SELECT * INTO _c FROM repatriation_costs WHERE id=_id;
  IF NOT FOUND OR COALESCE(_c.amount,0) <= 0 THEN RETURN; END IF;
  IF EXISTS (SELECT 1 FROM accounting_transactions WHERE reference_type='repatriation_cost' AND reference_id=_id) THEN RETURN; END IF;
  _curr := COALESCE((SELECT currency FROM organizations WHERE id=_c.organization_id),'USD');

  INSERT INTO accounting_transactions(transaction_number, transaction_date, account_type, category, description,
    debit_amount, credit_amount, reference_type, reference_id, organization_id, currency)
  VALUES ('RC-DR-'||substring(_c.id::text,1,8), COALESCE(_c.created_at,now()),
    'expense', COALESCE(_c.cost_type,'repatriation'),
    'Repatriation cost — '||COALESCE(_c.description,_c.cost_type,'repatriation'),
    _c.amount, 0, 'repatriation_cost', _c.id, _c.organization_id, _curr);

  INSERT INTO accounting_transactions(transaction_number, transaction_date, account_type, category, description,
    debit_amount, credit_amount, reference_type, reference_id, organization_id, currency)
  VALUES ('RC-CR-'||substring(_c.id::text,1,8), COALESCE(_c.created_at,now()),
    'liability','accounts_payable','Repatriation cost payable', 0, _c.amount,
    'repatriation_cost', _c.id, _c.organization_id, _curr);
END $$;

CREATE OR REPLACE FUNCTION public.trg_repatriation_cost_autopost() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN PERFORM public.post_repatriation_cost_to_ledger(NEW.id); RETURN NEW; END $$;

DROP TRIGGER IF EXISTS trg_repatriation_cost_autopost ON public.repatriation_costs;
CREATE TRIGGER trg_repatriation_cost_autopost AFTER INSERT OR UPDATE ON public.repatriation_costs
FOR EACH ROW EXECUTE FUNCTION public.trg_repatriation_cost_autopost();

-- Petty cash vouchers
CREATE OR REPLACE FUNCTION public.post_petty_cash_voucher_to_ledger(_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _v petty_cash_vouchers%ROWTYPE; _curr text; _fa uuid;
BEGIN
  SELECT * INTO _v FROM petty_cash_vouchers WHERE id=_id;
  IF NOT FOUND OR COALESCE(_v.amount,0) <= 0 THEN RETURN; END IF;
  IF EXISTS (SELECT 1 FROM accounting_transactions WHERE reference_type='petty_cash_voucher' AND reference_id=_id) THEN RETURN; END IF;
  _curr := COALESCE((SELECT currency FROM organizations WHERE id=_v.organization_id),'USD');
  SELECT account_id INTO _fa FROM petty_cash_floats WHERE id=_v.float_id;

  INSERT INTO accounting_transactions(transaction_number, transaction_date, account_type, category, description,
    debit_amount, credit_amount, reference_type, reference_id, organization_id, gl_account_id, currency)
  VALUES ('PV-DR-'||substring(_v.id::text,1,8), COALESCE(_v.voucher_date::timestamptz, _v.created_at, now()),
    'expense','petty_cash','Petty cash — '||COALESCE(_v.payee,_v.voucher_number),
    _v.amount, 0, 'petty_cash_voucher', _v.id, _v.organization_id, _v.gl_account_id, _curr);

  INSERT INTO accounting_transactions(transaction_number, transaction_date, account_type, category, description,
    debit_amount, credit_amount, reference_type, reference_id, organization_id, financial_account_id, currency)
  VALUES ('PV-CR-'||substring(_v.id::text,1,8), COALESCE(_v.voucher_date::timestamptz,_v.created_at,now()),
    'asset','cash','Petty cash float disbursement', 0, _v.amount,
    'petty_cash_voucher', _v.id, _v.organization_id, _fa, _curr);
END $$;

CREATE OR REPLACE FUNCTION public.trg_petty_cash_voucher_autopost() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN PERFORM public.post_petty_cash_voucher_to_ledger(NEW.id); RETURN NEW; END $$;

DROP TRIGGER IF EXISTS trg_petty_cash_voucher_autopost ON public.petty_cash_vouchers;
CREATE TRIGGER trg_petty_cash_voucher_autopost AFTER INSERT OR UPDATE ON public.petty_cash_vouchers
FOR EACH ROW EXECUTE FUNCTION public.trg_petty_cash_voucher_autopost();

-- Fixed asset depreciation runs
CREATE OR REPLACE FUNCTION public.post_depreciation_run_to_ledger(_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _r fixed_asset_depreciation_runs%ROWTYPE; _curr text;
BEGIN
  SELECT * INTO _r FROM fixed_asset_depreciation_runs WHERE id=_id;
  IF NOT FOUND OR COALESCE(_r.total_depreciation,0) <= 0 THEN RETURN; END IF;
  IF EXISTS (SELECT 1 FROM accounting_transactions WHERE reference_type='depreciation_run' AND reference_id=_id) THEN RETURN; END IF;
  _curr := COALESCE((SELECT currency FROM organizations WHERE id=_r.organization_id),'USD');

  INSERT INTO accounting_transactions(transaction_number, transaction_date, account_type, category, description,
    debit_amount, credit_amount, reference_type, reference_id, organization_id, currency)
  VALUES ('DEP-DR-'||substring(_r.id::text,1,8), COALESCE(_r.run_at,now()),
    'expense','depreciation','Depreciation run — '||_r.asset_count||' assets',
    _r.total_depreciation, 0, 'depreciation_run', _r.id, _r.organization_id, _curr);

  INSERT INTO accounting_transactions(transaction_number, transaction_date, account_type, category, description,
    debit_amount, credit_amount, reference_type, reference_id, organization_id, currency)
  VALUES ('DEP-CR-'||substring(_r.id::text,1,8), COALESCE(_r.run_at,now()),
    'asset','accumulated_depreciation','Accumulated depreciation',
    0, _r.total_depreciation, 'depreciation_run', _r.id, _r.organization_id, _curr);
END $$;

CREATE OR REPLACE FUNCTION public.trg_depreciation_run_autopost() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN PERFORM public.post_depreciation_run_to_ledger(NEW.id); RETURN NEW; END $$;

DROP TRIGGER IF EXISTS trg_depreciation_run_autopost ON public.fixed_asset_depreciation_runs;
CREATE TRIGGER trg_depreciation_run_autopost AFTER INSERT OR UPDATE ON public.fixed_asset_depreciation_runs
FOR EACH ROW EXECUTE FUNCTION public.trg_depreciation_run_autopost();

-- Withholding certificates (reduces AP, increases WHT payable)
CREATE OR REPLACE FUNCTION public.post_withholding_to_ledger(_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _w withholding_certificates%ROWTYPE; _curr text;
BEGIN
  SELECT * INTO _w FROM withholding_certificates WHERE id=_id;
  IF NOT FOUND OR COALESCE(_w.amount_withheld,0) <= 0 THEN RETURN; END IF;
  IF EXISTS (SELECT 1 FROM accounting_transactions WHERE reference_type='withholding_certificate' AND reference_id=_id) THEN RETURN; END IF;
  _curr := COALESCE((SELECT currency FROM organizations WHERE id=_w.organization_id),'USD');

  INSERT INTO accounting_transactions(transaction_number, transaction_date, account_type, category, description,
    debit_amount, credit_amount, reference_type, reference_id, organization_id, currency)
  VALUES ('WHT-DR-'||substring(_w.id::text,1,8), COALESCE(_w.certificate_date::timestamptz,_w.created_at,now()),
    'liability','accounts_payable','WHT deducted from supplier — '||COALESCE(_w.certificate_number,_w.id::text),
    _w.amount_withheld, 0, 'withholding_certificate', _w.id, _w.organization_id, _curr);

  INSERT INTO accounting_transactions(transaction_number, transaction_date, account_type, category, description,
    debit_amount, credit_amount, reference_type, reference_id, organization_id, currency)
  VALUES ('WHT-CR-'||substring(_w.id::text,1,8), COALESCE(_w.certificate_date::timestamptz,_w.created_at,now()),
    'liability','wht_payable','WHT payable to tax authority',
    0, _w.amount_withheld, 'withholding_certificate', _w.id, _w.organization_id, _curr);
END $$;

CREATE OR REPLACE FUNCTION public.trg_withholding_autopost() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN PERFORM public.post_withholding_to_ledger(NEW.id); RETURN NEW; END $$;

DROP TRIGGER IF EXISTS trg_withholding_autopost ON public.withholding_certificates;
CREATE TRIGGER trg_withholding_autopost AFTER INSERT OR UPDATE ON public.withholding_certificates
FOR EACH ROW EXECUTE FUNCTION public.trg_withholding_autopost();

-- Container sales — safety net when sold without invoice
CREATE OR REPLACE FUNCTION public.post_container_sale_to_ledger(_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _s container_sales%ROWTYPE; _curr text;
BEGIN
  SELECT * INTO _s FROM container_sales WHERE id=_id;
  IF NOT FOUND OR COALESCE(_s.selling_price,0) <= 0 THEN RETURN; END IF;
  IF _s.status::text <> 'sold' OR _s.invoice_id IS NOT NULL THEN RETURN; END IF;
  IF EXISTS (SELECT 1 FROM accounting_transactions WHERE reference_type='container_sale' AND reference_id=_id) THEN RETURN; END IF;
  _curr := COALESCE((SELECT currency FROM organizations WHERE id=_s.organization_id),'USD');

  INSERT INTO accounting_transactions(transaction_number, transaction_date, account_type, category, description,
    debit_amount, credit_amount, reference_type, reference_id, organization_id, currency)
  VALUES ('CS-AR-'||substring(_s.id::text,1,8), COALESCE(_s.sold_at,_s.created_at,now()),
    'asset','accounts_receivable','Container sale '||_s.sale_number,
    _s.selling_price, 0, 'container_sale', _s.id, _s.organization_id, _curr);

  INSERT INTO accounting_transactions(transaction_number, transaction_date, account_type, category, description,
    debit_amount, credit_amount, reference_type, reference_id, organization_id, currency)
  VALUES ('CS-REV-'||substring(_s.id::text,1,8), COALESCE(_s.sold_at,_s.created_at,now()),
    'revenue','container_sale','Container sale revenue '||_s.sale_number,
    0, _s.selling_price, 'container_sale', _s.id, _s.organization_id, _curr);

  IF COALESCE(_s.entry_price,0) > 0 THEN
    INSERT INTO accounting_transactions(transaction_number, transaction_date, account_type, category, description,
      debit_amount, credit_amount, reference_type, reference_id, organization_id, currency)
    VALUES ('CS-COGS-'||substring(_s.id::text,1,8), COALESCE(_s.sold_at,_s.created_at,now()),
      'cost_of_goods','container_cogs','COGS — '||_s.sale_number,
      _s.entry_price, 0, 'container_sale', _s.id, _s.organization_id, _curr);
    INSERT INTO accounting_transactions(transaction_number, transaction_date, account_type, category, description,
      debit_amount, credit_amount, reference_type, reference_id, organization_id, currency)
    VALUES ('CS-INV-'||substring(_s.id::text,1,8), COALESCE(_s.sold_at,_s.created_at,now()),
      'asset','inventory','Inventory relieved — '||_s.sale_number,
      0, _s.entry_price, 'container_sale', _s.id, _s.organization_id, _curr);
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.trg_container_sale_autopost() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN PERFORM public.post_container_sale_to_ledger(NEW.id); RETURN NEW; END $$;

DROP TRIGGER IF EXISTS trg_container_sale_autopost ON public.container_sales;
CREATE TRIGGER trg_container_sale_autopost AFTER INSERT OR UPDATE ON public.container_sales
FOR EACH ROW EXECUTE FUNCTION public.trg_container_sale_autopost();

-- =========================================================
-- B. Realtime publication + REPLICA IDENTITY FULL
-- =========================================================
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'invoices','vendor_payments','accounting_transactions','financial_accounts',
    'inter_account_transfers','expense_claims','purchase_orders','goods_receipts',
    'petty_cash_vouchers','payslips','payroll_runs','fixed_assets',
    'fixed_asset_depreciation_runs','bank_reconciliations','recurring_transfer_runs',
    'logistics_trip_costs','repatriation_costs','withholding_certificates','container_sales'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I REPLICA IDENTITY FULL', t);
    BEGIN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
    EXCEPTION WHEN duplicate_object THEN NULL; END;
  END LOOP;
END $$;

-- =========================================================
-- C. Idempotent backfill
-- =========================================================
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT id FROM payslips LOOP PERFORM public.post_payslip_to_ledger(r.id); END LOOP;
  FOR r IN SELECT id FROM logistics_trip_costs LOOP PERFORM public.post_trip_cost_to_ledger(r.id); END LOOP;
  FOR r IN SELECT id FROM repatriation_costs LOOP PERFORM public.post_repatriation_cost_to_ledger(r.id); END LOOP;
  FOR r IN SELECT id FROM petty_cash_vouchers LOOP PERFORM public.post_petty_cash_voucher_to_ledger(r.id); END LOOP;
  FOR r IN SELECT id FROM fixed_asset_depreciation_runs LOOP PERFORM public.post_depreciation_run_to_ledger(r.id); END LOOP;
  FOR r IN SELECT id FROM withholding_certificates LOOP PERFORM public.post_withholding_to_ledger(r.id); END LOOP;
  FOR r IN SELECT id FROM container_sales WHERE status::text='sold' AND invoice_id IS NULL LOOP
    PERFORM public.post_container_sale_to_ledger(r.id);
  END LOOP;
  FOR r IN SELECT reference_id FROM v_missing_postings WHERE reference_type='goods_receipt' LOOP
    PERFORM public.post_goods_receipt_to_ledger(r.reference_id);
  END LOOP;
END $$;
