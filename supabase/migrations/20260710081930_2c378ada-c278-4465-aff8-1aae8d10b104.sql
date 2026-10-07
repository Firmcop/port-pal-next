
DROP POLICY IF EXISTS "read defaults" ON public.role_permission_defaults;
CREATE POLICY "read defaults" ON public.role_permission_defaults
  FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role) OR is_platform_admin());
