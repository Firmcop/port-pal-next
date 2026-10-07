ALTER TABLE public.containers
  ADD COLUMN IF NOT EXISTS ownership_type text NOT NULL DEFAULT 'shipper_owned',
  ADD COLUMN IF NOT EXISTS transporter text,
  ADD COLUMN IF NOT EXISTS driver_name text,
  ADD COLUMN IF NOT EXISTS driver_phone text,
  ADD COLUMN IF NOT EXISTS truck_registration text;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'containers_ownership_type_check'
  ) THEN
    ALTER TABLE public.containers
      ADD CONSTRAINT containers_ownership_type_check
      CHECK (ownership_type IN ('depot_owned','shipper_owned'));
  END IF;
END $$;