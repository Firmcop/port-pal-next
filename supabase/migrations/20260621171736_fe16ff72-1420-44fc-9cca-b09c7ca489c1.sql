
ALTER TABLE public.container_sales ADD COLUMN IF NOT EXISTS currency text;

UPDATE public.container_sales s
SET currency = COALESCE(
  (SELECT d.currency FROM public.depots d WHERE d.organization_id = s.organization_id LIMIT 1),
  (SELECT o.currency FROM public.organizations o WHERE o.id = s.organization_id),
  'USD'
)
WHERE currency IS NULL;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'set_currency_from_org' AND pronamespace = 'public'::regnamespace)
     AND NOT EXISTS (
       SELECT 1 FROM pg_trigger
       WHERE tgname = 'set_currency_from_org_container_sales'
         AND tgrelid = 'public.container_sales'::regclass
     )
  THEN
    EXECUTE 'CREATE TRIGGER set_currency_from_org_container_sales
             BEFORE INSERT ON public.container_sales
             FOR EACH ROW EXECUTE FUNCTION public.set_currency_from_org()';
  END IF;
END $$;
