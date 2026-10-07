
-- 1. Vendor payments: currency + locked FX
ALTER TABLE public.vendor_payments
  ADD COLUMN IF NOT EXISTS currency text,
  ADD COLUMN IF NOT EXISTS fx_rate numeric,
  ADD COLUMN IF NOT EXISTS base_amount numeric;

ALTER TABLE public.supplier_invoices
  ADD COLUMN IF NOT EXISTS fx_rate numeric,
  ADD COLUMN IF NOT EXISTS base_amount numeric;

ALTER TABLE public.vendor_payment_allocations
  ADD COLUMN IF NOT EXISTS rule_applied text,
  ADD COLUMN IF NOT EXISTS fx_rate numeric,
  ADD COLUMN IF NOT EXISTS note text;

-- 2. Freeze FX on vendor payments
CREATE OR REPLACE FUNCTION public.lock_vendor_payment_fx()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _base text; _sup text;
BEGIN
  IF NEW.currency IS NULL OR btrim(NEW.currency) = '' THEN
    SELECT s.currency INTO _sup FROM public.suppliers s WHERE s.id = NEW.supplier_id;
    IF _sup IS NULL OR btrim(_sup) = '' THEN
      SELECT si.currency INTO _sup FROM public.supplier_invoices si WHERE si.purchase_order_id = NEW.po_id ORDER BY si.created_at LIMIT 1;
    END IF;
    IF _sup IS NULL OR btrim(_sup) = '' THEN
      SELECT po.currency INTO _sup FROM public.purchase_orders po WHERE po.id = NEW.po_id;
    END IF;
    SELECT o.currency INTO _base FROM public.organizations o WHERE o.id = NEW.organization_id;
    NEW.currency := COALESCE(NULLIF(btrim(COALESCE(_sup,'')),''), _base);
  END IF;

  SELECT o.currency INTO _base FROM public.organizations o WHERE o.id = NEW.organization_id;
  IF NEW.fx_rate IS NULL THEN
    NEW.fx_rate := public.get_fx_rate(NEW.organization_id, NEW.currency, _base, COALESCE(NEW.paid_at::date, current_date));
  END IF;
  NEW.base_amount := COALESCE(NEW.amount,0) * COALESCE(NEW.fx_rate, 1);
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_lock_vendor_payment_fx ON public.vendor_payments;
CREATE TRIGGER trg_lock_vendor_payment_fx
BEFORE INSERT OR UPDATE OF amount, currency, paid_at, supplier_id ON public.vendor_payments
FOR EACH ROW EXECUTE FUNCTION public.lock_vendor_payment_fx();

-- 3. Freeze FX on supplier invoices
CREATE OR REPLACE FUNCTION public.lock_supplier_invoice_fx()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _base text;
BEGIN
  SELECT o.currency INTO _base FROM public.organizations o WHERE o.id = NEW.organization_id;
  IF NEW.fx_rate IS NULL THEN
    NEW.fx_rate := public.get_fx_rate(NEW.organization_id, NEW.currency, _base, COALESCE(NEW.issue_date::date, current_date));
  END IF;
  NEW.base_amount := COALESCE(NEW.total_amount,0) * COALESCE(NEW.fx_rate, 1);
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_lock_supplier_invoice_fx ON public.supplier_invoices;
CREATE TRIGGER trg_lock_supplier_invoice_fx
BEFORE INSERT OR UPDATE OF total_amount, currency, issue_date ON public.supplier_invoices
FOR EACH ROW EXECUTE FUNCTION public.lock_supplier_invoice_fx();

-- 4. Backfill existing rows
UPDATE public.vendor_payments vp
   SET currency = COALESCE(NULLIF(btrim(COALESCE(s.currency,'')),''), o.currency)
  FROM public.organizations o
  LEFT JOIN public.suppliers s ON TRUE
 WHERE o.id = vp.organization_id AND s.id = vp.supplier_id AND vp.currency IS NULL;

UPDATE public.vendor_payments vp
   SET currency = o.currency
  FROM public.organizations o
 WHERE o.id = vp.organization_id AND vp.currency IS NULL;

UPDATE public.vendor_payments vp
   SET fx_rate = COALESCE(vp.fx_rate, public.get_fx_rate(vp.organization_id, vp.currency, o.currency, COALESCE(vp.paid_at::date, current_date)))
  FROM public.organizations o
 WHERE o.id = vp.organization_id;

UPDATE public.vendor_payments SET base_amount = COALESCE(amount,0) * COALESCE(fx_rate,1) WHERE base_amount IS NULL;

UPDATE public.supplier_invoices si
   SET fx_rate = COALESCE(si.fx_rate, public.get_fx_rate(si.organization_id, si.currency, o.currency, COALESCE(si.issue_date::date, si.created_at::date)))
  FROM public.organizations o
 WHERE o.id = si.organization_id;

UPDATE public.supplier_invoices SET base_amount = COALESCE(total_amount,0) * COALESCE(fx_rate,1) WHERE base_amount IS NULL;

-- 5. Backfill ledger currency / fx
UPDATE public.accounting_transactions t
   SET base_currency = COALESCE(t.base_currency, o.currency),
       fx_rate = COALESCE(t.fx_rate, public.get_fx_rate(t.organization_id, COALESCE(t.currency, o.currency), o.currency, COALESCE(t.transaction_date::date, t.created_at::date)))
  FROM public.organizations o
 WHERE o.id = t.organization_id
   AND (t.base_currency IS NULL OR t.fx_rate IS NULL);

UPDATE public.accounting_transactions
   SET fx_rate = 1
 WHERE fx_rate IS NULL AND upper(COALESCE(currency,'')) = upper(COALESCE(base_currency,''));

-- 6. Backfill project_id on historical ledger rows
UPDATE public.accounting_transactions t
   SET project_id = sub.pid
  FROM (
    SELECT t2.id,
           COALESCE(
             (SELECT cc.project_id FROM public.container_sales cs JOIN public.container_conversions cc ON cc.id = cs.conversion_id WHERE cs.id = t2.reference_id AND t2.reference_type = 'container_sales'),
             (SELECT COALESCE(i.project_id, (SELECT cc2.project_id FROM public.container_sales cs2 JOIN public.container_conversions cc2 ON cc2.id = cs2.conversion_id WHERE cs2.invoice_id = i.id LIMIT 1))
                FROM public.invoices i WHERE i.id = t2.reference_id AND t2.reference_type = 'invoice'),
             (SELECT COALESCE(po.project_id, cc.project_id) FROM public.supplier_invoices si
                LEFT JOIN public.purchase_orders po ON po.id = si.purchase_order_id
                LEFT JOIN public.container_conversions cc ON cc.id = po.conversion_id
               WHERE si.id = t2.reference_id AND t2.reference_type IN ('supplier_invoices','supplier_invoice')),
             (SELECT COALESCE(po.project_id, cc.project_id) FROM public.goods_receipts gr
                LEFT JOIN public.purchase_orders po ON po.id = gr.po_id
                LEFT JOIN public.container_conversions cc ON cc.id = po.conversion_id
               WHERE gr.id = t2.reference_id AND t2.reference_type = 'goods_receipt'),
             (SELECT COALESCE(vp.project_id, po.project_id, cc.project_id) FROM public.vendor_payments vp
                LEFT JOIN public.purchase_orders po ON po.id = vp.po_id
                LEFT JOIN public.container_conversions cc ON cc.id = COALESCE(vp.conversion_id, po.conversion_id)
               WHERE vp.id = t2.reference_id AND t2.reference_type = 'vendor_payment'),
             (SELECT cc.project_id FROM public.container_conversions cc WHERE cc.id = t2.reference_id AND t2.reference_type IN ('conversion','container_conversions','container_conversion')),
             (SELECT po.project_id FROM public.purchase_orders po WHERE po.id = t2.reference_id AND t2.reference_type IN ('purchase_order','purchase_orders'))
           ) AS pid
      FROM public.accounting_transactions t2
     WHERE t2.project_id IS NULL AND t2.reference_id IS NOT NULL
  ) sub
 WHERE sub.id = t.id AND sub.pid IS NOT NULL
   AND EXISTS (SELECT 1 FROM public.projects p WHERE p.id = sub.pid);

-- 7. Views
CREATE OR REPLACE VIEW public.material_stock_reconciliation
WITH (security_invoker = true) AS
SELECT m.id AS material_id,
       m.organization_id,
       m.name,
       m.unit,
       m.category,
       COALESCE(m.on_hand_qty,0) AS on_hand_qty,
       COALESCE(mv.movement_balance,0) AS movement_balance,
       COALESCE(m.on_hand_qty,0) - COALESCE(mv.movement_balance,0) AS variance,
       COALESCE(mv.receipts,0) AS receipts,
       COALESCE(mv.issues,0) AS issues,
       COALESCE(mv.adjustments,0) AS adjustments,
       COALESCE(mv.movement_count,0) AS movement_count,
       COALESCE(m.avg_unit_cost, m.unit_cost, 0) AS unit_cost,
       COALESCE(m.on_hand_qty,0) * COALESCE(m.avg_unit_cost, m.unit_cost, 0) AS stock_value,
       mv.last_movement_at
  FROM public.materials m
  LEFT JOIN (
    SELECT material_id,
           sum(qty) AS movement_balance,
           sum(CASE WHEN movement_type = 'receipt' THEN qty ELSE 0 END) AS receipts,
           sum(CASE WHEN movement_type IN ('issue','scrap') THEN qty ELSE 0 END) AS issues,
           sum(CASE WHEN movement_type IN ('adjustment','return') THEN qty ELSE 0 END) AS adjustments,
           count(*) AS movement_count,
           max(created_at) AS last_movement_at
      FROM public.material_movements
     GROUP BY material_id
  ) mv ON mv.material_id = m.id
 WHERE COALESCE(m.is_active, true);

CREATE OR REPLACE VIEW public.currency_integrity_exceptions
WITH (security_invoker = true) AS
SELECT t.id AS transaction_id,
       t.organization_id,
       t.transaction_number,
       t.transaction_date,
       t.reference_type,
       t.reference_id,
       t.description,
       t.currency,
       t.base_currency,
       t.fx_rate,
       t.debit_amount,
       t.credit_amount,
       CASE
         WHEN t.fx_rate IS NULL THEN 'missing_fx_rate'
         WHEN t.base_currency IS NULL THEN 'missing_base_currency'
         WHEN upper(COALESCE(t.currency,'')) <> upper(COALESCE(t.base_currency,'')) AND t.fx_rate = 1 THEN 'suspect_unity_rate'
         ELSE 'ok'
       END AS issue
  FROM public.accounting_transactions t
 WHERE t.fx_rate IS NULL
    OR t.base_currency IS NULL
    OR (upper(COALESCE(t.currency,'')) <> upper(COALESCE(t.base_currency,'')) AND t.fx_rate = 1);

CREATE OR REPLACE VIEW public.vendor_payment_unallocated
WITH (security_invoker = true) AS
SELECT vp.id AS payment_id,
       vp.organization_id,
       vp.supplier_id,
       vp.payment_number,
       vp.paid_at,
       vp.currency,
       vp.amount,
       COALESCE(a.allocated,0) AS allocated,
       vp.amount - COALESCE(a.allocated,0) AS unallocated
  FROM public.vendor_payments vp
  LEFT JOIN (SELECT payment_id, sum(amount) AS allocated FROM public.vendor_payment_allocations GROUP BY payment_id) a
    ON a.payment_id = vp.id;

CREATE OR REPLACE VIEW public.supplier_statement
WITH (security_invoker = true) AS
SELECT si.organization_id, si.supplier_id, 'invoice'::text AS entry_type, si.id AS entry_id,
       si.invoice_number AS reference, si.issue_date::date AS entry_date, si.currency,
       si.total_amount AS debit, 0::numeric AS credit, si.paid_amount, si.status
  FROM public.supplier_invoices si
UNION ALL
SELECT vp.organization_id, vp.supplier_id, 'payment'::text, vp.id,
       vp.payment_number, vp.paid_at::date, vp.currency,
       0::numeric, vp.amount, NULL::numeric, NULL::text
  FROM public.vendor_payments vp;

GRANT SELECT ON public.material_stock_reconciliation TO authenticated;
GRANT SELECT ON public.currency_integrity_exceptions TO authenticated;
GRANT SELECT ON public.vendor_payment_unallocated TO authenticated;
GRANT SELECT ON public.supplier_statement TO authenticated;
