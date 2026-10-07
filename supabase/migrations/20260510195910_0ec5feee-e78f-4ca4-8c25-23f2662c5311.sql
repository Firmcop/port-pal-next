-- Add gate-in fee to tariffs
ALTER TABLE public.tariffs
  ADD COLUMN IF NOT EXISTS gate_in_fee numeric(10,2) NOT NULL DEFAULT 0;

-- Lookup helper: returns the gate-in fee for a container based on its size/category/height
CREATE OR REPLACE FUNCTION public.lookup_gate_in_fee(_container_id uuid)
RETURNS TABLE(amount numeric, currency text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _c record;
BEGIN
  SELECT c.size::text AS size, c.category::text AS category, c.height_class::text AS height_class, c.organization_id
    INTO _c
  FROM public.containers c
  WHERE c.id = _container_id;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT t.gate_in_fee, t.currency
  FROM public.tariffs t
  WHERE t.organization_id = _c.organization_id
    AND t.is_active = true
    AND t.container_size = _c.size
    AND t.container_category = _c.category
    AND (t.container_category <> 'dry' OR t.height_class::text = COALESCE(_c.height_class, 'LC'))
  ORDER BY t.updated_at DESC
  LIMIT 1;
END;
$$;

-- Bill a gate-in fee: creates a draft invoice + one line item, returns the invoice id
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

  RETURN _invoice_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.lookup_gate_in_fee(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.bill_gate_in(uuid, text, numeric, text) TO authenticated;