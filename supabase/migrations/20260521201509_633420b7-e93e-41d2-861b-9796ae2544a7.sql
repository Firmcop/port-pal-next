CREATE OR REPLACE FUNCTION public.acquire_container_from_owner(
  _container_id uuid,
  _amount numeric,
  _currency text,
  _reason text,
  _reference text
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _org uuid := current_org_id();
  _owner text;
  _container_number text;
  _depot_name text;
  _supplier_id uuid;
  _po_id uuid;
  _po_num text;
  _label text;
BEGIN
  IF _container_id IS NULL OR _amount IS NULL OR _amount <= 0 THEN
    RETURN NULL;
  END IF;

  SELECT owner, container_number INTO _owner, _container_number
    FROM public.containers
   WHERE id = _container_id AND organization_id = _org;

  IF _owner IS NULL OR btrim(_owner) = '' THEN
    RETURN NULL;
  END IF;

  SELECT name INTO _depot_name FROM public.depots
   WHERE organization_id = _org
   ORDER BY created_at ASC LIMIT 1;

  IF _depot_name IS NOT NULL AND lower(btrim(_depot_name)) = lower(btrim(_owner)) THEN
    RETURN NULL;
  END IF;

  -- Upsert supplier by name within org
  SELECT id INTO _supplier_id FROM public.suppliers
   WHERE organization_id = _org AND lower(btrim(name)) = lower(btrim(_owner))
   LIMIT 1;
  IF _supplier_id IS NULL THEN
    INSERT INTO public.suppliers (name, organization_id, notes, is_active)
    VALUES (btrim(_owner), _org, 'Auto-created from container acquisition', true)
    RETURNING id INTO _supplier_id;
  END IF;

  _po_num := 'PO-ACQ-' || COALESCE(NULLIF(_reference,''), to_char(now(), 'YYYYMMDD')) || '-' || substr(replace(gen_random_uuid()::text,'-',''),1,6);
  _label := CASE _reason
              WHEN 'sale'          THEN 'Container acquisition (sale)'
              WHEN 'conversion'    THEN 'Container acquisition (conversion)'
              WHEN 'gate_out_sale' THEN 'Container acquisition (gate-out sale)'
              ELSE 'Container acquisition'
            END || ' — ' || COALESCE(_container_number, _container_id::text);

  INSERT INTO public.purchase_orders (po_number, supplier_id, status, total_cost, organization_id)
  VALUES (_po_num, _supplier_id, 'approved', _amount, _org)
  RETURNING id INTO _po_id;

  INSERT INTO public.po_items (po_id, description, quantity, unit_price, total_cost, organization_id)
  VALUES (_po_id, _label, 1, _amount, _amount, _org);

  INSERT INTO public.accounting_transactions (
    transaction_number, account_type, category, description,
    debit_amount, credit_amount, reference_type, reference_id, organization_id
  ) VALUES (
    'TXN-APAY-' || substr(replace(gen_random_uuid()::text,'-',''),1,10),
    'liability',
    'container_acquisition_payable',
    _label || ' — payable to ' || _owner,
    0,
    _amount,
    'purchase_orders',
    _po_id,
    _org
  );

  RETURN _po_id;
END;
$$;