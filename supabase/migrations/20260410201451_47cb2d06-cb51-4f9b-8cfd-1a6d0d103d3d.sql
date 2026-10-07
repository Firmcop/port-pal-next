
-- New enums
CREATE TYPE public.conversion_product_type AS ENUM ('office', 'home', 'coldroom', 'workshop', 'ablution', 'guard_house', 'other');
CREATE TYPE public.conversion_status AS ENUM ('planning', 'in_progress', 'completed', 'cancelled');
CREATE TYPE public.sale_status AS ENUM ('listed', 'reserved', 'sold', 'cancelled');
CREATE TYPE public.account_type AS ENUM ('revenue', 'cost_of_goods', 'expense', 'asset', 'liability');

-- Add new container statuses
ALTER TYPE public.container_status ADD VALUE IF NOT EXISTS 'in_conversion';
ALTER TYPE public.container_status ADD VALUE IF NOT EXISTS 'sold';

-- container_conversions
CREATE TABLE public.container_conversions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  conversion_number TEXT NOT NULL UNIQUE,
  container_id UUID REFERENCES public.containers(id),
  product_type public.conversion_product_type NOT NULL DEFAULT 'other',
  status public.conversion_status NOT NULL DEFAULT 'planning',
  description TEXT,
  specifications JSONB DEFAULT '{}'::jsonb,
  estimated_cost NUMERIC DEFAULT 0,
  actual_cost NUMERIC DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'USD',
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.container_conversions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view conversions" ON public.container_conversions FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins and operators can insert conversions" ON public.container_conversions FOR INSERT TO authenticated WITH CHECK (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'yard_operator'));
CREATE POLICY "Admins and operators can update conversions" ON public.container_conversions FOR UPDATE TO authenticated USING (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'yard_operator'));

CREATE TRIGGER update_container_conversions_updated_at BEFORE UPDATE ON public.container_conversions FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- conversion_materials
CREATE TABLE public.conversion_materials (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  conversion_id UUID NOT NULL REFERENCES public.container_conversions(id) ON DELETE CASCADE,
  description TEXT NOT NULL,
  quantity NUMERIC NOT NULL DEFAULT 1,
  unit_cost NUMERIC NOT NULL DEFAULT 0,
  total_cost NUMERIC NOT NULL DEFAULT 0,
  supplier TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.conversion_materials ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view materials" ON public.conversion_materials FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins and operators can insert materials" ON public.conversion_materials FOR INSERT TO authenticated WITH CHECK (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'yard_operator'));
CREATE POLICY "Admins and operators can update materials" ON public.conversion_materials FOR UPDATE TO authenticated USING (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'yard_operator'));

-- container_sales
CREATE TABLE public.container_sales (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  sale_number TEXT NOT NULL UNIQUE,
  container_id UUID REFERENCES public.containers(id),
  conversion_id UUID REFERENCES public.container_conversions(id),
  buyer_name TEXT NOT NULL,
  buyer_contact TEXT,
  entry_price NUMERIC NOT NULL DEFAULT 0,
  markup_percentage NUMERIC NOT NULL DEFAULT 0,
  selling_price NUMERIC NOT NULL DEFAULT 0,
  status public.sale_status NOT NULL DEFAULT 'listed',
  sold_at TIMESTAMPTZ,
  invoice_id UUID REFERENCES public.invoices(id),
  notes TEXT,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.container_sales ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view sales" ON public.container_sales FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins and operators can insert sales" ON public.container_sales FOR INSERT TO authenticated WITH CHECK (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'yard_operator'));
CREATE POLICY "Admins and operators can update sales" ON public.container_sales FOR UPDATE TO authenticated USING (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'yard_operator'));

CREATE TRIGGER update_container_sales_updated_at BEFORE UPDATE ON public.container_sales FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- accounting_transactions
CREATE TABLE public.accounting_transactions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  transaction_number TEXT NOT NULL UNIQUE,
  transaction_date TIMESTAMPTZ NOT NULL DEFAULT now(),
  account_type public.account_type NOT NULL,
  category TEXT NOT NULL,
  description TEXT NOT NULL,
  debit_amount NUMERIC NOT NULL DEFAULT 0,
  credit_amount NUMERIC NOT NULL DEFAULT 0,
  reference_type TEXT,
  reference_id UUID,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.accounting_transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view transactions" ON public.accounting_transactions FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins can insert transactions" ON public.accounting_transactions FOR INSERT TO authenticated WITH CHECK (has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins can update transactions" ON public.accounting_transactions FOR UPDATE TO authenticated USING (has_role(auth.uid(), 'admin'));
