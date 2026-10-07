DROP POLICY IF EXISTS "Users can insert own notifications" ON public.notifications;
CREATE POLICY "Users can insert own notifications"
ON public.notifications FOR INSERT TO authenticated
WITH CHECK (auth.uid() = user_id AND organization_id = current_org_id());

CREATE OR REPLACE FUNCTION public.guard_profile_privileged_columns()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _is_admin boolean;
BEGIN
  IF NEW.approval_limits IS DISTINCT FROM OLD.approval_limits
     OR NEW.manager_id IS DISTINCT FROM OLD.manager_id THEN
    SELECT public.is_platform_admin()
        OR EXISTS (
          SELECT 1 FROM public.organization_members om
          WHERE om.user_id = NEW.user_id
            AND om.status = 'active'
            AND public.is_org_admin(om.organization_id)
        )
      INTO _is_admin;

    IF NOT COALESCE(_is_admin, false) THEN
      RAISE EXCEPTION 'Only administrators can change approval limits or manager assignment';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.guard_profile_privileged_columns() FROM PUBLIC;

DROP TRIGGER IF EXISTS trg_guard_profile_privileged_columns ON public.profiles;
CREATE TRIGGER trg_guard_profile_privileged_columns
BEFORE UPDATE ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.guard_profile_privileged_columns();