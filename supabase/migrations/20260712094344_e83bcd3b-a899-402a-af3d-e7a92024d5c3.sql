
-- 1) Anon executable SECURITY DEFINER function: log_order_invoice_revenue is a trigger fn.
REVOKE ALL ON FUNCTION public.log_order_invoice_revenue() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.log_order_invoice_revenue() TO service_role;

-- 2) Security definer view: logistics_trip_pnl
ALTER VIEW public.logistics_trip_pnl SET (security_invoker = true);

-- 3) Restrict product-media SELECT policy to published product paths only.
DROP POLICY IF EXISTS "Public can read product media" ON storage.objects;

CREATE POLICY "Public can read published product media"
  ON storage.objects
  FOR SELECT
  TO anon, authenticated
  USING (
    bucket_id = 'product-media'
    AND EXISTS (
      SELECT 1 FROM public.products p
      WHERE p.is_published = true
        AND (
          p.cover_image_url = storage.objects.name
          OR p.gallery ? storage.objects.name
        )
    )
  );
