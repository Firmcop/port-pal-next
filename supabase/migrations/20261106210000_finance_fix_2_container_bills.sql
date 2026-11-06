-- =====================================================================
-- Finance fix 2 (6 Nov 2026): container acquisition bills.
--
-- Decided with Firmcop on 6 Nov:
--  * A container allocated to a split or conversion is billed to its owner
--    once, at allocation. The units the split produces are never billed.
--  * Firmcop, Firmcop Limited, Firmcop Group and the depots (e.g. Firmcop
--    Mombasa Depo) are the company itself: their containers are not bought.
--  * Bills with no currency default to the company currency (KES), not USD.
-- Data: 15 bills raised against these rules are cancelled; the reversal is
-- dated on each bill's own date. The October transport bills from Firmcop
-- Limited are kept, as marked in the audit review.
-- Idempotent.
-- =====================================================================

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
  _doc_cur text := upper(COALESCE(NULLIF(_currency,''), (SELECT o.currency FROM public.organizations o WHERE o.id = current_org_id()), 'KES'));
  _parent uuid; _org_name text;
  _sup_cur text; _rate numeric; _billed numeric;
  _base_cur text; _base_rate numeric; _base_amt numeric; _fx_src text;
  _existing_po uuid; _existing_inv text;
BEGIN
  IF _container_id IS NULL OR _amount IS NULL OR _amount <= 0 THEN RETURN NULL; END IF;

  SELECT owner, container_number, parent_container_id INTO _container_owner, _container_number, _parent
    FROM public.containers WHERE id = _container_id AND organization_id = _org;

  -- GUARD 0: units produced by a split or conversion are never billed; the
  -- source container carries the acquisition cost (billed once, at allocation).
  IF _parent IS NOT NULL THEN
    INSERT INTO public.finance_audit_log (organization_id, entity_type, entity_id, action, summary)
    VALUES (_org, 'containers', _container_id, 'acquisition_skipped_split_child',
      jsonb_build_object('container_number', _container_number, 'reason', _reason, 'reference', _reference, 'amount', _amount,
        'note', 'Produced by a split/conversion; the source container carries the acquisition.'));
    RETURN NULL;
  END IF;

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

  -- Owned by the company itself or one of its depots: nothing to buy.
  SELECT name INTO _org_name FROM public.organizations WHERE id = _org;
  IF EXISTS (SELECT 1 FROM public.depots d WHERE d.organization_id = _org AND lower(btrim(d.name)) = lower(btrim(_owner)))
     OR lower(btrim(_owner)) = lower(btrim(COALESCE(_org_name, '')))
     OR (length(btrim(COALESCE(_org_name, ''))) >= 3 AND lower(btrim(_owner)) LIKE lower(btrim(_org_name)) || ' %') THEN
    INSERT INTO public.finance_audit_log (organization_id, entity_type, entity_id, action, summary)
    VALUES (_org, 'containers', _container_id, 'acquisition_skipped_own_company',
      jsonb_build_object('container_number', _container_number, 'owner', _owner, 'reason', _reason, 'amount', _amount));
    RETURN NULL;
  END IF;

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

-- Bill the source container when it is allocated to a conversion or split.
CREATE OR REPLACE FUNCTION public.trg_bill_container_on_allocation()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
DECLARE _job container_conversions%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN RETURN NULL; END IF;          -- data loads and system jobs
  IF COALESCE(NEW.container_cost, 0) <= 0 THEN RETURN NULL; END IF;
  SELECT * INTO _job FROM container_conversions WHERE id = NEW.conversion_id;
  IF NOT FOUND OR _job.status::text = 'cancelled' THEN RETURN NULL; END IF;
  PERFORM public.acquire_container_from_owner(NEW.container_id, NEW.container_cost,
            NULLIF(_job.currency, ''), 'conversion', NEW.conversion_id::text);
  RETURN NULL;
END $$;
CREATE OR REPLACE TRIGGER trg_bill_container_on_allocation AFTER INSERT ON public.conversion_containers
  FOR EACH ROW EXECUTE FUNCTION public.trg_bill_container_on_allocation();

-- Data: cancel the bills raised against these rules, reversal on the bill's date.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT s.id, s.issue_date, s.invoice_number, s.purchase_order_id
      FROM public.supplier_invoices s
     WHERE s.status IN ('issued', 'partially_paid')
       AND s.invoice_number IN (
         'PINV-20260625-f8dbaf', 'PINV-20260716-c10172', 'PINV-ADJ-20260716-a7d4f0',  -- split children of AXIU1503496
         'PINV-20260523-7fc63b', 'PINV-20260523-8413c5',                               -- Firmcop Mombasa Depo
         'PINV-20260527-861e81', 'PINV-20260527-5dfabc', 'PINV-20260527-5f7585',       -- Firmcop Limited
         'PINV-20260527-a2b293', 'PINV-20260529-d58c0b', 'PINV-20260608-ff6503',
         'PINV-20260615-bcdbf7', 'PINV-20260615-c30c24', 'PINV-20260616-bc798c',       -- Firmcop
         'PINV-20260616-3d9593')
       AND COALESCE(s.paid_amount, 0) = 0
  LOOP
    PERFORM public.post_reversal_of('supplier_invoices', r.id,
      'bill ' || r.invoice_number || ' cancelled — raised to own company or for a split unit (review 6 Nov 2026)',
      r.issue_date::timestamptz);
    UPDATE public.supplier_invoices SET status = 'cancelled' WHERE id = r.id;
    UPDATE public.purchase_orders SET status = 'cancelled'
     WHERE id = r.purchase_order_id AND status::text NOT IN ('paid', 'cancelled', 'received')
       AND NOT EXISTS (SELECT 1 FROM public.supplier_invoices o WHERE o.purchase_order_id = r.purchase_order_id
                        AND o.id <> r.id AND o.status <> 'cancelled');
  END LOOP;
END $$;
