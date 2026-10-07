-- 1. Harden acquire_container_from_owner: accept explicit expected owner
CREATE OR REPLACE FUNCTION public.acquire_container_from_owner(
  _container_id uuid,
  _amount numeric,
  _currency text,
  _reason text,
  _reference text,
  _expected_owner text DEFAULT NULL
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

  IF _expected_owner IS NOT NULL AND btrim(_expected_owner) <> '' THEN
    _owner := _expected_owner;
  END IF;

  IF _owner IS NULL OR btrim(_owner) = '' THEN
    RETURN NULL;
  END IF;

  SELECT name INTO _depot_name FROM public.depots
   WHERE organization_id = _org
   ORDER BY created_at ASC LIMIT 1;

  IF _depot_name IS NOT NULL AND lower(btrim(_depot_name)) = lower(btrim(_owner)) THEN
    RETURN NULL;
  END IF;

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

-- 2. Backfill — inline so it doesn't depend on current_org_id() / a session
DO $$
DECLARE
  r RECORD;
  _depot text;
  _supplier uuid;
  _po uuid;
  _po_num text;
  _label text;
  _cnum text;
BEGIN
  FOR r IN
    SELECT cs.id            AS sale_id,
           cs.container_id,
           cs.original_owner,
           cs.entry_price,
           cs.sale_number,
           cs.purchase_invoice_id,
           c.owner          AS current_owner,
           c.organization_id,
           c.container_number
      FROM public.container_sales cs
      JOIN public.containers c ON c.id = cs.container_id
     WHERE cs.original_owner IS NOT NULL
       AND btrim(cs.original_owner) <> ''
  LOOP
    SELECT name INTO _depot FROM public.depots
     WHERE organization_id = r.organization_id
     ORDER BY created_at ASC LIMIT 1;

    -- a. Restore registered owner if it was overwritten with the depot
    IF _depot IS NOT NULL
       AND r.current_owner IS NOT NULL
       AND lower(btrim(r.current_owner)) = lower(btrim(_depot))
       AND lower(btrim(r.original_owner)) <> lower(btrim(_depot)) THEN
      UPDATE public.containers
         SET owner = r.original_owner
       WHERE id = r.container_id;
    END IF;

    -- b. Create missing acquisition PO + supplier + payable
    IF r.purchase_invoice_id IS NULL
       AND r.entry_price IS NOT NULL
       AND r.entry_price > 0
       AND (_depot IS NULL OR lower(btrim(r.original_owner)) <> lower(btrim(_depot))) THEN
      _cnum := r.container_number;

      SELECT id INTO _supplier FROM public.suppliers
       WHERE organization_id = r.organization_id
         AND lower(btrim(name)) = lower(btrim(r.original_owner))
       LIMIT 1;
      IF _supplier IS NULL THEN
        INSERT INTO public.suppliers (name, organization_id, notes, is_active)
        VALUES (btrim(r.original_owner), r.organization_id, 'Auto-created from container acquisition (backfill)', true)
        RETURNING id INTO _supplier;
      END IF;

      _po_num := 'PO-ACQ-' || COALESCE(NULLIF(r.sale_number,''), to_char(now(),'YYYYMMDD'))
                 || '-' || substr(replace(gen_random_uuid()::text,'-',''),1,6);
      _label := 'Container acquisition (sale) — ' || COALESCE(_cnum, r.container_id::text);

      INSERT INTO public.purchase_orders (po_number, supplier_id, status, total_cost, organization_id)
      VALUES (_po_num, _supplier, 'approved', r.entry_price, r.organization_id)
      RETURNING id INTO _po;

      INSERT INTO public.po_items (po_id, description, quantity, unit_price, total_cost, organization_id)
      VALUES (_po, _label, 1, r.entry_price, r.entry_price, r.organization_id);

      INSERT INTO public.accounting_transactions (
        transaction_number, account_type, category, description,
        debit_amount, credit_amount, reference_type, reference_id, organization_id
      ) VALUES (
        'TXN-APAY-' || substr(replace(gen_random_uuid()::text,'-',''),1,10),
        'liability', 'container_acquisition_payable',
        _label || ' — payable to ' || r.original_owner,
        0, r.entry_price, 'purchase_orders', _po, r.organization_id
      );

      UPDATE public.container_sales
         SET purchase_invoice_id = _po
       WHERE id = r.sale_id;
    END IF;
  END LOOP;
END $$;