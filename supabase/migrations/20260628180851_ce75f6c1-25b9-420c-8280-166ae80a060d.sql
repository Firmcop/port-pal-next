
-- Tighten SELECT policies to role-restricted reads

DROP POLICY IF EXISTS "org read ar" ON public.approval_requests;
CREATE POLICY "org read ar" ON public.approval_requests FOR SELECT
USING (
  is_platform_admin() OR (
    organization_id = current_org_id() AND (
      has_role(auth.uid(), 'admin'::app_role)
      OR has_role(auth.uid(), 'accountant'::app_role)
      OR has_role(auth.uid(), 'hr_manager'::app_role)
      OR requested_by = auth.uid()
      OR assigned_to = auth.uid()
    )
  )
);

DROP POLICY IF EXISTS "dl org read" ON public.dunning_log;
CREATE POLICY "dl org read" ON public.dunning_log FOR SELECT
USING (
  is_platform_admin() OR (
    organization_id = current_org_id() AND (
      has_role(auth.uid(), 'admin'::app_role)
      OR has_role(auth.uid(), 'accountant'::app_role)
      OR has_role(auth.uid(), 'gate_clerk'::app_role)
    )
  )
);

DROP POLICY IF EXISTS "dr org read" ON public.dunning_rules;
CREATE POLICY "dr org read" ON public.dunning_rules FOR SELECT
USING (
  is_platform_admin() OR (
    organization_id = current_org_id() AND (
      has_role(auth.uid(), 'admin'::app_role)
      OR has_role(auth.uid(), 'accountant'::app_role)
    )
  )
);

DROP POLICY IF EXISTS "org read wht" ON public.withholding_certificates;
CREATE POLICY "org read wht" ON public.withholding_certificates FOR SELECT
USING (
  is_platform_admin() OR (
    organization_id = current_org_id() AND (
      has_role(auth.uid(), 'admin'::app_role)
      OR has_role(auth.uid(), 'accountant'::app_role)
    )
  )
);

-- accounting_transactions: narrow Realtime/SELECT to finance roles
DROP POLICY IF EXISTS "Org members view accounting_transactions" ON public.accounting_transactions;
CREATE POLICY "Org members view accounting_transactions" ON public.accounting_transactions FOR SELECT
USING (
  is_platform_admin() OR (
    organization_id = current_org_id() AND (
      has_role(auth.uid(), 'admin'::app_role)
      OR has_role(auth.uid(), 'accountant'::app_role)
    )
  )
);
