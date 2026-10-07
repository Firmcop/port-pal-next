DROP FUNCTION IF EXISTS public.acquire_container_from_owner(uuid, numeric, text, text, text, text);

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
  _existing_po uuid; _existing_inv text;
BEGIN
  IF _container_id IS NULL OR _amount IS NULL OR _amount <= 0 THEN RETURN NULL; END IF;

  SELECT owner, container_number INTO _container_owner, _container_number
    FROM public.containers WHERE id = _container_id AND organization_id = _org;

  -- GUARD 1: idempotency — same container + reason + reference already invoiced.
  SELECT si.purchase_order_id, si.invoice_number INTO _existing_po, _existing_inv
    FROM public.supplier_invoices si
   WHERE si.organization_id = _org
     AND si.container_id = _container_id
     AND si.reason = _reason
     AND COALESCE(si.reference,'') = COALESCE(NULLIF(_reference,''),'')
     AND si.status <> 'cancelled'
     AND si.invoice_number NOT LIKE 'PINV-ADJ-%'
   ORDER BY si.created_at ASC LIMIT 1;

  IF _existing_inv IS NOT NULL THEN
    INSERT INTO public.finance_audit_log (organization_id, entity_type, entity_id, action, summary)
    VALUES (_org, 'containers', _container_id, 'acquisition_skipped_duplicate',
      jsonb_build_object('container_number', _container_number, 'reason', _reason,
        'reference', _reference, 'existing_invoice', _existing_inv, 'amount', _amount));
    RETURN _existing_po;
  END IF;

  -- GUARD 2: one acquisition liability per container. Once a container carries a
  -- 'purchase' acquisition invoice it belongs to the depot; selling, gating out or
  -- converting it must never raise a second acquisition invoice to the owner.
  IF _reason IN ('sale','gate_out_sale','conversion') THEN
    SELECT si.purchase_order_id, si.invoice_number INTO _existing_po, _existing_inv
      FROM public.supplier_invoices si
     WHERE si.organization_id = _org
       AND si.container_id = _container_id
       AND si.reason = 'purchase'
       AND si.status <> 'cancelled'
     ORDER BY si.created_at ASC LIMIT 1;

    IF _existing_inv IS NOT NULL THEN
      INSERT INTO public.finance_audit_log (organization_id, entity_type, entity_id, action, summary)
      VALUES (_org, 'containers', _container_id, 'acquisition_skipped_already_purchased',
        jsonb_build_object('container_number', _container_number, 'reason', _reason,
          'reference', _reference, 'purchase_invoice', _existing_inv, 'amount', _amount,
          'note', 'Container already has a purchase acquisition invoice; no second liability raised.'));
      RETURN _existing_po;
    END IF;
  END IF;

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

-- Admin-only reversal of a duplicate/redundant acquisition invoice.
CREATE OR REPLACE FUNCTION public.reverse_duplicate_acquisition_invoice(_invoice_id uuid, _reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _org uuid := current_org_id();
  _inv record; _why text := btrim(COALESCE(_reason,''));
BEGIN
  IF NOT (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'org_owner') OR public.is_platform_admin()) THEN
    RAISE EXCEPTION 'Only administrators can reverse acquisition invoices';
  END IF;
  IF _why = '' THEN RAISE EXCEPTION 'A reason is required'; END IF;

  SELECT * INTO _inv FROM public.supplier_invoices
   WHERE id = _invoice_id AND organization_id = _org;
  IF _inv.id IS NULL THEN RAISE EXCEPTION 'Invoice not found'; END IF;
  IF _inv.status = 'cancelled' THEN
    RETURN jsonb_build_object('invoice_id', _inv.id, 'already_cancelled', true);
  END IF;
  IF COALESCE(_inv.paid_amount,0) > 0 THEN
    RAISE EXCEPTION 'Invoice % has payments applied; settle or unallocate them first', _inv.invoice_number;
  END IF;

  UPDATE public.supplier_invoices
     SET status = 'cancelled',
         notes = COALESCE(notes || E'\n','') || 'Reversed as duplicate acquisition: ' || _why,
         updated_at = now()
   WHERE id = _inv.id;

  IF _inv.purchase_order_id IS NOT NULL THEN
    UPDATE public.purchase_orders
       SET status = 'cancelled', updated_at = now()
     WHERE id = _inv.purchase_order_id AND organization_id = _org;
  END IF;

  -- Contra the acquisition payable
  INSERT INTO public.accounting_transactions (
    transaction_number, account_type, category, description,
    debit_amount, credit_amount, reference_type, reference_id, organization_id, currency
  ) VALUES (
    'TXN-APREV-' || substr(replace(gen_random_uuid()::text,'-',''),1,10),
    'liability', 'container_acquisition_payable',
    'Reversal of duplicate acquisition invoice ' || _inv.invoice_number || ' — ' || _why,
    COALESCE(_inv.total_amount,0), 0, 'supplier_invoices', _inv.id, _org, _inv.currency
  );

  INSERT INTO public.finance_audit_log (organization_id, entity_type, entity_id, action, summary)
  VALUES (_org, 'supplier_invoices', _inv.id, 'acquisition_invoice_reversed',
    jsonb_build_object('invoice_number', _inv.invoice_number, 'container_id', _inv.container_id,
      'reason_code', _inv.reason, 'reference', _inv.reference, 'amount', _inv.total_amount,
      'currency', _inv.currency, 'purchase_order_id', _inv.purchase_order_id, 'note', _why));

  RETURN jsonb_build_object('invoice_id', _inv.id, 'invoice_number', _inv.invoice_number,
    'reversed_amount', _inv.total_amount, 'currency', _inv.currency);
END $function$;

REVOKE ALL ON FUNCTION public.reverse_duplicate_acquisition_invoice(uuid, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.reverse_duplicate_acquisition_invoice(uuid, text) TO authenticated;

-- Read-only audit of redundant / repeated acquisition invoices.
CREATE OR REPLACE FUNCTION public.duplicate_acquisition_audit()
 RETURNS TABLE(
   invoice_id uuid, invoice_number text, container_id uuid, container_number text,
   supplier_name text, reason text, reference text, total_amount numeric, currency text,
   status text, paid_amount numeric, created_at timestamptz,
   issue text, keeps_invoice text
 )
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH scoped AS (
    SELECT si.*, c.container_number, s.name AS supplier_name
      FROM public.supplier_invoices si
      JOIN public.containers c ON c.id = si.container_id
      LEFT JOIN public.suppliers s ON s.id = si.supplier_id
     WHERE si.organization_id = current_org_id()
       AND si.status <> 'cancelled'
       AND si.invoice_number NOT LIKE 'PINV-ADJ-%'
       AND si.reason IN ('purchase','sale','gate_out_sale','conversion')
  ),
  purchases AS (
    SELECT container_id, min(created_at) AS first_at,
           (array_agg(invoice_number ORDER BY created_at))[1] AS keep_inv
      FROM scoped WHERE reason = 'purchase' GROUP BY container_id
  ),
  repeats AS (
    SELECT id,
      row_number() OVER (PARTITION BY container_id, reason, COALESCE(reference,'') ORDER BY created_at) AS rn,
      (array_agg(invoice_number) OVER (PARTITION BY container_id, reason, COALESCE(reference,'') ))[1] AS first_inv
      FROM scoped
  )
  SELECT sc.id, sc.invoice_number, sc.container_id, sc.container_number, sc.supplier_name,
         sc.reason, sc.reference, sc.total_amount, sc.currency, sc.status,
         sc.paid_amount, sc.created_at,
         CASE WHEN r.rn > 1 THEN 'repeat_invoice'
              ELSE 'already_purchased' END AS issue,
         CASE WHEN r.rn > 1 THEN r.first_inv ELSE p.keep_inv END AS keeps_invoice
    FROM scoped sc
    JOIN repeats r ON r.id = sc.id
    LEFT JOIN purchases p ON p.container_id = sc.container_id
   WHERE r.rn > 1
      OR (sc.reason IN ('sale','gate_out_sale','conversion') AND p.container_id IS NOT NULL)
   ORDER BY sc.container_number, sc.created_at;
$function$;

REVOKE ALL ON FUNCTION public.duplicate_acquisition_audit() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.duplicate_acquisition_audit() TO authenticated;