
ALTER TABLE public.supplier_invoices DROP CONSTRAINT IF EXISTS supplier_invoices_reason_check;
ALTER TABLE public.supplier_invoices
  ADD CONSTRAINT supplier_invoices_reason_check
  CHECK (reason IN ('sale','conversion','gate_out_sale','manual','purchase','acquisition_transport','acquisition_crane_offloading','repatriation'));
