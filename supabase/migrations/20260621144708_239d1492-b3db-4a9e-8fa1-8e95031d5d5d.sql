ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS currency text;
ALTER TABLE public.suppliers ADD COLUMN IF NOT EXISTS currency text;