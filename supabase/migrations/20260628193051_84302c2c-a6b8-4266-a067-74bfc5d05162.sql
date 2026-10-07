
-- 1. Realtime topic policy: block additional sensitive tables
DROP POLICY IF EXISTS "Authenticated users can use realtime" ON realtime.messages;
DROP POLICY IF EXISTS "Authenticated users can send realtime" ON realtime.messages;

CREATE POLICY "Authenticated users can use realtime"
ON realtime.messages
FOR SELECT
TO authenticated
USING (
  auth.uid() IS NOT NULL AND (
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
          AND realtime.topic() NOT LIKE (current_org_id()::text || ':accounting_transactions%')
          AND realtime.topic() NOT LIKE (current_org_id()::text || ':edi_exports%')
          AND realtime.topic() NOT LIKE (current_org_id()::text || ':vendor_payments%')
        )
        OR has_role(auth.uid(), 'admin'::app_role)
        OR has_role(auth.uid(), 'accountant'::app_role)
        OR has_role(auth.uid(), 'hr_manager'::app_role)
      )
    )
  )
);

CREATE POLICY "Authenticated users can send realtime"
ON realtime.messages
FOR INSERT
TO authenticated
WITH CHECK (
  auth.uid() IS NOT NULL AND (
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
          AND realtime.topic() NOT LIKE (current_org_id()::text || ':accounting_transactions%')
          AND realtime.topic() NOT LIKE (current_org_id()::text || ':edi_exports%')
          AND realtime.topic() NOT LIKE (current_org_id()::text || ':vendor_payments%')
        )
        OR has_role(auth.uid(), 'admin'::app_role)
        OR has_role(auth.uid(), 'accountant'::app_role)
        OR has_role(auth.uid(), 'hr_manager'::app_role)
      )
    )
  )
);

-- 2. Restrict vendor_payments source-table SELECT to finance roles
DO $$
DECLARE p RECORD;
BEGIN
  FOR p IN SELECT polname FROM pg_policy WHERE polrelid = 'public.vendor_payments'::regclass AND polcmd = 'r' LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.vendor_payments', p.polname);
  END LOOP;
END $$;

CREATE POLICY "vendor_payments_select_finance_only"
ON public.vendor_payments
FOR SELECT
TO authenticated
USING (
  organization_id = current_org_id()
  AND (
    has_role(auth.uid(), 'admin'::app_role)
    OR has_role(auth.uid(), 'accountant'::app_role)
  )
);

-- 3. lease_invoices_run insert: enforce org scope
DROP POLICY IF EXISTS "Admins clerks insert lease billing runs" ON public.lease_invoices_run;

CREATE POLICY "Admins clerks insert lease billing runs"
ON public.lease_invoices_run
FOR INSERT
TO authenticated
WITH CHECK (
  organization_id = current_org_id()
  AND (
    has_role(auth.uid(), 'admin'::app_role)
    OR has_role(auth.uid(), 'gate_clerk'::app_role)
  )
);

-- 4. Revoke anon EXECUTE on internal SECURITY DEFINER functions
REVOKE EXECUTE ON FUNCTION public.apply_quote_template(uuid, uuid, text) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.apply_section_pack(uuid, uuid) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.approval_requests_audit_notify() FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.clone_quote_template(uuid, text) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.decide_approval_request(uuid, text, text) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.evaluate_approval_required(text, uuid, numeric, uuid) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.flag_document_for_approval() FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.notify_approval_target(uuid, uuid, text, text, text, uuid) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.restore_quote_template_version(uuid) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.save_quote_as_template(uuid, text, text, text) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.save_section_as_pack(uuid, text, text) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.set_created_by_default() FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.snapshot_quote_template(uuid, text) FROM anon, PUBLIC;

GRANT EXECUTE ON FUNCTION public.apply_quote_template(uuid, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.apply_section_pack(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.clone_quote_template(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.decide_approval_request(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.evaluate_approval_required(text, uuid, numeric, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.notify_approval_target(uuid, uuid, text, text, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.restore_quote_template_version(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.save_quote_as_template(uuid, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.save_section_as_pack(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.snapshot_quote_template(uuid, text) TO authenticated;

-- 5. Pin search_path on trigger function missing it
ALTER FUNCTION public.touch_quote_templates_updated_at() SET search_path = public;
