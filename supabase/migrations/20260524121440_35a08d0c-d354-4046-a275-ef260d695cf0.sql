CREATE OR REPLACE FUNCTION public.get_user_view_modules(_user_id uuid)
RETURNS SETOF text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT DISTINCT m.module
  FROM (
    SELECT module FROM public.role_permission_defaults WHERE action = 'view' AND allowed = true
    UNION
    SELECT module FROM public.role_permission_overrides WHERE action = 'view' AND allowed = true
  ) m
  WHERE public.has_permission(_user_id, m.module, 'view'::app_action);
$$;