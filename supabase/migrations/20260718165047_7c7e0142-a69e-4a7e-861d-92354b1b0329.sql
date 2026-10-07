
-- Enums
DO $$ BEGIN CREATE TYPE public.asset_class AS ENUM ('equipment','vehicle','facility','it','tool','other'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE public.asset_condition AS ENUM ('new','good','fair','poor','out_of_service'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE public.asset_disposal_method AS ENUM ('sale','scrap','donation','write_off','lost'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Extend fixed_assets
ALTER TABLE public.fixed_assets
  ADD COLUMN IF NOT EXISTS asset_class public.asset_class NOT NULL DEFAULT 'equipment',
  ADD COLUMN IF NOT EXISTS tag_number text,
  ADD COLUMN IF NOT EXISTS serial_number text,
  ADD COLUMN IF NOT EXISTS manufacturer text,
  ADD COLUMN IF NOT EXISTS model text,
  ADD COLUMN IF NOT EXISTS depot_id uuid REFERENCES public.depots(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS custodian_employee_id uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS vehicle_id uuid REFERENCES public.logistics_vehicles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS condition public.asset_condition NOT NULL DEFAULT 'good',
  ADD COLUMN IF NOT EXISTS warranty_expiry date,
  ADD COLUMN IF NOT EXISTS next_service_at date,
  ADD COLUMN IF NOT EXISTS service_interval_days integer,
  ADD COLUMN IF NOT EXISTS disposal_method public.asset_disposal_method,
  ADD COLUMN IF NOT EXISTS disposal_proceeds numeric(18,2),
  ADD COLUMN IF NOT EXISTS disposal_gain_loss numeric(18,2),
  ADD COLUMN IF NOT EXISTS notes text;
CREATE UNIQUE INDEX IF NOT EXISTS ux_fixed_assets_tag ON public.fixed_assets(organization_id, tag_number) WHERE tag_number IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_fixed_assets_depot ON public.fixed_assets(depot_id);
CREATE INDEX IF NOT EXISTS ix_fixed_assets_custodian ON public.fixed_assets(custodian_employee_id);
CREATE INDEX IF NOT EXISTS ix_fixed_assets_class ON public.fixed_assets(asset_class);

-- asset_assignments
CREATE TABLE IF NOT EXISTS public.asset_assignments (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id uuid NOT NULL,
  asset_id uuid NOT NULL REFERENCES public.fixed_assets(id) ON DELETE CASCADE,
  from_employee_id uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  to_employee_id uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  from_depot_id uuid REFERENCES public.depots(id) ON DELETE SET NULL,
  to_depot_id uuid REFERENCES public.depots(id) ON DELETE SET NULL,
  effective_at timestamptz NOT NULL DEFAULT now(),
  notes text,
  actor_user_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.asset_assignments TO authenticated;
GRANT ALL ON public.asset_assignments TO service_role;
ALTER TABLE public.asset_assignments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "asset_assignments org read" ON public.asset_assignments;
DROP POLICY IF EXISTS "asset_assignments org write" ON public.asset_assignments;
CREATE POLICY "asset_assignments org read" ON public.asset_assignments FOR SELECT TO authenticated USING (organization_id = public.current_org_id() OR public.is_platform_admin());
CREATE POLICY "asset_assignments org write" ON public.asset_assignments FOR ALL TO authenticated USING (organization_id = public.current_org_id() OR public.is_platform_admin()) WITH CHECK (organization_id = public.current_org_id() OR public.is_platform_admin());
CREATE INDEX IF NOT EXISTS ix_asset_assignments_asset ON public.asset_assignments(asset_id, effective_at DESC);

-- asset_maintenance_plans
CREATE TABLE IF NOT EXISTS public.asset_maintenance_plans (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id uuid NOT NULL,
  asset_id uuid NOT NULL REFERENCES public.fixed_assets(id) ON DELETE CASCADE,
  name text NOT NULL,
  frequency text NOT NULL CHECK (frequency IN ('daily','weekly','monthly','quarterly','annually','custom_days')),
  interval_days integer,
  next_due_at date NOT NULL,
  last_done_at date,
  task_template text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.asset_maintenance_plans TO authenticated;
GRANT ALL ON public.asset_maintenance_plans TO service_role;
ALTER TABLE public.asset_maintenance_plans ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "asset_plans org read" ON public.asset_maintenance_plans;
DROP POLICY IF EXISTS "asset_plans org write" ON public.asset_maintenance_plans;
CREATE POLICY "asset_plans org read" ON public.asset_maintenance_plans FOR SELECT TO authenticated USING (organization_id = public.current_org_id() OR public.is_platform_admin());
CREATE POLICY "asset_plans org write" ON public.asset_maintenance_plans FOR ALL TO authenticated USING (organization_id = public.current_org_id() OR public.is_platform_admin()) WITH CHECK (organization_id = public.current_org_id() OR public.is_platform_admin());
CREATE INDEX IF NOT EXISTS ix_asset_plans_due ON public.asset_maintenance_plans(next_due_at) WHERE is_active;

-- asset_disposals
CREATE TABLE IF NOT EXISTS public.asset_disposals (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id uuid NOT NULL,
  asset_id uuid NOT NULL REFERENCES public.fixed_assets(id) ON DELETE RESTRICT,
  method public.asset_disposal_method NOT NULL,
  disposed_on date NOT NULL DEFAULT current_date,
  buyer_customer_id uuid REFERENCES public.customers(id) ON DELETE SET NULL,
  proceeds numeric(18,2) NOT NULL DEFAULT 0,
  currency text,
  nbv_at_disposal numeric(18,2),
  gain_loss numeric(18,2),
  notes text,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','pending_approval','approved','posted','rejected')),
  approval_request_id uuid,
  posted_at timestamptz,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.asset_disposals TO authenticated;
GRANT ALL ON public.asset_disposals TO service_role;
ALTER TABLE public.asset_disposals ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "asset_disposals org read" ON public.asset_disposals;
DROP POLICY IF EXISTS "asset_disposals org write" ON public.asset_disposals;
CREATE POLICY "asset_disposals org read" ON public.asset_disposals FOR SELECT TO authenticated USING (organization_id = public.current_org_id() OR public.is_platform_admin());
CREATE POLICY "asset_disposals org write" ON public.asset_disposals FOR ALL TO authenticated USING (organization_id = public.current_org_id() OR public.is_platform_admin()) WITH CHECK (organization_id = public.current_org_id() OR public.is_platform_admin());

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname='set_currency_from_org') THEN
    EXECUTE 'DROP TRIGGER IF EXISTS trg_currency_asset_disposals ON public.asset_disposals';
    EXECUTE 'CREATE TRIGGER trg_currency_asset_disposals BEFORE INSERT ON public.asset_disposals FOR EACH ROW EXECUTE FUNCTION public.set_currency_from_org()';
  END IF;
END $$;

-- work_orders link
ALTER TABLE public.work_orders ADD COLUMN IF NOT EXISTS asset_id uuid REFERENCES public.fixed_assets(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS ix_work_orders_asset ON public.work_orders(asset_id);

-- Custodian history trigger
CREATE OR REPLACE FUNCTION public.log_asset_assignment()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF (TG_OP='INSERT' AND (NEW.custodian_employee_id IS NOT NULL OR NEW.depot_id IS NOT NULL))
     OR (TG_OP='UPDATE' AND (NEW.custodian_employee_id IS DISTINCT FROM OLD.custodian_employee_id OR NEW.depot_id IS DISTINCT FROM OLD.depot_id))
  THEN
    INSERT INTO public.asset_assignments(organization_id, asset_id, from_employee_id, to_employee_id, from_depot_id, to_depot_id, actor_user_id)
    VALUES (NEW.organization_id, NEW.id,
            CASE WHEN TG_OP='UPDATE' THEN OLD.custodian_employee_id END, NEW.custodian_employee_id,
            CASE WHEN TG_OP='UPDATE' THEN OLD.depot_id END, NEW.depot_id, auth.uid());
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.log_asset_assignment() FROM PUBLIC, anon;
DROP TRIGGER IF EXISTS trg_log_asset_assignment ON public.fixed_assets;
CREATE TRIGGER trg_log_asset_assignment AFTER INSERT OR UPDATE OF custodian_employee_id, depot_id ON public.fixed_assets FOR EACH ROW EXECUTE FUNCTION public.log_asset_assignment();

-- Advance maintenance plan
CREATE OR REPLACE FUNCTION public.advance_maintenance_plan(_plan_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE p record; step integer;
BEGIN
  SELECT * INTO p FROM public.asset_maintenance_plans WHERE id=_plan_id;
  IF NOT FOUND THEN RETURN; END IF;
  step := CASE p.frequency
    WHEN 'daily' THEN 1 WHEN 'weekly' THEN 7 WHEN 'monthly' THEN 30
    WHEN 'quarterly' THEN 91 WHEN 'annually' THEN 365
    ELSE COALESCE(p.interval_days,30) END;
  UPDATE public.asset_maintenance_plans
     SET last_done_at=current_date, next_due_at=current_date+step, updated_at=now()
   WHERE id=_plan_id;
END $$;
REVOKE ALL ON FUNCTION public.advance_maintenance_plan(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.advance_maintenance_plan(uuid) TO authenticated;

-- Post asset disposal
CREATE OR REPLACE FUNCTION public.post_asset_disposal(_disposal_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE d record; a record; nbv numeric;
BEGIN
  SELECT * INTO d FROM public.asset_disposals WHERE id=_disposal_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Disposal not found'; END IF;
  IF d.status='posted' THEN RETURN d.id; END IF;
  SELECT * INTO a FROM public.fixed_assets WHERE id=d.asset_id;
  nbv := COALESCE(a.cost,0) - COALESCE(a.accumulated_depreciation,0);
  UPDATE public.asset_disposals SET nbv_at_disposal=nbv, gain_loss=COALESCE(d.proceeds,0)-nbv, status='posted', posted_at=now(), updated_at=now() WHERE id=_disposal_id;
  UPDATE public.fixed_assets SET status='disposed', disposed_at=d.disposed_on, disposal_method=d.method, disposal_proceeds=d.proceeds, disposal_gain_loss=COALESCE(d.proceeds,0)-nbv, updated_at=now() WHERE id=d.asset_id;
  RETURN d.id;
END $$;
REVOKE ALL ON FUNCTION public.post_asset_disposal(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.post_asset_disposal(uuid) TO authenticated;

-- Module catalog entry
INSERT INTO public.modules_catalog(code, name, description, monthly_price, is_core, sort_order)
VALUES ('assets','Assets','Asset register, custodians, maintenance and disposals',0,false,55)
ON CONFLICT (code) DO UPDATE SET name=EXCLUDED.name, description=EXCLUDED.description;

-- Role defaults
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='role_permission_defaults') THEN
    INSERT INTO public.role_permission_defaults(role, module, action, allowed)
    SELECT r::public.app_role, 'assets', a::public.app_action, true
    FROM (VALUES ('admin'),('org_owner'),('asset_manager')) roles(r)
    CROSS JOIN (VALUES ('view'),('create'),('edit'),('delete'),('approve'),('export')) actions(a)
    ON CONFLICT DO NOTHING;
    INSERT INTO public.role_permission_defaults(role, module, action, allowed) VALUES
      ('viewer'::public.app_role,'assets','view'::public.app_action,true),
      ('accountant'::public.app_role,'assets','view'::public.app_action,true),
      ('accountant'::public.app_role,'assets','export'::public.app_action,true)
    ON CONFLICT DO NOTHING;
  END IF;
END $$;
