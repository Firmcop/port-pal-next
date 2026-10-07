
-- 1. Auto-default organization_id to caller's current org
DO $$
DECLARE t text;
DECLARE biz_tables text[] := ARRAY[
  'containers','container_movements','gate_appointments','inspections','work_orders',
  'damage_estimates','invoices','invoice_line_items','payments','customers','leads',
  'deals','sales_orders','sales_order_items','quotes','quote_items','materials',
  'material_stock','material_requests','suppliers','employees','accounting_transactions',
  'tariffs','purchase_orders','po_items','purchases','goods_receipts','goods_receipt_items',
  'lease_agreements','lease_units','lease_quotations','lease_rate_cards','lease_invoices_run',
  'container_conversions','conversion_labour','conversion_materials','conversion_services',
  'conversion_tasks','container_sales','repatriations','repatriation_costs','cost_entries',
  'eir_records','release_instructions','repair_line_items','store_issues','store_returns',
  'trucks_drivers','vendor_payments','whatsapp_messages','yard_blocks','depots',
  'notifications','notification_log','customer_portal_users'
];
BEGIN
  FOREACH t IN ARRAY biz_tables LOOP
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN organization_id SET DEFAULT public.current_org_id()', t);
  END LOOP;
END $$;

-- 2. Drop existing policies on the tables we are rewriting
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT c.relname, p.polname
    FROM pg_policy p JOIN pg_class c ON p.polrelid=c.oid
    JOIN pg_namespace n ON c.relnamespace=n.oid
    WHERE n.nspname='public' AND c.relname IN (
      'containers','container_movements','gate_appointments','inspections','work_orders',
      'damage_estimates','invoices','invoice_line_items','payments','customers','leads',
      'deals','sales_orders','sales_order_items','quotes','quote_items','materials',
      'suppliers','employees','accounting_transactions','tariffs','purchase_orders','po_items',
      'lease_agreements','lease_units','lease_quotations','lease_rate_cards',
      'container_conversions','container_sales','repatriations','eir_records','goods_receipts',
      'trucks_drivers','yard_blocks','release_instructions','vendor_payments',
      'whatsapp_messages','depots'
    )
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', r.polname, r.relname);
  END LOOP;
END $$;

-- 3. Staff-only tables: uniform org-scoped policies
DO $$
DECLARE t text;
DECLARE staff_tables text[] := ARRAY[
  'inspections','work_orders','damage_estimates','leads','deals','sales_orders',
  'sales_order_items','quotes','quote_items','materials','suppliers','employees',
  'purchase_orders','po_items','lease_units','lease_quotations','lease_rate_cards',
  'container_conversions','container_sales','repatriations','eir_records','goods_receipts',
  'trucks_drivers','yard_blocks','release_instructions','vendor_payments','whatsapp_messages',
  'depots','tariffs','accounting_transactions','container_movements'
];
BEGIN
  FOREACH t IN ARRAY staff_tables LOOP
    EXECUTE format($f$
      CREATE POLICY "Org members view %1$s" ON public.%1$I FOR SELECT
      USING (
        public.is_platform_admin() OR (
          organization_id = public.current_org_id() AND (
            has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'yard_operator'::app_role)
            OR has_role(auth.uid(),'gate_clerk'::app_role) OR has_role(auth.uid(),'viewer'::app_role)
          )
        )
      )
    $f$, t);
    EXECUTE format($f$
      CREATE POLICY "Org staff insert %1$s" ON public.%1$I FOR INSERT
      WITH CHECK (
        organization_id = public.current_org_id() AND (
          has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'yard_operator'::app_role)
          OR has_role(auth.uid(),'gate_clerk'::app_role)
        )
      )
    $f$, t);
    EXECUTE format($f$
      CREATE POLICY "Org staff update %1$s" ON public.%1$I FOR UPDATE
      USING (
        public.is_platform_admin() OR (
          organization_id = public.current_org_id() AND (
            has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'yard_operator'::app_role)
            OR has_role(auth.uid(),'gate_clerk'::app_role)
          )
        )
      )
    $f$, t);
    EXECUTE format($f$
      CREATE POLICY "Org admins delete %1$s" ON public.%1$I FOR DELETE
      USING (
        public.is_platform_admin() OR (
          organization_id = public.current_org_id() AND has_role(auth.uid(),'admin'::app_role)
        )
      )
    $f$, t);
  END LOOP;
END $$;

-- 4. Portal-visible tables
-- containers
CREATE POLICY "Org staff view containers" ON public.containers FOR SELECT USING (
  public.is_platform_admin() OR (
    organization_id = public.current_org_id() AND (
      has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'yard_operator'::app_role)
      OR has_role(auth.uid(),'gate_clerk'::app_role) OR has_role(auth.uid(),'viewer'::app_role)
    )
  )
);
CREATE POLICY "Portal users view own containers" ON public.containers FOR SELECT USING (
  organization_id = (SELECT organization_id FROM public.customers WHERE id = public.get_portal_customer_id(auth.uid()))
  AND (
    owner = (SELECT company_name FROM public.customers WHERE id = public.get_portal_customer_id(auth.uid()))
    OR shipping_line = (SELECT company_name FROM public.customers WHERE id = public.get_portal_customer_id(auth.uid()))
  )
);
CREATE POLICY "Org staff insert containers" ON public.containers FOR INSERT WITH CHECK (
  organization_id = public.current_org_id() AND (
    has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'yard_operator'::app_role) OR has_role(auth.uid(),'gate_clerk'::app_role)
  )
);
CREATE POLICY "Org staff update containers" ON public.containers FOR UPDATE USING (
  public.is_platform_admin() OR (
    organization_id = public.current_org_id() AND (
      has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'yard_operator'::app_role) OR has_role(auth.uid(),'gate_clerk'::app_role)
    )
  )
);
CREATE POLICY "Org admins delete containers" ON public.containers FOR DELETE USING (
  public.is_platform_admin() OR (organization_id = public.current_org_id() AND has_role(auth.uid(),'admin'::app_role))
);

-- gate_appointments
CREATE POLICY "Org staff view gate_appointments" ON public.gate_appointments FOR SELECT USING (
  public.is_platform_admin() OR (
    organization_id = public.current_org_id() AND (
      has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'yard_operator'::app_role)
      OR has_role(auth.uid(),'gate_clerk'::app_role) OR has_role(auth.uid(),'viewer'::app_role)
    )
  )
);
CREATE POLICY "Portal users view own gate_appointments" ON public.gate_appointments FOR SELECT USING (
  organization_id = (SELECT organization_id FROM public.customers WHERE id = public.get_portal_customer_id(auth.uid()))
  AND (
    created_by = auth.uid()
    OR shipping_line = (SELECT company_name FROM public.customers WHERE id = public.get_portal_customer_id(auth.uid()))
  )
);
CREATE POLICY "Org staff insert gate_appointments" ON public.gate_appointments FOR INSERT WITH CHECK (
  organization_id = public.current_org_id() AND (
    has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'yard_operator'::app_role) OR has_role(auth.uid(),'gate_clerk'::app_role)
  )
);
CREATE POLICY "Portal users insert gate_appointments" ON public.gate_appointments FOR INSERT WITH CHECK (
  organization_id = (SELECT organization_id FROM public.customers WHERE id = public.get_portal_customer_id(auth.uid()))
  AND created_by = auth.uid()
);
CREATE POLICY "Org staff update gate_appointments" ON public.gate_appointments FOR UPDATE USING (
  public.is_platform_admin() OR (
    organization_id = public.current_org_id() AND (
      has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'yard_operator'::app_role) OR has_role(auth.uid(),'gate_clerk'::app_role)
    )
  )
);
CREATE POLICY "Org admins delete gate_appointments" ON public.gate_appointments FOR DELETE USING (
  public.is_platform_admin() OR (organization_id = public.current_org_id() AND has_role(auth.uid(),'admin'::app_role))
);

-- invoices
CREATE POLICY "Org staff view invoices" ON public.invoices FOR SELECT USING (
  public.is_platform_admin() OR (
    organization_id = public.current_org_id() AND (
      has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'yard_operator'::app_role)
      OR has_role(auth.uid(),'gate_clerk'::app_role) OR has_role(auth.uid(),'viewer'::app_role)
    )
  )
);
CREATE POLICY "Portal users view own invoices" ON public.invoices FOR SELECT USING (
  organization_id = (SELECT organization_id FROM public.customers WHERE id = public.get_portal_customer_id(auth.uid()))
  AND customer_name = (SELECT company_name FROM public.customers WHERE id = public.get_portal_customer_id(auth.uid()))
);
CREATE POLICY "Org clerks insert invoices" ON public.invoices FOR INSERT WITH CHECK (
  organization_id = public.current_org_id() AND (
    has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'gate_clerk'::app_role)
  )
);
CREATE POLICY "Org clerks update invoices" ON public.invoices FOR UPDATE USING (
  public.is_platform_admin() OR (
    organization_id = public.current_org_id() AND (
      has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'gate_clerk'::app_role)
    )
  )
);
CREATE POLICY "Org admins delete invoices" ON public.invoices FOR DELETE USING (
  public.is_platform_admin() OR (organization_id = public.current_org_id() AND has_role(auth.uid(),'admin'::app_role))
);

-- invoice_line_items
CREATE POLICY "Org members view invoice_line_items" ON public.invoice_line_items FOR SELECT USING (
  public.is_platform_admin() OR organization_id = public.current_org_id()
);
CREATE POLICY "Org clerks insert invoice_line_items" ON public.invoice_line_items FOR INSERT WITH CHECK (
  organization_id = public.current_org_id() AND (
    has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'gate_clerk'::app_role)
  )
);
CREATE POLICY "Org clerks update invoice_line_items" ON public.invoice_line_items FOR UPDATE USING (
  public.is_platform_admin() OR (
    organization_id = public.current_org_id() AND (
      has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'gate_clerk'::app_role)
    )
  )
);
CREATE POLICY "Org admins delete invoice_line_items" ON public.invoice_line_items FOR DELETE USING (
  public.is_platform_admin() OR (organization_id = public.current_org_id() AND has_role(auth.uid(),'admin'::app_role))
);

-- payments
CREATE POLICY "Org staff view payments" ON public.payments FOR SELECT USING (
  public.is_platform_admin() OR (
    organization_id = public.current_org_id() AND (
      has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'yard_operator'::app_role)
      OR has_role(auth.uid(),'gate_clerk'::app_role) OR has_role(auth.uid(),'viewer'::app_role)
    )
  )
);
CREATE POLICY "Portal users view own payments" ON public.payments FOR SELECT USING (
  organization_id = (SELECT organization_id FROM public.customers WHERE id = public.get_portal_customer_id(auth.uid()))
  AND invoice_id IN (
    SELECT i.id FROM public.invoices i
    WHERE i.organization_id = (SELECT organization_id FROM public.customers WHERE id = public.get_portal_customer_id(auth.uid()))
      AND i.customer_name = (SELECT company_name FROM public.customers WHERE id = public.get_portal_customer_id(auth.uid()))
  )
);
CREATE POLICY "Org clerks insert payments" ON public.payments FOR INSERT WITH CHECK (
  organization_id = public.current_org_id() AND (
    has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'gate_clerk'::app_role)
  )
);
CREATE POLICY "Org clerks update payments" ON public.payments FOR UPDATE USING (
  public.is_platform_admin() OR (
    organization_id = public.current_org_id() AND (
      has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'gate_clerk'::app_role)
    )
  )
);
CREATE POLICY "Org admins delete payments" ON public.payments FOR DELETE USING (
  public.is_platform_admin() OR (organization_id = public.current_org_id() AND has_role(auth.uid(),'admin'::app_role))
);

-- customers
CREATE POLICY "Org staff view customers" ON public.customers FOR SELECT USING (
  public.is_platform_admin() OR (
    organization_id = public.current_org_id() AND (
      has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'yard_operator'::app_role)
      OR has_role(auth.uid(),'gate_clerk'::app_role) OR has_role(auth.uid(),'viewer'::app_role)
    )
  )
);
CREATE POLICY "Portal users view own customer" ON public.customers FOR SELECT USING (
  id = public.get_portal_customer_id(auth.uid())
);
CREATE POLICY "Org staff insert customers" ON public.customers FOR INSERT WITH CHECK (
  organization_id = public.current_org_id() AND (
    has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'yard_operator'::app_role) OR has_role(auth.uid(),'gate_clerk'::app_role)
  )
);
CREATE POLICY "Org staff update customers" ON public.customers FOR UPDATE USING (
  public.is_platform_admin() OR (
    organization_id = public.current_org_id() AND (
      has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'yard_operator'::app_role) OR has_role(auth.uid(),'gate_clerk'::app_role)
    )
  )
);
CREATE POLICY "Org admins delete customers" ON public.customers FOR DELETE USING (
  public.is_platform_admin() OR (organization_id = public.current_org_id() AND has_role(auth.uid(),'admin'::app_role))
);

-- lease_agreements
CREATE POLICY "Org staff view lease_agreements" ON public.lease_agreements FOR SELECT USING (
  public.is_platform_admin() OR (
    organization_id = public.current_org_id() AND (
      has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'yard_operator'::app_role)
      OR has_role(auth.uid(),'gate_clerk'::app_role) OR has_role(auth.uid(),'viewer'::app_role)
    )
  )
);
CREATE POLICY "Portal users view own lease_agreements" ON public.lease_agreements FOR SELECT USING (
  organization_id = (SELECT organization_id FROM public.customers WHERE id = public.get_portal_customer_id(auth.uid()))
  AND customer_id = public.get_portal_customer_id(auth.uid())
);
CREATE POLICY "Org staff insert lease_agreements" ON public.lease_agreements FOR INSERT WITH CHECK (
  organization_id = public.current_org_id() AND (
    has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'yard_operator'::app_role) OR has_role(auth.uid(),'gate_clerk'::app_role)
  )
);
CREATE POLICY "Org staff update lease_agreements" ON public.lease_agreements FOR UPDATE USING (
  public.is_platform_admin() OR (
    organization_id = public.current_org_id() AND (
      has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'yard_operator'::app_role) OR has_role(auth.uid(),'gate_clerk'::app_role)
    )
  )
);
CREATE POLICY "Org admins delete lease_agreements" ON public.lease_agreements FOR DELETE USING (
  public.is_platform_admin() OR (organization_id = public.current_org_id() AND has_role(auth.uid(),'admin'::app_role))
);

-- 5. Org-scoped notification triggers
CREATE OR REPLACE FUNCTION public.notify_on_movement()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _container_number text; _user record;
BEGIN
  SELECT container_number INTO _container_number FROM public.containers WHERE id = NEW.container_id;
  FOR _user IN
    SELECT DISTINCT m.user_id FROM public.organization_members m
    JOIN public.user_roles ur ON ur.user_id = m.user_id
    WHERE m.organization_id = NEW.organization_id AND m.status = 'active'
  LOOP
    INSERT INTO public.notifications (user_id, organization_id, title, message, type, reference_id, reference_type)
    VALUES (_user.user_id, NEW.organization_id, 'Container Movement',
      COALESCE(_container_number,'Unknown') || ' — ' || REPLACE(NEW.movement_type::text,'_',' '),
      'movement', NEW.id, 'container_movements');
  END LOOP;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.notify_on_appointment_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _user record;
BEGIN
  IF TG_OP='INSERT' OR (TG_OP='UPDATE' AND OLD.status IS DISTINCT FROM NEW.status) THEN
    FOR _user IN
      SELECT DISTINCT m.user_id FROM public.organization_members m
      JOIN public.user_roles ur ON ur.user_id = m.user_id
      WHERE m.organization_id = NEW.organization_id AND m.status = 'active'
    LOOP
      INSERT INTO public.notifications (user_id, organization_id, title, message, type, reference_id, reference_type)
      VALUES (_user.user_id, NEW.organization_id, 'Gate Appointment',
        NEW.appointment_number || ' — ' || REPLACE(NEW.status::text,'_',' '),
        'appointment', NEW.id, 'gate_appointments');
    END LOOP;
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.notify_on_work_order_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _user record;
BEGIN
  IF TG_OP='INSERT' OR (TG_OP='UPDATE' AND (OLD.status IS DISTINCT FROM NEW.status OR OLD.assigned_to IS DISTINCT FROM NEW.assigned_to)) THEN
    FOR _user IN
      SELECT DISTINCT m.user_id FROM public.organization_members m
      JOIN public.user_roles ur ON ur.user_id = m.user_id
      WHERE m.organization_id = NEW.organization_id AND m.status = 'active'
    LOOP
      INSERT INTO public.notifications (user_id, organization_id, title, message, type, reference_id, reference_type)
      VALUES (_user.user_id, NEW.organization_id, 'Work Order',
        NEW.wo_number || ' — ' || REPLACE(NEW.status::text,'_',' '),
        'work_order', NEW.id, 'work_orders');
    END LOOP;
  END IF;
  RETURN NEW;
END $$;
