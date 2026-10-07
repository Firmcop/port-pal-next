-- 1) Fix stale trigger: invoices has customer_name/customer_reference, not customer_id
CREATE OR REPLACE FUNCTION public.trg_fal_invoices()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE _act text;
BEGIN
  IF TG_OP = 'INSERT' THEN _act := 'create';
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.status IS DISTINCT FROM OLD.status THEN _act := 'status:' || NEW.status;
    ELSE _act := 'update'; END IF;
  ELSE _act := 'delete'; END IF;
  PERFORM fal_write(COALESCE(NEW.organization_id, OLD.organization_id),
    'invoice', COALESCE(NEW.id, OLD.id),
    COALESCE(NEW.invoice_number, OLD.invoice_number),
    _act,
    jsonb_build_object(
      'total', COALESCE(NEW.total_amount, OLD.total_amount),
      'status', COALESCE(NEW.status, OLD.status),
      'customer_name', COALESCE(NEW.customer_name, OLD.customer_name),
      'customer_reference', COALESCE(NEW.customer_reference, OLD.customer_reference)),
    CASE WHEN TG_OP <> 'INSERT' THEN to_jsonb(OLD) ELSE NULL END,
    CASE WHEN TG_OP <> 'DELETE' THEN to_jsonb(NEW) ELSE NULL END,
    '/billing/invoices?invoice=' || COALESCE(NEW.id, OLD.id)::text);
  RETURN COALESCE(NEW, OLD);
END $function$;

-- 2) Migrate legacy Default Org → FCL across all tenant tables
DO $$
DECLARE
  _target uuid := '6b29b65b-fa63-4dcf-9854-ede5c9a8320b';
  _legacy uuid := '00000000-0000-0000-0000-000000000001';
  _t text; _cnt int;
BEGIN
  FOR _t IN
    SELECT table_name FROM information_schema.columns
    WHERE table_schema='public' AND column_name='organization_id'
      AND table_name NOT IN ('organizations','organization_members','platform_admins','modules_catalog','subscriptions','subscription_modules','platform_invoices','platform_invoice_runs','platform_invoice_lines','org_lifecycle_events','security_findings')
  LOOP
    BEGIN
      EXECUTE format('UPDATE public.%I SET organization_id=$1 WHERE organization_id=$2',_t) USING _target,_legacy;
      GET DIAGNOSTICS _cnt = ROW_COUNT;
      IF _cnt > 0 THEN RAISE NOTICE 'Moved % rows from %', _cnt, _t; END IF;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'Skipped % due to: %', _t, SQLERRM;
    END;
  END LOOP;
END $$;

-- 3) Remove firmcop's legacy Default Org membership so FCL becomes active org
DELETE FROM public.organization_members
WHERE organization_id = '00000000-0000-0000-0000-000000000001'
  AND user_id = (SELECT id FROM auth.users WHERE email='firmcop@gmail.com');