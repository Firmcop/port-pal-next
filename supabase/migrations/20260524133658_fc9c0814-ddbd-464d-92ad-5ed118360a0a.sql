
CREATE OR REPLACE FUNCTION public.set_currency_from_org()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  org_currency text;
BEGIN
  IF NEW.currency IS NULL AND NEW.organization_id IS NOT NULL THEN
    SELECT currency INTO org_currency FROM public.organizations WHERE id = NEW.organization_id;
    IF org_currency IS NOT NULL THEN
      NEW.currency := org_currency;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DO $$
DECLARE
  t text;
  tables text[] := ARRAY[
    'logistics_trip_costs','logistics_trip_revenue','logistics_transport_orders',
    'logistics_routes','logistics_carrier_rates','invoices','recurring_invoice_templates',
    'damage_estimates','tariffs','lease_agreements','lease_quotations',
    'container_conversions','projects','depots','financial_accounts','gl_accounts'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN currency DROP DEFAULT', t);
    EXECUTE format('DROP TRIGGER IF EXISTS set_currency_from_org_trg ON public.%I', t);
    EXECUTE format('CREATE TRIGGER set_currency_from_org_trg BEFORE INSERT ON public.%I FOR EACH ROW EXECUTE FUNCTION public.set_currency_from_org()', t);
  END LOOP;
END $$;

UPDATE public.logistics_trip_costs c SET currency = o.currency FROM public.organizations o
  WHERE c.organization_id = o.id AND c.currency IN ('USD','EUR') AND o.currency <> c.currency AND c.expense_txn_id IS NULL;

UPDATE public.logistics_trip_revenue r SET currency = o.currency FROM public.organizations o
  WHERE r.organization_id = o.id AND r.currency IN ('USD','EUR') AND o.currency <> r.currency AND r.invoice_id IS NULL;

UPDATE public.invoices i SET currency = o.currency FROM public.organizations o
  WHERE i.organization_id = o.id AND i.currency IN ('USD','EUR') AND o.currency <> i.currency AND i.status = 'draft';

UPDATE public.logistics_transport_orders x SET currency = o.currency FROM public.organizations o
  WHERE x.organization_id = o.id AND x.currency IN ('USD','EUR') AND o.currency <> x.currency;
UPDATE public.logistics_routes x SET currency = o.currency FROM public.organizations o
  WHERE x.organization_id = o.id AND x.currency IN ('USD','EUR') AND o.currency <> x.currency;
UPDATE public.logistics_carrier_rates x SET currency = o.currency FROM public.organizations o
  WHERE x.organization_id = o.id AND x.currency IN ('USD','EUR') AND o.currency <> x.currency;
UPDATE public.recurring_invoice_templates x SET currency = o.currency FROM public.organizations o
  WHERE x.organization_id = o.id AND x.currency IN ('USD','EUR') AND o.currency <> x.currency;
UPDATE public.damage_estimates x SET currency = o.currency FROM public.organizations o
  WHERE x.organization_id = o.id AND x.currency IN ('USD','EUR') AND o.currency <> x.currency;
UPDATE public.tariffs x SET currency = o.currency FROM public.organizations o
  WHERE x.organization_id = o.id AND x.currency IN ('USD','EUR') AND o.currency <> x.currency;
UPDATE public.lease_agreements x SET currency = o.currency FROM public.organizations o
  WHERE x.organization_id = o.id AND x.currency IN ('USD','EUR') AND o.currency <> x.currency;
UPDATE public.lease_quotations x SET currency = o.currency FROM public.organizations o
  WHERE x.organization_id = o.id AND x.currency IN ('USD','EUR') AND o.currency <> x.currency;
UPDATE public.container_conversions x SET currency = o.currency FROM public.organizations o
  WHERE x.organization_id = o.id AND x.currency IN ('USD','EUR') AND o.currency <> x.currency;
UPDATE public.projects x SET currency = o.currency FROM public.organizations o
  WHERE x.organization_id = o.id AND x.currency IN ('USD','EUR') AND o.currency <> x.currency;
UPDATE public.depots x SET currency = o.currency FROM public.organizations o
  WHERE x.organization_id = o.id AND x.currency IN ('USD','EUR') AND o.currency <> x.currency;
UPDATE public.financial_accounts x SET currency = o.currency FROM public.organizations o
  WHERE x.organization_id = o.id AND x.currency IN ('USD','EUR') AND o.currency <> x.currency;
UPDATE public.gl_accounts x SET currency = o.currency FROM public.organizations o
  WHERE x.organization_id = o.id AND x.currency IN ('USD','EUR') AND o.currency <> x.currency;
