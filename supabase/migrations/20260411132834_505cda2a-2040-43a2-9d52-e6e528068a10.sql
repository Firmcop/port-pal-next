
-- 1. leads
CREATE TABLE public.leads (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  customer_id uuid REFERENCES public.customers(id),
  contact_name text NOT NULL,
  contact_email text,
  contact_phone text,
  source text NOT NULL DEFAULT 'walk_in',
  status text NOT NULL DEFAULT 'new',
  notes text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can view leads" ON public.leads FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins and operators can insert leads" ON public.leads FOR INSERT TO authenticated WITH CHECK (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'yard_operator'::app_role));
CREATE POLICY "Admins and operators can update leads" ON public.leads FOR UPDATE TO authenticated USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'yard_operator'::app_role));

-- 2. deals
CREATE TABLE public.deals (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  lead_id uuid REFERENCES public.leads(id),
  customer_id uuid REFERENCES public.customers(id),
  title text NOT NULL,
  value numeric NOT NULL DEFAULT 0,
  stage text NOT NULL DEFAULT 'discovery',
  expected_close_date date,
  notes text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.deals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can view deals" ON public.deals FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins and operators can insert deals" ON public.deals FOR INSERT TO authenticated WITH CHECK (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'yard_operator'::app_role));
CREATE POLICY "Admins and operators can update deals" ON public.deals FOR UPDATE TO authenticated USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'yard_operator'::app_role));

-- 3. quotes
CREATE TABLE public.quotes (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  deal_id uuid REFERENCES public.deals(id),
  customer_id uuid REFERENCES public.customers(id) NOT NULL,
  quote_number text NOT NULL,
  status text NOT NULL DEFAULT 'draft',
  total_amount numeric NOT NULL DEFAULT 0,
  valid_until date,
  notes text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.quotes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can view quotes" ON public.quotes FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins and operators can insert quotes" ON public.quotes FOR INSERT TO authenticated WITH CHECK (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'yard_operator'::app_role));
CREATE POLICY "Admins and operators can update quotes" ON public.quotes FOR UPDATE TO authenticated USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'yard_operator'::app_role));

-- 4. quote_items
CREATE TABLE public.quote_items (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  quote_id uuid REFERENCES public.quotes(id) ON DELETE CASCADE NOT NULL,
  item_type text NOT NULL DEFAULT 'service',
  description text NOT NULL,
  quantity numeric NOT NULL DEFAULT 1,
  unit_price numeric NOT NULL DEFAULT 0,
  total_price numeric NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.quote_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can view quote_items" ON public.quote_items FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins and operators can insert quote_items" ON public.quote_items FOR INSERT TO authenticated WITH CHECK (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'yard_operator'::app_role));
CREATE POLICY "Admins and operators can update quote_items" ON public.quote_items FOR UPDATE TO authenticated USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'yard_operator'::app_role));
CREATE POLICY "Admins and operators can delete quote_items" ON public.quote_items FOR DELETE TO authenticated USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'yard_operator'::app_role));

-- 5. sales_orders
CREATE TABLE public.sales_orders (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  order_number text NOT NULL,
  quote_id uuid REFERENCES public.quotes(id),
  customer_id uuid REFERENCES public.customers(id) NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  total_amount numeric NOT NULL DEFAULT 0,
  notes text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.sales_orders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can view sales_orders" ON public.sales_orders FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins and operators can insert sales_orders" ON public.sales_orders FOR INSERT TO authenticated WITH CHECK (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'yard_operator'::app_role));
CREATE POLICY "Admins and operators can update sales_orders" ON public.sales_orders FOR UPDATE TO authenticated USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'yard_operator'::app_role));

-- 6. sales_order_items
CREATE TABLE public.sales_order_items (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  sales_order_id uuid REFERENCES public.sales_orders(id) ON DELETE CASCADE NOT NULL,
  item_type text NOT NULL DEFAULT 'service',
  description text NOT NULL,
  quantity numeric NOT NULL DEFAULT 1,
  unit_price numeric NOT NULL DEFAULT 0,
  total_price numeric NOT NULL DEFAULT 0,
  container_id uuid REFERENCES public.containers(id),
  conversion_id uuid REFERENCES public.container_conversions(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.sales_order_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can view sales_order_items" ON public.sales_order_items FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins and operators can insert sales_order_items" ON public.sales_order_items FOR INSERT TO authenticated WITH CHECK (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'yard_operator'::app_role));
CREATE POLICY "Admins and operators can update sales_order_items" ON public.sales_order_items FOR UPDATE TO authenticated USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'yard_operator'::app_role));

-- 7. materials
CREATE TABLE public.materials (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name text NOT NULL,
  unit text NOT NULL DEFAULT 'pcs',
  unit_cost numeric NOT NULL DEFAULT 0,
  category text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.materials ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can view materials" ON public.materials FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins and operators can insert materials" ON public.materials FOR INSERT TO authenticated WITH CHECK (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'yard_operator'::app_role));
CREATE POLICY "Admins and operators can update materials" ON public.materials FOR UPDATE TO authenticated USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'yard_operator'::app_role));

-- 8. material_stock
CREATE TABLE public.material_stock (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  material_id uuid REFERENCES public.materials(id) ON DELETE CASCADE NOT NULL,
  qty_available numeric NOT NULL DEFAULT 0,
  qty_reserved numeric NOT NULL DEFAULT 0,
  last_updated timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.material_stock ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can view material_stock" ON public.material_stock FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins and operators can insert material_stock" ON public.material_stock FOR INSERT TO authenticated WITH CHECK (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'yard_operator'::app_role));
CREATE POLICY "Admins and operators can update material_stock" ON public.material_stock FOR UPDATE TO authenticated USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'yard_operator'::app_role));

-- 9. suppliers
CREATE TABLE public.suppliers (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name text NOT NULL,
  contact_person text,
  phone text,
  email text,
  address text,
  notes text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.suppliers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can view suppliers" ON public.suppliers FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins and operators can insert suppliers" ON public.suppliers FOR INSERT TO authenticated WITH CHECK (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'yard_operator'::app_role));
CREATE POLICY "Admins and operators can update suppliers" ON public.suppliers FOR UPDATE TO authenticated USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'yard_operator'::app_role));

-- 10. purchase_orders
CREATE TABLE public.purchase_orders (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  po_number text NOT NULL,
  supplier_id uuid REFERENCES public.suppliers(id) NOT NULL,
  conversion_id uuid REFERENCES public.container_conversions(id),
  status text NOT NULL DEFAULT 'draft',
  total_cost numeric NOT NULL DEFAULT 0,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.purchase_orders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can view purchase_orders" ON public.purchase_orders FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins and operators can insert purchase_orders" ON public.purchase_orders FOR INSERT TO authenticated WITH CHECK (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'yard_operator'::app_role));
CREATE POLICY "Admins and operators can update purchase_orders" ON public.purchase_orders FOR UPDATE TO authenticated USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'yard_operator'::app_role));

-- 11. po_items
CREATE TABLE public.po_items (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  po_id uuid REFERENCES public.purchase_orders(id) ON DELETE CASCADE NOT NULL,
  material_id uuid REFERENCES public.materials(id),
  description text NOT NULL,
  quantity numeric NOT NULL DEFAULT 1,
  unit_price numeric NOT NULL DEFAULT 0,
  total_cost numeric NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.po_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can view po_items" ON public.po_items FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins and operators can insert po_items" ON public.po_items FOR INSERT TO authenticated WITH CHECK (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'yard_operator'::app_role));
CREATE POLICY "Admins and operators can update po_items" ON public.po_items FOR UPDATE TO authenticated USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'yard_operator'::app_role));

-- 12. goods_receipts
CREATE TABLE public.goods_receipts (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  po_id uuid REFERENCES public.purchase_orders(id) NOT NULL,
  received_by uuid,
  received_at timestamptz NOT NULL DEFAULT now(),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.goods_receipts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can view goods_receipts" ON public.goods_receipts FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins and operators can insert goods_receipts" ON public.goods_receipts FOR INSERT TO authenticated WITH CHECK (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'yard_operator'::app_role));
CREATE POLICY "Admins and operators can update goods_receipts" ON public.goods_receipts FOR UPDATE TO authenticated USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'yard_operator'::app_role));

-- 13. goods_receipt_items
CREATE TABLE public.goods_receipt_items (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  receipt_id uuid REFERENCES public.goods_receipts(id) ON DELETE CASCADE NOT NULL,
  po_item_id uuid REFERENCES public.po_items(id) NOT NULL,
  received_qty numeric NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.goods_receipt_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can view goods_receipt_items" ON public.goods_receipt_items FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins and operators can insert goods_receipt_items" ON public.goods_receipt_items FOR INSERT TO authenticated WITH CHECK (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'yard_operator'::app_role));
CREATE POLICY "Admins and operators can update goods_receipt_items" ON public.goods_receipt_items FOR UPDATE TO authenticated USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'yard_operator'::app_role));

-- 14. cost_entries
CREATE TABLE public.cost_entries (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  production_order_id uuid REFERENCES public.container_conversions(id) NOT NULL,
  cost_type text NOT NULL DEFAULT 'material',
  reference_id uuid,
  reference_type text,
  amount numeric NOT NULL DEFAULT 0,
  description text,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.cost_entries ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can view cost_entries" ON public.cost_entries FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins and operators can insert cost_entries" ON public.cost_entries FOR INSERT TO authenticated WITH CHECK (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'yard_operator'::app_role));
CREATE POLICY "Admins and operators can update cost_entries" ON public.cost_entries FOR UPDATE TO authenticated USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'yard_operator'::app_role));

-- 15. Alter container_conversions — add sales_order_id
ALTER TABLE public.container_conversions ADD COLUMN sales_order_id uuid REFERENCES public.sales_orders(id);

-- 16. Alter customers — add kra_pin
ALTER TABLE public.customers ADD COLUMN kra_pin text;

-- Triggers for updated_at
CREATE TRIGGER update_deals_updated_at BEFORE UPDATE ON public.deals FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
