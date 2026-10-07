-- Free seat limit
ALTER TABLE public.organizations 
  ADD COLUMN IF NOT EXISTS free_seat_limit int NOT NULL DEFAULT 1;

-- Update org_has_module to deny non-core for free orgs
CREATE OR REPLACE FUNCTION public.org_has_module(_org_id uuid, _code text)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT CASE
    WHEN _code = 'core' THEN true
    WHEN EXISTS (SELECT 1 FROM public.organizations WHERE id = _org_id AND status = 'free') THEN false
    ELSE EXISTS (
      SELECT 1 FROM public.subscription_modules
      WHERE organization_id = _org_id AND module_code = _code AND enabled = true
    )
  END
$function$;

-- Expire trials -> free
CREATE OR REPLACE FUNCTION public.expire_trials()
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _org RECORD;
  _count int := 0;
BEGIN
  FOR _org IN
    SELECT id, owner_user_id FROM public.organizations
    WHERE status = 'trial' AND trial_ends_at < now()
  LOOP
    UPDATE public.organizations SET status = 'free' WHERE id = _org.id;

    -- Disable paid modules
    UPDATE public.subscription_modules
      SET enabled = false
      WHERE organization_id = _org.id AND module_code <> 'core';

    -- Deactivate everyone except the original owner
    UPDATE public.organization_members
      SET status = 'inactive'
      WHERE organization_id = _org.id
        AND user_id <> _org.owner_user_id
        AND status = 'active';

    _count := _count + 1;
  END LOOP;
  RETURN _count;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.expire_trials() FROM anon, authenticated;
