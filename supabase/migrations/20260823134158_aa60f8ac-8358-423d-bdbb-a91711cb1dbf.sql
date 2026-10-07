
CREATE OR REPLACE FUNCTION public.update_conversion_output(_id uuid, _size container_size, _category container_category, _height_class container_height_class, _planned_count integer, _target_owner text, _notes text, _reason text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _row public.conversion_outputs%ROWTYPE;
  _job public.container_conversions%ROWTYPE;
  _created integer;
  _parent_size int;
  _footprint int;
  _units int;
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
  IF _size IS NULL OR (_size::text) NOT IN ('10','20','30','40','45') THEN
    RAISE EXCEPTION 'invalid_size: pick a valid container size so the cost can be apportioned';
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

  -- the whole output mix must still fit the mother unit, otherwise the cost
  -- allocation could never sum back to the mother total
  IF _job.job_kind = 'split' THEN
    SELECT (size::text)::int INTO _parent_size FROM public.containers WHERE id = _job.container_id;
    IF _parent_size IS NULL THEN RAISE EXCEPTION 'split_requires_source_container'; END IF;

    SELECT COALESCE(SUM(CASE WHEN o.id = _id THEN (_size::text)::int * _planned_count
                             ELSE (o.size::text)::int * o.planned_count END), 0),
           COALESCE(SUM(CASE WHEN o.id = _id THEN _planned_count ELSE o.planned_count END), 0)
      INTO _footprint, _units
      FROM public.conversion_outputs o WHERE o.conversion_id = _job.id;

    IF _units < 1 THEN
      RAISE EXCEPTION 'no_outputs: a split job needs at least one output unit to carry the cost';
    END IF;
    IF _footprint > _parent_size THEN
      RAISE EXCEPTION 'split_size_compat: the outputs add up to %ft but the mother unit is only %ft', _footprint, _parent_size;
    END IF;
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
$function$;
