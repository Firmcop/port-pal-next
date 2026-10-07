
CREATE POLICY "Public can read product media"
  ON storage.objects FOR SELECT TO anon, authenticated
  USING (bucket_id = 'product-media');

CREATE POLICY "Org members can upload product media"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'product-media' AND (storage.foldername(name))[1] = current_org_id()::text);

CREATE POLICY "Org members can update own product media"
  ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'product-media' AND (storage.foldername(name))[1] = current_org_id()::text);

CREATE POLICY "Org members can delete own product media"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'product-media' AND (storage.foldername(name))[1] = current_org_id()::text);
