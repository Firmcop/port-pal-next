
-- Fix accounting_transactions_broad_write_access: restrict INSERT/UPDATE to admin & accountant only
DROP POLICY IF EXISTS "Org staff insert accounting_transactions" ON public.accounting_transactions;
DROP POLICY IF EXISTS "Org staff update accounting_transactions" ON public.accounting_transactions;

CREATE POLICY "Finance staff insert accounting_transactions"
ON public.accounting_transactions
FOR INSERT
WITH CHECK (
  organization_id = current_org_id()
  AND (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'accountant'::app_role))
);

CREATE POLICY "Finance staff update accounting_transactions"
ON public.accounting_transactions
FOR UPDATE
USING (
  is_platform_admin() OR (
    organization_id = current_org_id()
    AND (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'accountant'::app_role))
  )
);

-- Fix realtime_payslips_broadcast: remove payslips from realtime publication so
-- postgres_changes subscriptions cannot receive payslip row events at all.
ALTER PUBLICATION supabase_realtime DROP TABLE public.payslips;
