-- 1. Allow admins to read all profiles (for Users & Roles directory)
CREATE POLICY "Admins can view all profiles"
ON public.profiles
FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'admin'::app_role));

-- 2. Protected, atomic role-change function (admin-only)
CREATE OR REPLACE FUNCTION public.change_user_staff_role(
  _target_user_id uuid,
  _new_role public.app_role
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _admin_count int;
  _was_admin boolean;
BEGIN
  -- Only admins can change roles
  IF NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'Only admins can change user roles';
  END IF;

  -- Validate role is a staff role (customer is managed separately via portal)
  IF _new_role NOT IN ('admin'::app_role, 'yard_operator'::app_role, 'gate_clerk'::app_role, 'viewer'::app_role) THEN
    RAISE EXCEPTION 'Invalid staff role: %', _new_role;
  END IF;

  -- Prevent removing the last admin
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _target_user_id AND role = 'admin'::app_role
  ) INTO _was_admin;

  IF _was_admin AND _new_role <> 'admin'::app_role THEN
    SELECT COUNT(*) INTO _admin_count FROM public.user_roles WHERE role = 'admin'::app_role;
    IF _admin_count <= 1 THEN
      RAISE EXCEPTION 'Cannot remove the last admin account';
    END IF;
  END IF;

  -- Remove existing staff roles only (preserve 'customer' role for portal users)
  DELETE FROM public.user_roles
  WHERE user_id = _target_user_id
    AND role IN ('admin'::app_role, 'yard_operator'::app_role, 'gate_clerk'::app_role, 'viewer'::app_role);

  -- Insert the new staff role
  INSERT INTO public.user_roles (user_id, role)
  VALUES (_target_user_id, _new_role)
  ON CONFLICT (user_id, role) DO NOTHING;
END;
$$;

-- 3. One-time promotion: make the requesting account an admin
DELETE FROM public.user_roles
WHERE user_id = 'fb3b8214-1ba2-4ba8-8e2f-9217959fd9fb'
  AND role IN ('viewer'::app_role, 'yard_operator'::app_role, 'gate_clerk'::app_role);

INSERT INTO public.user_roles (user_id, role)
VALUES ('fb3b8214-1ba2-4ba8-8e2f-9217959fd9fb', 'admin'::app_role)
ON CONFLICT (user_id, role) DO NOTHING;