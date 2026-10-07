CREATE OR REPLACE FUNCTION public.customer_slug_for_conversion(_customer_id uuid)
RETURNS text
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  _name text;
  _norm text;
  _token text;
  _rest text;
  _noise text[] := ARRAY['THE','MS','MRS','MR','DR','M'];
BEGIN
  IF _customer_id IS NULL THEN
    RETURN 'NOCUST';
  END IF;

  SELECT COALESCE(NULLIF(btrim(company_name), ''), NULLIF(btrim(contact_person), ''))
    INTO _name
  FROM public.customers
  WHERE id = _customer_id;

  IF _name IS NULL OR _name = '' THEN
    RETURN 'NOCUST';
  END IF;

  _norm := btrim(regexp_replace(upper(public.unaccent(_name)), '[^A-Z0-9]+', ' ', 'g'));

  IF _norm = '' THEN
    RETURN 'CUST' || upper(substr(replace(_customer_id::text, '-', ''), 1, 6));
  END IF;

  _token := split_part(_norm, ' ', 1);
  _rest  := btrim(substr(_norm, length(_token) + 1));

  IF _token = ANY(_noise) AND _rest <> '' THEN
    _token := split_part(_rest, ' ', 1);
  END IF;

  _token := regexp_replace(_token, '[^A-Z0-9]', '', 'g');

  IF _token IS NULL OR _token = '' THEN
    RETURN 'CUST' || upper(substr(replace(_customer_id::text, '-', ''), 1, 6));
  END IF;

  RETURN left(_token, 12);
END;
$function$;