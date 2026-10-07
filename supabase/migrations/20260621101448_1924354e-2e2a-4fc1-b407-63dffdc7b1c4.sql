
-- 1. supplier_invoices
CREATE TABLE public.supplier_invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  invoice_number text NOT NULL,
  supplier_id uuid NOT NULL REFERENCES public.suppliers(id) ON DELETE RESTRICT,
  purchase_order_id uuid REFERENCES public.purchase_orders(id) ON DELETE SET NULL,
  container_id uuid REFERENCES public.containers(id) ON DELETE SET NULL,
  reason text NOT NULL DEFAULT 'manual' CHECK (reason IN ('sale','conversion','gate_out_sale','manual')),
  reference text,
  issue_date date NOT NULL DEFAULT current_date,
  due_date date NOT NULL DEFAULT (current_date + INTERVAL '30 days'),
  subtotal numeric NOT NULL DEFAULT 0,
  tax_amount numeric NOT NULL DEFAULT 0,
  total_amount numeric NOT NULL DEFAULT 0,
  paid_amount numeric NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'USD',
  status text NOT NULL DEFAULT 'issued' CHECK (status IN ('issued','partially_paid','paid','cancelled')),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, invoice_number)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.supplier_invoices TO authenticated;
GRANT ALL ON public.supplier_invoices TO service_role;

ALTER TABLE public.supplier_invoices ENABLE ROW LEVEL SECURITY;

CREATE POLICY "supplier_invoices_select_org"
  ON public.supplier_invoices FOR SELECT TO authenticated
  USING (organization_id = current_org_id() OR is_platform_admin());

CREATE POLICY "supplier_invoices_insert_admin"
  ON public.supplier_invoices FOR INSERT TO authenticated
  WITH CHECK (organization_id = current_org_id()
    AND (has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'accountant'::app_role)));

CREATE POLICY "supplier_invoices_update_admin"
  ON public.supplier_invoices FOR UPDATE TO authenticated
  USING (organization_id = current_org_id()
    AND (has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'accountant'::app_role)))
  WITH CHECK (organization_id = current_org_id());

CREATE POLICY "supplier_invoices_delete_admin"
  ON public.supplier_invoices FOR DELETE TO authenticated
  USING (organization_id = current_org_id()
    AND has_role(auth.uid(),'admin'::app_role));

CREATE TRIGGER trg_supplier_invoices_updated_at
  BEFORE UPDATE ON public.supplier_invoices
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER trg_supplier_invoices_currency
  BEFORE INSERT ON public.supplier_invoices
  FOR EACH ROW EXECUTE FUNCTION public.set_currency_from_org();

CREATE INDEX idx_supplier_invoices_org ON public.supplier_invoices(organization_id);
CREATE INDEX idx_supplier_invoices_supplier ON public.supplier_invoices(supplier_id);
CREATE INDEX idx_supplier_invoices_po ON public.supplier_invoices(purchase_order_id);
CREATE INDEX idx_supplier_invoices_status ON public.supplier_invoices(status);

-- 2. supplier_invoice_lines
CREATE TABLE public.supplier_invoice_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  invoice_id uuid NOT NULL REFERENCES public.supplier_invoices(id) ON DELETE CASCADE,
  description text NOT NULL,
  quantity numeric NOT NULL DEFAULT 1,
  unit_price numeric NOT NULL DEFAULT 0,
  line_total numeric NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.supplier_invoice_lines TO authenticated;
GRANT ALL ON public.supplier_invoice_lines TO service_role;

ALTER TABLE public.supplier_invoice_lines ENABLE ROW LEVEL SECURITY;

CREATE POLICY "supplier_invoice_lines_select_org"
  ON public.supplier_invoice_lines FOR SELECT TO authenticated
  USING (organization_id = current_org_id() OR is_platform_admin());

CREATE POLICY "supplier_invoice_lines_write_admin"
  ON public.supplier_invoice_lines FOR ALL TO authenticated
  USING (organization_id = current_org_id()
    AND (has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'accountant'::app_role)))
  WITH CHECK (organization_id = current_org_id()
    AND (has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'accountant'::app_role)));

CREATE INDEX idx_supplier_invoice_lines_invoice ON public.supplier_invoice_lines(invoice_id);

-- 3. Cross-links on consumption tables
ALTER TABLE public.container_sales
  ADD COLUMN IF NOT EXISTS supplier_invoice_id uuid REFERENCES public.supplier_invoices(id) ON DELETE SET NULL;
ALTER TABLE public.container_conversions
  ADD COLUMN IF NOT EXISTS supplier_invoice_id uuid REFERENCES public.supplier_invoices(id) ON DELETE SET NULL;
ALTER TABLE public.eir_records
  ADD COLUMN IF NOT EXISTS supplier_invoice_id uuid REFERENCES public.supplier_invoices(id) ON DELETE SET NULL;

-- 4. Extend acquire_container_from_owner to also issue a supplier invoice
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

  -- Issue purchase invoice (vendor bill) to the owner
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
  ) VALUES (
    _org, _inv_id, _label, 1, _amount, _amount
  );

  INSERT INTO public.accounting_transactions (
    transaction_number, account_type, category, description,
    debit_amount, credit_amount, reference_type, reference_id, organization_id
  ) VALUES (
    'TXN-APAY-' || substr(replace(gen_random_uuid()::text,'-',''),1,10),
    'liability',
    'container_acquisition_payable',
    _label || ' — payable to ' || _owner || ' (' || _inv_num || ')',
    0,
    _amount,
    'supplier_invoices',
    _inv_id,
    _org
  );

  RETURN _po_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.acquire_container_from_owner(uuid,numeric,text,text,text,text) FROM anon, PUBLIC;

-- 5. Backfill purchase invoices for existing acquisition POs
DO $$
DECLARE
  r RECORD;
  _inv_id uuid;
  _inv_num text;
  _label text;
BEGIN
  FOR r IN
    SELECT po.id            AS po_id,
           po.po_number,
           po.supplier_id,
           po.total_cost,
           po.organization_id,
           po.created_at,
           s.name           AS supplier_name,
           cs.id            AS sale_id,
           cs.container_id  AS sale_container_id,
           cs.sale_number,
           pi.description   AS po_line_desc
      FROM public.purchase_orders po
      LEFT JOIN public.suppliers s ON s.id = po.supplier_id
      LEFT JOIN public.container_sales cs ON cs.purchase_invoice_id = po.id
      LEFT JOIN LATERAL (
        SELECT description FROM public.po_items WHERE po_id = po.id ORDER BY created_at LIMIT 1
      ) pi ON true
     WHERE po.po_number LIKE 'PO-ACQ-%'
       AND NOT EXISTS (SELECT 1 FROM public.supplier_invoices si WHERE si.purchase_order_id = po.id)
  LOOP
    _inv_num := 'PINV-' || to_char(r.created_at,'YYYYMMDD') || '-' || substr(replace(gen_random_uuid()::text,'-',''),1,6);
    _label := COALESCE(r.po_line_desc, 'Container acquisition — ' || r.po_number);

    INSERT INTO public.supplier_invoices (
      organization_id, invoice_number, supplier_id, purchase_order_id, container_id,
      reason, reference, issue_date, due_date,
      subtotal, tax_amount, total_amount, currency, status
    ) VALUES (
      r.organization_id, _inv_num, r.supplier_id, r.po_id, r.sale_container_id,
      'sale', r.sale_number, r.created_at::date, (r.created_at::date + INTERVAL '30 days')::date,
      COALESCE(r.total_cost,0), 0, COALESCE(r.total_cost,0),
      (SELECT COALESCE(currency,'USD') FROM public.organizations WHERE id = r.organization_id),
      'issued'
    ) RETURNING id INTO _inv_id;

    INSERT INTO public.supplier_invoice_lines (
      organization_id, invoice_id, description, quantity, unit_price, line_total
    ) VALUES (
      r.organization_id, _inv_id, _label, 1, COALESCE(r.total_cost,0), COALESCE(r.total_cost,0)
    );

    -- Re-point existing payable accounting transaction to the new invoice
    UPDATE public.accounting_transactions
       SET reference_type = 'supplier_invoices',
           reference_id   = _inv_id
     WHERE reference_type = 'purchase_orders'
       AND reference_id   = r.po_id
       AND category       = 'container_acquisition_payable';

    -- Link consumption rows
    IF r.sale_id IS NOT NULL THEN
      UPDATE public.container_sales SET supplier_invoice_id = _inv_id WHERE id = r.sale_id;
    END IF;
  END LOOP;
END $$;
