
-- Attach currency auto-fill trigger to customer/supplier/ledger tables
DROP TRIGGER IF EXISTS set_currency_from_org_trg ON public.customers;
CREATE TRIGGER set_currency_from_org_trg BEFORE INSERT ON public.customers
  FOR EACH ROW EXECUTE FUNCTION public.set_currency_from_org();

DROP TRIGGER IF EXISTS set_currency_from_org_trg ON public.suppliers;
CREATE TRIGGER set_currency_from_org_trg BEFORE INSERT ON public.suppliers
  FOR EACH ROW EXECUTE FUNCTION public.set_currency_from_org();

DROP TRIGGER IF EXISTS set_currency_from_org_trg ON public.accounting_transactions;
CREATE TRIGGER set_currency_from_org_trg BEFORE INSERT ON public.accounting_transactions
  FOR EACH ROW EXECUTE FUNCTION public.set_currency_from_org();

-- Drop hardcoded 'USD' default so trigger can fill from org
ALTER TABLE public.supplier_invoices ALTER COLUMN currency DROP DEFAULT;
