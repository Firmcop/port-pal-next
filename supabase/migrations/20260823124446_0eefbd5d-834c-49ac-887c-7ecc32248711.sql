CREATE TABLE IF NOT EXISTS public.conversion_output_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversion_id uuid NOT NULL REFERENCES public.container_conversions(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL,
  target_kind text NOT NULL CHECK (target_kind IN ('planned_output','child_container')),
  target_id uuid,
  target_label text,
  action text NOT NULL CHECK (action IN ('create','update','delete')),
  old_values jsonb,
  new_values jsonb,
  reason text NOT NULL,
  changed_by uuid DEFAULT auth.uid(),
  changed_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.conversion_output_audit TO authenticated;
GRANT ALL ON public.conversion_output_audit TO service_role;
ALTER TABLE public.conversion_output_audit ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "coa_select_org" ON public.conversion_output_audit;
CREATE POLICY "coa_select_org" ON public.conversion_output_audit
  FOR SELECT TO authenticated
  USING (organization_id = public.current_org_id() OR public.is_platform_admin());

CREATE INDEX IF NOT EXISTS conversion_output_audit_conv_idx
  ON public.conversion_output_audit (conversion_id, changed_at DESC);

CREATE OR REPLACE FUNCTION public._assert_output_editable(_job public.container_conversions)
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF _job.status IN ('completed','cancelled') THEN
    IF NOT (public.is_org_admin(_job.organization_id) OR public.is_platform_admin()) THEN
      RAISE EXCEPTION 'forbidden: only an admin can change outputs on a % job', _job.status;
    END IF;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.update_conversion_output(
  _id uuid,
  _size container_size,
  _category container_category,
  _height_class container_height_class,
  _planned_count integer,
  _target_owner text,
  _notes text,
  _reason text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _row public.conversion_outputs%ROWTYPE;
  _job public.container_conversions%ROWTYPE;
  _created integer;
BEGIN
  IF _reason IS NULL OR length(btrim(_reason)) < 5 THEN
    RAISE EXCEPTION 'reason_required: please give a reason of at least 5 characters';
  END IF;
  SELECT * INTO _row FROM public.conversion_outputs WHERE id = _id;
  IF NOT FOUND THEN RAISE EXCEPTION 'output_not_found'; END IF;
  SELECT * INTO _job FROM public.container_conversions WHERE id = _row.conversion_id;
  PERFORM public._assert_output_editable(_job);

  IF _planned_count IS NULL OR _planned_count < 1 OR _planned_count > 50 THEN
    RAISE EXCEPTION 'invalid_count: planned count must be between 1 and 50';
  END IF;
  IF _category::text = 'dry' AND _height_class IS NULL THEN
    RAISE EXCEPTION 'height_required: dry containers need a height class';
  END IF;

  SELECT count(*) INTO _created
    FROM public.containers c
   WHERE c.parent_container_id = _job.container_id
     AND c.size = _row.size
     AND c.category = _row.category
     AND coalesce(c.height_class::text,'') = coalesce(_row.height_class::text,'');

  IF _planned_count < _created THEN
    RAISE EXCEPTION 'count_below_created: % child container(s) already exist for this spec', _created;
  END IF;
  IF _created > 0 AND (_size <> _row.size OR _category <> _row.category
      OR coalesce(_height_class::text,'') <> coalesce(_row.height_class::text,'')) THEN
    RAISE EXCEPTION 'spec_locked: children already created for this spec - only the count can change';
  END IF;

  UPDATE public.conversion_outputs
     SET size = _size,
         category = _category,
         height_class = CASE WHEN _category::text IN ('dry','reefer') THEN _height_class ELSE NULL END,
         planned_count = _planned_count,
         target_owner = nullif(btrim(coalesce(_target_owner,'')),''),
         notes = nullif(btrim(coalesce(_notes,'')),'')
   WHERE id = _id;

  INSERT INTO public.conversion_output_audit
    (conversion_id, organization_id, target_kind, target_id, target_label, action, old_values, new_values, reason, changed_by)
  VALUES (_job.id, _job.organization_id, 'planned_output', _id,
          concat(_row.size::text, ' ', _row.category::text), 'update',
          jsonb_build_object('size', _row.size, 'category', _row.category, 'height_class', _row.height_class,
                             'planned_count', _row.planned_count, 'target_owner', _row.target_owner, 'notes', _row.notes),
          jsonb_build_object('size', _size, 'category', _category, 'height_class', _height_class,
                             'planned_count', _planned_count, 'target_owner', _target_owner, 'notes', _notes),
          btrim(_reason), auth.uid());
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_conversion_output(_id uuid, _reason text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _row public.conversion_outputs%ROWTYPE;
  _job public.container_conversions%ROWTYPE;
  _created integer;
BEGIN
  IF _reason IS NULL OR length(btrim(_reason)) < 5 THEN
    RAISE EXCEPTION 'reason_required: please give a reason of at least 5 characters';
  END IF;
  SELECT * INTO _row FROM public.conversion_outputs WHERE id = _id;
  IF NOT FOUND THEN RAISE EXCEPTION 'output_not_found'; END IF;
  SELECT * INTO _job FROM public.container_conversions WHERE id = _row.conversion_id;
  PERFORM public._assert_output_editable(_job);

  SELECT count(*) INTO _created
    FROM public.containers c
   WHERE c.parent_container_id = _job.container_id
     AND c.size = _row.size
     AND c.category = _row.category
     AND coalesce(c.height_class::text,'') = coalesce(_row.height_class::text,'');
  IF _created > 0 THEN
    RAISE EXCEPTION 'children_exist: % child container(s) were produced for this spec - reduce the count instead', _created;
  END IF;

  DELETE FROM public.conversion_outputs WHERE id = _id;

  INSERT INTO public.conversion_output_audit
    (conversion_id, organization_id, target_kind, target_id, target_label, action, old_values, reason, changed_by)
  VALUES (_job.id, _job.organization_id, 'planned_output', _id,
          concat(_row.size::text, ' ', _row.category::text), 'delete',
          jsonb_build_object('size', _row.size, 'category', _row.category, 'height_class', _row.height_class,
                             'planned_count', _row.planned_count, 'target_owner', _row.target_owner, 'notes', _row.notes),
          btrim(_reason), auth.uid());
END;
$$;

CREATE OR REPLACE FUNCTION public.update_conversion_child_container(
  _container_id uuid,
  _size container_size,
  _category container_category,
  _height_class container_height_class,
  _notes text,
  _reason text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _c public.containers%ROWTYPE;
  _job public.container_conversions%ROWTYPE;
BEGIN
  IF _reason IS NULL OR length(btrim(_reason)) < 5 THEN
    RAISE EXCEPTION 'reason_required: please give a reason of at least 5 characters';
  END IF;
  SELECT * INTO _c FROM public.containers WHERE id = _container_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'container_not_found'; END IF;
  IF _c.parent_container_id IS NULL THEN RAISE EXCEPTION 'not_a_child_container'; END IF;
  IF NOT (public.is_org_admin(_c.organization_id) OR public.is_platform_admin()) THEN
    RAISE EXCEPTION 'forbidden: only an admin can edit produced containers';
  END IF;
  IF _category::text = 'dry' AND _height_class IS NULL THEN
    RAISE EXCEPTION 'height_required: dry containers need a height class';
  END IF;

  SELECT * INTO _job FROM public.container_conversions
   WHERE container_id = _c.parent_container_id
   ORDER BY created_at DESC LIMIT 1;

  UPDATE public.containers
     SET size = _size,
         category = _category,
         height_class = CASE WHEN _category::text IN ('dry','reefer') THEN _height_class ELSE NULL END,
         notes = nullif(btrim(coalesce(_notes,'')),'')
   WHERE id = _container_id;

  IF _job.id IS NOT NULL THEN
    INSERT INTO public.conversion_output_audit
      (conversion_id, organization_id, target_kind, target_id, target_label, action, old_values, new_values, reason, changed_by)
    VALUES (_job.id, _c.organization_id, 'child_container', _container_id, _c.container_number, 'update',
            jsonb_build_object('size', _c.size, 'category', _c.category, 'height_class', _c.height_class, 'notes', _c.notes),
            jsonb_build_object('size', _size, 'category', _category, 'height_class', _height_class, 'notes', _notes),
            btrim(_reason), auth.uid());
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.remove_conversion_child_container(_container_id uuid, _reason text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _c public.containers%ROWTYPE;
  _job public.container_conversions%ROWTYPE;
BEGIN
  IF _reason IS NULL OR length(btrim(_reason)) < 5 THEN
    RAISE EXCEPTION 'reason_required: please give a reason of at least 5 characters';
  END IF;
  SELECT * INTO _c FROM public.containers WHERE id = _container_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'container_not_found'; END IF;
  IF _c.parent_container_id IS NULL THEN RAISE EXCEPTION 'not_a_child_container'; END IF;
  IF NOT (public.is_org_admin(_c.organization_id) OR public.is_platform_admin()) THEN
    RAISE EXCEPTION 'forbidden: only an admin can remove produced containers';
  END IF;
  IF _c.status::text <> 'available' THEN
    RAISE EXCEPTION 'container_not_available: % is %, so it cannot be removed', _c.container_number, _c.status;
  END IF;
  IF EXISTS (SELECT 1 FROM public.container_sales WHERE container_id = _container_id) THEN
    RAISE EXCEPTION 'container_sold: % has a sale record', _c.container_number;
  END IF;
  IF EXISTS (SELECT 1 FROM public.lease_units WHERE container_id = _container_id) THEN
    RAISE EXCEPTION 'container_leased: % is on a lease', _c.container_number;
  END IF;
  IF EXISTS (SELECT 1 FROM public.conversion_containers WHERE container_id = _container_id) THEN
    RAISE EXCEPTION 'container_in_use: % is attached to another conversion job', _c.container_number;
  END IF;
  IF EXISTS (SELECT 1 FROM public.eir_records WHERE container_id = _container_id) THEN
    RAISE EXCEPTION 'container_has_eir: % already has gate records', _c.container_number;
  END IF;

  SELECT * INTO _job FROM public.container_conversions
   WHERE container_id = _c.parent_container_id
   ORDER BY created_at DESC LIMIT 1;

  DELETE FROM public.container_movements WHERE container_id = _container_id;
  DELETE FROM public.conversion_output_costs
   WHERE output_kind = 'container' AND output_id = _container_id;
  DELETE FROM public.containers WHERE id = _container_id;

  IF _job.id IS NOT NULL THEN
    INSERT INTO public.conversion_output_audit
      (conversion_id, organization_id, target_kind, target_id, target_label, action, old_values, reason, changed_by)
    VALUES (_job.id, _c.organization_id, 'child_container', _container_id, _c.container_number, 'delete',
            jsonb_build_object('size', _c.size, 'category', _c.category, 'height_class', _c.height_class,
                               'status', _c.status, 'acquisition_cost', _c.acquisition_cost),
            btrim(_reason), auth.uid());
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.update_conversion_output(uuid, container_size, container_category, container_height_class, integer, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_conversion_output(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_conversion_child_container(uuid, container_size, container_category, container_height_class, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.remove_conversion_child_container(uuid, text) TO authenticated;