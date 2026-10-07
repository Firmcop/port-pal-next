
-- 1. Helpers
CREATE OR REPLACE FUNCTION public.can_view_module(_user uuid, _module text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.has_permission(_user, _module, 'view'::app_action)
$$;

CREATE OR REPLACE FUNCTION public.can_write_module(_user uuid, _module text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.has_permission(_user, _module, 'create'::app_action)
      OR public.has_permission(_user, _module, 'edit'::app_action)
$$;

REVOKE ALL ON FUNCTION public.can_view_module(uuid, text) FROM public, anon;
REVOKE ALL ON FUNCTION public.can_write_module(uuid, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.can_view_module(uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.can_write_module(uuid, text) TO authenticated, service_role;

-- 2. Rewrite policies per (table, module)
DO $mig$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      -- CRM
      ('customers','crm'),
      ('leads','crm'),
      ('deals','crm'),
      ('quotes','crm'),
      ('quote_items','crm'),
      ('quote_sections','crm'),
      ('quote_versions','crm'),
      ('quote_templates','crm'),
      ('quote_template_sections','crm'),
      ('quote_template_items','crm'),
      ('quote_visuals','crm'),
      ('sales_orders','crm'),
      ('sales_order_items','crm'),
      -- Manufacturing
      ('container_conversions','manufacturing'),
      ('conversion_containers','manufacturing'),
      ('conversion_materials','manufacturing'),
      ('conversion_labour','manufacturing'),
      ('conversion_services','manufacturing'),
      ('conversion_tasks','manufacturing'),
      ('conversion_outputs','manufacturing'),
      ('conversion_output_costs','manufacturing'),
      ('conversion_sub_assemblies','manufacturing'),
      ('finished_products','manufacturing'),
      ('sub_assembly_stock','manufacturing'),
      ('sub_assembly_movements','manufacturing'),
      ('sub_assembly_sales','manufacturing'),
      ('container_sales','manufacturing'),
      -- Procurement
      ('suppliers','procurement'),
      ('purchase_orders','procurement'),
      ('po_items','procurement'),
      ('goods_receipts','procurement'),
      ('goods_receipt_items','procurement'),
      ('supplier_invoices','procurement'),
      ('supplier_invoice_lines','procurement'),
      ('materials','procurement'),
      ('material_stock','procurement'),
      ('material_movements','procurement'),
      ('material_requests','procurement'),
      ('store_issues','procurement'),
      ('store_returns','procurement'),
      -- Inventory
      ('containers','inventory'),
      ('container_movements','inventory'),
      ('stock_adjustments','inventory')
    ) AS t(tbl, module)
  LOOP
    -- Drop old SELECT/INSERT/UPDATE/ALL policies (keep DELETE + Portal policies)
    DECLARE p record;
    BEGIN
      FOR p IN
        SELECT policyname, cmd FROM pg_policies
        WHERE schemaname='public' AND tablename=r.tbl
          AND cmd IN ('SELECT','INSERT','UPDATE','ALL')
          AND policyname NOT ILIKE 'Portal%'
      LOOP
        EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', p.policyname, r.tbl);
      END LOOP;
    END;

    -- Recreate standardized policies
    EXECUTE format($f$
      CREATE POLICY rbac_select ON public.%I
      FOR SELECT
      USING (
        public.is_platform_admin()
        OR (organization_id = public.current_org_id()
            AND public.can_view_module(auth.uid(), %L))
      )
    $f$, r.tbl, r.module);

    EXECUTE format($f$
      CREATE POLICY rbac_insert ON public.%I
      FOR INSERT
      WITH CHECK (
        public.is_platform_admin()
        OR (organization_id = public.current_org_id()
            AND public.can_write_module(auth.uid(), %L))
      )
    $f$, r.tbl, r.module);

    EXECUTE format($f$
      CREATE POLICY rbac_update ON public.%I
      FOR UPDATE
      USING (
        public.is_platform_admin()
        OR (organization_id = public.current_org_id()
            AND public.can_write_module(auth.uid(), %L))
      )
      WITH CHECK (
        public.is_platform_admin()
        OR (organization_id = public.current_org_id()
            AND public.can_write_module(auth.uid(), %L))
      )
    $f$, r.tbl, r.module, r.module);
  END LOOP;
END;
$mig$;
