
CREATE POLICY "quote_visuals_select" ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'quote-visuals' AND (storage.foldername(name))[1] = current_org_id()::text);

CREATE POLICY "quote_visuals_insert" ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'quote-visuals'
  AND (storage.foldername(name))[1] = current_org_id()::text
  AND (has_role(auth.uid(),'admin') OR has_role(auth.uid(),'yard_operator'))
);

CREATE POLICY "quote_visuals_update" ON storage.objects FOR UPDATE TO authenticated
USING (
  bucket_id = 'quote-visuals'
  AND (storage.foldername(name))[1] = current_org_id()::text
  AND (has_role(auth.uid(),'admin') OR has_role(auth.uid(),'yard_operator'))
);

CREATE POLICY "quote_visuals_delete" ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'quote-visuals'
  AND (storage.foldername(name))[1] = current_org_id()::text
  AND (has_role(auth.uid(),'admin') OR has_role(auth.uid(),'yard_operator'))
);
