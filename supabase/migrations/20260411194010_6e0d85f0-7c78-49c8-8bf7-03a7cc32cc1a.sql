
ALTER TABLE public.depots
  ADD COLUMN address_line1 text,
  ADD COLUMN address_line2 text,
  ADD COLUMN city text,
  ADD COLUMN country text,
  ADD COLUMN postal_code text,
  ADD COLUMN phone text,
  ADD COLUMN email text,
  ADD COLUMN website text,
  ADD COLUMN tax_id text,
  ADD COLUMN logo_url text,
  ADD COLUMN registration_number text,
  ADD COLUMN bank_name text,
  ADD COLUMN bank_account text,
  ADD COLUMN bank_branch text;

INSERT INTO storage.buckets (id, name, public)
VALUES ('depot-assets', 'depot-assets', true)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Public can view depot assets"
ON storage.objects FOR SELECT
USING (bucket_id = 'depot-assets');

CREATE POLICY "Authenticated users can upload depot assets"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'depot-assets');

CREATE POLICY "Authenticated users can update depot assets"
ON storage.objects FOR UPDATE
TO authenticated
USING (bucket_id = 'depot-assets');
