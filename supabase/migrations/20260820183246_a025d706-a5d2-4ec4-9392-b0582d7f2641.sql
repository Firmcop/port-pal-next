-- Invoices generated from a quote inherit the conversion job's project
CREATE OR REPLACE FUNCTION public.derive_invoice_project()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE _pid uuid;
BEGIN
  IF NEW.project_id IS NOT NULL OR NEW.customer_reference IS NULL THEN RETURN NEW; END IF;
  SELECT cc.project_id INTO _pid
    FROM public.quotes q
    JOIN public.container_conversions cc ON cc.quote_id = q.id
   WHERE q.quote_number = NEW.customer_reference
     AND cc.organization_id = NEW.organization_id
   LIMIT 1;
  IF _pid IS NOT NULL THEN NEW.project_id := _pid; END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_derive_invoice_project ON public.invoices;
CREATE TRIGGER trg_derive_invoice_project
BEFORE INSERT ON public.invoices
FOR EACH ROW EXECUTE FUNCTION public.derive_invoice_project();

REVOKE ALL ON FUNCTION public.derive_invoice_project() FROM PUBLIC, anon, authenticated;

-- When a job is linked to a quote/project, pull its already-issued invoices in
CREATE OR REPLACE FUNCTION public.sync_conversion_invoice_projects()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.project_id IS NULL OR NEW.quote_id IS NULL THEN RETURN NEW; END IF;

  UPDATE public.invoices i SET project_id = NEW.project_id
   WHERE i.project_id IS NULL
     AND i.organization_id = NEW.organization_id
     AND i.customer_reference = (SELECT q.quote_number FROM public.quotes q WHERE q.id = NEW.quote_id);

  UPDATE public.accounting_transactions t SET project_id = NEW.project_id
   WHERE t.project_id IS NULL AND t.reference_type = 'invoice'
     AND t.reference_id IN (SELECT id FROM public.invoices WHERE project_id = NEW.project_id);

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_sync_conversion_invoice_projects ON public.container_conversions;
CREATE TRIGGER trg_sync_conversion_invoice_projects
AFTER INSERT OR UPDATE OF project_id, quote_id ON public.container_conversions
FOR EACH ROW EXECUTE FUNCTION public.sync_conversion_invoice_projects();

REVOKE ALL ON FUNCTION public.sync_conversion_invoice_projects() FROM PUBLIC, anon, authenticated;

-- Backfill
UPDATE public.invoices i SET project_id = cc.project_id
  FROM public.quotes q JOIN public.container_conversions cc ON cc.quote_id = q.id
 WHERE i.project_id IS NULL AND i.customer_reference = q.quote_number
   AND i.organization_id = cc.organization_id AND cc.project_id IS NOT NULL;

UPDATE public.accounting_transactions t SET project_id = i.project_id
  FROM public.invoices i
 WHERE t.project_id IS NULL AND t.reference_type = 'invoice' AND t.reference_id = i.id
   AND i.project_id IS NOT NULL;
