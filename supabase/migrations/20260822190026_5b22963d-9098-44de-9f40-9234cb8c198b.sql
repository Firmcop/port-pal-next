-- 1) edi_exports may reference a supplier (purchase) invoice
ALTER TABLE public.edi_exports ALTER COLUMN invoice_id DROP NOT NULL;
ALTER TABLE public.edi_exports
  ADD COLUMN IF NOT EXISTS supplier_invoice_id uuid REFERENCES public.supplier_invoices(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_edi_exports_supplier_invoice ON public.edi_exports(supplier_invoice_id);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'edi_exports_one_target') THEN
    ALTER TABLE public.edi_exports
      ADD CONSTRAINT edi_exports_one_target CHECK (
        (invoice_id IS NOT NULL AND supplier_invoice_id IS NULL)
        OR (invoice_id IS NULL AND supplier_invoice_id IS NOT NULL)
      );
  END IF;
END $$;

-- 2) EDIFACT INVOIC D96A generator for supplier (purchase) invoices
CREATE OR REPLACE FUNCTION public.generate_supplier_invoice_edi(_supplier_invoice_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _inv record; _sup record; _depot record; _container_number text; _line record;
  _ich text; _msg text := ''; _segments int := 0;
  _depot_id text; _vendor_id text; _depot_name text; _depot_addr text; _vendor_addr text;
  _date text := to_char(now(),'YYMMDD');
  _time text := to_char(now(),'HH24MI');
  _doc_date text := to_char(now(),'YYYYMMDD');
  _line_no int := 0; _export_id uuid; _err text;
BEGIN
  SELECT si.id, si.organization_id, si.invoice_number, si.supplier_id, si.container_id,
         si.subtotal, si.total_amount, si.currency, si.status
    INTO _inv
  FROM public.supplier_invoices si WHERE si.id = _supplier_invoice_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'supplier_invoice_not_found'; END IF;

  -- Same validation rules as the customer path: skip voided / zero-value docs
  IF COALESCE(_inv.status,'') IN ('cancelled','void','credited') THEN RETURN NULL; END IF;
  IF COALESCE(_inv.total_amount,0) <= 0 THEN RETURN NULL; END IF;

  -- one export per supplier invoice
  SELECT id INTO _export_id FROM public.edi_exports
   WHERE supplier_invoice_id = _supplier_invoice_id AND status <> 'failed' LIMIT 1;
  IF _export_id IS NOT NULL THEN RETURN _export_id; END IF;

  BEGIN
    SELECT name, tax_id, address, email INTO _sup
      FROM public.suppliers WHERE id = _inv.supplier_id;

    SELECT container_number INTO _container_number
      FROM public.containers WHERE id = _inv.container_id;

    SELECT name, tax_id, address INTO _depot
      FROM public.depots WHERE organization_id = _inv.organization_id
      ORDER BY is_hq DESC NULLS LAST, created_at ASC LIMIT 1;

    _depot_name := COALESCE(_depot.name,'DEPOT');
    _depot_addr := COALESCE(_depot.address,'');
    _depot_id   := COALESCE(_depot.tax_id, _inv.organization_id::text);
    _vendor_id  := COALESCE(NULLIF(_sup.tax_id,''), upper(replace(COALESCE(_sup.name,'VENDOR'),' ','')));
    _vendor_addr := COALESCE(_sup.address,'');

    _ich := next_edi_interchange_ref(_inv.organization_id);

    _msg := 'UNA:+.? ''' || E'\n';
    _msg := _msg || 'UNB+UNOC:3+' || _vendor_id || ':ZZZ+' || _depot_id || ':ZZZ+'
            || _date || ':' || _time || '+' || _ich || '''' || E'\n';
    _msg := _msg || 'UNH+1+INVOIC:D:96A:UN''' || E'\n'; _segments := _segments + 1;
    _msg := _msg || 'BGM+380+' || _inv.invoice_number || '+9''' || E'\n'; _segments := _segments + 1;
    _msg := _msg || 'DTM+137:' || _doc_date || ':102''' || E'\n'; _segments := _segments + 1;

    IF _container_number IS NOT NULL THEN
      _msg := _msg || 'RFF+ON:' || _container_number || '''' || E'\n'; _segments := _segments + 1;
    END IF;

    -- Vendor is the supplier; depot is the buyer on a purchase invoice
    _msg := _msg || 'NAD+SU+' || _vendor_id || '::92++' || COALESCE(_sup.name,'VENDOR') || '+' || _vendor_addr || '''' || E'\n'; _segments := _segments + 1;
    _msg := _msg || 'NAD+BY+' || _depot_id || '::92++' || _depot_name || '+' || _depot_addr || '''' || E'\n'; _segments := _segments + 1;

    IF _sup.tax_id IS NOT NULL AND length(_sup.tax_id) > 0 THEN
      _msg := _msg || 'RFF+VA:' || _sup.tax_id || '''' || E'\n'; _segments := _segments + 1;
    END IF;

    _msg := _msg || 'CUX+2:' || COALESCE(_inv.currency,'USD') || ':4''' || E'\n'; _segments := _segments + 1;

    FOR _line IN
      SELECT description, quantity, unit_price, line_total
        FROM public.supplier_invoice_lines
       WHERE invoice_id = _supplier_invoice_id
       ORDER BY created_at
    LOOP
      _line_no := _line_no + 1;
      _msg := _msg || 'LIN+' || _line_no || '''' || E'\n'; _segments := _segments + 1;
      _msg := _msg || 'IMD+F++:::' || COALESCE(_line.description,'SERVICE') || '''' || E'\n'; _segments := _segments + 1;
      _msg := _msg || 'QTY+47:' || COALESCE(_line.quantity,1) || '''' || E'\n'; _segments := _segments + 1;
      _msg := _msg || 'MOA+203:' || COALESCE(_line.line_total,0) || '''' || E'\n'; _segments := _segments + 1;
      _msg := _msg || 'PRI+AAA:' || COALESCE(_line.unit_price,0) || '''' || E'\n'; _segments := _segments + 1;
    END LOOP;

    _msg := _msg || 'UNS+S''' || E'\n'; _segments := _segments + 1;
    _msg := _msg || 'MOA+79:' || COALESCE(_inv.subtotal,_inv.total_amount,0) || '''' || E'\n'; _segments := _segments + 1;
    _msg := _msg || 'MOA+9:' || COALESCE(_inv.total_amount,0) || '''' || E'\n'; _segments := _segments + 1;
    _segments := _segments + 1; -- UNT
    _msg := _msg || 'UNT+' || _segments || '+1''' || E'\n';
    _msg := _msg || 'UNZ+1+' || _ich || '''' || E'\n';

    INSERT INTO public.edi_exports (
      organization_id, invoice_id, supplier_invoice_id, format, interchange_control_ref,
      message_ref, payload, byte_size, sha256, status, created_by
    ) VALUES (
      _inv.organization_id, NULL, _supplier_invoice_id, 'EDIFACT_INVOIC_D96A', _ich,
      '1', _msg, length(_msg), encode(digest(_msg,'sha256'),'hex'), 'generated', auth.uid()
    ) RETURNING id INTO _export_id;

    RETURN _export_id;
  EXCEPTION WHEN OTHERS THEN
    _err := SQLERRM;
    INSERT INTO public.edi_exports (
      organization_id, invoice_id, supplier_invoice_id, format, status, error, created_by
    ) VALUES (
      _inv.organization_id, NULL, _supplier_invoice_id, 'EDIFACT_INVOIC_D96A', 'failed', _err, auth.uid()
    ) RETURNING id INTO _export_id;
    RETURN _export_id;
  END;
END $function$;

REVOKE ALL ON FUNCTION public.generate_supplier_invoice_edi(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.generate_supplier_invoice_edi(uuid) TO authenticated, service_role;

-- 3) Auto-generate on creation of any container acquisition purchase invoice
CREATE OR REPLACE FUNCTION public.trg_supplier_invoice_auto_edi()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.reason IN ('purchase','acquisition_transport','acquisition_crane_offloading') THEN
    BEGIN
      PERFORM public.generate_supplier_invoice_edi(NEW.id);
    EXCEPTION WHEN OTHERS THEN
      NULL; -- EDI generation must never block invoice creation
    END;
  END IF;
  RETURN NEW;
END $function$;

DROP TRIGGER IF EXISTS trg_supplier_invoices_auto_edi ON public.supplier_invoices;
CREATE TRIGGER trg_supplier_invoices_auto_edi
  AFTER INSERT ON public.supplier_invoices
  FOR EACH ROW EXECUTE FUNCTION public.trg_supplier_invoice_auto_edi();

-- 4) Audit helper for acquisition vendor/cost overrides at intake
CREATE OR REPLACE FUNCTION public.log_container_acquisition_override(
  _container_id uuid,
  _changes jsonb,
  _reason text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _org uuid := current_org_id();
  _cnum text;
BEGIN
  IF _container_id IS NULL OR _changes IS NULL OR _changes = '{}'::jsonb THEN RETURN; END IF;
  SELECT container_number INTO _cnum FROM public.containers
   WHERE id = _container_id AND organization_id = _org;
  IF _cnum IS NULL THEN RETURN; END IF;

  INSERT INTO public.finance_audit_log (
    organization_id, actor_user_id, entity_type, entity_id, entity_ref, action, summary
  ) VALUES (
    _org, auth.uid(), 'containers', _container_id, _cnum, 'acquisition_defaults_overridden',
    jsonb_build_object('container_number', _cnum, 'changes', _changes, 'reason', NULLIF(btrim(COALESCE(_reason,'')),''))
  );
END $function$;

REVOKE ALL ON FUNCTION public.log_container_acquisition_override(uuid, jsonb, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.log_container_acquisition_override(uuid, jsonb, text) TO authenticated, service_role;