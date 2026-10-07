ALTER TABLE public.container_conversions
  ADD CONSTRAINT container_conversions_customer_id_fkey
  FOREIGN KEY (customer_id) REFERENCES public.customers(id);