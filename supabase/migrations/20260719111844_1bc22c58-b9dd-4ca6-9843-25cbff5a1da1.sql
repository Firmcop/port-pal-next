
-- 1) adjust_container_acquisition: prefer container_sales.original_owner over containers.owner
CREATE OR REPLACE FUNCTION public.adjust_container_acquisition(
  _container_id uuid, _delta_amount numeric, _currency text, _reason text, _reference text
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  _org uuid := current_org_id();
  _owner text;
  _sold_owner text;
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

  -- If this container has been sold, the true acquisition counterparty is the
  -- ORIGINAL owner snapshotted on container_sales — not containers.owner,
  -- which was overwritten with the buyer's name at sale time.
  SELECT original_owner INTO _sold_owner
    FROM public.container_sales
   WHERE container_id = _container_id
     AND organization_id = _org
     AND original_owner IS NOT NULL
     AND btrim(original_owner) <> ''
   ORDER BY created_at DESC
   LIMIT 1;

  IF _sold_owner IS NOT NULL THEN
    _owner := _sold_owner;
  END IF;

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
    _sign * _abs, 0, _sign * _abs, NULLIF(_currency,''), 'issued'
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
    'supplier_invoices',
    _inv_id,
    _org
  );

  RETURN _po_id;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.adjust_container_acquisition(uuid,numeric,text,text,text) FROM anon, PUBLIC;
GRANT  EXECUTE ON FUNCTION public.adjust_container_acquisition(uuid,numeric,text,text,text) TO authenticated, service_role;


-- 2) acquire_container_from_owner: same fallback when caller didn't pass _expected_owner
CREATE OR REPLACE FUNCTION public.acquire_container_from_owner(
  _container_id uuid, _amount numeric, _currency text, _reason text, _reference text,
  _expected_owner text DEFAULT NULL::text
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  _org uuid := current_org_id();
  _owner text;
  _sold_owner text;
  _container_number text;
  _depot_name text;
  _supplier_id uuid;
  _po_id uuid;
  _po_num text;
  _label text;
  _inv_id uuid;
  _inv_num text;
BEGIN
  IF _container_id IS NULL OR _amount IS NULL OR _amount <= 0 THEN
    RETURN NULL;
  END IF;

  SELECT owner, container_number INTO _owner, _container_number
    FROM public.containers
   WHERE id = _container_id AND organization_id = _org;

  IF _expected_owner IS NOT NULL AND btrim(_expected_owner) <> '' THEN
    _owner := _expected_owner;
  ELSE
    -- Sold-container fallback: containers.owner has been overwritten with the buyer.
    SELECT original_owner INTO _sold_owner
      FROM public.container_sales
     WHERE container_id = _container_id
       AND organization_id = _org
       AND original_owner IS NOT NULL
       AND btrim(original_owner) <> ''
     ORDER BY created_at DESC
     LIMIT 1;
    IF _sold_owner IS NOT NULL THEN
      _owner := _sold_owner;
    END IF;
  END IF;

  IF _owner IS NULL OR btrim(_owner) = '' THEN
    RETURN NULL;
  END IF;

  SELECT name INTO _depot_name FROM public.depots
   WHERE organization_id = _org ORDER BY created_at ASC LIMIT 1;

  IF _depot_name IS NOT NULL AND lower(btrim(_depot_name)) = lower(btrim(_owner)) THEN
    RETURN NULL;
  END IF;

  SELECT id INTO _supplier_id FROM public.suppliers
   WHERE organization_id = _org AND lower(btrim(name)) = lower(btrim(_owner)) LIMIT 1;
  IF _supplier_id IS NULL THEN
    INSERT INTO public.suppliers (name, organization_id, notes, is_active)
    VALUES (btrim(_owner), _org, 'Auto-created from container acquisition', true)
    RETURNING id INTO _supplier_id;
  END IF;

  _po_num := 'PO-ACQ-' || COALESCE(NULLIF(_reference,''), to_char(now(), 'YYYYMMDD'))
           || '-' || substr(replace(gen_random_uuid()::text,'-',''),1,6);
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

  _inv_num := 'PINV-' || to_char(now(),'YYYYMMDD') || '-' || substr(replace(gen_random_uuid()::text,'-',''),1,6);

  INSERT INTO public.supplier_invoices (
    organization_id, invoice_number, supplier_id, purchase_order_id, container_id,
    reason, reference, issue_date, due_date,
    subtotal, tax_amount, total_amount, currency, status
  ) VALUES (
    _org, _inv_num, _supplier_id, _po_id, _container_id,
    _reason, NULLIF(_reference,''), current_date, current_date + INTERVAL '30 days',
    _amount, 0, _amount, COALESCE(NULLIF(_currency,''),'USD'), 'issued'
  ) RETURNING id INTO _inv_id;

  INSERT INTO public.supplier_invoice_lines (
    organization_id, invoice_id, description, quantity, unit_price, line_total
  ) VALUES (_org, _inv_id, _label, 1, _amount, _amount);

  INSERT INTO public.accounting_transactions (
    transaction_number, account_type, category, description,
    debit_amount, credit_amount, reference_type, reference_id, organization_id
  ) VALUES (
    'TXN-APAY-' || substr(replace(gen_random_uuid()::text,'-',''),1,10),
    'liability',
    'container_acquisition_payable',
    _label || ' — payable to ' || _owner || ' (' || _inv_num || ')',
    0, _amount, 'supplier_invoices', _inv_id, _org
  );

  RETURN _po_id;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.acquire_container_from_owner(uuid,numeric,text,text,text,text) FROM anon, PUBLIC;
GRANT  EXECUTE ON FUNCTION public.acquire_container_from_owner(uuid,numeric,text,text,text,text) TO authenticated, service_role;


-- 3) Backfill: repoint mispointed ADJ POs and their supplier invoices from the
-- buyer to the original owner, per container_sales snapshot.
DO $$
DECLARE
  r record;
  _target_supplier uuid;
BEGIN
  FOR r IN
    SELECT DISTINCT
           si.id                AS invoice_id,
           si.purchase_order_id AS po_id,
           si.supplier_id       AS wrong_supplier_id,
           si.organization_id   AS org,
           si.container_id      AS container_id,
           cs.original_owner    AS original_owner,
           cs.buyer_name        AS buyer_name,
           s_wrong.name         AS wrong_name
      FROM public.supplier_invoices si
      JOIN public.suppliers s_wrong ON s_wrong.id = si.supplier_id
      JOIN public.container_sales cs
        ON cs.container_id = si.container_id
       AND cs.organization_id = si.organization_id
     WHERE si.invoice_number LIKE 'PINV-ADJ-%'
       AND cs.original_owner IS NOT NULL
       AND btrim(cs.original_owner) <> ''
       AND lower(btrim(cs.buyer_name)) = lower(btrim(s_wrong.name))
       AND lower(btrim(cs.original_owner)) <> lower(btrim(s_wrong.name))
  LOOP
    -- Resolve / create the correct supplier for the original owner
    SELECT id INTO _target_supplier
      FROM public.suppliers
     WHERE organization_id = r.org
       AND lower(btrim(name)) = lower(btrim(r.original_owner))
     LIMIT 1;

    IF _target_supplier IS NULL THEN
      INSERT INTO public.suppliers (name, organization_id, notes, is_active)
      VALUES (btrim(r.original_owner), r.org,
              'Auto-created by acquisition backfill (mispointed ADJ PO repair)', true)
      RETURNING id INTO _target_supplier;
    END IF;

    UPDATE public.supplier_invoices
       SET supplier_id = _target_supplier
     WHERE id = r.invoice_id;

    IF r.po_id IS NOT NULL THEN
      UPDATE public.purchase_orders
         SET supplier_id = _target_supplier
       WHERE id = r.po_id;
    END IF;

    INSERT INTO public.finance_audit_log (
      organization_id, entity_type, entity_id, entity_ref, action, summary
    ) VALUES (
      r.org, 'purchase_orders', COALESCE(r.po_id, r.invoice_id),
      'ACQ-ADJ repair', 'repoint_supplier',
      jsonb_build_object(
        'from_supplier_id', r.wrong_supplier_id,
        'from_supplier_name', r.wrong_name,
        'to_supplier_id', _target_supplier,
        'to_supplier_name', r.original_owner,
        'invoice_id', r.invoice_id,
        'po_id', r.po_id,
        'container_id', r.container_id,
        'reason', 'buyer_name was overwritten onto containers.owner; ADJ RPC created PO to buyer instead of original owner'
      )
    );
  END LOOP;

  -- Deactivate now-orphaned buyer-as-supplier rows that were auto-created and
  -- have no remaining PO / invoice / GRN references.
  UPDATE public.suppliers s
     SET is_active = false,
         notes = COALESCE(notes,'') || E'\n[deactivated by acquisition backfill: no remaining references]'
   WHERE s.notes ILIKE 'Auto-created from container acquisition%'
     AND NOT EXISTS (SELECT 1 FROM public.purchase_orders   po WHERE po.supplier_id = s.id)
     AND NOT EXISTS (SELECT 1 FROM public.supplier_invoices si WHERE si.supplier_id = s.id)
     AND EXISTS (
       SELECT 1 FROM public.customers c
        WHERE c.organization_id = s.organization_id
          AND lower(btrim(c.company_name)) = lower(btrim(s.name))
     );
END $$;
