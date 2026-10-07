
-- 1) Multi-container conversion linking table
CREATE TABLE IF NOT EXISTS public.conversion_containers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversion_id uuid NOT NULL REFERENCES public.container_conversions(id) ON DELETE CASCADE,
  container_id  uuid NOT NULL REFERENCES public.containers(id),
  container_cost numeric(14,2) NOT NULL DEFAULT 0,
  transport_offloading_cost numeric(14,2) NOT NULL DEFAULT 0,
  role text NOT NULL DEFAULT 'secondary' CHECK (role IN ('primary','secondary')),
  organization_id uuid NOT NULL DEFAULT current_org_id(),
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (conversion_id, container_id)
);

CREATE INDEX IF NOT EXISTS idx_conversion_containers_conv ON public.conversion_containers(conversion_id);
CREATE INDEX IF NOT EXISTS idx_conversion_containers_cnt  ON public.conversion_containers(container_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.conversion_containers TO authenticated;
GRANT ALL ON public.conversion_containers TO service_role;

ALTER TABLE public.conversion_containers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org members can view conversion containers"
  ON public.conversion_containers FOR SELECT TO authenticated
  USING (organization_id = current_org_id() OR is_platform_admin());

CREATE POLICY "Admins & yard ops can write conversion containers"
  ON public.conversion_containers FOR ALL TO authenticated
  USING (organization_id = current_org_id() AND (has_role(auth.uid(),'admin') OR has_role(auth.uid(),'yard_operator') OR is_org_admin(auth.uid())))
  WITH CHECK (organization_id = current_org_id() AND (has_role(auth.uid(),'admin') OR has_role(auth.uid(),'yard_operator') OR is_org_admin(auth.uid())));

-- 2) Backfill primary rows from legacy container_conversions.container_id
INSERT INTO public.conversion_containers (conversion_id, container_id, container_cost, transport_offloading_cost, role, organization_id, created_by, created_at)
SELECT cc.id, cc.container_id,
       COALESCE(cc.container_cost, 0),
       COALESCE(cc.transport_offloading_cost, 0),
       'primary',
       cc.organization_id,
       cc.created_by,
       cc.created_at
FROM public.container_conversions cc
WHERE cc.container_id IS NOT NULL
ON CONFLICT (conversion_id, container_id) DO NOTHING;

-- 3) Quote linkage on downstream records
ALTER TABLE public.container_conversions
  ADD COLUMN IF NOT EXISTS quote_id uuid REFERENCES public.quotes(id) ON DELETE SET NULL;
ALTER TABLE public.container_sales
  ADD COLUMN IF NOT EXISTS quote_id uuid REFERENCES public.quotes(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_container_conversions_quote ON public.container_conversions(quote_id);
CREATE INDEX IF NOT EXISTS idx_container_sales_quote ON public.container_sales(quote_id);

-- 4) RPCs to attach / detach containers safely
CREATE OR REPLACE FUNCTION public.attach_container_to_conversion(
  _conversion_id uuid,
  _container_id uuid,
  _container_cost numeric DEFAULT 0,
  _transport_offloading_cost numeric DEFAULT 0
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _job public.container_conversions%ROWTYPE;
  _link_id uuid;
  _existing_primary uuid;
BEGIN
  SELECT * INTO _job FROM public.container_conversions WHERE id = _conversion_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'conversion_not_found'; END IF;
  IF _job.status NOT IN ('planning','in_progress') THEN
    RAISE EXCEPTION 'conversion_not_editable';
  END IF;

  SELECT id INTO _existing_primary FROM public.conversion_containers
    WHERE conversion_id = _conversion_id AND role = 'primary' LIMIT 1;

  INSERT INTO public.conversion_containers
    (conversion_id, container_id, container_cost, transport_offloading_cost, role, organization_id, created_by)
  VALUES
    (_conversion_id, _container_id, COALESCE(_container_cost,0), COALESCE(_transport_offloading_cost,0),
     CASE WHEN _existing_primary IS NULL THEN 'primary' ELSE 'secondary' END,
     _job.organization_id, auth.uid())
  RETURNING id INTO _link_id;

  -- mirror to legacy column if this is the primary and legacy is empty
  IF _existing_primary IS NULL AND _job.container_id IS NULL THEN
    UPDATE public.container_conversions
       SET container_id = _container_id,
           container_cost = COALESCE(_container_cost,0),
           transport_offloading_cost = COALESCE(_transport_offloading_cost,0)
     WHERE id = _conversion_id;
  END IF;

  UPDATE public.containers SET status = 'in_conversion'
   WHERE id = _container_id AND status <> 'in_conversion';

  RETURN _link_id;
END;
$$;

REVOKE ALL ON FUNCTION public.attach_container_to_conversion(uuid,uuid,numeric,numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.attach_container_to_conversion(uuid,uuid,numeric,numeric) TO authenticated;

CREATE OR REPLACE FUNCTION public.detach_container_from_conversion(_link_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _link public.conversion_containers%ROWTYPE;
  _job public.container_conversions%ROWTYPE;
BEGIN
  SELECT * INTO _link FROM public.conversion_containers WHERE id = _link_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'link_not_found'; END IF;
  SELECT * INTO _job FROM public.container_conversions WHERE id = _link.conversion_id;
  IF _job.status NOT IN ('planning','in_progress') THEN
    RAISE EXCEPTION 'conversion_not_editable';
  END IF;

  DELETE FROM public.conversion_containers WHERE id = _link_id;

  -- if we removed the legacy-mirrored container, clear legacy column
  IF _job.container_id = _link.container_id THEN
    UPDATE public.container_conversions
       SET container_id = NULL, container_cost = 0, transport_offloading_cost = 0
     WHERE id = _job.id;
  END IF;

  -- return container to available if not referenced by any other active job
  IF NOT EXISTS (
    SELECT 1 FROM public.conversion_containers cc
      JOIN public.container_conversions j ON j.id = cc.conversion_id
     WHERE cc.container_id = _link.container_id
       AND j.status IN ('planning','in_progress')
  ) THEN
    UPDATE public.containers SET status = 'available'
     WHERE id = _link.container_id AND status = 'in_conversion';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.detach_container_from_conversion(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.detach_container_from_conversion(uuid) TO authenticated;
