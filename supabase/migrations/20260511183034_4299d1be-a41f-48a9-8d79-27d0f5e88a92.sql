-- =========================================================================
-- EDI EXPORT OF GATE-IN FEE INVOICES (UN/EDIFACT INVOIC D96A)
-- =========================================================================

-- Per-org interchange counter for UNB segments
CREATE TABLE IF NOT EXISTS public.edi_interchange_seq (
  organization_id uuid PRIMARY KEY,
  last_value bigint NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.edi_interchange_seq ENABLE ROW LEVEL SECURITY;
CREATE POLICY "edi_seq_read" ON public.edi_interchange_seq FOR SELECT
  USING (organization_id = current_org_id() OR is_platform_admin());

CREATE OR REPLACE FUNCTION public.next_edi_interchange_ref(_org uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _v bigint;
BEGIN
  INSERT INTO public.edi_interchange_seq (organization_id, last_value)
  VALUES (_org, 1)
  ON CONFLICT (organization_id)
  DO UPDATE SET last_value = edi_interchange_seq.last_value + 1, updated_at = now()
  RETURNING last_value INTO _v;
  RETURN lpad(_v::text, 10, '0');
END;
$$;

-- EDI exports table
CREATE TABLE IF NOT EXISTS public.edi_exports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  invoice_id uuid NOT NULL REFERENCES public.invoices(id) ON DELETE CASCADE,
  format text NOT NULL DEFAULT 'EDIFACT_INVOIC_D96A',
  interchange_control_ref text,
  message_ref text,
  payload text,
  byte_size integer,
  sha256 text,
  status text NOT NULL DEFAULT 'generated' CHECK (status IN ('generated','downloaded','failed')),
  error text,
  generated_at timestamptz NOT NULL DEFAULT now(),
  downloaded_at timestamptz,
  downloaded_by uuid,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_edi_exports_invoice ON public.edi_exports(invoice_id);
CREATE INDEX IF NOT EXISTS idx_edi_exports_org ON public.edi_exports(organization_id);

ALTER TABLE public.edi_exports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "edi_exports_select_org" ON public.edi_exports FOR SELECT
  USING (organization_id = current_org_id() OR is_platform_admin());

CREATE POLICY "edi_exports_update_admin" ON public.edi_exports FOR UPDATE
  USING (
    organization_id = current_org_id()
    AND (
      has_role(auth.uid(),'admin'::app_role)
      OR has_role(auth.uid(),'gate_clerk'::app_role)
      OR has_role(auth.uid(),'yard_operator'::app_role)
    )
  );

CREATE TRIGGER trg_edi_exports_updated
  BEFORE UPDATE ON public.edi_exports
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- =========================================================================
-- generate_gate_in_edi: builds an EDIFACT INVOIC D96A message and stores it
-- =========================================================================
CREATE OR REPLACE FUNCTION public.generate_gate_in_edi(_invoice_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _inv record;
  _container record;
  _customer record;
  _depot record;
  _line record;
  _ich text;
  _msg text := '';
  _segments int := 0;
  _depot_id text;
  _customer_id text;
  _depot_name text;
  _depot_addr text;
  _customer_addr text;
  _date text := to_char(now(), 'YYMMDD');
  _time text := to_char(now(), 'HH24MI');
  _doc_date text := to_char(now(), 'YYYYMMDD');
  _line_no int := 0;
  _export_id uuid;
  _err text;
BEGIN
  SELECT i.id, i.organization_id, i.invoice_number, i.customer_name, i.container_id,
         i.subtotal, i.total_amount, i.currency
    INTO _inv
  FROM public.invoices i WHERE i.id = _invoice_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'invoice_not_found';
  END IF;

  BEGIN
    -- Container
    SELECT container_number, depot_id INTO _container
      FROM public.containers WHERE id = _inv.container_id;

    -- Customer (look up by name within org for billing identifiers)
    SELECT company_name, tax_id, kra_pin, address, email
      INTO _customer
    FROM public.customers
    WHERE organization_id = _inv.organization_id
      AND lower(company_name) = lower(_inv.customer_name)
    LIMIT 1;

    -- Depot
    SELECT name, tax_id, address INTO _depot
      FROM public.depots
      WHERE id = COALESCE(_container.depot_id, (SELECT depot_id FROM public.containers WHERE id = _inv.container_id));

    _depot_name := COALESCE(_depot.name, 'DEPOT');
    _depot_addr := COALESCE(_depot.address, '');
    _depot_id := COALESCE(_depot.tax_id, _inv.organization_id::text);
    _customer_id := COALESCE(_customer.tax_id, _customer.kra_pin, upper(replace(_inv.customer_name, ' ', '')));
    _customer_addr := COALESCE(_customer.address, '');

    _ich := next_edi_interchange_ref(_inv.organization_id);

    -- UNA service-string advice
    _msg := 'UNA:+.? ''' || E'\n';

    -- UNB interchange header
    _msg := _msg || 'UNB+UNOC:3+' || _depot_id || ':ZZZ+' || _customer_id || ':ZZZ+'
            || _date || ':' || _time || '+' || _ich || '''' || E'\n';

    -- UNH message header
    _msg := _msg || 'UNH+1+INVOIC:D:96A:UN''' || E'\n'; _segments := _segments + 1;

    -- BGM beginning of message — 380 = commercial invoice
    _msg := _msg || 'BGM+380+' || _inv.invoice_number || '+9''' || E'\n'; _segments := _segments + 1;

    -- DTM date — 137 = document/message date
    _msg := _msg || 'DTM+137:' || _doc_date || ':102''' || E'\n'; _segments := _segments + 1;

    -- RFF container reference
    IF _container.container_number IS NOT NULL THEN
      _msg := _msg || 'RFF+ON:' || _container.container_number || '''' || E'\n'; _segments := _segments + 1;
    END IF;

    -- NAD supplier (depot)
    _msg := _msg || 'NAD+SU+' || _depot_id || '::92++' || _depot_name || '+' || _depot_addr || '''' || E'\n'; _segments := _segments + 1;
    -- NAD buyer (shipping line/owner)
    _msg := _msg || 'NAD+BY+' || _customer_id || '::92++' || _inv.customer_name || '+' || _customer_addr || '''' || E'\n'; _segments := _segments + 1;

    -- RFF VAT — KRA PIN if present
    IF _customer.kra_pin IS NOT NULL AND length(_customer.kra_pin) > 0 THEN
      _msg := _msg || 'RFF+VA:' || _customer.kra_pin || '''' || E'\n'; _segments := _segments + 1;
    END IF;

    -- CUX currency
    _msg := _msg || 'CUX+2:' || COALESCE(_inv.currency,'EUR') || ':4''' || E'\n'; _segments := _segments + 1;

    -- LIN/IMD/QTY/MOA/PRI per line item
    FOR _line IN
      SELECT description, quantity, unit_price, total_price
        FROM public.invoice_line_items
        WHERE invoice_id = _invoice_id
        ORDER BY created_at
    LOOP
      _line_no := _line_no + 1;
      _msg := _msg || 'LIN+' || _line_no || '++' || COALESCE(_container.container_number, _inv.invoice_number) || ':CN''' || E'\n'; _segments := _segments + 1;
      _msg := _msg || 'IMD+F++::::' || replace(_line.description, '+', ' ') || '''' || E'\n'; _segments := _segments + 1;
      _msg := _msg || 'QTY+47:' || _line.quantity || '''' || E'\n'; _segments := _segments + 1;
      _msg := _msg || 'MOA+203:' || _line.total_price || '''' || E'\n'; _segments := _segments + 1;
      _msg := _msg || 'PRI+AAA:' || _line.unit_price || '''' || E'\n'; _segments := _segments + 1;
    END LOOP;

    -- Summary
    _msg := _msg || 'UNS+S''' || E'\n'; _segments := _segments + 1;
    _msg := _msg || 'MOA+86:' || _inv.total_amount || '''' || E'\n'; _segments := _segments + 1;

    -- UNT trailer (segment count includes UNH and UNT)
    _segments := _segments + 1;
    _msg := _msg || 'UNT+' || _segments || '+1''' || E'\n';

    -- UNZ interchange trailer
    _msg := _msg || 'UNZ+1+' || _ich || '''' || E'\n';

    INSERT INTO public.edi_exports (
      organization_id, invoice_id, format, interchange_control_ref, message_ref,
      payload, byte_size, sha256, status, created_by
    ) VALUES (
      _inv.organization_id, _invoice_id, 'EDIFACT_INVOIC_D96A', _ich, '1',
      _msg, octet_length(_msg), encode(digest(_msg, 'sha256'), 'hex'),
      'generated', auth.uid()
    ) RETURNING id INTO _export_id;

    PERFORM public.log_org_event(
      _inv.organization_id,
      'edi_export_generated',
      jsonb_build_object(
        'invoice_id', _invoice_id,
        'invoice_number', _inv.invoice_number,
        'edi_export_id', _export_id,
        'interchange_ref', _ich,
        'sha256', encode(digest(_msg, 'sha256'), 'hex'),
        'byte_size', octet_length(_msg),
        'status', 'generated'
      )
    );

    RETURN _export_id;
  EXCEPTION WHEN OTHERS THEN
    _err := SQLERRM;
    INSERT INTO public.edi_exports (
      organization_id, invoice_id, format, status, error, created_by
    ) VALUES (
      _inv.organization_id, _invoice_id, 'EDIFACT_INVOIC_D96A',
      'failed', _err, auth.uid()
    ) RETURNING id INTO _export_id;

    PERFORM public.log_org_event(
      _inv.organization_id,
      'edi_export_generated',
      jsonb_build_object(
        'invoice_id', _invoice_id,
        'invoice_number', _inv.invoice_number,
        'edi_export_id', _export_id,
        'status', 'failed',
        'error', _err
      )
    );
    RETURN _export_id;
  END;
END;
$$;

GRANT EXECUTE ON FUNCTION public.generate_gate_in_edi(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.next_edi_interchange_ref(uuid) TO authenticated;

-- =========================================================================
-- mark_edi_downloaded
-- =========================================================================
CREATE OR REPLACE FUNCTION public.mark_edi_downloaded(_export_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _row record;
BEGIN
  IF NOT (
    has_role(auth.uid(),'admin'::app_role)
    OR has_role(auth.uid(),'gate_clerk'::app_role)
    OR has_role(auth.uid(),'yard_operator'::app_role)
  ) THEN
    RAISE EXCEPTION 'forbidden_role';
  END IF;

  SELECT id, organization_id, invoice_id, interchange_control_ref
    INTO _row
  FROM public.edi_exports WHERE id = _export_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'edi_export_not_found'; END IF;

  UPDATE public.edi_exports
     SET status = 'downloaded',
         downloaded_at = now(),
         downloaded_by = auth.uid()
   WHERE id = _export_id;

  PERFORM public.log_org_event(
    _row.organization_id,
    'edi_export_downloaded',
    jsonb_build_object(
      'edi_export_id', _row.id,
      'invoice_id', _row.invoice_id,
      'interchange_ref', _row.interchange_control_ref
    )
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.mark_edi_downloaded(uuid) TO authenticated;

-- =========================================================================
-- Update bill_gate_in to also generate EDI (best-effort; failures logged)
-- =========================================================================
CREATE OR REPLACE FUNCTION public.bill_gate_in(
  _container_id uuid,
  _customer_name text,
  _amount numeric,
  _currency text DEFAULT 'EUR'
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _org uuid;
  _container_number text;
  _invoice_id uuid;
  _invoice_number text;
BEGIN
  IF _amount IS NULL OR _amount <= 0 THEN
    RAISE EXCEPTION 'invalid_amount';
  END IF;
  IF _customer_name IS NULL OR length(trim(_customer_name)) = 0 THEN
    RAISE EXCEPTION 'missing_customer';
  END IF;

  SELECT organization_id, container_number
    INTO _org, _container_number
  FROM public.containers
  WHERE id = _container_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'container_not_found';
  END IF;

  IF NOT (
    public.is_platform_admin()
    OR public.has_role(auth.uid(), 'admin'::app_role)
    OR public.has_role(auth.uid(), 'gate_clerk'::app_role)
    OR public.has_role(auth.uid(), 'yard_operator'::app_role)
  ) THEN
    RAISE EXCEPTION 'forbidden_role';
  END IF;

  _invoice_number := 'GIN-' || to_char(now(), 'YYYYMMDD') || '-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6));

  INSERT INTO public.invoices (
    invoice_number, customer_name, container_id, invoice_type,
    subtotal, tax_rate, tax_amount, total_amount, currency, status, created_by, organization_id
  ) VALUES (
    _invoice_number, _customer_name, _container_id, 'gate_fee',
    _amount, 0, 0, _amount, COALESCE(_currency, 'EUR'), 'draft', auth.uid(), _org
  ) RETURNING id INTO _invoice_id;

  INSERT INTO public.invoice_line_items (
    invoice_id, description, quantity, unit_price, total_price, charge_type, organization_id
  ) VALUES (
    _invoice_id,
    'Gate-in fee – ' || COALESCE(_container_number, _container_id::text),
    1, _amount, _amount, 'gate_fee', _org
  );

  PERFORM public.log_org_event(
    _org,
    'gate_in_billed',
    jsonb_build_object(
      'invoice_id', _invoice_id,
      'invoice_number', _invoice_number,
      'container_id', _container_id,
      'container_number', _container_number,
      'customer_name', _customer_name,
      'amount', _amount,
      'currency', COALESCE(_currency, 'EUR')
    )
  );

  -- Auto-generate EDI (best-effort; never blocks billing)
  BEGIN
    PERFORM public.generate_gate_in_edi(_invoice_id);
  EXCEPTION WHEN OTHERS THEN
    -- Already logged inside generate_gate_in_edi; swallow to keep billing intact
    NULL;
  END;

  RETURN _invoice_id;
END;
$$;
