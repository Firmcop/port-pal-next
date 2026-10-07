
CREATE OR REPLACE FUNCTION public.link_supplier_invoice_to_consumption()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.purchase_order_id IS NOT NULL THEN
    UPDATE public.container_sales
       SET supplier_invoice_id = NEW.id
     WHERE purchase_invoice_id = NEW.purchase_order_id
       AND (supplier_invoice_id IS NULL OR supplier_invoice_id <> NEW.id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_link_supplier_invoice ON public.supplier_invoices;
CREATE TRIGGER trg_link_supplier_invoice
  AFTER INSERT ON public.supplier_invoices
  FOR EACH ROW EXECUTE FUNCTION public.link_supplier_invoice_to_consumption();

-- One-shot backfill for any rows created after the previous migration
UPDATE public.container_sales cs
   SET supplier_invoice_id = si.id
  FROM public.supplier_invoices si
 WHERE cs.purchase_invoice_id = si.purchase_order_id
   AND cs.supplier_invoice_id IS NULL;
