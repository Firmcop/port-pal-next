ALTER TABLE public.container_sales ADD COLUMN IF NOT EXISTS acquisition_supplier text;

-- Depot legal name -----------------------------------------------------------
CREATE OR REPLACE FUNCTION public.depot_legal_name(_org uuid DEFAULT NULL)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(
    (SELECT d.name FROM public.depots d
      WHERE d.organization_id = COALESCE(_org, current_org_id())
      ORDER BY d.is_hq DESC NULLS LAST, d.created_at LIMIT 1),
    (SELECT o.name FROM public.organizations o WHERE o.id = COALESCE(_org, current_org_id()))
  );
$$;

-- Owner to print on outbound documents ---------------------------------------
CREATE OR REPLACE FUNCTION public.container_document_owner(_container_id uuid)
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _org uuid := current_org_id();
  _c record;
  _depot text := public.depot_legal_name();
  _has_pi boolean;
BEGIN
  SELECT c.owner, c.ownership_type INTO _c
    FROM public.containers c WHERE c.id = _container_id AND c.organization_id = _org;
  IF NOT FOUND THEN RETURN NULL; END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.supplier_invoices si
     WHERE si.organization_id = _org AND si.container_id = _container_id
       AND COALESCE(si.status,'') <> 'cancelled'
  ) INTO _has_pi;

  IF COALESCE(_c.ownership_type,'') = 'depot_owned' OR _has_pi THEN
    RETURN _depot;
  END IF;
  RETURN _c.owner;
END;
$$;

-- Keep acquisition vendor on sales, and show the depot as document owner -----
CREATE OR REPLACE FUNCTION public.set_sale_ownership_fields()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _doc text;
BEGIN
  IF NEW.container_id IS NOT NULL THEN
    IF NEW.acquisition_supplier IS NULL OR btrim(NEW.acquisition_supplier) = '' THEN
      NEW.acquisition_supplier := COALESCE(
        NULLIF(btrim(COALESCE(NEW.original_owner,'')),''),
        (SELECT c.owner FROM public.containers c WHERE c.id = NEW.container_id));
    END IF;
    _doc := public.container_document_owner(NEW.container_id);
    IF _doc IS NOT NULL AND btrim(_doc) <> '' THEN
      NEW.original_owner := _doc;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_set_sale_ownership_fields ON public.container_sales;
CREATE TRIGGER trg_set_sale_ownership_fields
BEFORE INSERT ON public.container_sales
FOR EACH ROW EXECUTE FUNCTION public.set_sale_ownership_fields();

-- Acquisition PO must still go to the real vendor, never the depot -----------
CREATE OR REPLACE FUNCTION public.preview_acquisition_recipient(
  _container_id uuid,
  _expected_owner text DEFAULT NULL
) RETURNS TABLE(owner text, source text, note text, buyer_name text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _org uuid := current_org_id();
  _container_owner text;
  _sold_owner text;
  _buyer text;
  _depot text := public.depot_legal_name();
BEGIN
  IF _container_id IS NULL THEN RETURN; END IF;

  SELECT c.owner INTO _container_owner
    FROM public.containers c
   WHERE c.id = _container_id AND c.organization_id = _org;

  SELECT COALESCE(NULLIF(btrim(COALESCE(cs.acquisition_supplier,'')),''), cs.original_owner)
    INTO _sold_owner
    FROM public.container_sales cs
   WHERE cs.container_id = _container_id AND cs.organization_id = _org
     AND COALESCE(NULLIF(btrim(COALESCE(cs.acquisition_supplier,'')),''), cs.original_owner) IS NOT NULL
   ORDER BY cs.created_at DESC LIMIT 1;

  IF _sold_owner IS NOT NULL AND lower(btrim(_sold_owner)) = lower(btrim(COALESCE(_depot,'~'))) THEN
    _sold_owner := NULL;
  END IF;

  SELECT cs.buyer_name INTO _buyer
    FROM public.container_sales cs
   WHERE cs.container_id = _container_id AND cs.organization_id = _org
   ORDER BY cs.created_at DESC LIMIT 1;

  IF _expected_owner IS NOT NULL AND btrim(_expected_owner) <> '' THEN
    owner := btrim(_expected_owner);
    source := 'expected_owner';
    note := 'PO will be issued to expected owner ' || owner;
  ELSIF _sold_owner IS NOT NULL THEN
    owner := btrim(_sold_owner);
    source := 'sale_acquisition_supplier';
    note := 'PO will be issued to the acquisition vendor ' || owner;
  ELSE
    owner := btrim(COALESCE(_container_owner,''));
    source := 'container_owner';
    note := 'PO will be issued to container.owner ' || COALESCE(owner,'');
  END IF;
  buyer_name := _buyer;
  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.depot_legal_name(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.container_document_owner(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.depot_legal_name(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.container_document_owner(uuid) TO authenticated;