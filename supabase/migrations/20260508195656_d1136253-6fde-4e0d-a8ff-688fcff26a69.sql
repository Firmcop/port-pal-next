-- =========================================================
-- 1. Resend throttle
-- =========================================================
CREATE TABLE IF NOT EXISTS public.email_resend_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  kind text NOT NULL DEFAULT 'signup_verification',
  attempted_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS email_resend_attempts_email_idx
  ON public.email_resend_attempts (lower(email), attempted_at DESC);

ALTER TABLE public.email_resend_attempts ENABLE ROW LEVEL SECURITY;
-- No client policies — service role / SECURITY DEFINER access only.

CREATE OR REPLACE FUNCTION public.request_signup_resend(_email text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _norm text := lower(trim(_email));
  _last timestamptz;
  _hour_count int;
  _wait int;
BEGIN
  IF _norm IS NULL OR _norm = '' THEN
    RAISE EXCEPTION 'invalid_email' USING ERRCODE = '22023';
  END IF;

  SELECT max(attempted_at) INTO _last
  FROM public.email_resend_attempts
  WHERE lower(email) = _norm AND kind = 'signup_verification';

  IF _last IS NOT NULL AND _last > now() - interval '60 seconds' THEN
    _wait := 60 - EXTRACT(EPOCH FROM (now() - _last))::int;
    RAISE EXCEPTION 'cooldown:%', GREATEST(_wait, 1) USING ERRCODE = 'P0001';
  END IF;

  SELECT count(*) INTO _hour_count
  FROM public.email_resend_attempts
  WHERE lower(email) = _norm
    AND kind = 'signup_verification'
    AND attempted_at > now() - interval '1 hour';

  IF _hour_count >= 5 THEN
    RAISE EXCEPTION 'hourly_limit:3600' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.email_resend_attempts (email, kind) VALUES (_norm, 'signup_verification');

  RETURN jsonb_build_object('ok', true, 'next_allowed_at', (now() + interval '60 seconds'));
END;
$$;

REVOKE EXECUTE ON FUNCTION public.request_signup_resend(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.request_signup_resend(text) TO anon, authenticated;

-- =========================================================
-- 2. Organization lifecycle audit log
-- =========================================================
CREATE TABLE IF NOT EXISTS public.org_lifecycle_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  actor_user_id uuid,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS org_lifecycle_events_org_idx
  ON public.org_lifecycle_events (organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS org_lifecycle_events_type_idx
  ON public.org_lifecycle_events (event_type, created_at DESC);

ALTER TABLE public.org_lifecycle_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Platform admins read all lifecycle events"
  ON public.org_lifecycle_events FOR SELECT
  USING (public.is_platform_admin());

CREATE POLICY "Org admins read own lifecycle events"
  ON public.org_lifecycle_events FOR SELECT
  USING (public.is_org_admin(organization_id));

CREATE OR REPLACE FUNCTION public.log_org_event(
  _org_id uuid,
  _event_type text,
  _details jsonb DEFAULT '{}'::jsonb,
  _actor uuid DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _id uuid;
BEGIN
  INSERT INTO public.org_lifecycle_events (organization_id, event_type, actor_user_id, details)
  VALUES (_org_id, _event_type, COALESCE(_actor, auth.uid()), COALESCE(_details, '{}'::jsonb))
  RETURNING id INTO _id;
  RETURN _id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.log_org_event(uuid, text, jsonb, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.log_org_event(uuid, text, jsonb, uuid) TO authenticated, service_role;

-- =========================================================
-- 3. Update expire_trials to emit lifecycle events
-- =========================================================
CREATE OR REPLACE FUNCTION public.expire_trials()
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _org RECORD;
  _disabled_modules int;
  _deactivated_members int;
  _count int := 0;
BEGIN
  FOR _org IN
    SELECT id, owner_user_id, trial_ends_at FROM public.organizations
    WHERE status = 'trial' AND trial_ends_at < now()
  LOOP
    UPDATE public.organizations SET status = 'free' WHERE id = _org.id;

    PERFORM public.log_org_event(_org.id, 'trial_expired',
      jsonb_build_object('trial_ended_at', _org.trial_ends_at));

    WITH d AS (
      UPDATE public.subscription_modules
        SET enabled = false
        WHERE organization_id = _org.id AND module_code <> 'core' AND enabled = true
        RETURNING module_code
    )
    SELECT count(*) INTO _disabled_modules FROM d;

    WITH m AS (
      UPDATE public.organization_members
        SET status = 'inactive'
        WHERE organization_id = _org.id
          AND user_id <> _org.owner_user_id
          AND status = 'active'
        RETURNING user_id
    )
    SELECT count(*) INTO _deactivated_members FROM m;

    PERFORM public.log_org_event(_org.id, 'downgraded_to_free',
      jsonb_build_object(
        'modules_disabled', _disabled_modules,
        'members_deactivated', _deactivated_members
      ));

    _count := _count + 1;
  END LOOP;
  RETURN _count;
END;
$$;
