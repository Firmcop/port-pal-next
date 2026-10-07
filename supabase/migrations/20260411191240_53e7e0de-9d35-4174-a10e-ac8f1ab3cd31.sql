ALTER TABLE public.container_sales ADD COLUMN eir_id uuid REFERENCES public.eir_records(id);
ALTER TABLE public.container_sales ADD COLUMN original_owner text;
ALTER TABLE public.container_sales ADD COLUMN purchase_invoice_id uuid REFERENCES public.invoices(id);