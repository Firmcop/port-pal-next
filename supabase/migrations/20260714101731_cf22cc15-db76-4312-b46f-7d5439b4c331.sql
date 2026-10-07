
DO $$
DECLARE v text;
BEGIN
  FOR v IN
    SELECT viewname FROM pg_views WHERE schemaname='public' AND viewname IN (
      'conversion_variance_summary','employee_balances','employee_payroll_status',
      'finance_dashboard_metrics','financial_account_balances','logistics_trip_pnl',
      'project_pnl','unified_ledger_entries','v_account_balances','v_finance_data_health',
      'v_missing_postings','v_purchase_vat_summary','v_unposted_documents','v_unrecorded_payments'
    )
  LOOP
    EXECUTE format('ALTER VIEW public.%I SET (security_invoker = on)', v);
    EXECUTE format('GRANT SELECT ON public.%I TO authenticated', v);
    EXECUTE format('GRANT SELECT ON public.%I TO service_role', v);
  END LOOP;
END $$;
