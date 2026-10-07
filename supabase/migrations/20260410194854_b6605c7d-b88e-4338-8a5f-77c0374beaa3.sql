
-- Invoice status enum
CREATE TYPE public.invoice_status AS ENUM ('draft', 'sent', 'paid', 'overdue', 'cancelled', 'credited');

-- Charge type enum
CREATE TYPE public.charge_type AS ENUM ('storage', 'repair', 'handling', 'gate_fee', 'other');

-- Payment method enum
CREATE TYPE public.payment_method AS ENUM ('bank_transfer', 'cash', 'cheque', 'credit_card', 'other');

-- Tariffs table (rate cards)
CREATE TABLE public.tariffs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tariff_name TEXT NOT NULL,
  container_size TEXT NOT NULL DEFAULT '20' CHECK (container_size IN ('20', '40', '45')),
  container_category TEXT NOT NULL DEFAULT 'dry' CHECK (container_category IN ('dry', 'reefer', 'tank', 'flat_rack', 'open_top')),
  rate_per_day NUMERIC(10,2) NOT NULL DEFAULT 0,
  free_days INTEGER NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'EUR',
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.tariffs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view tariffs"
  ON public.tariffs FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins can insert tariffs"
  ON public.tariffs FOR INSERT TO authenticated
  WITH CHECK (has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins can update tariffs"
  ON public.tariffs FOR UPDATE TO authenticated
  USING (has_role(auth.uid(), 'admin'));

CREATE TRIGGER update_tariffs_updated_at
  BEFORE UPDATE ON public.tariffs FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Invoices table
CREATE TABLE public.invoices (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  invoice_number TEXT NOT NULL UNIQUE,
  customer_name TEXT NOT NULL,
  customer_reference TEXT,
  container_id UUID REFERENCES public.containers(id),
  invoice_type public.charge_type NOT NULL DEFAULT 'storage',
  subtotal NUMERIC(12,2) NOT NULL DEFAULT 0,
  tax_rate NUMERIC(5,2) NOT NULL DEFAULT 0,
  tax_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  total_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'EUR',
  status public.invoice_status NOT NULL DEFAULT 'draft',
  issued_at TIMESTAMP WITH TIME ZONE,
  due_at TIMESTAMP WITH TIME ZONE,
  paid_at TIMESTAMP WITH TIME ZONE,
  notes TEXT,
  created_by UUID,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view invoices"
  ON public.invoices FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins and clerks can insert invoices"
  ON public.invoices FOR INSERT TO authenticated
  WITH CHECK (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'gate_clerk'));
CREATE POLICY "Admins and clerks can update invoices"
  ON public.invoices FOR UPDATE TO authenticated
  USING (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'gate_clerk'));

CREATE TRIGGER update_invoices_updated_at
  BEFORE UPDATE ON public.invoices FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Invoice Line Items
CREATE TABLE public.invoice_line_items (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  invoice_id UUID NOT NULL REFERENCES public.invoices(id) ON DELETE CASCADE,
  description TEXT NOT NULL,
  quantity NUMERIC(10,2) NOT NULL DEFAULT 1,
  unit_price NUMERIC(10,2) NOT NULL DEFAULT 0,
  total_price NUMERIC(12,2) NOT NULL DEFAULT 0,
  charge_type public.charge_type NOT NULL DEFAULT 'storage',
  period_from TIMESTAMP WITH TIME ZONE,
  period_to TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.invoice_line_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view line items"
  ON public.invoice_line_items FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins and clerks can insert line items"
  ON public.invoice_line_items FOR INSERT TO authenticated
  WITH CHECK (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'gate_clerk'));
CREATE POLICY "Admins and clerks can update line items"
  ON public.invoice_line_items FOR UPDATE TO authenticated
  USING (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'gate_clerk'));

-- Payments table
CREATE TABLE public.payments (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  payment_number TEXT NOT NULL UNIQUE,
  invoice_id UUID NOT NULL REFERENCES public.invoices(id),
  amount NUMERIC(12,2) NOT NULL,
  payment_method public.payment_method NOT NULL DEFAULT 'bank_transfer',
  reference_number TEXT,
  paid_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  notes TEXT,
  recorded_by UUID,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view payments"
  ON public.payments FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins and clerks can insert payments"
  ON public.payments FOR INSERT TO authenticated
  WITH CHECK (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'gate_clerk'));
CREATE POLICY "Admins and clerks can update payments"
  ON public.payments FOR UPDATE TO authenticated
  USING (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'gate_clerk'));

-- Indexes
CREATE INDEX idx_tariffs_active ON public.tariffs(is_active);
CREATE INDEX idx_invoices_status ON public.invoices(status);
CREATE INDEX idx_invoices_customer ON public.invoices(customer_name);
CREATE INDEX idx_invoices_container ON public.invoices(container_id);
CREATE INDEX idx_invoice_line_items_invoice ON public.invoice_line_items(invoice_id);
CREATE INDEX idx_payments_invoice ON public.payments(invoice_id);
