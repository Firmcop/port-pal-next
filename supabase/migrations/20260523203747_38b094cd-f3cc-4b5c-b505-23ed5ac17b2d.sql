
-- 1. Org-scope SELECT policies on cross-org-readable tables
DO $$
DECLARE
  t text;
  tables text[] := ARRAY[
    'conversion_services','conversion_materials','conversion_labour','conversion_tasks',
    'cost_entries','purchases','goods_receipt_items','material_stock',
    'material_requests','repair_line_items'
  ];
  polname text;
BEGIN
  FOREACH t IN ARRAY tables LOOP
    FOR polname IN
      SELECT p.polname FROM pg_policy p
      JOIN pg_class c ON c.oid = p.polrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname='public' AND c.relname=t AND p.polcmd='r'
    LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', polname, t);
    END LOOP;
    EXECUTE format($f$
      CREATE POLICY "Org members can view %1$s"
        ON public.%1$I FOR SELECT
        TO authenticated
        USING (organization_id = current_org_id() OR is_platform_admin())
    $f$, t);
  END LOOP;
END $$;

-- 2. Container photos: restrict UPDATE to staff
DROP POLICY IF EXISTS "Authenticated users can update container photos" ON storage.objects;
CREATE POLICY "Staff can update container photos"
  ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'container-photos'
    AND (
      has_role(auth.uid(), 'admin'::app_role)
      OR has_role(auth.uid(), 'yard_operator'::app_role)
      OR has_role(auth.uid(), 'gate_clerk'::app_role)
    )
  )
  WITH CHECK (
    bucket_id = 'container-photos'
    AND (
      has_role(auth.uid(), 'admin'::app_role)
      OR has_role(auth.uid(), 'yard_operator'::app_role)
      OR has_role(auth.uid(), 'gate_clerk'::app_role)
    )
  );

-- 3. Depot-assets: restrict INSERT/UPDATE to admins
DROP POLICY IF EXISTS "Authenticated users can upload depot assets" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can update depot assets" ON storage.objects;
CREATE POLICY "Admins can upload depot assets"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'depot-assets' AND has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Admins can update depot assets"
  ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'depot-assets' AND has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (bucket_id = 'depot-assets' AND has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Admins can delete depot assets"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'depot-assets' AND has_role(auth.uid(), 'admin'::app_role));

-- 4. Realtime: only authenticated users may subscribe
ALTER TABLE realtime.messages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Authenticated users can use realtime" ON realtime.messages;
CREATE POLICY "Authenticated users can use realtime"
  ON realtime.messages FOR SELECT
  TO authenticated
  USING (auth.uid() IS NOT NULL);
