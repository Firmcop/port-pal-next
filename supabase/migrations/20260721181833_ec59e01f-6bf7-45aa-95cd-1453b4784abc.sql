ALTER TABLE public.supplier_invoices DROP CONSTRAINT IF EXISTS supplier_invoices_reason_check;
ALTER TABLE public.supplier_invoices ADD CONSTRAINT supplier_invoices_reason_check
  CHECK (reason = ANY (ARRAY['sale'::text, 'conversion'::text, 'gate_out_sale'::text, 'manual'::text, 'purchase'::text]));