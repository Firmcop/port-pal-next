
DROP POLICY IF EXISTS "expense_receipts_read" ON storage.objects;
CREATE POLICY "expense_receipts_read" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'expense-receipts'
    AND (public.is_platform_admin()
      OR (((storage.foldername(name))[1])::uuid = public.current_org_id()
          AND public.can_view_module(auth.uid(), 'accounting')))
  );

DROP POLICY IF EXISTS "expense_receipts_write" ON storage.objects;
CREATE POLICY "expense_receipts_write" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'expense-receipts'
    AND ((storage.foldername(name))[1])::uuid = public.current_org_id()
    AND (public.is_platform_admin() OR public.can_write_module(auth.uid(), 'accounting'))
  );

DROP POLICY IF EXISTS "expense_receipts_delete" ON storage.objects;
CREATE POLICY "expense_receipts_delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'expense-receipts'
    AND ((storage.foldername(name))[1])::uuid = public.current_org_id()
    AND (public.is_platform_admin() OR public.can_write_module(auth.uid(), 'accounting'))
  );
