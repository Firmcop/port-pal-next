CREATE OR REPLACE FUNCTION public.next_conversion_number(_org uuid, _customer uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _slug text;
  _seq int;
  _max int;
  _org_id uuid := COALESCE(_org, '00000000-0000-0000-0000-000000000001'::uuid);
  _candidate text;
  _i int := 0;
BEGIN
  _slug := public.customer_slug_for_conversion(_customer);

  -- Highest number already used for this slug anywhere (the unique index is global)
  SELECT COALESCE(MAX(NULLIF(regexp_replace(conversion_number, '^.*-', ''), '')::int), 0)
    INTO _max
  FROM public.container_conversions
  WHERE conversion_number ~ ('^CNV-' || _slug || '-[0-9]+$');

  INSERT INTO public.conversion_number_sequences AS s
    (organization_id, slug, last_seq, updated_at)
  VALUES (_org_id, _slug, GREATEST(_max, 0) + 1, now())
  ON CONFLICT (organization_id, slug) DO UPDATE
    SET last_seq = GREATEST(s.last_seq, _max) + 1, updated_at = now()
  RETURNING last_seq INTO _seq;

  LOOP
    _i := _i + 1;
    _candidate := 'CNV-' || _slug || '-' || lpad(_seq::text, 4, '0');
    EXIT WHEN NOT EXISTS (
      SELECT 1 FROM public.container_conversions WHERE conversion_number = _candidate
    ) OR _i > 50;
    _seq := _seq + 1;
    UPDATE public.conversion_number_sequences
       SET last_seq = _seq, updated_at = now()
     WHERE organization_id = _org_id AND slug = _slug;
  END LOOP;

  RETURN _candidate;
END;
$function$;