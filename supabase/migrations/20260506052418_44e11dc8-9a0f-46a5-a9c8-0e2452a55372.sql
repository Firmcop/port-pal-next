
-- Phase 3: Subscriptions & module enforcement

CREATE TYPE public.subscription_status AS ENUM ('trial','active','past_due','suspended','cancelled');
CREATE TYPE public.billing_cycle AS ENUM ('monthly','annual');

CREATE TABLE public.subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL UNIQUE REFERENCES public.organizations(id) ON DELETE CASCADE,
  status public.subscription_status NOT NULL DEFAULT 'trial',
  billing_cycle public.billing_cycle NOT NULL DEFAULT 'monthly',
  currency text NOT NULL DEFAULT 'USD',
  base_fee numeric(12,2) NOT NULL DEFAULT 0,
  per_seat_fee numeric(12,2) NOT NULL DEFAULT 15,
  seat_limit integer,            -- null = unlimited
  current_period_start timestamptz NOT NULL DEFAULT now(),
  current_period_end timestamptz NOT NULL DEFAULT (now() + interval '1 month'),
  cancel_at_period_end boolean NOT NULL DEFAULT false,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_subscriptions_updated_at BEFORE UPDATE ON public.subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.subscription_modules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  module_code text NOT NULL REFERENCES public.modules_catalog(code) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT true,
  price_snapshot numeric(12,2) NOT NULL DEFAULT 0,
  enabled_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, module_code)
);
CREATE INDEX idx_sub_modules_org ON public.subscription_modules(organization_id);

ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscription_modules ENABLE ROW LEVEL SECURITY;

-- RLS: org members can view their own subscription; platform admins manage all
CREATE POLICY "Members can view own subscription" ON public.subscriptions
  FOR SELECT TO authenticated
  USING (organization_id = public.current_org_id() OR public.is_platform_admin());

CREATE POLICY "Platform admins manage subscriptions" ON public.subscriptions
  FOR ALL TO authenticated
  USING (public.is_platform_admin())
  WITH CHECK (public.is_platform_admin());

CREATE POLICY "Members view own subscription modules" ON public.subscription_modules
  FOR SELECT TO authenticated
  USING (organization_id = public.current_org_id() OR public.is_platform_admin());

CREATE POLICY "Platform admins manage subscription modules" ON public.subscription_modules
  FOR ALL TO authenticated
  USING (public.is_platform_admin())
  WITH CHECK (public.is_platform_admin());

-- Replace org_has_module with actual lookup
CREATE OR REPLACE FUNCTION public.org_has_module(_org_id uuid, _code text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT CASE
    WHEN _code IN ('core') THEN true
    ELSE EXISTS (
      SELECT 1 FROM public.subscription_modules
      WHERE organization_id = _org_id AND module_code = _code AND enabled = true
    )
  END
$$;

-- Seat helpers
CREATE OR REPLACE FUNCTION public.org_active_user_count(_org_id uuid)
RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT count(*)::int FROM public.organization_members
  WHERE organization_id = _org_id AND status = 'active'
$$;

-- Backfill: create a subscription + all modules for every existing organization
INSERT INTO public.subscriptions (organization_id, status, base_fee, per_seat_fee)
SELECT id,
       CASE WHEN status = 'trial' THEN 'trial'::subscription_status
            WHEN status = 'active' THEN 'active'::subscription_status
            ELSE 'active'::subscription_status END,
       0, 15
FROM public.organizations
ON CONFLICT (organization_id) DO NOTHING;

INSERT INTO public.subscription_modules (organization_id, module_code, price_snapshot, enabled)
SELECT o.id, mc.code, mc.monthly_price, true
FROM public.organizations o
CROSS JOIN public.modules_catalog mc
ON CONFLICT (organization_id, module_code) DO NOTHING;
