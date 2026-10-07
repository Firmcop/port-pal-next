
ALTER FUNCTION public.delete_email(text, bigint) SET search_path = public, pgmq, extensions;
ALTER FUNCTION public.enqueue_email(text, jsonb) SET search_path = public, pgmq, extensions;
ALTER FUNCTION public.move_to_dlq(text, text, bigint, jsonb) SET search_path = public, pgmq, extensions;
ALTER FUNCTION public.read_email_batch(text, integer, integer) SET search_path = public, pgmq, extensions;
ALTER FUNCTION public.trg_post_inter_account_transfer() SET search_path = public;

DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT 'public.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' AS sig
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.prosecdef
      AND p.proname NOT IN ('get_invitation_preview')
      AND has_function_privilege('anon', p.oid, 'EXECUTE')
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM anon', r.sig);
  END LOOP;
END $$;

ALTER VIEW public.logistics_trip_pnl SET (security_invoker = true);

DROP POLICY IF EXISTS "Anyone can view container photos" ON storage.objects;
DROP POLICY IF EXISTS "Public can view depot assets" ON storage.objects;

CREATE POLICY "Auth users can list container photos"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'container-photos'
    AND (
      has_role(auth.uid(),'admin') OR has_role(auth.uid(),'yard_operator')
      OR has_role(auth.uid(),'gate_clerk') OR has_role(auth.uid(),'viewer')
      OR is_platform_admin()
    )
  );

CREATE POLICY "Auth users can list depot assets"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'depot-assets');

ALTER TABLE public.email_resend_attempts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Platform admins manage email resend attempts" ON public.email_resend_attempts;
CREATE POLICY "Platform admins manage email resend attempts"
  ON public.email_resend_attempts FOR ALL TO authenticated
  USING (is_platform_admin())
  WITH CHECK (is_platform_admin());
