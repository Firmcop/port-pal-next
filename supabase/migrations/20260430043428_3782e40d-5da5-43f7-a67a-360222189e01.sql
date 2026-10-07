
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='lease_invoices_run' AND policyname='Portal users view own lease billing runs') THEN
    CREATE POLICY "Portal users view own lease billing runs"
    ON public.lease_invoices_run
    FOR SELECT
    TO authenticated
    USING (
      lease_id IN (
        SELECT id FROM public.lease_agreements
        WHERE customer_id = public.get_portal_customer_id(auth.uid())
      )
    );
  END IF;
END $$;
