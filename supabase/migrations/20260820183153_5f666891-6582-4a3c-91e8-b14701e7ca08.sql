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

-- Backfill: every conversion job gets a project so P&L rolls up
INSERT INTO public.projects (organization_id, code, name, customer_id, status, start_date, end_date, budget_amount, currency, description, created_by)
SELECT cc.organization_id,
       CASE WHEN EXISTS (SELECT 1 FROM public.projects p WHERE p.organization_id = cc.organization_id AND p.code = cc.conversion_number)
            THEN cc.conversion_number || '-' || substr(cc.id::text,1,4) ELSE cc.conversion_number END,
       'Conversion: ' || cc.conversion_number,
       cc.customer_id,
       (CASE cc.status::text WHEN 'completed' THEN 'completed' WHEN 'cancelled' THEN 'archived' ELSE 'active' END)::public.project_status,
       cc.start_date, cc.end_date, COALESCE(cc.quoted_price,0), cc.currency, cc.description, cc.created_by
  FROM public.container_conversions cc
 WHERE cc.project_id IS NULL;

UPDATE public.container_conversions cc
   SET project_id = p.id, updated_at = now()
  FROM public.projects p
 WHERE cc.project_id IS NULL
   AND p.organization_id = cc.organization_id
   AND p.name = 'Conversion: ' || cc.conversion_number;

UPDATE public.accounting_transactions t SET project_id = cc.project_id
  FROM public.container_sales cs JOIN public.container_conversions cc ON cc.id = cs.conversion_id
 WHERE t.project_id IS NULL AND t.reference_type = 'container_sales' AND t.reference_id = cs.id AND cc.project_id IS NOT NULL;

UPDATE public.accounting_transactions t SET project_id = x.pid
  FROM (SELECT i.id, COALESCE(i.project_id,
          (SELECT cc2.project_id FROM public.container_sales cs JOIN public.container_conversions cc2 ON cc2.id = cs.conversion_id WHERE cs.invoice_id = i.id LIMIT 1)) pid
        FROM public.invoices i) x
 WHERE t.project_id IS NULL AND t.reference_type = 'invoice' AND t.reference_id = x.id AND x.pid IS NOT NULL;

UPDATE public.accounting_transactions t SET project_id = COALESCE(po.project_id, cc.project_id)
  FROM public.supplier_invoices si
  LEFT JOIN public.purchase_orders po ON po.id = si.purchase_order_id
  LEFT JOIN public.container_conversions cc ON cc.id = po.conversion_id
 WHERE t.project_id IS NULL AND t.reference_type IN ('supplier_invoices','supplier_invoice') AND t.reference_id = si.id
   AND COALESCE(po.project_id, cc.project_id) IS NOT NULL;

UPDATE public.accounting_transactions t SET project_id = COALESCE(po.project_id, cc.project_id)
  FROM public.goods_receipts gr
  LEFT JOIN public.purchase_orders po ON po.id = gr.po_id
  LEFT JOIN public.container_conversions cc ON cc.id = po.conversion_id
 WHERE t.project_id IS NULL AND t.reference_type = 'goods_receipt' AND t.reference_id = gr.id
   AND COALESCE(po.project_id, cc.project_id) IS NOT NULL;

UPDATE public.accounting_transactions t SET project_id = COALESCE(vp.project_id, po.project_id, cc.project_id)
  FROM public.vendor_payments vp
  LEFT JOIN public.purchase_orders po ON po.id = vp.po_id
  LEFT JOIN public.container_conversions cc ON cc.id = COALESCE(vp.conversion_id, po.conversion_id)
 WHERE t.project_id IS NULL AND t.reference_type = 'vendor_payment' AND t.reference_id = vp.id
   AND COALESCE(vp.project_id, po.project_id, cc.project_id) IS NOT NULL;
