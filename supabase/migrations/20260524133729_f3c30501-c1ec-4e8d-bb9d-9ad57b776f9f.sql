
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
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN currency DROP NOT NULL', t);
  END LOOP;
END $$;

REVOKE EXECUTE ON FUNCTION public.set_currency_from_org() FROM PUBLIC, anon, authenticated;
