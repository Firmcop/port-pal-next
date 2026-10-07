
-- 1. staff_invitations
CREATE TABLE IF NOT EXISTS public.staff_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  email text NOT NULL,
  role public.app_role NOT NULL,
  display_name text,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '7 days'),
  invited_by uuid,
  accepted_at timestamptz,
  accepted_user_id uuid,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS staff_invitations_org_idx ON public.staff_invitations(organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS staff_invitations_email_idx ON public.staff_invitations(lower(email));

ALTER TABLE public.staff_invitations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org admins read invitations"
  ON public.staff_invitations FOR SELECT
  USING (public.is_org_admin(organization_id) OR public.is_platform_admin());

-- writes go through edge functions / SECURITY DEFINER RPCs only

-- 2. Public preview RPC for accept-invite page
CREATE OR REPLACE FUNCTION public.get_invitation_preview(_token_hash text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _row RECORD;
BEGIN
  SELECT i.email, i.role, i.expires_at, i.accepted_at, i.revoked_at, o.name AS org_name
    INTO _row
  FROM public.staff_invitations i
  JOIN public.organizations o ON o.id = i.organization_id
  WHERE i.token_hash = _token_hash;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('valid', false, 'reason', 'not_found');
  END IF;
  IF _row.revoked_at IS NOT NULL THEN
    RETURN jsonb_build_object('valid', false, 'reason', 'revoked');
  END IF;
  IF _row.accepted_at IS NOT NULL THEN
    RETURN jsonb_build_object('valid', false, 'reason', 'already_accepted');
  END IF;
  IF _row.expires_at < now() THEN
    RETURN jsonb_build_object('valid', false, 'reason', 'expired');
  END IF;

  RETURN jsonb_build_object(
    'valid', true,
    'email', _row.email,
    'role', _row.role,
    'organization_name', _row.org_name,
    'expires_at', _row.expires_at
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_invitation_preview(text) TO anon, authenticated;

-- 3. Trigger: log role changes to org_lifecycle_events
CREATE OR REPLACE FUNCTION public.log_user_role_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _org uuid;
  _target uuid;
  _action text;
  _role text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    _target := NEW.user_id;
    _role := NEW.role::text;
    _action := 'role_assigned';
  ELSIF TG_OP = 'DELETE' THEN
    _target := OLD.user_id;
    _role := OLD.role::text;
    _action := 'role_removed';
  ELSE
    RETURN NULL;
  END IF;

  -- Only log staff role changes (skip 'customer')
  IF _role NOT IN ('admin','yard_operator','gate_clerk','viewer') THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  SELECT organization_id INTO _org
  FROM public.organization_members
  WHERE user_id = _target AND status = 'active'
  ORDER BY created_at ASC LIMIT 1;

  IF _org IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  PERFORM public.log_org_event(_org, _action,
    jsonb_build_object('target_user_id', _target, 'role', _role),
    auth.uid());

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS user_roles_audit_log ON public.user_roles;
CREATE TRIGGER user_roles_audit_log
  AFTER INSERT OR DELETE ON public.user_roles
  FOR EACH ROW EXECUTE FUNCTION public.log_user_role_change();

-- 4. Trial extend / restart RPCs
CREATE OR REPLACE FUNCTION public.extend_trial(_org_id uuid, _days int)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _new_end timestamptz;
  _current timestamptz;
BEGIN
  IF NOT (public.is_org_admin(_org_id) OR public.is_platform_admin()) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  IF _days IS NULL OR _days <= 0 OR _days > 90 THEN
    RAISE EXCEPTION 'invalid_days';
  END IF;

  SELECT trial_ends_at INTO _current FROM public.organizations WHERE id = _org_id;
  _new_end := COALESCE(GREATEST(_current, now()), now()) + make_interval(days => _days);

  UPDATE public.organizations
    SET trial_ends_at = _new_end,
        status = CASE WHEN status IN ('free','trial') THEN 'trial'::org_status ELSE status END
    WHERE id = _org_id;

  PERFORM public.log_org_event(_org_id, 'trial_extended',
    jsonb_build_object('days', _days, 'new_trial_ends_at', _new_end), auth.uid());

  RETURN jsonb_build_object('ok', true, 'trial_ends_at', _new_end);
END;
$$;

CREATE OR REPLACE FUNCTION public.restart_trial(_org_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _new_end timestamptz;
  _restart_count int;
BEGIN
  IF NOT (public.is_org_admin(_org_id) OR public.is_platform_admin()) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  SELECT count(*) INTO _restart_count
    FROM public.org_lifecycle_events
    WHERE organization_id = _org_id AND event_type = 'trial_restarted';
  IF _restart_count >= 1 AND NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'already_restarted';
  END IF;

  _new_end := now() + interval '14 days';
  UPDATE public.organizations
    SET trial_ends_at = _new_end, status = 'trial'::org_status
    WHERE id = _org_id;

  PERFORM public.log_org_event(_org_id, 'trial_restarted',
    jsonb_build_object('new_trial_ends_at', _new_end), auth.uid());

  RETURN jsonb_build_object('ok', true, 'trial_ends_at', _new_end);
END;
$$;

-- 5. Set member status (suspend/reactivate/remove)
CREATE OR REPLACE FUNCTION public.set_member_status(_member_id uuid, _status text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _row RECORD;
BEGIN
  SELECT * INTO _row FROM public.organization_members WHERE id = _member_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'member_not_found'; END IF;
  IF NOT (public.is_org_admin(_row.organization_id) OR public.is_platform_admin()) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  IF _row.role = 'org_owner' AND _status <> 'active' THEN
    RAISE EXCEPTION 'cannot_modify_owner';
  END IF;
  IF _status NOT IN ('active','suspended','removed') THEN
    RAISE EXCEPTION 'invalid_status';
  END IF;

  IF _status = 'removed' THEN
    DELETE FROM public.organization_members WHERE id = _member_id;
  ELSE
    UPDATE public.organization_members SET status = _status WHERE id = _member_id;
  END IF;

  PERFORM public.log_org_event(_row.organization_id, 'member_status_changed',
    jsonb_build_object('member_id', _member_id, 'user_id', _row.user_id, 'status', _status),
    auth.uid());

  RETURN jsonb_build_object('ok', true);
END;
$$;
