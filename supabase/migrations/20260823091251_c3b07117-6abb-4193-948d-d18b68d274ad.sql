-- 1. Vendor payment currency: prefer the purchase order's own currency
CREATE OR REPLACE FUNCTION public.lock_vendor_payment_fx()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE _base text; _cur text;
BEGIN
  IF NEW.currency IS NULL OR btrim(NEW.currency) = '' THEN
    SELECT po.currency INTO _cur FROM public.purchase_orders po WHERE po.id = NEW.po_id;
    IF _cur IS NULL OR btrim(_cur) = '' THEN
      SELECT si.currency INTO _cur FROM public.supplier_invoices si
       WHERE si.purchase_order_id = NEW.po_id ORDER BY si.created_at LIMIT 1;
    END IF;
    IF _cur IS NULL OR btrim(_cur) = '' THEN
      SELECT s.currency INTO _cur FROM public.suppliers s WHERE s.id = NEW.supplier_id;
    END IF;
    SELECT o.currency INTO _base FROM public.organizations o WHERE o.id = NEW.organization_id;
    NEW.currency := COALESCE(NULLIF(btrim(COALESCE(_cur,'')),''), _base);
  END IF;

  SELECT o.currency INTO _base FROM public.organizations o WHERE o.id = NEW.organization_id;
  IF NEW.fx_rate IS NULL THEN
    NEW.fx_rate := public.get_fx_rate(NEW.organization_id, NEW.currency, _base, COALESCE(NEW.paid_at::date, current_date));
  END IF;
  NEW.base_amount := COALESCE(NEW.amount,0) * COALESCE(NEW.fx_rate, 1);
  RETURN NEW;
END $$;

-- 2. record_vendor_payment: stamp the PO currency, allow a manual FX rate
DROP FUNCTION IF EXISTS public.record_vendor_payment(uuid,numeric,uuid,public.payment_method,text,timestamptz,text);

CREATE FUNCTION public.record_vendor_payment(
  _po_id uuid,
  _amount numeric,
  _account_id uuid,
  _method public.payment_method DEFAULT 'bank_transfer',
  _reference text DEFAULT NULL,
  _paid_at timestamptz DEFAULT now(),
  _notes text DEFAULT NULL,
  _currency text DEFAULT NULL,
  _fx_rate numeric DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE _po purchase_orders%ROWTYPE; _pid uuid; _num text; _paid numeric; _cur text;
BEGIN
  IF _amount IS NULL OR _amount <= 0 THEN RAISE EXCEPTION 'invalid_amount'; END IF;
  IF _account_id IS NULL THEN RAISE EXCEPTION 'financial_account_required'; END IF;
  SELECT * INTO _po FROM purchase_orders WHERE id = _po_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'po_not_found'; END IF;

  _cur := NULLIF(btrim(COALESCE(_currency, _po.currency, '')), '');

  _num := 'VPAY-'||to_char(now(),'YYYYMMDD')||'-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,6));
  INSERT INTO public.vendor_payments(
    payment_number, po_id, supplier_id, amount, payment_method, reference_number,
    paid_at, notes, recorded_by, organization_id, financial_account_id, conversion_id,
    currency, fx_rate
  ) VALUES (
    _num,_po_id,_po.supplier_id,_amount,_method,_reference,COALESCE(_paid_at,now()),_notes,
    auth.uid(),_po.organization_id,_account_id,_po.conversion_id,
    _cur, _fx_rate
  )
  RETURNING id INTO _pid;

  SELECT COALESCE(sum(amount),0) INTO _paid FROM vendor_payments WHERE po_id = _po_id;
  IF _paid >= COALESCE(_po.total_cost,0) AND COALESCE(_po.total_cost,0) > 0 THEN
    UPDATE purchase_orders SET status='paid' WHERE id=_po_id AND status<>'paid';
  END IF;
  RETURN _pid;
END $$;

REVOKE EXECUTE ON FUNCTION public.record_vendor_payment(uuid,numeric,uuid,public.payment_method,text,timestamptz,text,text,numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_vendor_payment(uuid,numeric,uuid,public.payment_method,text,timestamptz,text,text,numeric) TO authenticated;

-- 3. Currency consistency findings in the finance data-health view
CREATE OR REPLACE VIEW public.v_finance_data_health AS
SELECT organization_id, finding_code, severity, count, detail
FROM (
  SELECT organization_id, 'orphan_gl_account'::text AS finding_code, 'high'::text AS severity,
         count(*) AS count, 'Ledger entries not linked to a Chart of Accounts row.'::text AS detail
    FROM accounting_transactions WHERE gl_account_id IS NULL GROUP BY organization_id
  UNION ALL
  SELECT organization_id, 'null_currency', 'medium', count(*),
         'Ledger entries with missing currency code.'
    FROM accounting_transactions WHERE currency IS NULL GROUP BY organization_id
  UNION ALL
  SELECT x.organization_id, 'unbalanced_currency_ledger', 'high', count(*),
         'Currency buckets whose debit and credit totals do not match.'
    FROM (SELECT organization_id, currency,
                 sum(debit_amount) - sum(credit_amount) AS diff
            FROM accounting_transactions WHERE currency IS NOT NULL
           GROUP BY organization_id, currency
          HAVING abs(sum(debit_amount) - sum(credit_amount)) > 0.01) x
   GROUP BY x.organization_id
  UNION ALL
  SELECT organization_id, 'unbilled_container_sale', 'medium', count(*),
         'Container sales in listed/sold state without a linked invoice.'
    FROM container_sales
   WHERE invoice_id IS NULL AND status = ANY (ARRAY['listed'::sale_status,'sold'::sale_status])
   GROUP BY organization_id
  UNION ALL
  SELECT organization_id, 'payment_missing_currency', 'low', count(*),
         'Payments recorded without a currency (should inherit from invoice).'
    FROM payments WHERE currency IS NULL GROUP BY organization_id
  UNION ALL
  SELECT vp.organization_id, 'vendor_payment_currency_mismatch', 'high', count(*),
         'Vendor payments whose currency differs from the purchase order they settle.'
    FROM vendor_payments vp
    JOIN purchase_orders po ON po.id = vp.po_id
   WHERE vp.currency IS NOT NULL AND po.currency IS NOT NULL
     AND upper(btrim(vp.currency)) <> upper(btrim(po.currency))
   GROUP BY vp.organization_id
  UNION ALL
  SELECT si.organization_id, 'supplier_invoice_currency_mismatch', 'high', count(*),
         'Supplier invoices whose currency differs from their purchase order.'
    FROM supplier_invoices si
    JOIN purchase_orders po ON po.id = si.purchase_order_id
   WHERE si.currency IS NOT NULL AND po.currency IS NOT NULL
     AND upper(btrim(si.currency)) <> upper(btrim(po.currency))
   GROUP BY si.organization_id
  UNION ALL
  SELECT organization_id, 'foreign_doc_missing_fx', 'medium', count(*),
         'Foreign-currency supplier invoices with no FX rate or base amount recorded.'
    FROM supplier_invoices si
   WHERE si.currency IS NOT NULL
     AND upper(si.currency) <> upper(COALESCE((SELECT o.currency FROM organizations o WHERE o.id = si.organization_id),'USD'))
     AND (si.fx_rate IS NULL OR si.fx_rate <= 0 OR si.base_amount IS NULL)
   GROUP BY organization_id
) s
WHERE count > 0;