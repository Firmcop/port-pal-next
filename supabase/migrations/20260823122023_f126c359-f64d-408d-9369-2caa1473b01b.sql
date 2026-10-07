-- Attach: derive costs from live acquisition invoices (currency-converted) and
-- always keep the job header totals in sync with the attached containers.
CREATE OR REPLACE FUNCTION public.attach_container_to_conversion(
  _conversion_id uuid,
  _container_id uuid,
  _container_cost numeric DEFAULT NULL,
  _transport_offloading_cost numeric DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _job public.container_conversions%ROWTYPE;
  _link_id uuid;
  _existing_primary uuid;
  _sp numeric := 0;
  _ss numeric := 0;
  _cost numeric;
  _transport numeric;
BEGIN
  SELECT * INTO _job FROM public.container_conversions WHERE id = _conversion_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'conversion_not_found'; END IF;
  IF _job.status NOT IN ('planning','in_progress') THEN
    RAISE EXCEPTION 'conversion_not_editable';
  END IF;

  -- Live acquisition split, converted into the job currency.
  SELECT s.purchase, s.services INTO _sp, _ss
    FROM public.container_acquisition_split(_container_id, coalesce(_job.currency,'USD')) s;

  _cost := coalesce(_container_cost, _sp, 0);
  _transport := coalesce(_transport_offloading_cost, _ss, 0);

  SELECT id INTO _existing_primary FROM public.conversion_containers
    WHERE conversion_id = _conversion_id AND role = 'primary' LIMIT 1;

  IF _existing_primary IS NULL AND _job.container_id IS NOT NULL AND _job.container_id <> _container_id THEN
    INSERT INTO public.conversion_containers
      (conversion_id, container_id, container_cost, transport_offloading_cost, role, organization_id, created_by)
    VALUES
      (_conversion_id, _job.container_id,
       COALESCE(_job.container_cost, 0),
       COALESCE(_job.transport_offloading_cost, 0),
       'primary', _job.organization_id, auth.uid())
    RETURNING id INTO _existing_primary;
  END IF;

  INSERT INTO public.conversion_containers
    (conversion_id, container_id, container_cost, transport_offloading_cost, role, organization_id, created_by)
  VALUES
    (_conversion_id, _container_id, _cost, _transport,
     CASE WHEN _existing_primary IS NULL THEN 'primary' ELSE 'secondary' END,
     _job.organization_id, auth.uid())
  RETURNING id INTO _link_id;

  -- Always restate the legacy header columns from the join table so the
  -- Overview panel and the cost KPIs can never disagree.
  UPDATE public.container_conversions j
     SET container_id = COALESCE(j.container_id, _container_id),
         container_cost = t.p,
         transport_offloading_cost = t.s,
         updated_at = now()
    FROM (SELECT coalesce(sum(container_cost),0) p, coalesce(sum(transport_offloading_cost),0) s
            FROM public.conversion_containers WHERE conversion_id = _conversion_id) t
   WHERE j.id = _conversion_id;

  UPDATE public.containers SET status = 'in_conversion'
   WHERE id = _container_id AND status <> 'in_conversion';

  RETURN _link_id;
END;
$function$;

-- Detach: same header restatement instead of blanket zeroing.
CREATE OR REPLACE FUNCTION public.detach_container_from_conversion(_link_id uuid, _reason text DEFAULT NULL::text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _link public.conversion_containers%ROWTYPE;
  _job public.container_conversions%ROWTYPE;
  _next_primary uuid;
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

  IF _link.role = 'primary' THEN
    UPDATE public.conversion_containers SET role = 'primary'
     WHERE id = (SELECT id FROM public.conversion_containers
                  WHERE conversion_id = _job.id ORDER BY created_at LIMIT 1)
    RETURNING container_id INTO _next_primary;
  END IF;

  IF _job.container_id = _link.container_id THEN
    UPDATE public.container_conversions SET container_id = _next_primary WHERE id = _job.id;
  END IF;

  UPDATE public.container_conversions j
     SET container_cost = t.p, transport_offloading_cost = t.s, updated_at = now()
    FROM (SELECT coalesce(sum(container_cost),0) p, coalesce(sum(transport_offloading_cost),0) s
            FROM public.conversion_containers WHERE conversion_id = _job.id) t
   WHERE j.id = _job.id;

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
$function$;

GRANT EXECUTE ON FUNCTION public.container_acquisition_split(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.container_acquisition_total(uuid, text) TO authenticated;