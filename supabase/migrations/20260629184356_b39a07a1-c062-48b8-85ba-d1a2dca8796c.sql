
INSERT INTO public.subscriptions (organization_id, status, billing_cycle, currency, base_fee, per_seat_fee, seat_limit, current_period_start, current_period_end, notes)
VALUES (
  '6b29b65b-fa63-4dcf-9854-ede5c9a8320b',
  'active', 'annual', 'KES', 0, 0, 25,
  now(), now() + interval '1 year',
  'Manually activated by platform admin'
)
ON CONFLICT (organization_id) DO UPDATE SET
  status = 'active',
  billing_cycle = 'annual',
  current_period_start = now(),
  current_period_end = now() + interval '1 year',
  seat_limit = GREATEST(COALESCE(public.subscriptions.seat_limit,0), 25),
  cancel_at_period_end = false;

INSERT INTO public.subscription_modules (organization_id, module_code, enabled, price_snapshot)
SELECT '6b29b65b-fa63-4dcf-9854-ede5c9a8320b', code, true, 0
FROM public.modules_catalog
ON CONFLICT (organization_id, module_code) DO UPDATE SET enabled = true;

SELECT public.log_org_event(
  '6b29b65b-fa63-4dcf-9854-ede5c9a8320b'::uuid,
  'subscription_activated',
  jsonb_build_object('reason','manual_activation','source','admin'),
  NULL
);

CREATE OR REPLACE FUNCTION public.org_subscription_active(_org uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.is_platform_admin()
      OR EXISTS (
           SELECT 1 FROM public.subscriptions s
           WHERE s.organization_id = _org
             AND s.status IN ('active','trial')
             AND s.current_period_end > now()
         );
$$;

REVOKE EXECUTE ON FUNCTION public.org_subscription_active(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.org_subscription_active(uuid) TO authenticated, service_role;
