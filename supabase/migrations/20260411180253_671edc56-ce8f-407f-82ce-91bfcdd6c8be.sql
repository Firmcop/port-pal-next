
CREATE TABLE public.vendor_payments (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  payment_number text NOT NULL,
  po_id uuid NOT NULL REFERENCES public.purchase_orders(id),
  supplier_id uuid NOT NULL REFERENCES public.suppliers(id),
  amount numeric NOT NULL,
  payment_method public.payment_method NOT NULL DEFAULT 'bank_transfer'::public.payment_method,
  reference_number text,
  paid_at timestamptz NOT NULL DEFAULT now(),
  notes text,
  recorded_by uuid,
  conversion_id uuid REFERENCES public.container_conversions(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.vendor_payments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins and operators can insert vendor_payments"
  ON public.vendor_payments FOR INSERT TO authenticated
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'yard_operator'::app_role));

CREATE POLICY "Admins and operators can update vendor_payments"
  ON public.vendor_payments FOR UPDATE TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'yard_operator'::app_role));

CREATE POLICY "Staff can view vendor_payments"
  ON public.vendor_payments FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'yard_operator'::app_role) OR has_role(auth.uid(), 'viewer'::app_role));
