ALTER TABLE public.lease_agreements
  ADD COLUMN IF NOT EXISTS container_size text,
  ADD COLUMN IF NOT EXISTS container_category container_category,
  ADD COLUMN IF NOT EXISTS height_class container_height_class;

CREATE OR REPLACE FUNCTION public.validate_lease_agreement_height_class()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.container_category = 'dry' AND NEW.height_class IS NULL THEN
    RAISE EXCEPTION 'height_class is required for dry containers (HC or LC)';
  END IF;
  IF NEW.container_category IS NOT NULL AND NEW.container_category <> 'dry' AND NEW.height_class IS NOT NULL THEN
    RAISE EXCEPTION 'height_class must be NULL for non-dry containers';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_lease_agreement_height_class ON public.lease_agreements;
CREATE TRIGGER trg_validate_lease_agreement_height_class
BEFORE INSERT OR UPDATE ON public.lease_agreements
FOR EACH ROW
EXECUTE FUNCTION public.validate_lease_agreement_height_class();