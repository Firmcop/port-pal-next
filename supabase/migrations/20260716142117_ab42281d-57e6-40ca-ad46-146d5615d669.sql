
-- 1. Regenerate any legacy conversion_number that doesn't match the new format,
--    so the CHECK / UNIQUE we add below cannot fail on historical data.
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT id, organization_id, customer_id
    FROM public.container_conversions
    WHERE conversion_number IS NOT NULL
      AND conversion_number !~ '^CNV-[A-Z0-9]{1,12}-[0-9]{4,}$'
    ORDER BY created_at
  LOOP
    UPDATE public.container_conversions
       SET conversion_number = public.next_conversion_number(r.organization_id, r.customer_id)
     WHERE id = r.id;
  END LOOP;
END $$;

-- 2. Break any accidental duplicates within the same organization by
--    re-issuing a fresh number for every non-first occurrence.
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT id, organization_id, customer_id
    FROM (
      SELECT id, organization_id, customer_id,
             row_number() OVER (
               PARTITION BY organization_id, conversion_number
               ORDER BY created_at
             ) AS rn
      FROM public.container_conversions
      WHERE conversion_number IS NOT NULL
    ) s
    WHERE rn > 1
  LOOP
    UPDATE public.container_conversions
       SET conversion_number = public.next_conversion_number(r.organization_id, r.customer_id)
     WHERE id = r.id;
  END LOOP;
END $$;

-- 3. Enforce format going forward. NULL still allowed — the BEFORE INSERT
--    trigger fills it in from next_conversion_number().
ALTER TABLE public.container_conversions
  DROP CONSTRAINT IF EXISTS container_conversions_conversion_number_format_chk;

ALTER TABLE public.container_conversions
  ADD CONSTRAINT container_conversions_conversion_number_format_chk
  CHECK (
    conversion_number IS NULL
    OR conversion_number ~ '^CNV-[A-Z0-9]{1,12}-[0-9]{4,}$'
  );

-- 4. Prevent duplicates per organization (partial: only rows that have a number).
DROP INDEX IF EXISTS public.container_conversions_org_number_uniq;
CREATE UNIQUE INDEX container_conversions_org_number_uniq
  ON public.container_conversions (organization_id, conversion_number)
  WHERE conversion_number IS NOT NULL;
