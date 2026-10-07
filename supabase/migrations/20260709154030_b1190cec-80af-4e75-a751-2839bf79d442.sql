
DROP POLICY IF EXISTS "Org staff insert trucks_drivers" ON public.trucks_drivers;
DROP POLICY IF EXISTS "Org staff update trucks_drivers" ON public.trucks_drivers;
DROP POLICY IF EXISTS "Org members view trucks_drivers" ON public.trucks_drivers;
DROP POLICY IF EXISTS "Org admins delete trucks_drivers" ON public.trucks_drivers;

CREATE POLICY "Org staff insert trucks_drivers" ON public.trucks_drivers
FOR INSERT TO authenticated
WITH CHECK (
  organization_id = current_org_id() AND (
    is_platform_admin() OR is_org_admin(auth.uid())
    OR has_role(auth.uid(), 'admin'::app_role)
    OR has_role(auth.uid(), 'yard_operator'::app_role)
    OR has_role(auth.uid(), 'gate_clerk'::app_role)
  )
);

CREATE POLICY "Org staff update trucks_drivers" ON public.trucks_drivers
FOR UPDATE TO authenticated
USING (
  is_platform_admin() OR (organization_id = current_org_id() AND (
    is_org_admin(auth.uid())
    OR has_role(auth.uid(), 'admin'::app_role)
    OR has_role(auth.uid(), 'yard_operator'::app_role)
    OR has_role(auth.uid(), 'gate_clerk'::app_role)
  ))
);

CREATE POLICY "Org members view trucks_drivers" ON public.trucks_drivers
FOR SELECT TO authenticated
USING (
  is_platform_admin() OR (organization_id = current_org_id() AND (
    is_org_admin(auth.uid())
    OR has_role(auth.uid(), 'admin'::app_role)
    OR has_role(auth.uid(), 'yard_operator'::app_role)
    OR has_role(auth.uid(), 'gate_clerk'::app_role)
    OR has_role(auth.uid(), 'viewer'::app_role)
  ))
);

CREATE POLICY "Org admins delete trucks_drivers" ON public.trucks_drivers
FOR DELETE TO authenticated
USING (
  is_platform_admin() OR (organization_id = current_org_id() AND (
    is_org_admin(auth.uid()) OR has_role(auth.uid(), 'admin'::app_role)
  ))
);
