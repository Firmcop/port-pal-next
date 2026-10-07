
-- 1. New cost columns
ALTER TABLE public.container_conversions
  ADD COLUMN IF NOT EXISTS transport_offloading_cost numeric NOT NULL DEFAULT 0;

ALTER TABLE public.container_sales
  ADD COLUMN IF NOT EXISTS transport_offloading_cost numeric NOT NULL DEFAULT 0;

-- 2. Adjustment RPC for owner acquisition (delta-based; supports negative for credit)
CREATE OR REPLACE FUNCTION public.adjust_container_acquisition(
  _container_id uuid,
  _delta_amount numeric,
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
  _inv_id uuid;
  _inv_num text;
  _abs numeric;
  _sign int;
BEGIN
  IF _container_id IS NULL OR _delta_amount IS NULL OR _delta_amount = 0 THEN
    RETURN NULL;
  END IF;

  _sign := CASE WHEN _delta_amount > 0 THEN 1 ELSE -1 END;
  _abs := abs(_delta_amount);

  SELECT owner, container_number INTO _owner, _container_number
    FROM public.containers
   WHERE id = _container_id AND organization_id = _org;

  IF _owner IS NULL OR btrim(_owner) = '' THEN RETURN NULL; END IF;

  SELECT name INTO _depot_name FROM public.depots
   WHERE organization_id = _org ORDER BY created_at ASC LIMIT 1;

  IF _depot_name IS NOT NULL AND lower(btrim(_depot_name)) = lower(btrim(_owner)) THEN
    RETURN NULL;
  END IF;

  SELECT id INTO _supplier_id FROM public.suppliers
   WHERE organization_id = _org AND lower(btrim(name)) = lower(btrim(_owner)) LIMIT 1;
  IF _supplier_id IS NULL THEN
    INSERT INTO public.suppliers (name, organization_id, notes, is_active)
    VALUES (btrim(_owner), _org, 'Auto-created from container acquisition adjustment', true)
    RETURNING id INTO _supplier_id;
  END IF;

  _po_num := 'PO-ACQ-ADJ-' || COALESCE(NULLIF(_reference,''), to_char(now(),'YYYYMMDD'))
           || '-' || substr(replace(gen_random_uuid()::text,'-',''),1,6);
  _label := CASE WHEN _sign > 0 THEN 'Container acquisition adjustment (increase)' ELSE 'Container acquisition adjustment (decrease)' END
         || ' — ' || COALESCE(_container_number, _container_id::text);

  INSERT INTO public.purchase_orders (po_number, supplier_id, status, total_cost, organization_id)
  VALUES (_po_num, _supplier_id, 'approved', _sign * _abs, _org)
  RETURNING id INTO _po_id;

  INSERT INTO public.po_items (po_id, description, quantity, unit_price, total_cost, organization_id)
  VALUES (_po_id, _label, 1, _sign * _abs, _sign * _abs, _org);

  _inv_num := 'PINV-ADJ-' || to_char(now(),'YYYYMMDD') || '-' || substr(replace(gen_random_uuid()::text,'-',''),1,6);

  INSERT INTO public.supplier_invoices (
    organization_id, invoice_number, supplier_id, purchase_order_id, container_id,
    reason, reference, issue_date, due_date,
    subtotal, tax_amount, total_amount, currency, status
  ) VALUES (
    _org, _inv_num, _supplier_id, _po_id, _container_id,
    _reason, NULLIF(_reference,''), current_date, current_date + INTERVAL '30 days',
    _sign * _abs, 0, _sign * _abs, COALESCE(NULLIF(_currency,''),'USD'), 'issued'
  ) RETURNING id INTO _inv_id;

  INSERT INTO public.supplier_invoice_lines (
    organization_id, invoice_id, description, quantity, unit_price, line_total
  ) VALUES (_org, _inv_id, _label, 1, _sign * _abs, _sign * _abs);

  INSERT INTO public.accounting_transactions (
    transaction_number, account_type, category, description,
    debit_amount, credit_amount, reference_type, reference_id, organization_id
  ) VALUES (
    'TXN-APAY-ADJ-' || substr(replace(gen_random_uuid()::text,'-',''),1,10),
    'liability',
    'container_acquisition_payable_adjustment',
    _label || ' — payable adjustment to ' || _owner || ' (' || _inv_num || ')',
    CASE WHEN _sign < 0 THEN _abs ELSE 0 END,
    CASE WHEN _sign > 0 THEN _abs ELSE 0 END,
    'supplier_invoices', _inv_id, _org
  );

  -- Mirror to containers.acquisition_cost
  UPDATE public.containers
     SET acquisition_cost = COALESCE(acquisition_cost,0) + (_sign * _abs)
   WHERE id = _container_id AND organization_id = _org;

  RETURN _po_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.adjust_container_acquisition(uuid,numeric,text,text,text) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.adjust_container_acquisition(uuid,numeric,text,text,text) TO authenticated, service_role;

-- 3. Adjust conversion costs (purchase + transport) with ledger harmonization
CREATE OR REPLACE FUNCTION public.adjust_conversion_costs(
  _id uuid,
  _new_purchase numeric,
  _new_transport numeric
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _org uuid := current_org_id();
  _row public.container_conversions%ROWTYPE;
  _delta_purchase numeric;
  _delta_transport numeric;
  _delta_total numeric;
  _adj_po uuid;
  _currency text;
  _ref text;
  _ledger_posted boolean := false;
BEGIN
  SELECT * INTO _row FROM public.container_conversions
   WHERE id = _id AND organization_id = _org;
  IF NOT FOUND THEN RAISE EXCEPTION 'conversion_not_found'; END IF;

  _new_purchase := COALESCE(_new_purchase, 0);
  _new_transport := COALESCE(_new_transport, 0);

  _delta_purchase := _new_purchase - COALESCE(_row.container_cost, 0);
  _delta_transport := _new_transport - COALESCE(_row.transport_offloading_cost, 0);
  _delta_total := _delta_purchase + _delta_transport;

  UPDATE public.container_conversions
     SET container_cost = _new_purchase,
         transport_offloading_cost = _new_transport,
         updated_at = now()
   WHERE id = _id;

  IF _row.status = 'completed' THEN
    _currency := COALESCE(_row.currency, 'USD');
    _ref := COALESCE(_row.conversion_number, _id::text);

    IF _row.container_id IS NOT NULL AND _delta_purchase <> 0 THEN
      _adj_po := public.adjust_container_acquisition(
        _row.container_id, _delta_purchase, _currency, 'conversion', _ref);
    END IF;

    IF _delta_total <> 0 THEN
      INSERT INTO public.accounting_transactions (
        transaction_number, account_type, category, description,
        debit_amount, credit_amount, reference_type, reference_id, organization_id
      ) VALUES (
        'TXN-CONV-ADJ-' || substr(replace(gen_random_uuid()::text,'-',''),1,10),
        'expense',
        'cost_adjustment',
        'Conversion cost adjustment — ' || _ref
          || ' (purchase ' || _delta_purchase || ', transport ' || _delta_transport || ')',
        CASE WHEN _delta_total > 0 THEN _delta_total ELSE 0 END,
        CASE WHEN _delta_total < 0 THEN -_delta_total ELSE 0 END,
        'container_conversions', _id, _org
      );
      _ledger_posted := true;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'delta_purchase', _delta_purchase,
    'delta_transport', _delta_transport,
    'adjustment_po', _adj_po,
    'ledger_posted', _ledger_posted
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.adjust_conversion_costs(uuid,numeric,numeric) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.adjust_conversion_costs(uuid,numeric,numeric) TO authenticated, service_role;

-- 4. Adjust sale costs (entry_price + transport) with ledger harmonization
CREATE OR REPLACE FUNCTION public.adjust_sale_costs(
  _id uuid,
  _new_purchase numeric,
  _new_transport numeric
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _org uuid := current_org_id();
  _row public.container_sales%ROWTYPE;
  _delta_purchase numeric;
  _delta_transport numeric;
  _delta_total numeric;
  _adj_po uuid;
  _currency text;
  _ref text;
  _ledger_posted boolean := false;
BEGIN
  SELECT * INTO _row FROM public.container_sales
   WHERE id = _id AND organization_id = _org;
  IF NOT FOUND THEN RAISE EXCEPTION 'sale_not_found'; END IF;

  _new_purchase := COALESCE(_new_purchase, 0);
  _new_transport := COALESCE(_new_transport, 0);

  _delta_purchase := _new_purchase - COALESCE(_row.entry_price, 0);
  _delta_transport := _new_transport - COALESCE(_row.transport_offloading_cost, 0);
  _delta_total := _delta_purchase + _delta_transport;

  UPDATE public.container_sales
     SET entry_price = _new_purchase,
         transport_offloading_cost = _new_transport,
         -- recompute selling_price to keep markup invariant
         selling_price = _new_purchase * (1 + COALESCE(markup_percentage,0)/100.0),
         updated_at = now()
   WHERE id = _id;

  IF _row.status = 'sold' THEN
    _currency := 'USD';
    _ref := COALESCE(_row.sale_number, _id::text);

    IF _row.container_id IS NOT NULL AND _delta_purchase <> 0 THEN
      _adj_po := public.adjust_container_acquisition(
        _row.container_id, _delta_purchase, _currency, 'sale', _ref);
    END IF;

    IF _delta_total <> 0 THEN
      INSERT INTO public.accounting_transactions (
        transaction_number, account_type, category, description,
        debit_amount, credit_amount, reference_type, reference_id, organization_id
      ) VALUES (
        'TXN-SALE-ADJ-' || substr(replace(gen_random_uuid()::text,'-',''),1,10),
        'expense',
        'cost_adjustment',
        'Sale COGS adjustment — ' || _ref
          || ' (purchase ' || _delta_purchase || ', transport ' || _delta_transport || ')',
        CASE WHEN _delta_total > 0 THEN _delta_total ELSE 0 END,
        CASE WHEN _delta_total < 0 THEN -_delta_total ELSE 0 END,
        'container_sales', _id, _org
      );
      _ledger_posted := true;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'delta_purchase', _delta_purchase,
    'delta_transport', _delta_transport,
    'adjustment_po', _adj_po,
    'ledger_posted', _ledger_posted
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.adjust_sale_costs(uuid,numeric,numeric) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.adjust_sale_costs(uuid,numeric,numeric) TO authenticated, service_role;
