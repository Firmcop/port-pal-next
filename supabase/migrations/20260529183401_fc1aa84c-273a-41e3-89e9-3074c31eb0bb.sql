
-- ============================================================
-- PART 1: VAT on purchases
-- ============================================================

ALTER TABLE public.materials
  ADD COLUMN IF NOT EXISTS is_vatable boolean NOT NULL DEFAULT false;

ALTER TABLE public.po_items
  ADD COLUMN IF NOT EXISTS is_vatable boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS tax_code_id uuid REFERENCES public.tax_codes(id),
  ADD COLUMN IF NOT EXISTS tax_rate numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS tax_amount numeric NOT NULL DEFAULT 0;

ALTER TABLE public.purchase_orders
  ADD COLUMN IF NOT EXISTS subtotal numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS tax_total numeric NOT NULL DEFAULT 0;

ALTER TABLE public.goods_receipt_items
  ADD COLUMN IF NOT EXISTS is_vatable boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS tax_rate numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS tax_amount numeric NOT NULL DEFAULT 0;

-- Recompute po_item tax_amount and rollup to purchase_orders
CREATE OR REPLACE FUNCTION public.po_item_compute_tax()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _rate numeric;
BEGIN
  IF NEW.is_vatable THEN
    _rate := NEW.tax_rate;
    IF _rate IS NULL OR _rate = 0 THEN
      IF NEW.tax_code_id IS NOT NULL THEN
        SELECT rate INTO _rate FROM public.tax_codes WHERE id = NEW.tax_code_id;
      END IF;
      IF (_rate IS NULL OR _rate = 0) THEN
        SELECT tc.rate INTO _rate
          FROM public.purchase_orders po
          LEFT JOIN public.tax_codes tc ON tc.id = po.tax_code_id
         WHERE po.id = NEW.po_id;
      END IF;
    END IF;
    NEW.tax_rate := COALESCE(_rate, 0);
    NEW.tax_amount := round(COALESCE(NEW.quantity,0) * COALESCE(NEW.unit_price,0) * NEW.tax_rate / 100.0, 2);
  ELSE
    NEW.tax_rate := 0;
    NEW.tax_amount := 0;
  END IF;
  NEW.total_cost := round(COALESCE(NEW.quantity,0) * COALESCE(NEW.unit_price,0), 2) + NEW.tax_amount;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_po_item_compute_tax ON public.po_items;
CREATE TRIGGER trg_po_item_compute_tax
  BEFORE INSERT OR UPDATE ON public.po_items
  FOR EACH ROW EXECUTE FUNCTION public.po_item_compute_tax();

CREATE OR REPLACE FUNCTION public.po_recompute_totals()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _po_id uuid;
BEGIN
  _po_id := COALESCE(NEW.po_id, OLD.po_id);
  UPDATE public.purchase_orders po
     SET subtotal = COALESCE((SELECT sum(round(quantity*unit_price,2)) FROM public.po_items WHERE po_id=_po_id),0),
         tax_total = COALESCE((SELECT sum(tax_amount) FROM public.po_items WHERE po_id=_po_id),0),
         total_cost = COALESCE((SELECT sum(round(quantity*unit_price,2)+tax_amount) FROM public.po_items WHERE po_id=_po_id),0)
   WHERE po.id = _po_id;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS trg_po_recompute_totals ON public.po_items;
CREATE TRIGGER trg_po_recompute_totals
  AFTER INSERT OR UPDATE OR DELETE ON public.po_items
  FOR EACH ROW EXECUTE FUNCTION public.po_recompute_totals();

-- Backfill totals for existing POs
UPDATE public.purchase_orders po
   SET subtotal = COALESCE((SELECT sum(round(quantity*unit_price,2)) FROM public.po_items WHERE po_id=po.id),0),
       tax_total = COALESCE((SELECT sum(tax_amount) FROM public.po_items WHERE po_id=po.id),0);

-- VAT summary view
CREATE OR REPLACE VIEW public.v_purchase_vat_summary
WITH (security_invoker=on) AS
SELECT
  po.organization_id,
  po.id AS purchase_order_id,
  po.po_number,
  po.supplier_id,
  po.order_date,
  date_trunc('month', po.order_date)::date AS period,
  COALESCE(po.subtotal,0) AS subtotal,
  COALESCE(po.tax_total,0) AS tax_total,
  COALESCE(po.total_cost,0) AS grand_total,
  (SELECT count(*) FROM public.po_items i WHERE i.po_id=po.id AND i.is_vatable) AS vatable_lines,
  (SELECT count(*) FROM public.po_items i WHERE i.po_id=po.id AND NOT i.is_vatable) AS non_vatable_lines
FROM public.purchase_orders po;

GRANT SELECT ON public.v_purchase_vat_summary TO authenticated;

-- Extend finance dashboard with input VAT this month
DROP VIEW IF EXISTS public.finance_dashboard_metrics CASCADE;
CREATE VIEW public.finance_dashboard_metrics AS
 WITH cash AS (
         SELECT fa.organization_id, fa.currency,
            COALESCE(sum(fa.opening_balance), 0::numeric)
            + COALESCE(sum(at.debit_amount - at.credit_amount) FILTER (WHERE at.id IS NOT NULL), 0::numeric) AS amount
           FROM financial_accounts fa
             LEFT JOIN accounting_transactions at ON at.financial_account_id = fa.id
          WHERE fa.is_active AND fa.account_type = ANY (ARRAY['bank'::financial_account_type,'cash'::financial_account_type,'mobile_money'::financial_account_type])
          GROUP BY fa.organization_id, fa.currency
), ar AS (
         SELECT i.organization_id, i.currency,
            COALESCE(sum(i.total_amount - COALESCE((SELECT sum(p.amount) FROM payments p WHERE p.invoice_id=i.id),0)),0) AS amount
           FROM invoices i
          WHERE i.status = ANY (ARRAY['draft'::invoice_status,'sent'::invoice_status,'overdue'::invoice_status]) AND i.voided_at IS NULL
          GROUP BY i.organization_id, i.currency
), mtd AS (
         SELECT organization_id,
            COALESCE(sum(credit_amount) FILTER (WHERE account_type='revenue'::account_type),0) AS revenue,
            COALESCE(sum(debit_amount) FILTER (WHERE account_type='expense'::account_type),0) AS expense,
            COALESCE(sum(debit_amount) FILTER (WHERE account_type='cost_of_goods'::account_type),0) AS cogs,
            COALESCE(sum(debit_amount) FILTER (WHERE account_type='asset'::account_type AND category='input_tax'),0) AS input_vat
           FROM accounting_transactions
          WHERE transaction_date >= date_trunc('month', now())
          GROUP BY organization_id
), recon AS (
         SELECT organization_id,
            count(*) FILTER (WHERE status='in_progress'::bank_reconciliation_status) AS in_progress_count,
            count(*) FILTER (WHERE status='completed'::bank_reconciliation_status) AS completed_count,
            count(*) FILTER (WHERE status='completed'::bank_reconciliation_status AND completed_at >= now() - interval '30 days') AS recent_completed
           FROM bank_reconciliations GROUP BY organization_id
)
 SELECT id AS organization_id,
    COALESCE((SELECT json_agg(json_build_object('currency',cash.currency,'amount',cash.amount)) FROM cash WHERE cash.organization_id=o.id),'[]'::json) AS cash_on_hand,
    COALESCE((SELECT json_agg(json_build_object('currency',ar.currency,'amount',ar.amount)) FROM ar WHERE ar.organization_id=o.id),'[]'::json) AS receivables,
    COALESCE((SELECT sum(cash.amount) FROM cash WHERE cash.organization_id=o.id),0) AS cash_total,
    COALESCE((SELECT sum(ar.amount) FROM ar WHERE ar.organization_id=o.id),0) AS receivables_total,
    COALESCE((SELECT mtd.revenue FROM mtd WHERE mtd.organization_id=o.id),0) AS mtd_revenue,
    COALESCE((SELECT mtd.expense FROM mtd WHERE mtd.organization_id=o.id),0) AS mtd_expense,
    COALESCE((SELECT mtd.cogs FROM mtd WHERE mtd.organization_id=o.id),0) AS mtd_cogs,
    COALESCE((SELECT mtd.revenue - mtd.expense - mtd.cogs FROM mtd WHERE mtd.organization_id=o.id),0) AS mtd_net,
    COALESCE((SELECT mtd.input_vat FROM mtd WHERE mtd.organization_id=o.id),0) AS mtd_input_vat,
    COALESCE((SELECT recon.in_progress_count FROM recon WHERE recon.organization_id=o.id),0::bigint) AS recon_in_progress,
    COALESCE((SELECT recon.completed_count FROM recon WHERE recon.organization_id=o.id),0::bigint) AS recon_completed,
    COALESCE((SELECT recon.recent_completed FROM recon WHERE recon.organization_id=o.id),0::bigint) AS recon_recent
   FROM organizations o;

GRANT SELECT ON public.finance_dashboard_metrics TO authenticated;

-- ============================================================
-- PART 2: Posting triggers for unposted modules
-- ============================================================

-- ---- Customer payments → Dr Cash, Cr AR ----
CREATE OR REPLACE FUNCTION public.post_payment_to_ledger(_payment_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _p payments%ROWTYPE; _inv invoices%ROWTYPE; _curr text;
BEGIN
  SELECT * INTO _p FROM payments WHERE id=_payment_id;
  IF NOT FOUND OR COALESCE(_p.amount,0) <= 0 THEN RETURN; END IF;
  IF EXISTS (SELECT 1 FROM accounting_transactions WHERE reference_type='payment' AND reference_id=_payment_id) THEN RETURN; END IF;
  SELECT * INTO _inv FROM invoices WHERE id=_p.invoice_id;
  _curr := COALESCE(_inv.currency, (SELECT currency FROM organizations WHERE id=_p.organization_id), 'USD');

  INSERT INTO accounting_transactions(transaction_number, transaction_date, account_type, category, description,
    debit_amount, credit_amount, reference_type, reference_id, organization_id, currency, financial_account_id)
  VALUES ('CASH-'||substring(_p.payment_number from 1 for 30)||'-'||substring(_p.id::text,1,8),
    COALESCE(_p.paid_at, now()), 'asset', 'cash',
    'Cash receipt — Payment '||_p.payment_number, _p.amount, 0,
    'payment', _p.id, _p.organization_id, _curr, _p.financial_account_id);

  INSERT INTO accounting_transactions(transaction_number, transaction_date, account_type, category, description,
    debit_amount, credit_amount, reference_type, reference_id, organization_id, currency)
  VALUES ('AR-CLR-'||substring(_p.payment_number from 1 for 30)||'-'||substring(_p.id::text,1,8),
    COALESCE(_p.paid_at, now()), 'asset', 'accounts_receivable',
    'AR clearing — Payment '||_p.payment_number, 0, _p.amount,
    'payment', _p.id, _p.organization_id, _curr);
END $$;

CREATE OR REPLACE FUNCTION public.trg_payment_autopost()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN PERFORM public.post_payment_to_ledger(NEW.id); RETURN NEW; END $$;

DROP TRIGGER IF EXISTS trg_payment_autopost ON public.payments;
CREATE TRIGGER trg_payment_autopost AFTER INSERT ON public.payments
  FOR EACH ROW EXECUTE FUNCTION public.trg_payment_autopost();

-- ---- Vendor payments → Cr Cash, Dr AP ----
CREATE OR REPLACE FUNCTION public.post_vendor_payment_to_ledger(_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE _v vendor_payments%ROWTYPE; _curr text;
BEGIN
  SELECT * INTO _v FROM vendor_payments WHERE id=_id;
  IF NOT FOUND OR COALESCE(_v.amount,0) <= 0 THEN RETURN; END IF;
  IF EXISTS (SELECT 1 FROM accounting_transactions WHERE reference_type='vendor_payment' AND reference_id=_id) THEN RETURN; END IF;
  _curr := COALESCE((SELECT currency FROM organizations WHERE id=_v.organization_id),'USD');

  INSERT INTO accounting_transactions(transaction_number, transaction_date, account_type, category, description,
    debit_amount, credit_amount, reference_type, reference_id, organization_id, currency)
  VALUES ('AP-'||substring(_v.payment_number from 1 for 30)||'-'||substring(_v.id::text,1,8),
    COALESCE(_v.paid_at, now()), 'liability', 'accounts_payable',
    'AP settlement — Vendor payment '||_v.payment_number, _v.amount, 0,
    'vendor_payment', _v.id, _v.organization_id, _curr);

  INSERT INTO accounting_transactions(transaction_number, transaction_date, account_type, category, description,
    debit_amount, credit_amount, reference_type, reference_id, organization_id, currency, financial_account_id)
  VALUES ('CASH-OUT-'||substring(_v.payment_number from 1 for 30)||'-'||substring(_v.id::text,1,8),
    COALESCE(_v.paid_at, now()), 'asset', 'cash',
    'Cash payment — Vendor payment '||_v.payment_number, 0, _v.amount,
    'vendor_payment', _v.id, _v.organization_id, _curr, _v.financial_account_id);
END $$;

CREATE OR REPLACE FUNCTION public.trg_vendor_payment_autopost()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN PERFORM public.post_vendor_payment_to_ledger(NEW.id); RETURN NEW; END $$;

DROP TRIGGER IF EXISTS trg_vendor_payment_autopost ON public.vendor_payments;
CREATE TRIGGER trg_vendor_payment_autopost AFTER INSERT ON public.vendor_payments
  FOR EACH ROW EXECUTE FUNCTION public.trg_vendor_payment_autopost();

-- ---- Goods receipts → Dr Inventory + Dr Input VAT, Cr AP ----
CREATE OR REPLACE FUNCTION public.post_goods_receipt_to_ledger(_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  _gr goods_receipts%ROWTYPE;
  _net numeric := 0;
  _tax numeric := 0;
  _curr text;
BEGIN
  SELECT * INTO _gr FROM goods_receipts WHERE id=_id;
  IF NOT FOUND THEN RETURN; END IF;
  IF EXISTS (SELECT 1 FROM accounting_transactions WHERE reference_type='goods_receipt' AND reference_id=_id) THEN RETURN; END IF;

  SELECT COALESCE(sum(round(gri.received_qty * COALESCE(pi.unit_price,0),2)),0),
         COALESCE(sum(CASE WHEN COALESCE(gri.is_vatable, pi.is_vatable) THEN round(gri.received_qty*COALESCE(pi.unit_price,0)*COALESCE(NULLIF(gri.tax_rate,0), pi.tax_rate)/100.0, 2) ELSE 0 END),0)
    INTO _net, _tax
    FROM goods_receipt_items gri
    LEFT JOIN po_items pi ON pi.id = gri.po_item_id
   WHERE gri.receipt_id = _id;

  IF (_net + _tax) <= 0 THEN RETURN; END IF;
  _curr := COALESCE((SELECT currency FROM organizations WHERE id=_gr.organization_id),'USD');

  INSERT INTO accounting_transactions(transaction_number, transaction_date, account_type, category, description,
    debit_amount, credit_amount, reference_type, reference_id, organization_id, currency)
  VALUES ('INV-'||substring(_gr.id::text,1,8), COALESCE(_gr.received_at,now()),
    'asset','inventory','Inventory received — GR '||substring(_gr.id::text,1,8),
    _net, 0, 'goods_receipt', _gr.id, _gr.organization_id, _curr);

  IF _tax > 0 THEN
    INSERT INTO accounting_transactions(transaction_number, transaction_date, account_type, category, description,
      debit_amount, credit_amount, reference_type, reference_id, organization_id, currency)
    VALUES ('VAT-IN-'||substring(_gr.id::text,1,8), COALESCE(_gr.received_at,now()),
      'asset','input_tax','Input VAT — GR '||substring(_gr.id::text,1,8),
      _tax, 0, 'goods_receipt', _gr.id, _gr.organization_id, _curr);
  END IF;

  INSERT INTO accounting_transactions(transaction_number, transaction_date, account_type, category, description,
    debit_amount, credit_amount, reference_type, reference_id, organization_id, currency)
  VALUES ('AP-'||substring(_gr.id::text,1,8), COALESCE(_gr.received_at,now()),
    'liability','accounts_payable','AP — GR '||substring(_gr.id::text,1,8),
    0, _net + _tax, 'goods_receipt', _gr.id, _gr.organization_id, _curr);
END $$;

CREATE OR REPLACE FUNCTION public.trg_gr_autopost()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN PERFORM public.post_goods_receipt_to_ledger(NEW.id); RETURN NEW; END $$;

DROP TRIGGER IF EXISTS trg_gr_autopost ON public.goods_receipts;
CREATE TRIGGER trg_gr_autopost AFTER INSERT ON public.goods_receipts
  FOR EACH ROW EXECUTE FUNCTION public.trg_gr_autopost();

-- ---- Expense claims (approved/reimbursed) → Dr Expense, Cr AP/Cash ----
CREATE OR REPLACE FUNCTION public.post_expense_claim_to_ledger(_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE _c expense_claims%ROWTYPE; _curr text; _credit_type account_type; _credit_cat text;
BEGIN
  SELECT * INTO _c FROM expense_claims WHERE id=_id;
  IF NOT FOUND OR COALESCE(_c.total_amount,0) <= 0 THEN RETURN; END IF;
  IF _c.status NOT IN ('approved','reimbursed','paid') THEN RETURN; END IF;
  IF EXISTS (SELECT 1 FROM accounting_transactions WHERE reference_type='expense_claim' AND reference_id=_id) THEN RETURN; END IF;
  _curr := COALESCE((SELECT currency FROM organizations WHERE id=_c.organization_id),'USD');

  IF _c.status IN ('reimbursed','paid') THEN
    _credit_type := 'asset'::account_type; _credit_cat := 'cash';
  ELSE
    _credit_type := 'liability'::account_type; _credit_cat := 'accounts_payable';
  END IF;

  INSERT INTO accounting_transactions(transaction_number, transaction_date, account_type, category, description,
    debit_amount, credit_amount, reference_type, reference_id, organization_id, currency)
  VALUES ('EXP-'||substring(_c.claim_number from 1 for 30)||'-'||substring(_c.id::text,1,8),
    COALESCE(_c.approved_at,_c.claim_date,now()), 'expense','employee_expense',
    'Expense claim '||_c.claim_number, _c.total_amount, 0,
    'expense_claim', _c.id, _c.organization_id, _curr);

  INSERT INTO accounting_transactions(transaction_number, transaction_date, account_type, category, description,
    debit_amount, credit_amount, reference_type, reference_id, organization_id, currency)
  VALUES ('EXP-CR-'||substring(_c.claim_number from 1 for 30)||'-'||substring(_c.id::text,1,8),
    COALESCE(_c.approved_at,_c.claim_date,now()), _credit_type, _credit_cat,
    'Expense claim credit '||_c.claim_number, 0, _c.total_amount,
    'expense_claim', _c.id, _c.organization_id, _curr);
END $$;

CREATE OR REPLACE FUNCTION public.trg_expense_claim_autopost()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF NEW.status IN ('approved','reimbursed','paid')
     AND (TG_OP='INSERT' OR OLD.status IS DISTINCT FROM NEW.status) THEN
    PERFORM public.post_expense_claim_to_ledger(NEW.id);
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_expense_claim_autopost ON public.expense_claims;
CREATE TRIGGER trg_expense_claim_autopost
  AFTER INSERT OR UPDATE OF status ON public.expense_claims
  FOR EACH ROW EXECUTE FUNCTION public.trg_expense_claim_autopost();

-- ---- Repair function: post any source rows missing ledger entries ----
CREATE OR REPLACE FUNCTION public.repair_missing_postings()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE r record; _counts jsonb := '{}'::jsonb; _n int;
BEGIN
  -- invoices
  _n := 0;
  FOR r IN SELECT id FROM invoices
    WHERE status IN ('sent','paid','overdue') AND COALESCE(total_amount,0) > 0
      AND NOT EXISTS (SELECT 1 FROM accounting_transactions WHERE reference_type='invoice' AND reference_id=invoices.id)
  LOOP BEGIN PERFORM public.post_invoice_to_ledger(r.id); _n := _n+1; EXCEPTION WHEN OTHERS THEN RAISE LOG 'repair invoice % failed: %', r.id, SQLERRM; END; END LOOP;
  _counts := jsonb_set(_counts, '{invoices}', to_jsonb(_n));

  _n := 0;
  FOR r IN SELECT id FROM payments WHERE NOT EXISTS (SELECT 1 FROM accounting_transactions WHERE reference_type='payment' AND reference_id=payments.id)
  LOOP BEGIN PERFORM public.post_payment_to_ledger(r.id); _n:=_n+1; EXCEPTION WHEN OTHERS THEN RAISE LOG 'repair payment % failed: %', r.id, SQLERRM; END; END LOOP;
  _counts := jsonb_set(_counts, '{payments}', to_jsonb(_n));

  _n := 0;
  FOR r IN SELECT id FROM vendor_payments WHERE NOT EXISTS (SELECT 1 FROM accounting_transactions WHERE reference_type='vendor_payment' AND reference_id=vendor_payments.id)
  LOOP BEGIN PERFORM public.post_vendor_payment_to_ledger(r.id); _n:=_n+1; EXCEPTION WHEN OTHERS THEN RAISE LOG 'repair vendor_payment % failed: %', r.id, SQLERRM; END; END LOOP;
  _counts := jsonb_set(_counts, '{vendor_payments}', to_jsonb(_n));

  _n := 0;
  FOR r IN SELECT id FROM goods_receipts WHERE NOT EXISTS (SELECT 1 FROM accounting_transactions WHERE reference_type='goods_receipt' AND reference_id=goods_receipts.id)
  LOOP BEGIN PERFORM public.post_goods_receipt_to_ledger(r.id); _n:=_n+1; EXCEPTION WHEN OTHERS THEN RAISE LOG 'repair goods_receipt % failed: %', r.id, SQLERRM; END; END LOOP;
  _counts := jsonb_set(_counts, '{goods_receipts}', to_jsonb(_n));

  _n := 0;
  FOR r IN SELECT id FROM expense_claims WHERE status IN ('approved','reimbursed','paid')
    AND NOT EXISTS (SELECT 1 FROM accounting_transactions WHERE reference_type='expense_claim' AND reference_id=expense_claims.id)
  LOOP BEGIN PERFORM public.post_expense_claim_to_ledger(r.id); _n:=_n+1; EXCEPTION WHEN OTHERS THEN RAISE LOG 'repair expense_claim % failed: %', r.id, SQLERRM; END; END LOOP;
  _counts := jsonb_set(_counts, '{expense_claims}', to_jsonb(_n));

  RETURN _counts;
END $$;

GRANT EXECUTE ON FUNCTION public.repair_missing_postings() TO authenticated;
REVOKE EXECUTE ON FUNCTION public.repair_missing_postings() FROM anon, PUBLIC;

-- View of source docs still missing ledger entries
CREATE OR REPLACE VIEW public.v_missing_postings
WITH (security_invoker=on) AS
  SELECT 'invoice' AS reference_type, id AS reference_id, organization_id, total_amount AS amount, COALESCE(issued_at, created_at) AS doc_date
    FROM invoices WHERE status IN ('sent','paid','overdue') AND COALESCE(total_amount,0) > 0
      AND NOT EXISTS (SELECT 1 FROM accounting_transactions WHERE reference_type='invoice' AND reference_id=invoices.id)
  UNION ALL
  SELECT 'payment', id, organization_id, amount, paid_at FROM payments
    WHERE NOT EXISTS (SELECT 1 FROM accounting_transactions WHERE reference_type='payment' AND reference_id=payments.id)
  UNION ALL
  SELECT 'vendor_payment', id, organization_id, amount, paid_at FROM vendor_payments
    WHERE NOT EXISTS (SELECT 1 FROM accounting_transactions WHERE reference_type='vendor_payment' AND reference_id=vendor_payments.id)
  UNION ALL
  SELECT 'goods_receipt', id, organization_id, NULL::numeric, received_at FROM goods_receipts
    WHERE NOT EXISTS (SELECT 1 FROM accounting_transactions WHERE reference_type='goods_receipt' AND reference_id=goods_receipts.id)
  UNION ALL
  SELECT 'expense_claim', id, organization_id, total_amount, COALESCE(approved_at, claim_date::timestamptz) FROM expense_claims
    WHERE status IN ('approved','reimbursed','paid')
      AND NOT EXISTS (SELECT 1 FROM accounting_transactions WHERE reference_type='expense_claim' AND reference_id=expense_claims.id);

GRANT SELECT ON public.v_missing_postings TO authenticated;
