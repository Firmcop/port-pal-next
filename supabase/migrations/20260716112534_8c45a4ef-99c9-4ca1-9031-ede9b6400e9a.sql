
CREATE TABLE IF NOT EXISTS public.conversion_number_sequences (
  organization_id uuid NOT NULL,
  slug text NOT NULL,
  last_seq integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, slug)
);

-- If previous partial migration created it with customer_key, migrate schema
ALTER TABLE public.conversion_number_sequences DROP COLUMN IF EXISTS customer_key;

GRANT SELECT ON public.conversion_number_sequences TO authenticated;
GRANT ALL ON public.conversion_number_sequences TO service_role;

ALTER TABLE public.conversion_number_sequences ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "conv_seq_read_same_org" ON public.conversion_number_sequences;
CREATE POLICY "conv_seq_read_same_org" ON public.conversion_number_sequences
  FOR SELECT TO authenticated
  USING (public.is_platform_admin() OR organization_id = public.current_org_id());

CREATE OR REPLACE FUNCTION public.customer_slug_for_conversion(_customer_id uuid)
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE _name text; _slug text;
BEGIN
  IF _customer_id IS NULL THEN RETURN 'NOCUST'; END IF;
  SELECT COALESCE(NULLIF(trim(company_name), ''), NULLIF(trim(contact_person), ''))
    INTO _name FROM public.customers WHERE id = _customer_id;
  IF _name IS NULL OR _name = '' THEN RETURN 'NOCUST'; END IF;
  _slug := upper(regexp_replace(split_part(_name, ' ', 1), '[^A-Za-z0-9]', '', 'g'));
  IF _slug IS NULL OR _slug = '' THEN RETURN 'NOCUST'; END IF;
  RETURN left(_slug, 12);
END;
$$;
REVOKE ALL ON FUNCTION public.customer_slug_for_conversion(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.customer_slug_for_conversion(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.next_conversion_number(_org uuid, _customer uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE _slug text; _seq int;
BEGIN
  _slug := public.customer_slug_for_conversion(_customer);
  INSERT INTO public.conversion_number_sequences AS s
    (organization_id, slug, last_seq, updated_at)
  VALUES (COALESCE(_org, '00000000-0000-0000-0000-000000000001'::uuid), _slug, 1, now())
  ON CONFLICT (organization_id, slug) DO UPDATE
    SET last_seq = s.last_seq + 1, updated_at = now()
  RETURNING last_seq INTO _seq;
  RETURN 'CNV-' || _slug || '-' || lpad(_seq::text, 4, '0');
END;
$$;
REVOKE ALL ON FUNCTION public.next_conversion_number(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.next_conversion_number(uuid, uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.trg_set_conversion_number()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NEW.conversion_number IS NULL OR NEW.conversion_number = ''
     OR NEW.conversion_number ~ '^CNV-[A-Z0-9]+$' THEN
    NEW.conversion_number := public.next_conversion_number(NEW.organization_id, NEW.customer_id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS set_conversion_number ON public.container_conversions;
CREATE TRIGGER set_conversion_number
  BEFORE INSERT ON public.container_conversions
  FOR EACH ROW EXECUTE FUNCTION public.trg_set_conversion_number();

DO $$
DECLARE r record; _slug text; _seq int; _org uuid;
BEGIN
  DELETE FROM public.conversion_number_sequences;
  UPDATE public.container_conversions SET conversion_number = '__tmp_' || id::text;
  FOR r IN
    SELECT id, organization_id, customer_id
      FROM public.container_conversions
      ORDER BY created_at NULLS LAST, id
  LOOP
    _org := COALESCE(r.organization_id, '00000000-0000-0000-0000-000000000001'::uuid);
    _slug := public.customer_slug_for_conversion(r.customer_id);

    INSERT INTO public.conversion_number_sequences AS s
      (organization_id, slug, last_seq, updated_at)
    VALUES (_org, _slug, 1, now())
    ON CONFLICT (organization_id, slug) DO UPDATE
      SET last_seq = s.last_seq + 1, updated_at = now()
    RETURNING last_seq INTO _seq;

    UPDATE public.container_conversions
      SET conversion_number = 'CNV-' || _slug || '-' || lpad(_seq::text, 4, '0')
      WHERE id = r.id;
  END LOOP;
END $$;
