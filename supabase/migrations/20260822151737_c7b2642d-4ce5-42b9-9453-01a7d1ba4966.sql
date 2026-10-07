-- 1. Revoke anon/public execute on internal trigger function
REVOKE EXECUTE ON FUNCTION public.sync_invoice_container_link() FROM PUBLIC, anon, authenticated;

-- 2. Customers: require an explicit customer-facing role in addition to the crm module permission
CREATE OR REPLACE FUNCTION public.can_view_customer_records(_user uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.can_view_module(_user, 'crm')
     AND EXISTS (
       SELECT 1 FROM public.user_roles ur
       WHERE ur.user_id = _user
         AND ur.organization_id = public.current_org_id()
         AND ur.role IN ('admin','org_owner','sales_manager','leasing_manager','accountant')
     );
$$;

DROP POLICY IF EXISTS rbac_select ON public.customers;
CREATE POLICY rbac_select ON public.customers
FOR SELECT TO authenticated
USING (
  public.is_platform_admin()
  OR (organization_id = public.current_org_id()
      AND (public.is_org_admin(organization_id) OR public.can_view_customer_records(auth.uid())))
);

-- 3. user_roles: manager visibility also requires active membership of the current org
CREATE OR REPLACE FUNCTION public.is_active_org_member(_org uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT _org IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.organization_members m
    WHERE m.organization_id = _org
      AND m.user_id = auth.uid()
      AND m.status = 'active'
  );
$$;

DROP POLICY IF EXISTS "Managers can view scoped org roles" ON public.user_roles;
CREATE POLICY "Managers can view scoped org roles" ON public.user_roles
FOR SELECT TO authenticated
USING (
  organization_id = public.current_org_id()
  AND public.is_active_org_member(organization_id)
  AND (
    user_id = auth.uid()
    OR public.user_directory_visible_roles(auth.uid()) IS NULL
    OR (cardinality(public.user_directory_visible_roles(auth.uid())) > 0
        AND role::text = ANY (public.user_directory_visible_roles(auth.uid())))
  )
);

-- 4. Realtime: keyword-based sensitivity gating so no finance topic can slip past exact-name matching
CREATE OR REPLACE FUNCTION public.realtime_topic_is_sensitive(_topic text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT _topic ~* '(payment|payroll|payslip|finance|financial|ledger|accounting|journal|expense_claim|withholding|petty_cash|depreciation|edi_export|salary|bank_)'
$$;

DROP POLICY IF EXISTS "Authenticated users can use realtime" ON realtime.messages;
CREATE POLICY "Authenticated users can use realtime" ON realtime.messages
FOR SELECT TO authenticated
USING (
  auth.uid() IS NOT NULL
  AND (
    realtime.topic() LIKE 'user:' || auth.uid()::text || ':%'
    OR (
      realtime.topic() LIKE public.current_org_id()::text || ':%'
      AND (
        NOT public.realtime_topic_is_sensitive(realtime.topic())
        OR public.has_role(auth.uid(), 'admin'::app_role)
        OR public.has_role(auth.uid(), 'accountant'::app_role)
        OR public.has_role(auth.uid(), 'hr_manager'::app_role)
      )
    )
  )
);

DROP POLICY IF EXISTS "Authenticated users can send realtime" ON realtime.messages;
CREATE POLICY "Authenticated users can send realtime" ON realtime.messages
FOR INSERT TO authenticated
WITH CHECK (
  auth.uid() IS NOT NULL
  AND (
    realtime.topic() LIKE 'user:' || auth.uid()::text || ':%'
    OR (
      realtime.topic() LIKE public.current_org_id()::text || ':%'
      AND (
        NOT public.realtime_topic_is_sensitive(realtime.topic())
        OR public.has_role(auth.uid(), 'admin'::app_role)
        OR public.has_role(auth.uid(), 'accountant'::app_role)
        OR public.has_role(auth.uid(), 'hr_manager'::app_role)
      )
    )
  )
);