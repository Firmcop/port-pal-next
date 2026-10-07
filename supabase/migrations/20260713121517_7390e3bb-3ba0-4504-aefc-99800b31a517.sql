
DROP POLICY IF EXISTS "Org members view repatriations" ON public.repatriations;
DROP POLICY IF EXISTS "Org staff insert repatriations" ON public.repatriations;
DROP POLICY IF EXISTS "Org staff update repatriations" ON public.repatriations;
DROP POLICY IF EXISTS "Org admins delete repatriations" ON public.repatriations;

CREATE POLICY "Org members view repatriations" ON public.repatriations
FOR SELECT USING (
  is_platform_admin() OR (
    organization_id = current_org_id() AND (
      has_role(auth.uid(), 'admin'::app_role)
      OR has_role(auth.uid(), 'yard_operator'::app_role)
      OR has_role(auth.uid(), 'gate_clerk'::app_role)
      OR has_role(auth.uid(), 'viewer'::app_role)
      OR EXISTS (
        SELECT 1 FROM public.organization_members om
        WHERE om.organization_id = repatriations.organization_id
          AND om.user_id = auth.uid()
          AND om.role = 'org_owner'
          AND om.status = 'active'
      )
    )
  )
);

CREATE POLICY "Org staff insert repatriations" ON public.repatriations
FOR INSERT WITH CHECK (
  is_platform_admin() OR (
    organization_id = current_org_id() AND (
      has_role(auth.uid(), 'admin'::app_role)
      OR has_role(auth.uid(), 'yard_operator'::app_role)
      OR has_role(auth.uid(), 'gate_clerk'::app_role)
      OR EXISTS (
        SELECT 1 FROM public.organization_members om
        WHERE om.organization_id = repatriations.organization_id
          AND om.user_id = auth.uid()
          AND om.role = 'org_owner'
          AND om.status = 'active'
      )
    )
  )
);

CREATE POLICY "Org staff update repatriations" ON public.repatriations
FOR UPDATE USING (
  is_platform_admin() OR (
    organization_id = current_org_id() AND (
      has_role(auth.uid(), 'admin'::app_role)
      OR has_role(auth.uid(), 'yard_operator'::app_role)
      OR has_role(auth.uid(), 'gate_clerk'::app_role)
      OR EXISTS (
        SELECT 1 FROM public.organization_members om
        WHERE om.organization_id = repatriations.organization_id
          AND om.user_id = auth.uid()
          AND om.role = 'org_owner'
          AND om.status = 'active'
      )
    )
  )
);

CREATE POLICY "Org admins delete repatriations" ON public.repatriations
FOR DELETE USING (
  is_platform_admin() OR (
    organization_id = current_org_id() AND (
      has_role(auth.uid(), 'admin'::app_role)
      OR EXISTS (
        SELECT 1 FROM public.organization_members om
        WHERE om.organization_id = repatriations.organization_id
          AND om.user_id = auth.uid()
          AND om.role = 'org_owner'
          AND om.status = 'active'
      )
    )
  )
);

CREATE OR REPLACE FUNCTION public.set_repatriation_org()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _container_org uuid;
BEGIN
  IF NEW.container_id IS NOT NULL THEN
    SELECT organization_id INTO _container_org
    FROM public.containers WHERE id = NEW.container_id;
    IF _container_org IS NOT NULL THEN
      NEW.organization_id := _container_org;
    END IF;
  END IF;
  IF NEW.organization_id IS NULL THEN
    NEW.organization_id := current_org_id();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_set_repatriation_org ON public.repatriations;
CREATE TRIGGER trg_set_repatriation_org
BEFORE INSERT ON public.repatriations
FOR EACH ROW EXECUTE FUNCTION public.set_repatriation_org();
