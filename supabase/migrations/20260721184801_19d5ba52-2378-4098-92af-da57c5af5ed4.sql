
ALTER TABLE public.containers
  ADD COLUMN IF NOT EXISTS pickup_location text,
  ADD COLUMN IF NOT EXISTS pickup_depot_id uuid REFERENCES public.depots(id),
  ADD COLUMN IF NOT EXISTS driver_id_number text;

ALTER TABLE public.eir_records
  ADD COLUMN IF NOT EXISTS pickup_depot_id uuid REFERENCES public.depots(id),
  ADD COLUMN IF NOT EXISTS driver_id_number text;
