
-- 1. gl_accounts
DROP POLICY IF EXISTS gl_accounts_insert ON public.gl_accounts;
DROP POLICY IF EXISTS gl_accounts_update ON public.gl_accounts;

CREATE POLICY gl_accounts_insert ON public.gl_accounts
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() IS NOT NULL AND organization_id = current_org_id());

CREATE POLICY gl_accounts_update ON public.gl_accounts
  FOR UPDATE TO authenticated
  USING (auth.uid() IS NOT NULL AND organization_id = current_org_id() AND NOT is_system)
  WITH CHECK (auth.uid() IS NOT NULL AND organization_id = current_org_id() AND NOT is_system);

-- 2. push_notification_queue (no organization_id column; scope via linked notification)
DROP POLICY IF EXISTS "Staff can view queue" ON public.push_notification_queue;

CREATE POLICY "Staff can view queue" ON public.push_notification_queue
  FOR SELECT TO authenticated
  USING (
    (
      has_role(auth.uid(), 'admin'::app_role)
      OR has_role(auth.uid(), 'yard_operator'::app_role)
      OR has_role(auth.uid(), 'gate_clerk'::app_role)
    )
    AND (
      notification_id IS NULL
      OR EXISTS (
        SELECT 1 FROM public.notifications n
        WHERE n.id = push_notification_queue.notification_id
          AND n.organization_id = current_org_id()
      )
    )
  );

CREATE POLICY "Admins can delete queue" ON public.push_notification_queue
  FOR DELETE TO authenticated
  USING (
    has_role(auth.uid(), 'admin'::app_role)
    AND (
      notification_id IS NULL
      OR EXISTS (
        SELECT 1 FROM public.notifications n
        WHERE n.id = push_notification_queue.notification_id
          AND n.organization_id = current_org_id()
      )
    )
  );

-- 3. realtime.messages
DROP POLICY IF EXISTS "Authenticated users can use realtime" ON realtime.messages;

CREATE POLICY "Authenticated users can use realtime" ON realtime.messages
  FOR SELECT TO authenticated
  USING (
    auth.uid() IS NOT NULL
    AND (
      realtime.topic() LIKE (current_org_id()::text || ':%')
      OR realtime.topic() LIKE ('user:' || auth.uid()::text || ':%')
    )
  );

CREATE POLICY "Authenticated users can send realtime" ON realtime.messages
  FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() IS NOT NULL
    AND (
      realtime.topic() LIKE (current_org_id()::text || ':%')
      OR realtime.topic() LIKE ('user:' || auth.uid()::text || ':%')
    )
  );

-- 4. Revoke EXECUTE on SECURITY DEFINER functions from anon/public
REVOKE EXECUTE ON FUNCTION public.has_permission(uuid, text, app_action) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_user_view_modules(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.trg_invoice_autopost_ledger() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.trg_invoice_paid_integrity() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.trg_gate_appt_completion_audit() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.trg_sale_sold_requires_invoice() FROM PUBLIC, anon, authenticated;
