
CREATE POLICY "quote_template_refs_read"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'quote-template-refs'
  AND (storage.foldername(name))[1] = public.current_org_id()::text
);

CREATE POLICY "quote_template_refs_write"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'quote-template-refs'
  AND (storage.foldername(name))[1] = public.current_org_id()::text
);

CREATE POLICY "quote_template_refs_delete"
ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'quote-template-refs'
  AND (storage.foldername(name))[1] = public.current_org_id()::text
);
