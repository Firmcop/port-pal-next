CREATE OR REPLACE FUNCTION public.acquire_container_from_owner(_container_id uuid, _amount numeric, _currency text, _reason text, _reference text, _expected_owner text DEFAULT NULL::text, _fx_rate numeric DEFAULT NULL::numeric)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _org uuid := current_org_id();
  _container_owner text; _sold_owner text; _owner text; _source text; _note text;
  _buyer text; _container_number text; _depot_name text;
  _supplier_id uuid; _po_id uuid; _po_num text; _label text; _inv_id uuid; _inv_num text;
  _doc_cur text := upper(COALESCE(NULLIF(_currency,''),'USD'));
  _sup_cur text; _rate numeric; _billed numeric;
  _base_cur text; _base_rate numeric; _base_amt numeric; _fx_src text;
BEGIN
  IF _container_id IS NULL OR _amount IS NULL OR _amount <= 0 THEN RETURN NULL; END IF;

  SELECT owner, container_number INTO _container_owner, _container_number
    FROM public.containers WHERE id = _container_id AND organization_id = _org;

  SELECT original_owner INTO _sold_owner FROM public.container_sales
   WHERE container_id = _container_id AND organization_id = _org
     AND original_owner IS NOT NULL AND btrim(original_owner) <> ''
   ORDER BY created_at DESC LIMIT 1;

  SELECT buyer_name INTO _buyer FROM public.container_sales
   WHERE container_id = _container_id AND organization_id = _org
   ORDER BY created_at DESC LIMIT 1;

  IF _expected_owner IS NOT NULL AND btrim(_expected_owner) <> '' THEN
    _owner := btrim(_expected_owner); _source := 'expected_owner';
    _note := 'PO issued to expected owner ' || _owner || COALESCE(' (buyer: ' || NULLIF(_buyer,'') || ')','');
  ELSIF _sold_owner IS NOT NULL THEN
    _owner := btrim(_sold_owner); _source := 'sale_original_owner';
    _note := 'Container previously sold; PO issued to sale original owner ' || _owner || COALESCE(' (buyer: ' || NULLIF(_buyer,'') || ')','');
  ELSE
    _owner := btrim(COALESCE(_container_owner,'')); _source := 'container_owner';
    _note := 'PO issued to container.owner ' || _owner;
  END IF;

  IF _owner IS NULL OR _owner = '' THEN RETURN NULL; END IF;

  SELECT name INTO _depot_name FROM public.depots WHERE organization_id = _org ORDER BY created_at ASC LIMIT 1;
  IF _depot_name IS NOT NULL AND lower(_depot_name) = lower(_owner) THEN RETURN NULL; END IF;

  SELECT id, currency INTO _supplier_id, _sup_cur FROM public.suppliers
   WHERE organization_id = _org AND lower(btrim(name)) = lower(_owner) LIMIT 1;
  IF _supplier_id IS NULL THEN
    INSERT INTO public.suppliers (name, organization_id, notes, is_active, currency)
    VALUES (_owner, _org, 'Auto-created from container acquisition', true, _doc_cur)
    RETURNING id, currency INTO _supplier_id, _sup_cur;
  END IF;

  _billed := _amount;
  IF _sup_cur IS NOT NULL AND upper(_sup_cur) <> _doc_cur THEN
    _rate := public.get_fx_rate(_org, _doc_cur, upper(_sup_cur), current_date);
    IF _rate IS NOT NULL AND _rate > 0 THEN
      _billed := round(_amount * _rate, 2);
      _note := _note || format(' — billed in supplier currency %s at %s %s/%s', upper(_sup_cur), _rate, upper(_sup_cur), _doc_cur);
      _doc_cur := upper(_sup_cur);
    ELSE
      _note := _note || format(' — supplier currency %s but no FX rate from %s; billed in %s', upper(_sup_cur), _doc_cur, _doc_cur);
    END IF;
  END IF;

  _po_num := 'PO-ACQ-' || COALESCE(NULLIF(_reference,''), to_char(now(),'YYYYMMDD'))
           || '-' || substr(replace(gen_random_uuid()::text,'-',''),1,6);
  _label := CASE _reason
              WHEN 'sale' THEN 'Container acquisition (sale)'
              WHEN 'conversion' THEN 'Container acquisition (conversion)'
              WHEN 'gate_out_sale' THEN 'Container acquisition (gate-out sale)'
              ELSE 'Container acquisition'
            END || ' — ' || COALESCE(_container_number, _container_id::text);

  INSERT INTO public.purchase_orders (
    po_number, supplier_id, status, total_cost, organization_id, currency,
    recipient_source, recipient_resolution_note, resolved_container_id
  ) VALUES (_po_num, _supplier_id, 'approved', _billed, _org, _doc_cur, _source, _note, _container_id)
  RETURNING id INTO _po_id;

  INSERT INTO public.po_items (po_id, description, quantity, unit_price, total_cost, organization_id)
  VALUES (_po_id, _label, 1, _billed, _billed, _org);

  _inv_num := 'PINV-' || to_char(now(),'YYYYMMDD') || '-' || substr(replace(gen_random_uuid()::text,'-',''),1,6);

  SELECT upper(COALESCE(currency,'USD')) INTO _base_cur FROM public.organizations WHERE id = _org;
  IF _base_cur IS NOT NULL AND _base_cur <> _doc_cur THEN
    IF _fx_rate IS NOT NULL AND _fx_rate > 0 THEN
      _base_rate := _fx_rate; _fx_src := 'manual';
    ELSE
      _base_rate := public.get_fx_rate(_org, _doc_cur, _base_cur, current_date); _fx_src := 'auto';
    END IF;
    IF _base_rate IS NOT NULL AND _base_rate > 0 THEN
      _base_amt := round(_billed * _base_rate, 2);
    END IF;
  ELSE
    _base_rate := 1; _base_amt := _billed; _fx_src := 'auto';
  END IF;

  INSERT INTO public.supplier_invoices (
    organization_id, invoice_number, supplier_id, purchase_order_id, container_id,
    reason, reference, issue_date, due_date, subtotal, tax_amount, total_amount, currency, status,
    fx_rate, base_amount, fx_rate_source
  ) VALUES (
    _org, _inv_num, _supplier_id, _po_id, _container_id, _reason, NULLIF(_reference,''),
    current_date, current_date + INTERVAL '30 days', _billed, 0, _billed, _doc_cur, 'issued',
    _base_rate, _base_amt, _fx_src
  ) RETURNING id INTO _inv_id;

  INSERT INTO public.supplier_invoice_lines (organization_id, invoice_id, description, quantity, unit_price, line_total)
  VALUES (_org, _inv_id, _label, 1, _billed, _billed);

  INSERT INTO public.accounting_transactions (
    transaction_number, account_type, category, description,
    debit_amount, credit_amount, reference_type, reference_id, organization_id, currency
  ) VALUES (
    'TXN-APAY-' || substr(replace(gen_random_uuid()::text,'-',''),1,10),
    'liability', 'container_acquisition_payable',
    _label || ' — payable to ' || _owner || ' (' || _inv_num || ')',
    0, _billed, 'supplier_invoices', _inv_id, _org, _doc_cur
  );

  INSERT INTO public.finance_audit_log (organization_id, entity_type, entity_id, action, summary)
  VALUES (_org, 'purchase_orders', _po_id, 'po_recipient_resolved',
    jsonb_build_object('po_number', _po_num, 'container_id', _container_id, 'container_number', _container_number,
      'buyer_name', _buyer, 'expected_owner', _expected_owner, 'sale_original_owner', _sold_owner,
      'container_owner', _container_owner, 'chosen_owner', _owner, 'recipient_source', _source,
      'reason', _reason, 'currency', _doc_cur, 'billed_amount', _billed,
      'fx_rate', _base_rate, 'fx_rate_source', _fx_src, 'base_amount', _base_amt));

  RETURN _po_id;
END $function$;

CREATE OR REPLACE FUNCTION public.record_container_service_invoice(_container_id uuid, _vendor_name text, _amount numeric, _currency text, _service_kind text, _reference text DEFAULT NULL::text, _fx_rate numeric DEFAULT NULL::numeric)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _org uuid := current_org_id();
  _vendor text := btrim(COALESCE(_vendor_name,''));
  _container_number text; _depot_name text;
  _supplier_id uuid; _po_id uuid; _po_num text; _label text; _inv_id uuid; _inv_num text;
  _doc_cur text := upper(COALESCE(NULLIF(_currency,''),'USD'));
  _sup_cur text; _rate numeric; _billed numeric; _reason text; _note text; _ref text;
  _base_cur text; _base_rate numeric; _base_amt numeric; _fx_src text;
BEGIN
  IF _container_id IS NULL OR _vendor = '' THEN RETURN NULL; END IF;
  IF _amount IS NULL OR _amount <= 0 THEN RETURN NULL; END IF;
  IF _service_kind NOT IN ('transport','crane_offloading') THEN
    RAISE EXCEPTION 'Invalid service kind %', _service_kind;
  END IF;

  SELECT container_number INTO _container_number
    FROM public.containers WHERE id = _container_id AND organization_id = _org;
  IF _container_number IS NULL THEN RETURN NULL; END IF;

  _reason := 'acquisition_' || _service_kind;
  _ref := COALESCE(NULLIF(btrim(COALESCE(_reference,'')),''), _container_number);

  IF EXISTS (
    SELECT 1 FROM public.supplier_invoices
     WHERE organization_id = _org AND container_id = _container_id AND reason = _reason
  ) THEN
    RETURN NULL;
  END IF;

  SELECT name INTO _depot_name FROM public.depots
   WHERE organization_id = _org ORDER BY created_at ASC LIMIT 1;
  IF _depot_name IS NOT NULL AND lower(_depot_name) = lower(_vendor) THEN RETURN NULL; END IF;

  SELECT id, currency INTO _supplier_id, _sup_cur FROM public.suppliers
   WHERE organization_id = _org AND lower(btrim(name)) = lower(_vendor) LIMIT 1;
  IF _supplier_id IS NULL THEN
    INSERT INTO public.suppliers (name, organization_id, notes, is_active, currency)
    VALUES (_vendor, _org, 'Auto-created from container acquisition service cost', true, _doc_cur)
    RETURNING id, currency INTO _supplier_id, _sup_cur;
  END IF;

  _billed := _amount;
  _note := CASE _service_kind
             WHEN 'transport' THEN 'Transport invoice for container acquisition'
             ELSE 'Crane / offloading invoice for container acquisition'
           END || ' — vendor ' || _vendor;

  IF _sup_cur IS NOT NULL AND upper(_sup_cur) <> _doc_cur THEN
    _rate := public.get_fx_rate(_org, _doc_cur, upper(_sup_cur), current_date);
    IF _rate IS NOT NULL AND _rate > 0 THEN
      _billed := round(_amount * _rate, 2);
      _note := _note || format(' — billed in supplier currency %s at %s %s/%s', upper(_sup_cur), _rate, upper(_sup_cur), _doc_cur);
      _doc_cur := upper(_sup_cur);
    ELSE
      _note := _note || format(' — supplier currency %s but no FX rate from %s; billed in %s', upper(_sup_cur), _doc_cur, _doc_cur);
    END IF;
  END IF;

  _label := CASE _service_kind
              WHEN 'transport' THEN 'Container transport / delivery'
              ELSE 'Container crane / offloading'
            END || ' — ' || _container_number;

  _po_num := 'PO-ACQ-' || upper(substr(_service_kind,1,4)) || '-' || _ref
           || '-' || substr(replace(gen_random_uuid()::text,'-',''),1,6);

  INSERT INTO public.purchase_orders (
    po_number, supplier_id, status, total_cost, organization_id, currency,
    recipient_source, recipient_resolution_note, resolved_container_id
  ) VALUES (_po_num, _supplier_id, 'approved', _billed, _org, _doc_cur,
    'service_vendor', _note, _container_id)
  RETURNING id INTO _po_id;

  INSERT INTO public.po_items (po_id, description, quantity, unit_price, total_cost, organization_id)
  VALUES (_po_id, _label, 1, _billed, _billed, _org);

  _inv_num := 'PINV-' || to_char(now(),'YYYYMMDD') || '-' || substr(replace(gen_random_uuid()::text,'-',''),1,6);

  SELECT upper(COALESCE(currency,'USD')) INTO _base_cur FROM public.organizations WHERE id = _org;
  IF _base_cur IS NOT NULL AND _base_cur <> _doc_cur THEN
    IF _fx_rate IS NOT NULL AND _fx_rate > 0 THEN
      _base_rate := _fx_rate; _fx_src := 'manual';
    ELSE
      _base_rate := public.get_fx_rate(_org, _doc_cur, _base_cur, current_date); _fx_src := 'auto';
    END IF;
    IF _base_rate IS NOT NULL AND _base_rate > 0 THEN
      _base_amt := round(_billed * _base_rate, 2);
    END IF;
  ELSE
    _base_rate := 1; _base_amt := _billed; _fx_src := 'auto';
  END IF;

  INSERT INTO public.supplier_invoices (
    organization_id, invoice_number, supplier_id, purchase_order_id, container_id,
    reason, reference, issue_date, due_date, subtotal, tax_amount, total_amount, currency, status,
    fx_rate, base_amount, fx_rate_source
  ) VALUES (
    _org, _inv_num, _supplier_id, _po_id, _container_id, _reason, _ref,
    current_date, current_date + INTERVAL '30 days', _billed, 0, _billed, _doc_cur, 'issued',
    _base_rate, _base_amt, _fx_src
  ) RETURNING id INTO _inv_id;

  INSERT INTO public.supplier_invoice_lines (organization_id, invoice_id, description, quantity, unit_price, line_total)
  VALUES (_org, _inv_id, _label, 1, _billed, _billed);

  INSERT INTO public.accounting_transactions (
    transaction_number, account_type, category, description,
    debit_amount, credit_amount, reference_type, reference_id, organization_id, currency
  ) VALUES (
    'TXN-APAY-' || substr(replace(gen_random_uuid()::text,'-',''),1,10),
    'liability', 'container_acquisition_payable',
    _label || ' — payable to ' || _vendor || ' (' || _inv_num || ')',
    0, _billed, 'supplier_invoices', _inv_id, _org, _doc_cur
  );

  INSERT INTO public.finance_audit_log (organization_id, entity_type, entity_id, action, summary)
  VALUES (_org, 'purchase_orders', _po_id, 'container_service_invoice',
    jsonb_build_object('po_number', _po_num, 'container_id', _container_id,
      'container_number', _container_number, 'vendor', _vendor,
      'service_kind', _service_kind, 'currency', _doc_cur, 'billed_amount', _billed,
      'fx_rate', _base_rate, 'fx_rate_source', _fx_src, 'base_amount', _base_amt));

  RETURN _po_id;
END $function$;