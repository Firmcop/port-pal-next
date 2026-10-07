CREATE OR REPLACE VIEW public.v_finance_data_health AS
SELECT organization_id, finding_code, severity, count, detail
FROM (
  SELECT s.organization_id, s.finding_code, s.severity, s.count, s.detail
  FROM (
    SELECT accounting_transactions.organization_id, 'orphan_gl_account'::text AS finding_code, 'high'::text AS severity, count(*) AS count,
           'Ledger entries not linked to a Chart of Accounts row.'::text AS detail
      FROM accounting_transactions WHERE accounting_transactions.gl_account_id IS NULL
      GROUP BY accounting_transactions.organization_id
    UNION ALL
    SELECT accounting_transactions.organization_id, 'null_currency'::text, 'medium'::text, count(*),
           'Ledger entries with missing currency code.'::text
      FROM accounting_transactions WHERE accounting_transactions.currency IS NULL
      GROUP BY accounting_transactions.organization_id
    UNION ALL
    SELECT x.organization_id, 'unbalanced_currency_ledger'::text, 'high'::text, count(*),
           'Currency buckets whose debit and credit totals do not match.'::text
      FROM (SELECT accounting_transactions.organization_id, accounting_transactions.currency,
                   sum(accounting_transactions.debit_amount) - sum(accounting_transactions.credit_amount) AS diff
              FROM accounting_transactions WHERE accounting_transactions.currency IS NOT NULL
             GROUP BY 1,2
            HAVING abs(sum(accounting_transactions.debit_amount) - sum(accounting_transactions.credit_amount)) > 0.01) x
      GROUP BY x.organization_id
    UNION ALL
    SELECT container_sales.organization_id, 'unbilled_container_sale'::text, 'medium'::text, count(*),
           'Container sales in listed/sold state without a linked invoice.'::text
      FROM container_sales
     WHERE container_sales.invoice_id IS NULL
       AND container_sales.status = ANY (ARRAY['listed'::sale_status,'sold'::sale_status])
     GROUP BY container_sales.organization_id
    UNION ALL
    SELECT payments.organization_id, 'payment_missing_currency'::text, 'low'::text, count(*),
           'Payments recorded without a currency (should inherit from invoice).'::text
      FROM payments WHERE payments.currency IS NULL GROUP BY payments.organization_id
    UNION ALL
    SELECT vp.organization_id, 'vendor_payment_currency_mismatch'::text, 'high'::text, count(*),
           'Vendor payments whose currency differs from the purchase order they settle.'::text
      FROM vendor_payments vp JOIN purchase_orders po ON po.id = vp.po_id
     WHERE vp.currency IS NOT NULL AND po.currency IS NOT NULL
       AND upper(btrim(vp.currency)) <> upper(btrim(po.currency))
     GROUP BY vp.organization_id
    UNION ALL
    SELECT si.organization_id, 'supplier_invoice_currency_mismatch'::text, 'high'::text, count(*),
           'Supplier invoices whose currency differs from their purchase order.'::text
      FROM supplier_invoices si JOIN purchase_orders po ON po.id = si.purchase_order_id
     WHERE si.currency IS NOT NULL AND po.currency IS NOT NULL
       AND upper(btrim(si.currency)) <> upper(btrim(po.currency))
     GROUP BY si.organization_id
    UNION ALL
    SELECT si.organization_id, 'foreign_doc_missing_fx'::text, 'medium'::text, count(*),
           'Foreign-currency supplier invoices with no FX rate or base amount recorded.'::text
      FROM supplier_invoices si
     WHERE si.currency IS NOT NULL
       AND upper(si.currency) <> upper(COALESCE((SELECT o.currency FROM organizations o WHERE o.id = si.organization_id),'USD'))
       AND (si.fx_rate IS NULL OR si.fx_rate <= 0 OR si.base_amount IS NULL)
     GROUP BY si.organization_id
    UNION ALL
    SELECT si.organization_id, 'self_billed_purchase_invoice'::text, 'high'::text, count(*),
           'Purchase invoices raised against our own company instead of a real supplier.'::text
      FROM supplier_invoices si JOIN suppliers s_1 ON s_1.id = si.supplier_id
     WHERE (lower(COALESCE(si.status,'')) <> ALL (ARRAY['cancelled','void','credited']))
       AND is_own_company_name(si.organization_id, s_1.name)
     GROUP BY si.organization_id
    UNION ALL
    SELECT i.organization_id, 'customer_invoice_currency_mismatch'::text, 'high'::text, count(*),
           'Sales invoices whose currency differs from the customer''s registered currency.'::text
      FROM invoices i JOIN customers c ON c.id = i.customer_id
     WHERE i.currency IS NOT NULL AND NULLIF(btrim(c.currency),'') IS NOT NULL
       AND upper(btrim(i.currency)) <> upper(btrim(c.currency))
       AND i.status::text <> ALL (ARRAY['cancelled','credited'])
     GROUP BY i.organization_id
  ) s
  WHERE s.count > 0
) v
WHERE organization_id = current_org_id() OR is_platform_admin();

CREATE OR REPLACE FUNCTION public.bill_unbilled_container_sales()
RETURNS TABLE(sale_id uuid, invoice_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  _org uuid := current_org_id();
  _sale RECORD;
  _inv_id uuid;
  _num text;
  _issued timestamptz;
  _ccy text;
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

    -- Prefer the buyer's registered currency, then the sale, then the org currency.
    SELECT NULLIF(btrim(c.currency),'') INTO _ccy
      FROM public.customers c WHERE c.id = _sale.customer_id;
    _ccy := COALESCE(_ccy, NULLIF(btrim(_sale.currency),''),
                     (SELECT currency FROM public.organizations WHERE id = _org));

    INSERT INTO public.invoices(
      invoice_number, customer_name, customer_id, container_id, invoice_type,
      subtotal, tax_amount, total_amount, status, currency,
      issued_at, due_at, organization_id, notes, created_by
    ) VALUES (
      _num,
      COALESCE(NULLIF(_sale.buyer_name,''), 'Container Sale Buyer'),
      _sale.customer_id,
      _sale.container_id,
      'other'::charge_type,
      COALESCE(_sale.selling_price, 0), 0, COALESCE(_sale.selling_price, 0),
      'sent'::invoice_status,
      _ccy,
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
$fn$;

REVOKE EXECUTE ON FUNCTION public.bill_unbilled_container_sales() FROM anon;