
CREATE OR REPLACE FUNCTION public.gate_in_upsert_container(_payload jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _id uuid;
  _num text := upper(trim(_payload->>'container_number'));
  _is_empty boolean := COALESCE(NULLIF(_payload->>'cargo_status',''),'empty') = 'empty';
  _org uuid := current_org_id();
  _height_class container_height_class := NULLIF(_payload->>'height_class','')::container_height_class;
BEGIN
  IF _payload->>'container_id' IS NOT NULL AND _payload->>'container_id' <> '' THEN
    _id := (_payload->>'container_id')::uuid;
    UPDATE public.containers SET
      status = 'available',
      is_empty = _is_empty,
      gate_in_at = now(),
      gate_out_at = NULL,
      owner = COALESCE(owner, NULLIF(_payload->>'owner','')),
      shipping_line = COALESCE(shipping_line, NULLIF(_payload->>'shipping_line','')),
      iso_type = COALESCE(iso_type, NULLIF(_payload->>'iso_type','')),
      tare_weight_kg = COALESCE(tare_weight_kg, NULLIF(_payload->>'tare_weight_kg','')::numeric),
      weight_kg = COALESCE(weight_kg, NULLIF(_payload->>'weight_kg','')::numeric),
      height_class = COALESCE(height_class, _height_class),
      updated_at = now()
    WHERE id = _id;
    RETURN _id;
  END IF;

  IF _num IS NULL OR _num = '' THEN
    RAISE EXCEPTION 'container_number_required';
  END IF;

  SELECT id INTO _id FROM public.containers
    WHERE organization_id = _org AND container_number = _num
    LIMIT 1;

  IF _id IS NOT NULL THEN
    UPDATE public.containers SET
      status = 'available',
      is_empty = _is_empty,
      gate_in_at = now(),
      gate_out_at = NULL,
      owner = COALESCE(owner, NULLIF(_payload->>'owner','')),
      shipping_line = COALESCE(shipping_line, NULLIF(_payload->>'shipping_line','')),
      iso_type = COALESCE(iso_type, NULLIF(_payload->>'iso_type','')),
      tare_weight_kg = COALESCE(tare_weight_kg, NULLIF(_payload->>'tare_weight_kg','')::numeric),
      weight_kg = COALESCE(weight_kg, NULLIF(_payload->>'weight_kg','')::numeric),
      height_class = COALESCE(height_class, _height_class),
      updated_at = now()
    WHERE id = _id;
    RETURN _id;
  END IF;

  INSERT INTO public.containers (
    container_number, size, category, iso_type, owner, shipping_line,
    tare_weight_kg, weight_kg, height_class, status, is_empty, gate_in_at, organization_id
  ) VALUES (
    _num,
    COALESCE(NULLIF(_payload->>'size',''), '20')::container_size,
    COALESCE(NULLIF(_payload->>'category',''), 'dry')::container_category,
    NULLIF(_payload->>'iso_type',''),
    NULLIF(_payload->>'owner',''),
    NULLIF(_payload->>'shipping_line',''),
    NULLIF(_payload->>'tare_weight_kg','')::numeric,
    NULLIF(_payload->>'weight_kg','')::numeric,
    _height_class,
    'available', _is_empty, now(), _org
  ) RETURNING id INTO _id;

  RETURN _id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.gate_in_upsert_container(jsonb) TO authenticated;
