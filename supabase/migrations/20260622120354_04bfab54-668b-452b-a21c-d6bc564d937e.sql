
-- 1) profiles: scope admin SELECT to same-org members
DROP POLICY IF EXISTS "Admins can view all profiles" ON public.profiles;
CREATE POLICY "Org admins can view org member profiles"
ON public.profiles FOR SELECT
USING (
  has_role(auth.uid(), 'admin'::app_role)
  AND EXISTS (
    SELECT 1 FROM public.organization_members om
    WHERE om.user_id = profiles.user_id
      AND om.organization_id = current_org_id()
  )
);

-- 2) depot-assets bucket: scope SELECT to objects under user's org-id folder.
-- Path layout: {organization_id}/{depot_id}/...  (depot uploads will use this prefix).
DROP POLICY IF EXISTS "Auth users can list depot assets" ON storage.objects;
CREATE POLICY "Org members can read own depot assets"
ON storage.objects FOR SELECT
USING (
  bucket_id = 'depot-assets'
  AND auth.uid() IS NOT NULL
  AND (storage.foldername(name))[1] = current_org_id()::text
);

-- Make admin write policies require the org-id prefix too
DROP POLICY IF EXISTS "Admins can upload depot assets" ON storage.objects;
CREATE POLICY "Admins can upload depot assets"
ON storage.objects FOR INSERT
WITH CHECK (
  bucket_id = 'depot-assets'
  AND has_role(auth.uid(), 'admin'::app_role)
  AND (storage.foldername(name))[1] = current_org_id()::text
);

DROP POLICY IF EXISTS "Admins can update depot assets" ON storage.objects;
CREATE POLICY "Admins can update depot assets"
ON storage.objects FOR UPDATE
USING (
  bucket_id = 'depot-assets'
  AND has_role(auth.uid(), 'admin'::app_role)
  AND (storage.foldername(name))[1] = current_org_id()::text
)
WITH CHECK (
  bucket_id = 'depot-assets'
  AND has_role(auth.uid(), 'admin'::app_role)
  AND (storage.foldername(name))[1] = current_org_id()::text
);

DROP POLICY IF EXISTS "Admins can delete depot assets" ON storage.objects;
CREATE POLICY "Admins can delete depot assets"
ON storage.objects FOR DELETE
USING (
  bucket_id = 'depot-assets'
  AND has_role(auth.uid(), 'admin'::app_role)
  AND (storage.foldername(name))[1] = current_org_id()::text
);

-- 3) push_notification_queue: require notification_id and org match (no NULL shortcut)
DROP POLICY IF EXISTS "Staff can view queue" ON public.push_notification_queue;
CREATE POLICY "Staff can view queue"
ON public.push_notification_queue FOR SELECT
USING (
  (has_role(auth.uid(), 'admin'::app_role)
   OR has_role(auth.uid(), 'yard_operator'::app_role)
   OR has_role(auth.uid(), 'gate_clerk'::app_role))
  AND notification_id IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM public.notifications n
    WHERE n.id = push_notification_queue.notification_id
      AND n.organization_id = current_org_id()
  )
);

DROP POLICY IF EXISTS "Admins can delete queue" ON public.push_notification_queue;
CREATE POLICY "Admins can delete queue"
ON public.push_notification_queue FOR DELETE
USING (
  has_role(auth.uid(), 'admin'::app_role)
  AND notification_id IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM public.notifications n
    WHERE n.id = push_notification_queue.notification_id
      AND n.organization_id = current_org_id()
  )
);

-- 4) realtime.messages: extend sensitive topic restriction set
DROP POLICY IF EXISTS "Authenticated users can send realtime" ON realtime.messages;
DROP POLICY IF EXISTS "Authenticated users can use realtime" ON realtime.messages;

CREATE POLICY "Authenticated users can use realtime"
ON realtime.messages FOR SELECT
USING (
  auth.uid() IS NOT NULL
  AND (
    realtime.topic() LIKE ('user:' || auth.uid()::text || ':%')
    OR (
      realtime.topic() LIKE (current_org_id()::text || ':%')
      AND (
        (
          realtime.topic() NOT LIKE (current_org_id()::text || ':payments%')
          AND realtime.topic() NOT LIKE (current_org_id()::text || ':payslips%')
          AND realtime.topic() NOT LIKE (current_org_id()::text || ':finance_audit_log%')
          AND realtime.topic() NOT LIKE (current_org_id()::text || ':payroll_runs%')
          AND realtime.topic() NOT LIKE (current_org_id()::text || ':petty_cash_vouchers%')
          AND realtime.topic() NOT LIKE (current_org_id()::text || ':withholding_certificates%')
          AND realtime.topic() NOT LIKE (current_org_id()::text || ':fixed_asset_depreciation_runs%')
          AND realtime.topic() NOT LIKE (current_org_id()::text || ':expense_claims%')
        )
        OR has_role(auth.uid(), 'admin'::app_role)
        OR has_role(auth.uid(), 'accountant'::app_role)
        OR has_role(auth.uid(), 'hr_manager'::app_role)
      )
    )
  )
);

CREATE POLICY "Authenticated users can send realtime"
ON realtime.messages FOR INSERT
WITH CHECK (
  auth.uid() IS NOT NULL
  AND (
    realtime.topic() LIKE ('user:' || auth.uid()::text || ':%')
    OR (
      realtime.topic() LIKE (current_org_id()::text || ':%')
      AND (
        (
          realtime.topic() NOT LIKE (current_org_id()::text || ':payments%')
          AND realtime.topic() NOT LIKE (current_org_id()::text || ':payslips%')
          AND realtime.topic() NOT LIKE (current_org_id()::text || ':finance_audit_log%')
          AND realtime.topic() NOT LIKE (current_org_id()::text || ':payroll_runs%')
          AND realtime.topic() NOT LIKE (current_org_id()::text || ':petty_cash_vouchers%')
          AND realtime.topic() NOT LIKE (current_org_id()::text || ':withholding_certificates%')
          AND realtime.topic() NOT LIKE (current_org_id()::text || ':fixed_asset_depreciation_runs%')
          AND realtime.topic() NOT LIKE (current_org_id()::text || ':expense_claims%')
        )
        OR has_role(auth.uid(), 'admin'::app_role)
        OR has_role(auth.uid(), 'accountant'::app_role)
        OR has_role(auth.uid(), 'hr_manager'::app_role)
      )
    )
  )
);

-- 5) Revoke anon/public execute on SECURITY DEFINER helper functions
REVOKE EXECUTE ON FUNCTION public.get_fx_rate(uuid, text, text, date) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.backfill_sales_currency(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_fx_rate(uuid, text, text, date) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.backfill_sales_currency(uuid, boolean) TO authenticated, service_role;
