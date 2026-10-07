-- C. Supplier/customer currency maintained end to end

ALTER TABLE public.purchase_orders ADD COLUMN IF NOT EXISTS currency text;

UPDATE public.purchase_orders po SET currency = COALESCE(po.currency, s.currency, o.currency)
  FROM public.suppliers s, public.organizations o
 WHERE s.id = po.supplier_id AND o.id = po.organization_id AND po.currency IS NULL;

UPDATE public.purchase_orders po SET currency = o.currency
  FROM public.organizations o WHERE o.id = po.organization_id AND po.currency IS NULL;

CREATE OR REPLACE FUNCTION public.set_po_currency_from_supplier()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.currency IS NULL OR btrim(NEW.currency) = '' THEN
    SELECT COALESCE(s.currency, o.currency) INTO NEW.currency
      FROM public.organizations o
      LEFT JOIN public.suppliers s ON s.id = NEW.supplier_id
     WHERE o.id = NEW.organization_id;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_set_po_currency ON public.purchase_orders;
CREATE TRIGGER trg_set_po_currency BEFORE INSERT ON public.purchase_orders
FOR EACH ROW EXECUTE FUNCTION public.set_po_currency_from_supplier();
REVOKE ALL ON FUNCTION public.set_po_currency_from_supplier() FROM PUBLIC, anon, authenticated;

-- Supplier invoices default to the supplier's registered currency
CREATE OR REPLACE FUNCTION public.set_supplier_invoice_currency()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _sup text; _po text;
BEGIN
  SELECT currency INTO _sup FROM public.suppliers WHERE id = NEW.supplier_id;
  SELECT currency INTO _po FROM public.purchase_orders WHERE id = NEW.purchase_order_id;
  IF NEW.currency IS NULL OR btrim(NEW.currency) = '' THEN
    NEW.currency := COALESCE(_po, _sup, NEW.currency);
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_set_supplier_invoice_currency ON public.supplier_invoices;
CREATE TRIGGER trg_set_supplier_invoice_currency BEFORE INSERT ON public.supplier_invoices
FOR EACH ROW EXECUTE FUNCTION public.set_supplier_invoice_currency();
REVOKE ALL ON FUNCTION public.set_supplier_invoice_currency() FROM PUBLIC, anon, authenticated;

-- Ledger rows inherit the source document's currency instead of the org default
CREATE OR REPLACE FUNCTION public.stamp_txn_currency_from_source()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _cur text; _base text;
BEGIN
  IF NEW.reference_id IS NULL THEN RETURN NEW; END IF;

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
END $$;

DROP TRIGGER IF EXISTS trg_stamp_txn_currency_from_source ON public.accounting_transactions;
CREATE TRIGGER trg_stamp_txn_currency_from_source
BEFORE INSERT ON public.accounting_transactions
FOR EACH ROW EXECUTE FUNCTION public.stamp_txn_currency_from_source();
REVOKE ALL ON FUNCTION public.stamp_txn_currency_from_source() FROM PUBLIC, anon, authenticated;

-- Repair labels on existing rows (amounts unchanged, currency now follows the document)
UPDATE public.accounting_transactions t
   SET currency = si.currency,
       base_currency = COALESCE(t.base_currency, o.currency),
       fx_rate = COALESCE(t.fx_rate, public.get_fx_rate(t.organization_id, si.currency, o.currency, t.transaction_date::date))
  FROM public.supplier_invoices si, public.organizations o
 WHERE t.reference_type IN ('supplier_invoices','supplier_invoice')
   AND t.reference_id = si.id AND o.id = t.organization_id
   AND t.currency IS DISTINCT FROM si.currency;

UPDATE public.accounting_transactions t
   SET currency = i.currency,
       base_currency = COALESCE(t.base_currency, o.currency),
       fx_rate = COALESCE(t.fx_rate, public.get_fx_rate(t.organization_id, i.currency, o.currency, t.transaction_date::date))
  FROM public.invoices i, public.organizations o
 WHERE t.reference_type = 'invoice' AND t.reference_id = i.id AND o.id = t.organization_id
   AND t.currency IS DISTINCT FROM i.currency;
