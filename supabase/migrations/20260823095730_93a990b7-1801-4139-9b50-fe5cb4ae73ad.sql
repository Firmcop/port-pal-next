
ALTER TABLE public.eir_records
  ADD COLUMN IF NOT EXISTS owner_at_issue text,
  ADD COLUMN IF NOT EXISTS new_owner text,
  ADD COLUMN IF NOT EXISTS owner_source text,
  ADD COLUMN IF NOT EXISTS acquisition_supplier text,
  ADD COLUMN IF NOT EXISTS owner_resolved_at timestamptz,
  ADD COLUMN IF NOT EXISTS owner_resolved_by uuid;

CREATE OR REPLACE FUNCTION public.resolve_eir_ownership(_container_id uuid, _new_owner text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _org uuid := public.current_org_id();
  _c record;
  _depot text;
  _pi record;
  _supplier text;
  _owner text;
  _source text;
  _new text := NULLIF(btrim(COALESCE(_new_owner,'')), '');
BEGIN
  SELECT c.owner, c.ownership_type, c.organization_id INTO _c
    FROM public.containers c WHERE c.id = _container_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  _org := COALESCE(_org, _c.organization_id);
  _depot := public.depot_legal_name(_org);

  SELECT si.invoice_number, s.name AS supplier_name INTO _pi
    FROM public.supplier_invoices si
    LEFT JOIN public.suppliers s ON s.id = si.supplier_id
   WHERE si.organization_id = _org AND si.container_id = _container_id
     AND COALESCE(si.status,'') <> 'cancelled'
   ORDER BY si.created_at LIMIT 1;

  _supplier := COALESCE(_pi.supplier_name, _c.owner);

  IF COALESCE(_c.ownership_type,'') = 'depot_owned' THEN
    _owner := _depot; _source := 'depot_owned_flag';
  ELSIF _pi.invoice_number IS NOT NULL THEN
    _owner := _depot; _source := 'purchase_invoice:'||_pi.invoice_number;
  ELSE
    _owner := _c.owner; _source := 'container_owner';
  END IF;

  IF _new IS NULL THEN
    SELECT COALESCE(cs.buyer_name, cu.company_name) INTO _new
      FROM public.container_sales cs
      LEFT JOIN public.customers cu ON cu.id = cs.customer_id
     WHERE cs.container_id = _container_id AND COALESCE(cs.status::text,'') <> 'cancelled'
     ORDER BY cs.created_at DESC LIMIT 1;
  END IF;
  IF _new IS NULL THEN
    SELECT cu.company_name INTO _new
      FROM public.container_conversions cc
      LEFT JOIN public.customers cu ON cu.id = cc.customer_id
     WHERE cc.container_id = _container_id AND COALESCE(cc.status::text,'') <> 'cancelled'
     ORDER BY cc.created_at DESC LIMIT 1;
  END IF;

  RETURN jsonb_build_object(
    'owner_at_issue', _owner,
    'owner_source', _source,
    'acquisition_supplier', _supplier,
    'new_owner', _new,
    'depot_legal_name', _depot);
END;
$$;

REVOKE ALL ON FUNCTION public.resolve_eir_ownership(uuid, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.resolve_eir_ownership(uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.eir_set_ownership()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE _o jsonb;
BEGIN
  IF NEW.container_id IS NULL THEN RETURN NEW; END IF;
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
END;
$$;

DROP TRIGGER IF EXISTS trg_eir_set_ownership ON public.eir_records;
CREATE TRIGGER trg_eir_set_ownership
BEFORE INSERT ON public.eir_records
FOR EACH ROW EXECUTE FUNCTION public.eir_set_ownership();

CREATE OR REPLACE FUNCTION public.eir_log_ownership()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.owner_at_issue IS NULL THEN RETURN NEW; END IF;
  INSERT INTO public.finance_audit_log(organization_id, actor_user_id, entity_type, entity_id, entity_ref, action, summary)
  VALUES (NEW.organization_id, auth.uid(), 'eir', NEW.id, NEW.eir_number, 'eir_ownership_resolved',
          jsonb_build_object('owner_at_issue', NEW.owner_at_issue, 'new_owner', NEW.new_owner,
                             'owner_source', NEW.owner_source,
                             'acquisition_supplier', NEW.acquisition_supplier,
                             'eir_type', NEW.eir_type, 'container_id', NEW.container_id));
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_eir_log_ownership ON public.eir_records;
CREATE TRIGGER trg_eir_log_ownership
AFTER INSERT ON public.eir_records
FOR EACH ROW EXECUTE FUNCTION public.eir_log_ownership();

UPDATE public.eir_records e
   SET owner_at_issue = (public.resolve_eir_ownership(e.container_id, NULL))->>'owner_at_issue',
       owner_source = (public.resolve_eir_ownership(e.container_id, NULL))->>'owner_source',
       acquisition_supplier = (public.resolve_eir_ownership(e.container_id, NULL))->>'acquisition_supplier',
       new_owner = COALESCE(e.new_owner, (public.resolve_eir_ownership(e.container_id, NULL))->>'new_owner'),
       owner_resolved_at = now()
 WHERE e.owner_at_issue IS NULL
   AND e.container_id IS NOT NULL
   AND public.resolve_eir_ownership(e.container_id, NULL) IS NOT NULL;

-- preview_contra_settlement referenced customers.name, which does not exist
CREATE OR REPLACE FUNCTION public.preview_contra_settlement(_supplier_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _org uuid := public.current_org_id();
  _sup record;
  _cust record;
  _ar jsonb := '[]'::jsonb;
  _ap jsonb := '[]'::jsonb;
  _totals jsonb := '[]'::jsonb;
  _r record;
BEGIN
  IF _org IS NULL THEN RAISE EXCEPTION 'No organization context'; END IF;
  SELECT * INTO _sup FROM public.suppliers WHERE id = _supplier_id AND organization_id = _org;
  IF NOT FOUND THEN RAISE EXCEPTION 'supplier_not_found'; END IF;

  SELECT * INTO _cust FROM public.customers
   WHERE organization_id = _org
     AND (id = _sup.linked_customer_id OR lower(btrim(company_name)) = lower(btrim(_sup.name)))
   ORDER BY (id = _sup.linked_customer_id) DESC LIMIT 1;

  IF _cust.id IS NULL THEN
    RETURN jsonb_build_object('supplier_id', _supplier_id, 'supplier_name', _sup.name,
                              'customer_id', NULL, 'linked', false,
                              'ar', _ar, 'ap', _ap, 'totals', _totals);
  END IF;

  FOR _r IN
    SELECT i.id, i.invoice_number, i.currency, i.issued_at, i.due_at, i.total_amount,
           COALESCE((SELECT sum(p.amount) FROM public.payments p WHERE p.invoice_id = i.id), 0) AS paid
      FROM public.invoices i
     WHERE i.organization_id = _org
       AND (i.customer_id = _cust.id OR lower(btrim(i.customer_name)) = lower(btrim(_cust.company_name)))
       AND i.status IN ('sent','overdue')
       AND i.voided_at IS NULL
     ORDER BY i.due_at NULLS LAST, i.created_at
  LOOP
    IF _r.total_amount - _r.paid > 0.01 THEN
      _ar := _ar || jsonb_build_object('invoice_id', _r.id, 'document_number', _r.invoice_number,
              'currency', upper(COALESCE(_r.currency,'')), 'due_at', _r.due_at,
              'total_amount', _r.total_amount, 'paid', _r.paid, 'outstanding', _r.total_amount - _r.paid);
    END IF;
  END LOOP;

  FOR _r IN
    SELECT si.id, si.invoice_number, si.currency, si.due_date, si.total_amount, COALESCE(si.paid_amount,0) AS paid
      FROM public.supplier_invoices si
     WHERE si.organization_id = _org AND si.supplier_id = _supplier_id
       AND COALESCE(si.status,'') <> 'cancelled'
       AND si.total_amount > COALESCE(si.paid_amount,0)
     ORDER BY si.due_date, si.created_at
  LOOP
    _ap := _ap || jsonb_build_object('supplier_invoice_id', _r.id, 'document_number', _r.invoice_number,
            'currency', upper(COALESCE(_r.currency,'')), 'due_at', _r.due_date,
            'total_amount', _r.total_amount, 'paid', _r.paid, 'outstanding', _r.total_amount - _r.paid);
  END LOOP;

  SELECT jsonb_agg(t) INTO _totals FROM (
    SELECT c AS currency,
           COALESCE((SELECT sum((x->>'outstanding')::numeric) FROM jsonb_array_elements(_ar) x WHERE x->>'currency' = c),0) AS ar_total,
           COALESCE((SELECT sum((x->>'outstanding')::numeric) FROM jsonb_array_elements(_ap) x WHERE x->>'currency' = c),0) AS ap_total,
           LEAST(
             COALESCE((SELECT sum((x->>'outstanding')::numeric) FROM jsonb_array_elements(_ar) x WHERE x->>'currency' = c),0),
             COALESCE((SELECT sum((x->>'outstanding')::numeric) FROM jsonb_array_elements(_ap) x WHERE x->>'currency' = c),0)
           ) AS offsettable
      FROM (SELECT DISTINCT x->>'currency' AS c FROM jsonb_array_elements(_ar || _ap) x) s
  ) t;

  RETURN jsonb_build_object('supplier_id', _supplier_id, 'supplier_name', _sup.name,
                            'customer_id', _cust.id, 'customer_name', _cust.company_name,
                            'linked', _sup.linked_customer_id IS NOT NULL,
                            'ar', _ar, 'ap', _ap, 'totals', COALESCE(_totals,'[]'::jsonb));
END;
$$;
