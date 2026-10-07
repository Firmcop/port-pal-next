
-- 1) Update attach RPC to backfill legacy primary container into join table before inserting new row
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

  -- Backfill: if no primary row exists yet but the legacy container_id is set,
  -- promote the legacy container into the join table so its cost isn't lost
  -- when the aggregator switches to the join-table branch.
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

-- 2) One-off backfill: for existing conversions that have a legacy container_id
-- but no matching primary row in the join table, insert one so the detail page
-- and completion flow account for it.
INSERT INTO public.conversion_containers
  (conversion_id, container_id, container_cost, transport_offloading_cost, role, organization_id, created_by)
SELECT cc.id, cc.container_id,
       COALESCE(cc.container_cost, 0),
       COALESCE(cc.transport_offloading_cost, 0),
       'primary', cc.organization_id, cc.created_by
FROM public.container_conversions cc
WHERE cc.container_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.conversion_containers x
     WHERE x.conversion_id = cc.id AND x.container_id = cc.container_id
  );
