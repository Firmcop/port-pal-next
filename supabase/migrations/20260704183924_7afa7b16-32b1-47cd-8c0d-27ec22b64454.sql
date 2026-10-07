
-- 1. Supplier currency trigger on supplier_invoices
CREATE OR REPLACE FUNCTION public.set_currency_from_supplier()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE _c text;
BEGIN
  IF NEW.currency IS NULL AND NEW.supplier_id IS NOT NULL THEN
    SELECT currency INTO _c FROM public.suppliers WHERE id = NEW.supplier_id;
    IF _c IS NOT NULL AND btrim(_c) <> '' THEN
      NEW.currency := _c;
    END IF;
  END IF;
  RETURN NEW;
END $$;

REVOKE EXECUTE ON FUNCTION public.set_currency_from_supplier() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS a_set_currency_from_supplier_trg ON public.supplier_invoices;
CREATE TRIGGER a_set_currency_from_supplier_trg
  BEFORE INSERT ON public.supplier_invoices
  FOR EACH ROW EXECUTE FUNCTION public.set_currency_from_supplier();

-- 2. Customer currency trigger on invoices (matched by customer_name within org)
CREATE OR REPLACE FUNCTION public.set_currency_from_customer()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE _c text;
BEGIN
  IF NEW.currency IS NULL
     AND NEW.customer_name IS NOT NULL
     AND NEW.organization_id IS NOT NULL THEN
    SELECT currency INTO _c FROM public.customers
      WHERE organization_id = NEW.organization_id
        AND lower(btrim(company_name)) = lower(btrim(NEW.customer_name))
      LIMIT 1;
    IF _c IS NOT NULL AND btrim(_c) <> '' THEN
      NEW.currency := _c;
    END IF;
  END IF;
  RETURN NEW;
END $$;

REVOKE EXECUTE ON FUNCTION public.set_currency_from_customer() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS a_set_currency_from_customer_trg ON public.invoices;
CREATE TRIGGER a_set_currency_from_customer_trg
  BEFORE INSERT ON public.invoices
  FOR EACH ROW EXECUTE FUNCTION public.set_currency_from_customer();

-- 3. Remove hard-coded USD fallback in adjust_container_acquisition so the supplier trigger can fill currency
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

  -- currency: prefer explicit arg, else let triggers (supplier -> org) resolve it
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
    'supplier_invoices', _inv_id, _org
  );

  UPDATE public.containers
     SET acquisition_cost = COALESCE(acquisition_cost,0) + (_sign * _abs)
   WHERE id = _container_id AND organization_id = _org;

  RETURN _po_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.adjust_container_acquisition(uuid,numeric,text,text,text) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.adjust_container_acquisition(uuid,numeric,text,text,text) TO authenticated, service_role;
