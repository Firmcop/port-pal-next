CREATE TABLE IF NOT EXISTS public.conversion_container_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversion_id uuid NOT NULL REFERENCES public.container_conversions(id) ON DELETE CASCADE,
  organization_id uuid,
  action text NOT NULL CHECK (action IN ('swap','detach','attach')),
  old_container_id uuid REFERENCES public.containers(id),
  new_container_id uuid REFERENCES public.containers(id),
  old_container_cost numeric DEFAULT 0,
  old_transport_offloading_cost numeric DEFAULT 0,
  new_container_cost numeric DEFAULT 0,
  new_transport_offloading_cost numeric DEFAULT 0,
  reason text NOT NULL,
  changed_by uuid,
  changed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cca_conversion ON public.conversion_container_audit(conversion_id, changed_at DESC);

GRANT SELECT ON public.conversion_container_audit TO authenticated;
GRANT ALL ON public.conversion_container_audit TO service_role;

ALTER TABLE public.conversion_container_audit ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Org members can view conversion container audit" ON public.conversion_container_audit;
CREATE POLICY "Org members can view conversion container audit"
ON public.conversion_container_audit
FOR SELECT TO authenticated
USING (public.is_platform_admin() OR organization_id = public.current_org_id());

CREATE OR REPLACE FUNCTION public.swap_conversion_container(
  _link_id uuid,
  _new_container_id uuid,
  _reason text,
  _container_cost numeric DEFAULT NULL,
  _transport_offloading_cost numeric DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _link public.conversion_containers%ROWTYPE;
  _job public.container_conversions%ROWTYPE;
  _new public.containers%ROWTYPE;
  _new_purchase numeric;
  _new_transport numeric;
BEGIN
  IF _reason IS NULL OR length(btrim(_reason)) < 10 THEN
    RAISE EXCEPTION 'reason_required: please give a reason of at least 10 characters';
  END IF;

  SELECT * INTO _link FROM public.conversion_containers WHERE id = _link_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'link_not_found'; END IF;

  SELECT * INTO _job FROM public.container_conversions WHERE id = _link.conversion_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'conversion_not_found'; END IF;

  IF _job.organization_id IS DISTINCT FROM public.current_org_id()
     AND NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  IF _job.status = 'cancelled' THEN
    RAISE EXCEPTION 'conversion_not_editable';
  ELSIF _job.status = 'completed' AND NOT (
        public.has_role(auth.uid(), 'admin'::app_role) OR public.is_platform_admin()
      ) THEN
    RAISE EXCEPTION 'admin_only: only an admin can change containers on a completed job';
  END IF;

  IF _new_container_id = _link.container_id THEN
    RAISE EXCEPTION 'same_container';
  END IF;

  SELECT * INTO _new FROM public.containers WHERE id = _new_container_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'container_not_found'; END IF;
  IF _new.organization_id IS DISTINCT FROM _job.organization_id THEN
    RAISE EXCEPTION 'container_other_org';
  END IF;
  IF _new.status IN ('sold','on_lease','booked_for_repatriation','converted') THEN
    RAISE EXCEPTION 'container_not_available: % is %', _new.container_number, _new.status;
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.conversion_containers
     WHERE conversion_id = _link.conversion_id AND container_id = _new_container_id
  ) THEN
    RAISE EXCEPTION 'container_already_attached';
  END IF;

  _new_purchase  := COALESCE(_container_cost, _link.container_cost, 0);
  _new_transport := COALESCE(_transport_offloading_cost, _link.transport_offloading_cost, 0);

  UPDATE public.conversion_containers
     SET container_id = _new_container_id,
         container_cost = _new_purchase,
         transport_offloading_cost = _new_transport
   WHERE id = _link_id;

  -- keep legacy mirror in sync when this row backs the job's primary container
  IF _job.container_id = _link.container_id THEN
    UPDATE public.container_conversions
       SET container_id = _new_container_id,
           container_cost = _new_purchase,
           transport_offloading_cost = _new_transport
     WHERE id = _job.id;
  END IF;

  -- release old container if no other active job holds it
  IF NOT EXISTS (
    SELECT 1 FROM public.conversion_containers cc
      JOIN public.container_conversions j ON j.id = cc.conversion_id
     WHERE cc.container_id = _link.container_id
       AND j.status IN ('planning','in_progress')
  ) THEN
    UPDATE public.containers SET status = 'available'
     WHERE id = _link.container_id AND status = 'in_conversion';
  END IF;

  IF _job.status IN ('planning','in_progress') THEN
    UPDATE public.containers SET status = 'in_conversion'
     WHERE id = _new_container_id AND status <> 'in_conversion';
  END IF;

  INSERT INTO public.conversion_container_audit
    (conversion_id, organization_id, action, old_container_id, new_container_id,
     old_container_cost, old_transport_offloading_cost,
     new_container_cost, new_transport_offloading_cost, reason, changed_by)
  VALUES
    (_job.id, _job.organization_id, 'swap', _link.container_id, _new_container_id,
     COALESCE(_link.container_cost,0), COALESCE(_link.transport_offloading_cost,0),
     _new_purchase, _new_transport, btrim(_reason), auth.uid());

  RETURN _link_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.swap_conversion_container(uuid, uuid, text, numeric, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.swap_conversion_container(uuid, uuid, text, numeric, numeric) TO authenticated;

CREATE OR REPLACE FUNCTION public.detach_container_from_conversion(_link_id uuid, _reason text DEFAULT NULL)
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
  IF _reason IS NULL OR length(btrim(_reason)) < 10 THEN
    RAISE EXCEPTION 'reason_required: please give a reason of at least 10 characters';
  END IF;

  DELETE FROM public.conversion_containers WHERE id = _link_id;

  IF _job.container_id = _link.container_id THEN
    UPDATE public.container_conversions
       SET container_id = NULL, container_cost = 0, transport_offloading_cost = 0
     WHERE id = _job.id;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.conversion_containers cc
      JOIN public.container_conversions j ON j.id = cc.conversion_id
     WHERE cc.container_id = _link.container_id
       AND j.status IN ('planning','in_progress')
  ) THEN
    UPDATE public.containers SET status = 'available'
     WHERE id = _link.container_id AND status = 'in_conversion';
  END IF;

  INSERT INTO public.conversion_container_audit
    (conversion_id, organization_id, action, old_container_id, new_container_id,
     old_container_cost, old_transport_offloading_cost, reason, changed_by)
  VALUES
    (_job.id, _job.organization_id, 'detach', _link.container_id, NULL,
     COALESCE(_link.container_cost,0), COALESCE(_link.transport_offloading_cost,0),
     btrim(_reason), auth.uid());
END;
$$;

REVOKE EXECUTE ON FUNCTION public.detach_container_from_conversion(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.detach_container_from_conversion(uuid, text) TO authenticated;