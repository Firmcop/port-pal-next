
ALTER TABLE public.purchase_orders DROP CONSTRAINT IF EXISTS purchase_orders_recipient_source_chk;
ALTER TABLE public.purchase_orders
  ADD CONSTRAINT purchase_orders_recipient_source_chk
  CHECK (recipient_source IS NULL OR recipient_source IN ('expected_owner','sale_original_owner','container_owner','service_vendor'));
