ALTER VIEW public.project_job_costs SET (security_invoker = on);

CREATE OR REPLACE FUNCTION public.stamp_project_from_conversion()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE _pid uuid;
BEGIN
  IF NEW.project_id IS NOT NULL OR NEW.reference_id IS NULL THEN RETURN NEW; END IF;

  IF NEW.reference_type = 'container_sales' THEN
    SELECT cc.project_id INTO _pid
      FROM public.container_sales cs
      JOIN public.container_conversions cc ON cc.id = cs.conversion_id
     WHERE cs.id = NEW.reference_id;

  ELSIF NEW.reference_type = 'invoice' THEN
    SELECT COALESCE(i.project_id,
             (SELECT cc.project_id FROM public.container_conversions cc WHERE cc.quote_id = i.quote_id LIMIT 1),
             (SELECT cc2.project_id FROM public.container_sales cs
                 JOIN public.container_conversions cc2 ON cc2.id = cs.conversion_id
                WHERE cs.invoice_id = i.id LIMIT 1))
      INTO _pid FROM public.invoices i WHERE i.id = NEW.reference_id;

  ELSIF NEW.reference_type IN ('supplier_invoices','supplier_invoice') THEN
    SELECT COALESCE(po.project_id, cc.project_id) INTO _pid
      FROM public.supplier_invoices si
      LEFT JOIN public.purchase_orders po ON po.id = si.purchase_order_id
      LEFT JOIN public.container_conversions cc ON cc.id = po.conversion_id
     WHERE si.id = NEW.reference_id;

  ELSIF NEW.reference_type = 'goods_receipt' THEN
    SELECT COALESCE(po.project_id, cc.project_id) INTO _pid
      FROM public.goods_receipts gr
      LEFT JOIN public.purchase_orders po ON po.id = gr.po_id
      LEFT JOIN public.container_conversions cc ON cc.id = po.conversion_id
     WHERE gr.id = NEW.reference_id;

  ELSIF NEW.reference_type = 'vendor_payment' THEN
    SELECT COALESCE(vp.project_id, po.project_id, cc.project_id) INTO _pid
      FROM public.vendor_payments vp
      LEFT JOIN public.purchase_orders po ON po.id = vp.po_id
      LEFT JOIN public.container_conversions cc ON cc.id = COALESCE(vp.conversion_id, po.conversion_id)
     WHERE vp.id = NEW.reference_id;
  END IF;

  IF _pid IS NOT NULL AND EXISTS (SELECT 1 FROM public.projects p WHERE p.id = _pid) THEN
    NEW.project_id := _pid;
  END IF;
  RETURN NEW;
END $$;
