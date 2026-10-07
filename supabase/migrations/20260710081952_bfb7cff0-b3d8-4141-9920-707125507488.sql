
DROP POLICY IF EXISTS "self read prefs" ON public.notification_preferences;
CREATE POLICY "self read prefs" ON public.notification_preferences
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR is_platform_admin());

DROP POLICY IF EXISTS "Authenticated users can use realtime" ON realtime.messages;
CREATE POLICY "Authenticated users can use realtime" ON realtime.messages
  FOR SELECT TO authenticated
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
          OR (
            has_role(auth.uid(), 'hr_manager'::app_role)
            AND (
              realtime.topic() LIKE (current_org_id()::text || ':payslips%')
              OR realtime.topic() LIKE (current_org_id()::text || ':payroll_runs%')
            )
          )
          OR (
            (has_role(auth.uid(), 'accountant'::app_role) OR has_role(auth.uid(), 'admin'::app_role))
            AND (
              realtime.topic() LIKE (current_org_id()::text || ':payments%')
              OR realtime.topic() LIKE (current_org_id()::text || ':payslips%')
              OR realtime.topic() LIKE (current_org_id()::text || ':finance_audit_log%')
              OR realtime.topic() LIKE (current_org_id()::text || ':payroll_runs%')
              OR realtime.topic() LIKE (current_org_id()::text || ':petty_cash_vouchers%')
              OR realtime.topic() LIKE (current_org_id()::text || ':withholding_certificates%')
              OR realtime.topic() LIKE (current_org_id()::text || ':fixed_asset_depreciation_runs%')
              OR realtime.topic() LIKE (current_org_id()::text || ':expense_claims%')
              OR realtime.topic() LIKE (current_org_id()::text || ':accounting_transactions%')
              OR realtime.topic() LIKE (current_org_id()::text || ':edi_exports%')
              OR realtime.topic() LIKE (current_org_id()::text || ':vendor_payments%')
            )
          )
        )
      )
    )
  );
