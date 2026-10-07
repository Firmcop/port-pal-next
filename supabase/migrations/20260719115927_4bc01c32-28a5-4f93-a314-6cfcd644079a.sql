
ALTER TABLE public.purchase_orders
  ADD COLUMN IF NOT EXISTS recipient_source text,
  ADD COLUMN IF NOT EXISTS recipient_resolution_note text,
  ADD COLUMN IF NOT EXISTS resolved_container_id uuid;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='purchase_orders_recipient_source_chk') THEN
    ALTER TABLE public.purchase_orders
      ADD CONSTRAINT purchase_orders_recipient_source_chk
      CHECK (recipient_source IS NULL OR recipient_source IN ('expected_owner','sale_original_owner','container_owner'));
  END IF;
END $$;

DROP FUNCTION IF EXISTS public.acquire_container_from_owner(uuid, numeric, text, text, text);

CREATE OR REPLACE FUNCTION public.acquire_container_from_owner(
  _container_id uuid,
  _amount numeric,
  _currency text,
  _reason text,
  _reference text,
  _expected_owner text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _org uuid := current_org_id();
  _container_owner text;
  _sold_owner text;
  _owner text;
  _source text;
  _note text;
  _buyer text;
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

  SELECT owner, container_number INTO _container_owner, _container_number
    FROM public.containers
   WHERE id = _container_id AND organization_id = _org;

  SELECT original_owner INTO _sold_owner
    FROM public.container_sales
   WHERE container_id = _container_id AND organization_id = _org
     AND original_owner IS NOT NULL AND btrim(original_owner) <> ''
   ORDER BY created_at DESC LIMIT 1;

  SELECT buyer_name INTO _buyer
    FROM public.container_sales
   WHERE container_id = _container_id AND organization_id = _org
   ORDER BY created_at DESC LIMIT 1;

  IF _expected_owner IS NOT NULL AND btrim(_expected_owner) <> '' THEN
    _owner := btrim(_expected_owner);
    _source := 'expected_owner';
    _note := 'PO issued to expected owner ' || _owner
           || COALESCE(' (buyer: ' || NULLIF(_buyer,'') || ')','');
  ELSIF _sold_owner IS NOT NULL THEN
    _owner := btrim(_sold_owner);
    _source := 'sale_original_owner';
    _note := 'Container previously sold; PO issued to sale original owner ' || _owner
           || COALESCE(' (buyer: ' || NULLIF(_buyer,'') || ')','');
  ELSE
    _owner := btrim(COALESCE(_container_owner,''));
    _source := 'container_owner';
    _note := 'PO issued to container.owner ' || _owner;
  END IF;

  IF _owner IS NULL OR _owner = '' THEN
    RETURN NULL;
  END IF;

  SELECT name INTO _depot_name FROM public.depots
   WHERE organization_id = _org ORDER BY created_at ASC LIMIT 1;

  IF _depot_name IS NOT NULL AND lower(_depot_name) = lower(_owner) THEN
    RETURN NULL;
  END IF;

  SELECT id INTO _supplier_id FROM public.suppliers
   WHERE organization_id = _org AND lower(btrim(name)) = lower(_owner) LIMIT 1;
  IF _supplier_id IS NULL THEN
    INSERT INTO public.suppliers (name, organization_id, notes, is_active)
    VALUES (_owner, _org, 'Auto-created from container acquisition', true)
    RETURNING id INTO _supplier_id;
  END IF;

  _po_num := 'PO-ACQ-' || COALESCE(NULLIF(_reference,''), to_char(now(),'YYYYMMDD'))
           || '-' || substr(replace(gen_random_uuid()::text,'-',''),1,6);
  _label := CASE _reason
              WHEN 'sale'          THEN 'Container acquisition (sale)'
              WHEN 'conversion'    THEN 'Container acquisition (conversion)'
              WHEN 'gate_out_sale' THEN 'Container acquisition (gate-out sale)'
              ELSE 'Container acquisition'
            END || ' — ' || COALESCE(_container_number, _container_id::text);

  INSERT INTO public.purchase_orders (
    po_number, supplier_id, status, total_cost, organization_id,
    recipient_source, recipient_resolution_note, resolved_container_id
  ) VALUES (
    _po_num, _supplier_id, 'approved', _amount, _org,
    _source, _note, _container_id
  ) RETURNING id INTO _po_id;

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
    'liability', 'container_acquisition_payable',
    _label || ' — payable to ' || _owner || ' (' || _inv_num || ')',
    0, _amount, 'supplier_invoices', _inv_id, _org
  );

  INSERT INTO public.finance_audit_log (
    organization_id, entity_type, entity_id, action, summary
  ) VALUES (
    _org, 'purchase_orders', _po_id, 'po_recipient_resolved',
    jsonb_build_object(
      'po_number', _po_num,
      'container_id', _container_id,
      'container_number', _container_number,
      'buyer_name', _buyer,
      'expected_owner', _expected_owner,
      'sale_original_owner', _sold_owner,
      'container_owner', _container_owner,
      'chosen_owner', _owner,
      'recipient_source', _source,
      'reason', _reason
    )
  );

  RETURN _po_id;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.acquire_container_from_owner(uuid,numeric,text,text,text,text) FROM anon, PUBLIC;
GRANT  EXECUTE ON FUNCTION public.acquire_container_from_owner(uuid,numeric,text,text,text,text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.preview_acquisition_recipient(
  _container_id uuid,
  _expected_owner text DEFAULT NULL
)
RETURNS TABLE(owner text, source text, note text, buyer_name text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _org uuid := current_org_id();
  _container_owner text;
  _sold_owner text;
  _buyer text;
BEGIN
  IF _container_id IS NULL THEN RETURN; END IF;

  SELECT c.owner INTO _container_owner
    FROM public.containers c
   WHERE c.id = _container_id AND c.organization_id = _org;

  SELECT cs.original_owner INTO _sold_owner
    FROM public.container_sales cs
   WHERE cs.container_id = _container_id AND cs.organization_id = _org
     AND cs.original_owner IS NOT NULL AND btrim(cs.original_owner) <> ''
   ORDER BY cs.created_at DESC LIMIT 1;

  SELECT cs.buyer_name INTO _buyer
    FROM public.container_sales cs
   WHERE cs.container_id = _container_id AND cs.organization_id = _org
   ORDER BY cs.created_at DESC LIMIT 1;

  IF _expected_owner IS NOT NULL AND btrim(_expected_owner) <> '' THEN
    owner := btrim(_expected_owner);
    source := 'expected_owner';
    note := 'PO will be issued to expected owner ' || owner;
  ELSIF _sold_owner IS NOT NULL THEN
    owner := btrim(_sold_owner);
    source := 'sale_original_owner';
    note := 'Container previously sold; PO will be issued to sale original owner ' || owner;
  ELSE
    owner := btrim(COALESCE(_container_owner,''));
    source := 'container_owner';
    note := 'PO will be issued to container.owner ' || COALESCE(owner,'');
  END IF;
  buyer_name := _buyer;
  RETURN NEXT;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.preview_acquisition_recipient(uuid,text) FROM anon, PUBLIC;
GRANT  EXECUTE ON FUNCTION public.preview_acquisition_recipient(uuid,text) TO authenticated, service_role;

-- Backfill
WITH matched AS (
  SELECT DISTINCT ON (po.id) po.id AS po_id, cs.container_id, cs.original_owner
    FROM public.purchase_orders po
    JOIN public.suppliers s ON s.id = po.supplier_id
    JOIN public.container_sales cs
      ON cs.organization_id = po.organization_id
     AND lower(btrim(cs.original_owner)) = lower(btrim(s.name))
   WHERE po.recipient_source IS NULL
     AND po.po_number LIKE 'PO-ACQ-%'
   ORDER BY po.id, cs.created_at DESC
)
UPDATE public.purchase_orders po
   SET recipient_source = 'sale_original_owner',
       recipient_resolution_note = 'Backfilled: matched to container_sales.original_owner ' || m.original_owner,
       resolved_container_id = COALESCE(po.resolved_container_id, m.container_id)
  FROM matched m
 WHERE po.id = m.po_id;

UPDATE public.purchase_orders
   SET recipient_source = 'container_owner',
       recipient_resolution_note = 'Backfilled: defaulted to container_owner (no matching sale record found)'
 WHERE recipient_source IS NULL
   AND po_number LIKE 'PO-ACQ-%';
