
-- 1. Add height_class to gate_in_upsert_container
CREATE OR REPLACE FUNCTION public.gate_in_upsert_container(_payload jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _id uuid;
  _num text := upper(trim(_payload->>'container_number'));
  _is_empty boolean := COALESCE(NULLIF(_payload->>'cargo_status',''),'empty') = 'empty';
  _org uuid := current_org_id();
  _height_class text := NULLIF(_payload->>'height_class','');
BEGIN
  IF _payload->>'container_id' IS NOT NULL AND _payload->>'container_id' <> '' THEN
    _id := (_payload->>'container_id')::uuid;
    UPDATE public.containers SET
      status = 'available',
      is_empty = _is_empty,
      gate_in_at = now(),
      gate_out_at = NULL,
      owner = COALESCE(owner, NULLIF(_payload->>'owner','')),
      shipping_line = COALESCE(shipping_line, NULLIF(_payload->>'shipping_line','')),
      iso_type = COALESCE(iso_type, NULLIF(_payload->>'iso_type','')),
      tare_weight_kg = COALESCE(tare_weight_kg, NULLIF(_payload->>'tare_weight_kg','')::numeric),
      weight_kg = COALESCE(weight_kg, NULLIF(_payload->>'weight_kg','')::numeric),
      height_class = COALESCE(height_class, _height_class),
      updated_at = now()
    WHERE id = _id;
    RETURN _id;
  END IF;

  IF _num IS NULL OR _num = '' THEN
    RAISE EXCEPTION 'container_number_required';
  END IF;

  SELECT id INTO _id FROM public.containers
    WHERE organization_id = _org AND container_number = _num
    LIMIT 1;

  IF _id IS NOT NULL THEN
    UPDATE public.containers SET
      status = 'available',
      is_empty = _is_empty,
      gate_in_at = now(),
      gate_out_at = NULL,
      owner = COALESCE(owner, NULLIF(_payload->>'owner','')),
      shipping_line = COALESCE(shipping_line, NULLIF(_payload->>'shipping_line','')),
      iso_type = COALESCE(iso_type, NULLIF(_payload->>'iso_type','')),
      tare_weight_kg = COALESCE(tare_weight_kg, NULLIF(_payload->>'tare_weight_kg','')::numeric),
      weight_kg = COALESCE(weight_kg, NULLIF(_payload->>'weight_kg','')::numeric),
      height_class = COALESCE(height_class, _height_class),
      updated_at = now()
    WHERE id = _id;
    RETURN _id;
  END IF;

  INSERT INTO public.containers (
    container_number, size, category, iso_type, owner, shipping_line,
    tare_weight_kg, weight_kg, height_class, status, is_empty, gate_in_at, organization_id
  ) VALUES (
    _num,
    COALESCE(NULLIF(_payload->>'size',''), '20')::container_size,
    COALESCE(NULLIF(_payload->>'category',''), 'dry')::container_category,
    NULLIF(_payload->>'iso_type',''),
    NULLIF(_payload->>'owner',''),
    NULLIF(_payload->>'shipping_line',''),
    NULLIF(_payload->>'tare_weight_kg','')::numeric,
    NULLIF(_payload->>'weight_kg','')::numeric,
    _height_class,
    'available', _is_empty, now(), _org
  ) RETURNING id INTO _id;

  RETURN _id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.gate_in_upsert_container(jsonb) TO authenticated;

-- 2. Extend bill_gate_in with optional _kind parameter
CREATE OR REPLACE FUNCTION public.bill_gate_in(
  _container_id uuid,
  _customer_name text,
  _amount numeric,
  _currency text DEFAULT NULL,
  _source_movement_id uuid DEFAULT NULL,
  _source_eir_id uuid DEFAULT NULL,
  _kind text DEFAULT 'gate_in_fee'
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
  _prefix text;
  _line_desc text;
  _kind_norm text := COALESCE(NULLIF(_kind,''),'gate_in_fee');
BEGIN
  IF _amount IS NULL OR _amount <= 0 THEN RAISE EXCEPTION 'invalid_amount'; END IF;
  IF _customer_name IS NULL OR length(trim(_customer_name)) = 0 THEN RAISE EXCEPTION 'missing_customer'; END IF;
  IF _kind_norm NOT IN ('gate_in_fee','inbound_transport') THEN RAISE EXCEPTION 'invalid_kind'; END IF;

  SELECT organization_id, container_number INTO _org, _container_number
    FROM public.containers WHERE id = _container_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'container_not_found'; END IF;

  IF NOT (
    public.is_platform_admin()
    OR public.has_role(auth.uid(),'admin'::app_role)
    OR public.has_role(auth.uid(),'gate_clerk'::app_role)
    OR public.has_role(auth.uid(),'yard_operator'::app_role)
  ) THEN RAISE EXCEPTION 'forbidden_role'; END IF;

  IF _kind_norm = 'inbound_transport' THEN
    _prefix := 'TRN';
    _line_desc := 'Inbound transport – ' || COALESCE(_container_number,_container_id::text);
  ELSE
    _prefix := 'GIN';
    _line_desc := 'Gate-in fee – ' || COALESCE(_container_number,_container_id::text);
  END IF;

  _invoice_number := _prefix || '-' || to_char(now(),'YYYYMMDD') || '-' || upper(substr(replace(gen_random_uuid()::text,'-',''),1,6));

  INSERT INTO public.invoices (
    invoice_number, customer_name, container_id, invoice_type,
    subtotal, tax_rate, tax_amount, total_amount, currency, status,
    created_by, organization_id, source_movement_id, source_eir_id
  ) VALUES (
    _invoice_number, _customer_name, _container_id, 'gate_fee',
    _amount, 0, 0, _amount, _currency, 'draft',
    auth.uid(), _org, _source_movement_id, _source_eir_id
  ) RETURNING id INTO _invoice_id;

  INSERT INTO public.invoice_line_items (
    invoice_id, description, quantity, unit_price, total_price, charge_type, organization_id
  ) VALUES (
    _invoice_id, _line_desc, 1, _amount, _amount, 'gate_fee', _org
  );

  PERFORM public.log_org_event(_org, CASE WHEN _kind_norm='inbound_transport' THEN 'inbound_transport_billed' ELSE 'gate_in_billed' END,
    jsonb_build_object('invoice_id',_invoice_id,'invoice_number',_invoice_number,
      'container_id',_container_id,'container_number',_container_number,
      'customer_name',_customer_name,'amount',_amount,'currency',_currency,'kind',_kind_norm,
      'source_movement_id',_source_movement_id,'source_eir_id',_source_eir_id));

  IF _kind_norm = 'gate_in_fee' THEN
    BEGIN PERFORM public.generate_gate_in_edi(_invoice_id);
    EXCEPTION WHEN OTHERS THEN NULL; END;
  END IF;

  RETURN _invoice_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.bill_gate_in(uuid, text, numeric, text, uuid, uuid, text) TO authenticated;
