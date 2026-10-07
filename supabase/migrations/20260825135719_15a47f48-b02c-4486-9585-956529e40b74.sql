CREATE OR REPLACE FUNCTION public.reverse_duplicate_acquisition_invoice(_invoice_id uuid, _reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _org uuid := current_org_id();
  _inv record; _why text := btrim(COALESCE(_reason,''));
BEGIN
  IF NOT (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'org_owner') OR public.is_platform_admin()) THEN
    RAISE EXCEPTION 'Only administrators can reverse acquisition invoices';
  END IF;
  IF _why = '' THEN RAISE EXCEPTION 'A reason is required'; END IF;

  SELECT * INTO _inv FROM public.supplier_invoices
   WHERE id = _invoice_id AND organization_id = _org;
  IF _inv.id IS NULL THEN RAISE EXCEPTION 'Invoice not found'; END IF;
  IF _inv.status = 'cancelled' THEN
    RETURN jsonb_build_object('invoice_id', _inv.id, 'already_cancelled', true);
  END IF;
  IF COALESCE(_inv.paid_amount,0) > 0 THEN
    RAISE EXCEPTION 'Invoice % has payments applied; settle or unallocate them first', _inv.invoice_number;
  END IF;

  UPDATE public.supplier_invoices
     SET status = 'cancelled',
         notes = COALESCE(notes || E'\n','') || 'Reversed as duplicate acquisition: ' || _why
   WHERE id = _inv.id;

  IF _inv.purchase_order_id IS NOT NULL THEN
    UPDATE public.purchase_orders SET status = 'cancelled'
     WHERE id = _inv.purchase_order_id AND organization_id = _org;
  END IF;

  INSERT INTO public.accounting_transactions (
    transaction_number, account_type, category, description,
    debit_amount, credit_amount, reference_type, reference_id, organization_id, currency
  ) VALUES (
    'TXN-APREV-' || substr(replace(gen_random_uuid()::text,'-',''),1,10),
    'liability', 'container_acquisition_payable',
    'Reversal of duplicate acquisition invoice ' || _inv.invoice_number || ' — ' || _why,
    COALESCE(_inv.total_amount,0), 0, 'supplier_invoices', _inv.id, _org, _inv.currency
  );

  INSERT INTO public.finance_audit_log (organization_id, entity_type, entity_id, action, summary)
  VALUES (_org, 'supplier_invoices', _inv.id, 'acquisition_invoice_reversed',
    jsonb_build_object('invoice_number', _inv.invoice_number, 'container_id', _inv.container_id,
      'reason_code', _inv.reason, 'reference', _inv.reference, 'amount', _inv.total_amount,
      'currency', _inv.currency, 'purchase_order_id', _inv.purchase_order_id, 'note', _why));

  RETURN jsonb_build_object('invoice_id', _inv.id, 'invoice_number', _inv.invoice_number,
    'reversed_amount', _inv.total_amount, 'currency', _inv.currency);
END $function$;

REVOKE ALL ON FUNCTION public.reverse_duplicate_acquisition_invoice(uuid, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.reverse_duplicate_acquisition_invoice(uuid, text) TO authenticated;