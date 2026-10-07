CREATE OR REPLACE FUNCTION public.bill_unbilled_container_sales()
RETURNS TABLE(sale_id uuid, invoice_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _org uuid := current_org_id();
  _sale RECORD;
  _inv_id uuid;
  _num text;
  _issued timestamptz;
BEGIN
  IF NOT (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'accountant'::app_role) OR is_platform_admin()) THEN
    RAISE EXCEPTION 'permission denied';
  END IF;

  FOR _sale IN
    SELECT cs.* FROM public.container_sales cs
     WHERE cs.organization_id = _org
       AND cs.invoice_id IS NULL
       AND cs.status IN ('listed','sold')
  LOOP
    _num := 'INV-CS-'||to_char(now(),'YYYYMMDD')||'-'||substr(_sale.id::text,1,8);
    _issued := COALESCE(_sale.sold_at, now());

    INSERT INTO public.invoices(
      invoice_number, customer_name, container_id, invoice_type,
      subtotal, tax_amount, total_amount, status, currency,
      issued_at, due_at, organization_id, notes, created_by
    ) VALUES (
      _num,
      COALESCE(NULLIF(_sale.buyer_name,''), 'Container Sale Buyer'),
      _sale.container_id,
      'other'::charge_type,
      COALESCE(_sale.selling_price, 0), 0, COALESCE(_sale.selling_price, 0),
      'sent'::invoice_status,
      COALESCE(_sale.currency, (SELECT currency FROM public.organizations WHERE id = _org)),
      _issued,
      _issued + interval '30 days',
      _org,
      'Auto-generated for container sale '||COALESCE(_sale.sale_number, _sale.id::text),
      auth.uid()
    ) RETURNING id INTO _inv_id;

    UPDATE public.container_sales SET invoice_id = _inv_id WHERE id = _sale.id;
    sale_id := _sale.id; invoice_id := _inv_id;
    RETURN NEXT;
  END LOOP;
END;
$function$;