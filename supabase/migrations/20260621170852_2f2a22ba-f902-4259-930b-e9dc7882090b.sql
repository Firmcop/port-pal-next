
CREATE SEQUENCE IF NOT EXISTS public.eir_number_seq;

CREATE OR REPLACE FUNCTION public.next_eir_number(prefix text DEFAULT 'EIR')
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  n bigint;
BEGIN
  n := nextval('public.eir_number_seq');
  RETURN format('%s-%s-%s',
    COALESCE(NULLIF(prefix, ''), 'EIR'),
    to_char(now() AT TIME ZONE 'UTC', 'YYYYMMDD'),
    lpad(n::text, 4, '0')
  );
END;
$$;

REVOKE ALL ON FUNCTION public.next_eir_number(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.next_eir_number(text) TO authenticated, service_role;
