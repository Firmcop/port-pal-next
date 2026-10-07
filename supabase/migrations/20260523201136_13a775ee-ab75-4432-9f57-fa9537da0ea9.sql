ALTER TABLE public.container_sales
  DROP CONSTRAINT IF EXISTS container_sales_purchase_invoice_id_fkey;

ALTER TABLE public.container_sales
  ADD CONSTRAINT container_sales_purchase_invoice_id_fkey
  FOREIGN KEY (purchase_invoice_id)
  REFERENCES public.purchase_orders(id)
  ON DELETE SET NULL;