
-- =========================================================
-- PHASE 1: Multi-tenant SaaS foundation
-- =========================================================

-- 1. Organizations (tenants)
CREATE TYPE public.org_status AS ENUM ('trial','active','past_due','suspended','cancelled');

CREATE TABLE public.organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text UNIQUE NOT NULL,
  country text,
  currency text NOT NULL DEFAULT 'USD',
  timezone text NOT NULL DEFAULT 'UTC',
  status public.org_status NOT NULL DEFAULT 'trial',
  trial_ends_at timestamptz NOT NULL DEFAULT (now() + interval '14 days'),
  owner_user_id uuid,
  billing_email text,
  tax_id text,
  logo_url text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_organizations_updated_at BEFORE UPDATE ON public.organizations
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 2. Organization members
CREATE TYPE public.org_member_role AS ENUM ('org_owner','admin','yard_operator','gate_clerk','viewer','customer');
CREATE TYPE public.org_member_status AS ENUM ('invited','active','suspended');

CREATE TABLE public.organization_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  role public.org_member_role NOT NULL DEFAULT 'viewer',
  status public.org_member_status NOT NULL DEFAULT 'active',
  invited_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, user_id)
);
CREATE INDEX idx_org_members_user ON public.organization_members(user_id);
CREATE INDEX idx_org_members_org ON public.organization_members(organization_id);
CREATE TRIGGER trg_org_members_updated_at BEFORE UPDATE ON public.organization_members
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 3. Platform admins (vendor side)
CREATE TABLE public.platform_admins (
  user_id uuid PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 4. Modules catalog
CREATE TABLE public.modules_catalog (
  code text PRIMARY KEY,
  name text NOT NULL,
  description text,
  monthly_price numeric(12,2) NOT NULL DEFAULT 0,
  is_core boolean NOT NULL DEFAULT false,
  sort_order int NOT NULL DEFAULT 100,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_modules_catalog_updated_at BEFORE UPDATE ON public.modules_catalog
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

INSERT INTO public.modules_catalog (code, name, description, monthly_price, is_core, sort_order) VALUES
  ('core','Core Platform','Dashboard, settings, notifications',0,true,1),
  ('inventory','Inventory & Yard','Container inventory and yard map',49,true,10),
  ('gate','Gate Operations','Appointments, EIR, trucks/drivers',39,false,20),
  ('mr','Maintenance & Repair','Inspections, estimates, work orders',39,false,30),
  ('billing','Billing & Tariffs','Tariffs, invoices, payments',39,false,40),
  ('accounting','Accounting','Ledger and financial summary',49,false,50),
  ('crm','CRM & Sales','Customers, leads, deals, quotes, sales orders',49,false,60),
  ('manufacturing','Manufacturing','Conversion jobs, container sales, materials',79,false,70),
  ('procurement','Procurement','Suppliers, POs, goods receipts',49,false,80),
  ('leasing','Leasing','Quotations, agreements, lease billing',79,false,90),
  ('portal','Customer Portal','Self-service portal for customers',29,false,100),
  ('whatsapp','WhatsApp Channel','WhatsApp notifications & inbound parsing',29,false,110);

-- 5. Helper functions
CREATE OR REPLACE FUNCTION public.is_platform_admin()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.platform_admins WHERE user_id = auth.uid())
$$;

CREATE OR REPLACE FUNCTION public.current_org_id()
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT organization_id FROM public.organization_members
  WHERE user_id = auth.uid() AND status = 'active'
  ORDER BY created_at ASC
  LIMIT 1
$$;

CREATE OR REPLACE FUNCTION public.org_has_module(_org_id uuid, _code text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT true  -- TODO: when subscription_modules exists, check it. For now everything is enabled.
$$;

-- 6. Default organization for backfill
INSERT INTO public.organizations (id, name, slug, status, trial_ends_at)
VALUES ('00000000-0000-0000-0000-000000000001','Default Organization','default','active', now() + interval '10 years');

-- Make every existing auth user a member of the default org (admin)
INSERT INTO public.organization_members (organization_id, user_id, role, status)
SELECT '00000000-0000-0000-0000-000000000001', id, 'admin', 'active'
FROM auth.users
ON CONFLICT (organization_id, user_id) DO NOTHING;

-- 7. Add organization_id to all business tables (with default = default org for backfill)
DO $$
DECLARE
  t text;
  business_tables text[] := ARRAY[
    'accounting_transactions','container_conversions','container_movements','container_sales',
    'containers','conversion_labour','conversion_materials','conversion_services','conversion_tasks',
    'cost_entries','customer_portal_users','customers','damage_estimates','deals','depots',
    'eir_records','employees','gate_appointments','goods_receipt_items','goods_receipts',
    'inspections','invoice_line_items','invoices','leads','lease_agreements','lease_invoices_run',
    'lease_quotations','lease_rate_cards','lease_units','material_requests','material_stock',
    'materials','notification_log','notifications','payments','po_items','purchase_orders',
    'purchases','quote_items','quotes','release_instructions','repair_line_items',
    'repatriation_costs','repatriations','sales_order_items','sales_orders','store_issues',
    'store_returns','suppliers','tariffs','trucks_drivers','vendor_payments','whatsapp_messages',
    'work_orders','yard_blocks'
  ];
BEGIN
  FOREACH t IN ARRAY business_tables LOOP
    EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS organization_id uuid', t);
    EXECUTE format('UPDATE public.%I SET organization_id = ''00000000-0000-0000-0000-000000000001'' WHERE organization_id IS NULL', t);
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN organization_id SET DEFAULT ''00000000-0000-0000-0000-000000000001''', t);
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN organization_id SET NOT NULL', t);
    EXECUTE format('ALTER TABLE public.%I ADD CONSTRAINT %I FOREIGN KEY (organization_id) REFERENCES public.organizations(id)', t, t || '_organization_id_fkey');
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON public.%I(organization_id)', 'idx_' || t || '_organization_id', t);
  END LOOP;
END$$;

-- 8. RLS for new tables
ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.platform_admins ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.modules_catalog ENABLE ROW LEVEL SECURITY;

-- Organizations: members can read their own org; platform admins manage everything
CREATE POLICY "Members read own organization" ON public.organizations
  FOR SELECT USING (id = public.current_org_id() OR public.is_platform_admin());
CREATE POLICY "Org owners and platform admins update" ON public.organizations
  FOR UPDATE USING (
    public.is_platform_admin() OR EXISTS (
      SELECT 1 FROM public.organization_members
      WHERE organization_id = organizations.id AND user_id = auth.uid()
        AND role IN ('org_owner','admin') AND status = 'active'
    )
  );
CREATE POLICY "Platform admins insert organizations" ON public.organizations
  FOR INSERT WITH CHECK (public.is_platform_admin());
CREATE POLICY "Platform admins delete organizations" ON public.organizations
  FOR DELETE USING (public.is_platform_admin());

-- Organization members: members can see roster of own org
CREATE POLICY "Members read own org roster" ON public.organization_members
  FOR SELECT USING (organization_id = public.current_org_id() OR public.is_platform_admin() OR user_id = auth.uid());
CREATE POLICY "Org admins manage members" ON public.organization_members
  FOR ALL USING (
    public.is_platform_admin() OR EXISTS (
      SELECT 1 FROM public.organization_members m
      WHERE m.organization_id = organization_members.organization_id
        AND m.user_id = auth.uid() AND m.role IN ('org_owner','admin') AND m.status = 'active'
    )
  ) WITH CHECK (
    public.is_platform_admin() OR EXISTS (
      SELECT 1 FROM public.organization_members m
      WHERE m.organization_id = organization_members.organization_id
        AND m.user_id = auth.uid() AND m.role IN ('org_owner','admin') AND m.status = 'active'
    )
  );

-- Platform admins: only platform admins
CREATE POLICY "Only platform admins read platform_admins" ON public.platform_admins
  FOR SELECT USING (public.is_platform_admin() OR user_id = auth.uid());
CREATE POLICY "Only platform admins manage platform_admins" ON public.platform_admins
  FOR ALL USING (public.is_platform_admin()) WITH CHECK (public.is_platform_admin());

-- Modules catalog: world-readable (used on pricing page); only platform admins write
CREATE POLICY "Anyone can read modules catalog" ON public.modules_catalog FOR SELECT USING (true);
CREATE POLICY "Platform admins manage modules catalog" ON public.modules_catalog
  FOR ALL USING (public.is_platform_admin()) WITH CHECK (public.is_platform_admin());
