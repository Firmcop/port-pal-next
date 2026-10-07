
-- Fix 1: Revoke anon EXECUTE on SECURITY DEFINER email queue functions
REVOKE EXECUTE ON FUNCTION public.email_queue_dispatch() FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.email_queue_wake() FROM anon, PUBLIC;

-- Fix 2: Restrict vendor_payments writes to admin/accountant only
DROP POLICY IF EXISTS "Org staff insert vendor_payments" ON public.vendor_payments;
DROP POLICY IF EXISTS "Org staff update vendor_payments" ON public.vendor_payments;

CREATE POLICY "Org finance insert vendor_payments"
ON public.vendor_payments
FOR INSERT
TO authenticated
WITH CHECK (
  organization_id = current_org_id()
  AND (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'accountant'::app_role))
);

CREATE POLICY "Org finance update vendor_payments"
ON public.vendor_payments
FOR UPDATE
TO authenticated
USING (
  is_platform_admin() OR (
    organization_id = current_org_id()
    AND (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'accountant'::app_role))
  )
)
WITH CHECK (
  organization_id = current_org_id()
  AND (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'accountant'::app_role))
);
