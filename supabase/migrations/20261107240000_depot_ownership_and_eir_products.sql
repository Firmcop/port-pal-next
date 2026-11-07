-- =====================================================================
-- Ownership of bought containers, and products on gate-out EIRs (7 Nov 2026).
--
-- Agreed with Firmcop:
--  * Once the seller has been invoiced (a purchase bill exists) the unit
--    belongs to the depot company, Firmcop Limited.
--  * A gate-out EIR for a sale shows Firmcop Limited as previous owner and the
--    buyer as current owner, whatever the form sends.
--  * Converted units are depot products: the EIR shows the product name and
--    the source container(s).
-- 1. organizations.legal_name ('Firmcop Limited') feeds depot_legal_name().
-- 2. container_conversions.product_name; eir_records.product_name and
--    source_containers.
-- 3. resolve_eir_ownership: purchase bills only (not transport/crane bills),
--    split units inherit from their parent, product details returned.
-- 4. eir_set_ownership: on gate-out the server sets the previous owner.
-- 5. A purchase bill switches an in-yard container to depot-owned.
-- 6. Past data corrected (old values in finance_audit_log).
-- =====================================================================

-- 1. legal name -------------------------------------------------------
ALTER TABLE public.organizations ADD COLUMN IF NOT EXISTS legal_name text;
UPDATE public.organizations SET legal_name = 'Firmcop Limited'
 WHERE id = '6b29b65b-fa63-4dcf-9854-ede5c9a8320b' AND legal_name IS DISTINCT FROM 'Firmcop Limited';

CREATE OR REPLACE FUNCTION public.depot_legal_name(_org uuid DEFAULT NULL)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT btrim(COALESCE(
    (SELECT NULLIF(btrim(o.legal_name), '') FROM public.organizations o WHERE o.id = COALESCE(_org, current_org_id())),
    (SELECT d.name FROM public.depots d
      WHERE d.organization_id = COALESCE(_org, current_org_id())
      ORDER BY d.is_hq DESC NULLS LAST, d.created_at LIMIT 1),
    (SELECT o.name FROM public.organizations o WHERE o.id = COALESCE(_org, current_org_id()))
  ));
$$;

-- 2. product fields ----------------------------------------------------
ALTER TABLE public.container_conversions ADD COLUMN IF NOT EXISTS product_name text;
ALTER TABLE public.eir_records ADD COLUMN IF NOT EXISTS product_name text;
ALTER TABLE public.eir_records ADD COLUMN IF NOT EXISTS source_containers text;
COMMENT ON COLUMN public.container_conversions.product_name IS 'Short name of the product made, printed on EIRs and invoices (e.g. 2-Bedroom Container House).';
COMMENT ON COLUMN public.eir_records.product_name IS 'Product released (converted units); null for units released as they are.';
COMMENT ON COLUMN public.eir_records.source_containers IS 'Container number(s) the product was made from.';

-- Product made from / out of a container: the conversion it went into (as
-- source) or, for a split unit, the conversion of its parent.
CREATE OR REPLACE FUNCTION public.eir_product_info(_container_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _c record; _cv record; _src text; _name text;
BEGIN
  SELECT id, container_number, parent_container_id, size INTO _c FROM containers WHERE id = _container_id;
  IF NOT FOUND THEN RETURN NULL; END IF;

  SELECT cv.* INTO _cv FROM container_conversions cv
   WHERE COALESCE(cv.status::text, '') <> 'cancelled'
     AND (cv.container_id IN (_c.id, _c.parent_container_id)
          OR EXISTS (SELECT 1 FROM conversion_containers x WHERE x.conversion_id = cv.id
                      AND x.container_id IN (_c.id, _c.parent_container_id)))
   ORDER BY (cv.container_id = _c.id OR EXISTS (SELECT 1 FROM conversion_containers x
              WHERE x.conversion_id = cv.id AND x.container_id = _c.id)) DESC,
            cv.created_at DESC
   LIMIT 1;

  IF _cv.id IS NULL THEN
    IF _c.parent_container_id IS NOT NULL THEN
      RETURN jsonb_build_object('product_name', _c.size || 'ft unit split from a larger container',
        'source_containers', (SELECT container_number FROM containers WHERE id = _c.parent_container_id));
    END IF;
    RETURN NULL;
  END IF;

  SELECT string_agg(DISTINCT n, ' + ') INTO _src FROM (
    SELECT p.container_number n FROM containers p WHERE p.id = _cv.container_id
    UNION SELECT p.container_number FROM conversion_containers x JOIN containers p ON p.id = x.container_id
     WHERE x.conversion_id = _cv.id
    UNION SELECT p.container_number FROM containers p WHERE p.id = _c.parent_container_id) s
   WHERE n IS NOT NULL;

  _name := NULLIF(btrim(_cv.product_name), '');
  IF _name IS NULL THEN
    _name := CASE
      WHEN _cv.job_kind = 'split' THEN COALESCE(_c.size || 'ft ', '') || 'split unit'
      WHEN _cv.product_type::text = 'home' THEN 'Container house'
      WHEN _cv.product_type::text = 'office' THEN 'Container office'
      WHEN _cv.product_type::text = 'fabrication' THEN 'Fabricated container unit'
      ELSE NULLIF(left(btrim(split_part(regexp_replace(COALESCE(_cv.description, ''), '^[\s*\-]+', ''), E'\n', 1)), 60), '')
    END;
  END IF;

  RETURN jsonb_build_object('product_name', COALESCE(_name, 'Converted container unit'),
    'source_containers', _src, 'conversion_id', _cv.id, 'conversion_number', _cv.conversion_number);
END $$;

-- 3. ownership resolver ------------------------------------------------
CREATE OR REPLACE FUNCTION public.resolve_eir_ownership(_container_id uuid, _new_owner text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  _org uuid := public.current_org_id();
  _c record; _p_owner text; _p_type text;
  _depot text;
  _pi record;
  _supplier text; _owner text; _source text;
  _new text := NULLIF(btrim(COALESCE(_new_owner, '')), '');
  _prod jsonb;
BEGIN
  SELECT c.owner, c.ownership_type, c.organization_id, c.parent_container_id INTO _c
    FROM public.containers c WHERE c.id = _container_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  _org := COALESCE(_org, _c.organization_id);
  _depot := public.depot_legal_name(_org);

  -- the seller's purchase bill (transport and crane bills do not transfer ownership);
  -- a split unit is covered by its parent's bill
  SELECT si.invoice_number, s.name AS supplier_name INTO _pi
    FROM public.supplier_invoices si
    LEFT JOIN public.suppliers s ON s.id = si.supplier_id
   WHERE si.organization_id = _org AND si.container_id IN (_container_id, _c.parent_container_id)
     AND COALESCE(si.status, '') <> 'cancelled'
     AND COALESCE(si.reason, '') NOT IN ('acquisition_transport', 'acquisition_crane_offloading')
   ORDER BY (si.container_id = _container_id) DESC, si.created_at LIMIT 1;

  IF _c.parent_container_id IS NOT NULL THEN
    SELECT owner, ownership_type INTO _p_owner, _p_type FROM public.containers WHERE id = _c.parent_container_id;
  END IF;

  _supplier := COALESCE(_pi.supplier_name, CASE WHEN _c.owner ILIKE 'firmcop%' THEN NULL ELSE _c.owner END);

  IF COALESCE(_c.ownership_type, '') = 'depot_owned' OR COALESCE(_p_type, '') = 'depot_owned' THEN
    _owner := _depot; _source := 'depot_owned_flag';
  ELSIF _pi.invoice_number IS NOT NULL THEN
    _owner := _depot; _source := 'purchase_invoice:' || _pi.invoice_number;
  ELSE
    _owner := COALESCE(_c.owner, _p_owner); _source := 'container_owner';
  END IF;

  IF _new IS NULL THEN
    SELECT COALESCE(cs.buyer_name, cu.company_name) INTO _new
      FROM public.container_sales cs
      LEFT JOIN public.customers cu ON cu.id = cs.customer_id
     WHERE cs.container_id IN (_container_id, _c.parent_container_id) AND COALESCE(cs.status::text, '') <> 'cancelled'
     ORDER BY (cs.container_id = _container_id) DESC, cs.created_at DESC LIMIT 1;
  END IF;
  IF _new IS NULL THEN
    SELECT cu.company_name INTO _new
      FROM public.container_conversions cc
      LEFT JOIN public.customers cu ON cu.id = cc.customer_id
     WHERE (cc.container_id IN (_container_id, _c.parent_container_id)
            OR EXISTS (SELECT 1 FROM conversion_containers x WHERE x.conversion_id = cc.id
                        AND x.container_id IN (_container_id, _c.parent_container_id)))
       AND COALESCE(cc.status::text, '') <> 'cancelled' AND cu.company_name IS NOT NULL
     ORDER BY cc.created_at DESC LIMIT 1;
  END IF;

  _prod := public.eir_product_info(_container_id);

  RETURN jsonb_build_object(
    'owner_at_issue', _owner,
    'owner_source', _source,
    'acquisition_supplier', _supplier,
    'new_owner', _new,
    'depot_legal_name', _depot,
    'product_name', _prod->>'product_name',
    'source_containers', _prod->>'source_containers');
END $$;

-- 4. EIR insert: the server decides the previous owner on gate-out --------
CREATE OR REPLACE FUNCTION public.eir_set_ownership()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _o jsonb;
BEGIN
  IF NEW.container_id IS NULL THEN RETURN NEW; END IF;

  IF NEW.eir_type::text = 'gate_out' THEN
    _o := public.resolve_eir_ownership(NEW.container_id, NEW.new_owner);
    IF _o IS NULL THEN RETURN NEW; END IF;
    IF COALESCE(NEW.release_purpose, '') IN ('sold_unit', 'sale', 'lease_unit') THEN
      -- the depot sells (or leases out) its own unit: it was bought from the seller first
      NEW.owner_at_issue := _o->>'depot_legal_name';
      NEW.owner_source := CASE WHEN (_o->>'owner_source') = 'container_owner' THEN 'sale_by_depot' ELSE _o->>'owner_source' END;
    ELSE
      NEW.owner_at_issue := _o->>'owner_at_issue';
      NEW.owner_source := _o->>'owner_source';
    END IF;
    NEW.acquisition_supplier := COALESCE(NEW.acquisition_supplier, _o->>'acquisition_supplier');
    NEW.new_owner := COALESCE(NULLIF(btrim(NEW.new_owner), ''), _o->>'new_owner');
    NEW.product_name := COALESCE(NEW.product_name, _o->>'product_name');
    NEW.source_containers := COALESCE(NEW.source_containers, _o->>'source_containers');
    NEW.owner_resolved_at := now();
    NEW.owner_resolved_by := auth.uid();
    RETURN NEW;
  END IF;

  IF NEW.owner_at_issue IS NOT NULL AND NEW.new_owner IS NOT NULL THEN RETURN NEW; END IF;
  _o := public.resolve_eir_ownership(NEW.container_id, NEW.new_owner);
  IF _o IS NULL THEN RETURN NEW; END IF;
  NEW.owner_at_issue := COALESCE(NEW.owner_at_issue, _o->>'owner_at_issue');
  NEW.owner_source := COALESCE(NEW.owner_source, _o->>'owner_source');
  NEW.acquisition_supplier := COALESCE(NEW.acquisition_supplier, _o->>'acquisition_supplier');
  NEW.new_owner := COALESCE(NEW.new_owner, _o->>'new_owner');
  NEW.owner_resolved_at := now();
  NEW.owner_resolved_by := auth.uid();
  RETURN NEW;
END $$;

-- 5. a purchase bill makes an in-yard unit depot-owned --------------------
CREATE OR REPLACE FUNCTION public.trg_container_owned_on_purchase()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _legal text; _c record;
BEGIN
  IF NEW.container_id IS NULL OR COALESCE(NEW.status, '') = 'cancelled'
     OR COALESCE(NEW.reason, '') IN ('acquisition_transport', 'acquisition_crane_offloading') THEN
    RETURN NEW;
  END IF;
  SELECT id, owner, ownership_type, gate_out_at INTO _c FROM containers WHERE id = NEW.container_id;
  IF _c.id IS NULL OR _c.gate_out_at IS NOT NULL THEN RETURN NEW; END IF;  -- already gone: owner follows the sale
  _legal := public.depot_legal_name(NEW.organization_id);
  IF _c.ownership_type = 'depot_owned' AND _c.owner = _legal THEN RETURN NEW; END IF;
  UPDATE containers SET ownership_type = 'depot_owned', owner = _legal, updated_at = now() WHERE id = _c.id;
  INSERT INTO finance_audit_log (organization_id, entity_type, entity_id, action, summary)
  VALUES (NEW.organization_id, 'containers', _c.id, 'owner_changed_on_purchase',
          jsonb_build_object('from_owner', _c.owner, 'from_type', _c.ownership_type, 'to_owner', _legal,
                             'purchase_invoice', NEW.invoice_number));
  RETURN NEW;
END $$;

CREATE OR REPLACE TRIGGER trg_container_owned_on_purchase
AFTER INSERT ON public.supplier_invoices
FOR EACH ROW EXECUTE FUNCTION public.trg_container_owned_on_purchase();

-- 6. correct past data -------------------------------------------------
DO $$
DECLARE
  _org constant uuid := '6b29b65b-fa63-4dcf-9854-ede5c9a8320b';
  _legal text := public.depot_legal_name('6b29b65b-fa63-4dcf-9854-ede5c9a8320b');
  r record; _o jsonb; _prev text; _src text; _new text;
  _n_cont int := 0; _n_eir int := 0;
BEGIN
  -- in-yard containers with a seller's bill (or a bought parent): depot-owned
  FOR r IN
    SELECT c.id, c.owner, c.ownership_type FROM containers c
     WHERE c.organization_id = _org AND c.gate_out_at IS NULL
       AND (c.ownership_type IS DISTINCT FROM 'depot_owned' OR c.owner IS DISTINCT FROM _legal)
       AND EXISTS (SELECT 1 FROM supplier_invoices si
                    WHERE si.container_id IN (c.id, c.parent_container_id) AND si.status <> 'cancelled'
                      AND si.reason NOT IN ('acquisition_transport', 'acquisition_crane_offloading')
                   UNION ALL
                   SELECT 1 FROM containers p WHERE p.id = c.parent_container_id
                      AND (p.ownership_type = 'depot_owned' OR p.owner ILIKE 'firmcop%'))
  LOOP
    UPDATE containers SET ownership_type = 'depot_owned', owner = _legal, updated_at = now() WHERE id = r.id;
    INSERT INTO finance_audit_log (organization_id, entity_type, entity_id, action, summary)
    VALUES (_org, 'containers', r.id, 'owner_corrected_bought_unit',
            jsonb_build_object('from_owner', r.owner, 'from_type', r.ownership_type, 'to_owner', _legal));
    _n_cont := _n_cont + 1;
  END LOOP;

  -- any other 'Firmcop Group' owner text -> legal name
  UPDATE containers SET owner = _legal WHERE organization_id = _org AND owner ILIKE 'firmcop group%';
  UPDATE conversion_outputs SET target_owner = _legal WHERE organization_id = _org AND target_owner ILIKE 'firmcop group%';

  -- gate-out EIRs: previous owner, buyer and product as the rules above
  FOR r IN SELECT * FROM eir_records WHERE organization_id = _org AND eir_type::text = 'gate_out' AND container_id IS NOT NULL LOOP
    _o := public.resolve_eir_ownership(r.container_id, r.new_owner);
    CONTINUE WHEN _o IS NULL;
    IF COALESCE(r.release_purpose, '') IN ('sold_unit', 'sale', 'lease_unit') THEN
      _prev := _o->>'depot_legal_name';
      _src := CASE WHEN (_o->>'owner_source') = 'container_owner' THEN 'sale_by_depot' ELSE _o->>'owner_source' END;
    ELSE
      _prev := _o->>'owner_at_issue'; _src := _o->>'owner_source';
    END IF;
    _new := COALESCE(NULLIF(btrim(r.new_owner), ''), _o->>'new_owner');
    IF _new ILIKE 'firmcop group%' THEN _new := _legal; END IF;
    IF (_prev, _new, _o->>'product_name', _o->>'source_containers')
       IS DISTINCT FROM (r.owner_at_issue, r.new_owner, r.product_name, r.source_containers) THEN
      INSERT INTO finance_audit_log (organization_id, entity_type, entity_id, action, summary)
      VALUES (_org, 'eir_records', r.id, 'eir_owner_corrected',
              jsonb_build_object('eir', r.eir_number, 'from_previous_owner', r.owner_at_issue, 'to_previous_owner', _prev,
                                 'from_current_owner', r.new_owner, 'to_current_owner', _new,
                                 'from_source', r.owner_source, 'product', _o->>'product_name',
                                 'source_containers', _o->>'source_containers'));
      UPDATE eir_records SET owner_at_issue = _prev, owner_source = _src, new_owner = _new,
             product_name = _o->>'product_name', source_containers = _o->>'source_containers',
             acquisition_supplier = COALESCE(acquisition_supplier, _o->>'acquisition_supplier'),
             owner_resolved_at = now()
       WHERE id = r.id;
      _n_eir := _n_eir + 1;
    END IF;
  END LOOP;

  -- gate-in EIRs that named the old depot name
  UPDATE eir_records SET owner_at_issue = _legal WHERE organization_id = _org AND owner_at_issue ILIKE 'firmcop group%';
  UPDATE eir_records SET new_owner = _legal WHERE organization_id = _org AND new_owner ILIKE 'firmcop group%';

  RAISE NOTICE 'containers corrected: %, gate-out EIRs corrected: %', _n_cont, _n_eir;
END $$;
