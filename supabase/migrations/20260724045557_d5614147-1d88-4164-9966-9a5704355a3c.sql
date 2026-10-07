
REVOKE EXECUTE ON FUNCTION public.award_rfq(uuid, uuid, jsonb) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.create_rfq(jsonb) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.logistics_staff_confirm_deposit_and_pay(uuid, numeric, uuid, payment_method, text, timestamp with time zone, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.mark_supplier_invitation(uuid, text, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.next_rfq_number(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.record_supplier_quote(uuid, jsonb) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.resend_supplier_invitation(uuid, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.reverse_payment(uuid, text) FROM PUBLIC, anon;

DO $$
DECLARE
  entry text;
  entries text[] := ARRAY[
    'budgets|admin write budgets',
    'tax_returns|admin write tr',
    'etims_submissions|admin write etims',
    'fx_revaluation_runs|admin write fxrev',
    'fixed_asset_depreciation_runs|admin write fa_runs',
    'period_close_checklist|admin write pcc',
    'withholding_certificates|admin write wht',
    'fixed_assets|admin write fa',
    'year_end_closes|admin write yec',
    'petty_cash_floats|admin write pcf',
    'approval_workflows|admin write aw',
    'fx_rates|admin write fx',
    'tax_codes|admin write tc'
  ];
  parts text[];
  tbl text;
  pol text;
  actual text;
BEGIN
  FOREACH entry IN ARRAY entries LOOP
    parts := string_to_array(entry, '|');
    tbl := parts[1];
    pol := parts[2];
    -- find any ALL policy on this table to drop (name may vary)
    FOR actual IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename=tbl AND cmd='ALL' LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', actual, tbl);
    END LOOP;
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL TO authenticated USING ((organization_id = current_org_id()) AND (has_role(auth.uid(), ''admin''::app_role) OR is_platform_admin())) WITH CHECK ((organization_id = current_org_id()) AND (has_role(auth.uid(), ''admin''::app_role) OR is_platform_admin()))',
      pol, tbl
    );
  END LOOP;
END $$;

DROP POLICY IF EXISTS "asset_plans org write" ON public.asset_maintenance_plans;
CREATE POLICY "asset_plans org write" ON public.asset_maintenance_plans
  FOR ALL TO authenticated
  USING (((organization_id = current_org_id()) OR is_platform_admin())
    AND (has_role(auth.uid(),'admin'::app_role) OR is_platform_admin() OR has_permission(auth.uid(),'assets','edit')))
  WITH CHECK (((organization_id = current_org_id()) OR is_platform_admin())
    AND (has_role(auth.uid(),'admin'::app_role) OR is_platform_admin() OR has_permission(auth.uid(),'assets','edit')));

DROP POLICY IF EXISTS "asset_disposals org write" ON public.asset_disposals;
CREATE POLICY "asset_disposals org write" ON public.asset_disposals
  FOR ALL TO authenticated
  USING (((organization_id = current_org_id()) OR is_platform_admin())
    AND (has_role(auth.uid(),'admin'::app_role) OR is_platform_admin() OR has_permission(auth.uid(),'assets','edit')))
  WITH CHECK (((organization_id = current_org_id()) OR is_platform_admin())
    AND (has_role(auth.uid(),'admin'::app_role) OR is_platform_admin() OR has_permission(auth.uid(),'assets','edit')));

DO $$
DECLARE
  t text;
  tables text[] := ARRAY[
    'logistics_carriers','logistics_carrier_rates','logistics_drivers','logistics_routes',
    'logistics_shuttle_schedules','logistics_transport_orders','logistics_trip_costs',
    'logistics_trip_legs','logistics_trip_revenue','logistics_trips','logistics_vehicles'
  ];
  pol text;
BEGIN
  FOREACH t IN ARRAY tables LOOP
    pol := t || '_org_write';
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', pol, t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL TO authenticated
       USING (((organization_id = current_org_id()) OR is_platform_admin())
              AND (has_role(auth.uid(),''admin''::app_role) OR is_platform_admin() OR has_permission(auth.uid(),''logistics'',''edit'')))
       WITH CHECK (((organization_id = current_org_id()) OR is_platform_admin())
              AND (has_role(auth.uid(),''admin''::app_role) OR is_platform_admin() OR has_permission(auth.uid(),''logistics'',''edit'')))',
      pol, t
    );
  END LOOP;
END $$;
