CREATE OR REPLACE FUNCTION public.gate_out_upsert_container(_payload jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _id uuid;
  _num text := upper(trim(COALESCE(_payload->>'container_number','')));
  _purpose text := NULLIF(_payload->>'release_purpose','');
  _cargo text := COALESCE(NULLIF(_payload->>'cargo_status',''),'empty');
  _is_empty boolean := _cargo = 'empty';
  _new_status text;
  _org uuid := current_org_id();
BEGIN
  _new_status := CASE _purpose
                   WHEN 'sold_unit'     THEN 'sold'
                   WHEN 'lease_unit'    THEN 'on_lease'
                   WHEN 'repositioning' THEN 'in_transit'
                   WHEN 'repair'        THEN 'in_transit'
                   ELSE NULL
                 END;

  IF _payload->>'container_id' IS NOT NULL AND _payload->>'container_id' <> '' THEN
    _id := (_payload->>'container_id')::uuid;
  ELSIF _num <> '' THEN
    SELECT id INTO _id FROM public.containers
     WHERE container_number = _num AND org_id = _org
     LIMIT 1;
  END IF;

  IF _id IS NULL THEN
    RAISE EXCEPTION 'Container not found for gate-out (id=%, number=%)', _payload->>'container_id', _num;
  END IF;

  UPDATE public.containers SET
    status      = COALESCE(_new_status, status),
    is_empty    = _is_empty,
    gate_out_at = now(),
    owner         = COALESCE(NULLIF(_payload->>'owner',''), owner),
    shipping_line = COALESCE(NULLIF(_payload->>'shipping_line',''), shipping_line),
    iso_type      = COALESCE(NULLIF(_payload->>'iso_type',''), iso_type)
  WHERE id = _id AND org_id = _org;

  RETURN _id;
END;
$$;