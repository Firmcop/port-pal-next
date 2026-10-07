-- Does a supplier name belong to the depot's own group (self-billing)?
CREATE OR REPLACE FUNCTION public.is_own_company_name(_org uuid, _name text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH own AS (
    SELECT lower(btrim(o.name)) AS n FROM public.organizations o WHERE o.id = _org
    UNION
    SELECT lower(btrim(d.name)) FROM public.depots d WHERE d.organization_id = _org
  ), tok AS (
    SELECT DISTINCT split_part(n, ' ', 1) AS t FROM own WHERE length(split_part(n, ' ', 1)) >= 4
  )
  SELECT EXISTS (SELECT 1 FROM own WHERE own.n = lower(btrim(COALESCE(_name,''))))
      OR EXISTS (SELECT 1 FROM tok WHERE split_part(lower(btrim(COALESCE(_name,''))), ' ', 1) = tok.t);
$function$;

REVOKE ALL ON FUNCTION public.is_own_company_name(uuid, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.is_own_company_name(uuid, text) TO authenticated, service_role;

-- Correct purchase invoices billed from the depot's own company instead of the real supplier.
CREATE OR REPLACE FUNCTION public.correct_acquisition_invoice_supplier(
  _invoice_id uuid,
  _supplier_id uuid,
  _reason text,
  _amount numeric DEFAULT NULL,
  _currency text DEFAULT NULL,
  _fx_rate numeric DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _inv RECORD;
  _org uuid;
  _why text := btrim(COALESCE(_reason,''));
  _old_supplier text;
  _new_supplier text;
  _cnum text;
  _cur text;
  _amt numeric;
  _delta numeric;
  _orgcur text;
  _rate numeric;
  _src text;
  _base numeric;
  _fx jsonb;
BEGIN
  IF _invoice_id IS NULL THEN RAISE EXCEPTION 'Invoice is required'; END IF;
  IF _supplier_id IS NULL THEN RAISE EXCEPTION 'A replacement supplier is required'; END IF;
  IF _why = '' THEN RAISE EXCEPTION 'A reason is required'; END IF;

  SELECT * INTO _inv FROM public.supplier_invoices WHERE id = _invoice_id;
  IF _inv.id IS NULL THEN RAISE EXCEPTION 'Invoice not found'; END IF;
  _org := _inv.organization_id;

  IF auth.uid() IS NOT NULL THEN
    IF NOT (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'org_owner') OR public.is_platform_admin()) THEN
      RAISE EXCEPTION 'Only admins can correct supplier invoices';
    END IF;
    IF _org <> public.current_org_id() AND NOT public.is_platform_admin() THEN
      RAISE EXCEPTION 'Invoice not found in this organization';
    END IF;
  END IF;

  IF lower(COALESCE(_inv.status,'')) IN ('paid','cancelled','void','credited') OR COALESCE(_inv.paid_amount,0) > 0 THEN
    RAISE EXCEPTION 'Invoice % is % and has % settled — correct it with a credit note instead.',
      _inv.invoice_number, lower(COALESCE(_inv.status,'')), COALESCE(_inv.paid_amount,0);
  END IF;

  SELECT name INTO _new_supplier FROM public.suppliers WHERE id = _supplier_id AND organization_id = _org;
  IF _new_supplier IS NULL THEN RAISE EXCEPTION 'Replacement supplier not found in this organization'; END IF;
  SELECT name INTO _old_supplier FROM public.suppliers WHERE id = _inv.supplier_id;
  SELECT container_number INTO _cnum FROM public.containers WHERE id = _inv.container_id;

  _cur := upper(COALESCE(NULLIF(btrim(COALESCE(_currency,'')),''), _inv.currency));
  _amt := ROUND(COALESCE(_amount, _inv.total_amount), 2);
  _delta := _amt - COALESCE(_inv.total_amount, 0);

  -- currency restatement goes through the lock trigger + its audit trail
  IF _cur <> upper(COALESCE(_inv.currency,'')) THEN
    PERFORM set_config('app.currency_override', 'true', true);
    INSERT INTO public.invoice_currency_audit (
      organization_id, invoice_kind, invoice_id, from_currency, to_currency, reason, changed_by)
    VALUES (_org, 'purchase', _inv.id, upper(COALESCE(_inv.currency,'')), _cur,
            'Supplier correction — ' || COALESCE(_cnum,'') || ': ' || _why, auth.uid());
  END IF;

  UPDATE public.supplier_invoices
     SET supplier_id = _supplier_id,
         subtotal = _amt,
         total_amount = _amt,
         currency = _cur,
         updated_at = now()
   WHERE id = _inv.id;

  UPDATE public.supplier_invoice_lines
     SET quantity = 1, unit_price = _amt, line_total = _amt
   WHERE invoice_id = _inv.id;

  IF _inv.purchase_order_id IS NOT NULL THEN
    UPDATE public.purchase_orders
       SET supplier_id = _supplier_id, total_cost = _amt, currency = _cur
     WHERE id = _inv.purchase_order_id;
    UPDATE public.po_items
       SET quantity = 1, unit_price = _amt, total_cost = _amt
     WHERE po_id = _inv.purchase_order_id;
  END IF;

  -- move the payable onto the real supplier
  UPDATE public.accounting_transactions
     SET description = CASE
           WHEN _old_supplier IS NOT NULL AND position(_old_supplier in COALESCE(description,'')) > 0
             THEN replace(description, _old_supplier, _new_supplier)
           ELSE COALESCE(description,'') || ' — supplier corrected to ' || _new_supplier
         END,
         currency = _cur
   WHERE organization_id = _org
     AND reference_type = 'supplier_invoices'
     AND reference_id = _inv.id;

  IF ROUND(_delta,2) <> 0 THEN
    INSERT INTO public.accounting_transactions (
      transaction_number, account_type, category, description,
      debit_amount, credit_amount, reference_type, reference_id, organization_id, currency)
    VALUES ('TXN-APADJ-' || substr(replace(gen_random_uuid()::text,'-',''),1,10),
      'liability','container_acquisition_payable_adjustment',
      'Acquisition restated — ' || COALESCE(_cnum,'container') || ' (' || _inv.invoice_number || '): ' || _why,
      CASE WHEN _delta < 0 THEN -_delta ELSE 0 END,
      CASE WHEN _delta > 0 THEN _delta ELSE 0 END,
      'supplier_invoices', _inv.id, _org, _cur);
  END IF;

  -- revalue into the base currency
  SELECT upper(COALESCE(currency,'USD')) INTO _orgcur FROM public.organizations WHERE id = _org;
  _orgcur := COALESCE(_orgcur,'USD');
  IF _cur = _orgcur THEN
    _rate := 1; _src := 'auto';
  ELSIF COALESCE(_fx_rate,0) > 0 THEN
    _rate := _fx_rate; _src := 'manual';
  ELSE
    _fx := public.get_fx_rate_detail(_org, _cur, _orgcur, CURRENT_DATE);
    _rate := NULLIF((_fx->>'rate')::numeric, 0);
    _src := 'auto';
  END IF;

  IF _rate IS NOT NULL THEN
    _base := ROUND(_amt * _rate, 2);
    UPDATE public.supplier_invoices
       SET fx_rate = _rate, base_amount = _base, fx_rate_source = _src, updated_at = now()
     WHERE id = _inv.id;
    UPDATE public.accounting_transactions
       SET fx_rate = _rate, base_currency = _orgcur
     WHERE organization_id = _org AND reference_type = 'supplier_invoices' AND reference_id = _inv.id;
  END IF;

  IF _inv.container_id IS NOT NULL AND _inv.reason = 'purchase' THEN
    UPDATE public.containers
       SET acquisition_cost = _amt, acquisition_currency = _cur
     WHERE id = _inv.container_id;
  END IF;

  INSERT INTO public.finance_audit_log (
    organization_id, actor_user_id, actor_email, entity_type, entity_id, entity_ref,
    action, summary, before_data, after_data)
  VALUES (_org, auth.uid(), COALESCE(auth.jwt() ->> 'email','system'),
    'supplier_invoices', _inv.id, _inv.invoice_number, 'supplier_invoice_supplier_correction',
    jsonb_build_object('reason', _why, 'container_id', _inv.container_id, 'container_number', _cnum),
    jsonb_build_object('supplier', _old_supplier, 'supplier_id', _inv.supplier_id,
                       'total_amount', _inv.total_amount, 'currency', _inv.currency),
    jsonb_build_object('supplier', _new_supplier, 'supplier_id', _supplier_id,
                       'total_amount', _amt, 'currency', _cur, 'fx_rate', _rate));

  RETURN jsonb_build_object(
    'invoice_number', _inv.invoice_number,
    'container_number', _cnum,
    'old_supplier', _old_supplier,
    'new_supplier', _new_supplier,
    'old_amount', _inv.total_amount,
    'old_currency', _inv.currency,
    'amount', _amt,
    'currency', _cur,
    'fx_rate', _rate);
END
$function$;

REVOKE ALL ON FUNCTION public.correct_acquisition_invoice_supplier(uuid, uuid, text, numeric, text, numeric) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.correct_acquisition_invoice_supplier(uuid, uuid, text, numeric, text, numeric) TO authenticated;

-- Purchase invoices billed from the depot's own company (self-billing).
CREATE OR REPLACE FUNCTION public.list_self_billed_purchase_invoices()
RETURNS TABLE (
  invoice_id uuid,
  invoice_number text,
  supplier_id uuid,
  supplier_name text,
  reason text,
  container_id uuid,
  container_number text,
  currency text,
  total_amount numeric,
  status text,
  issue_date date
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT si.id, si.invoice_number, si.supplier_id, s.name, si.reason,
         si.container_id, c.container_number, si.currency, si.total_amount,
         si.status, si.issue_date
    FROM public.supplier_invoices si
    JOIN public.suppliers s ON s.id = si.supplier_id
    LEFT JOIN public.containers c ON c.id = si.container_id
   WHERE si.organization_id = public.current_org_id()
     AND lower(COALESCE(si.status,'')) NOT IN ('cancelled','void','credited')
     AND public.is_own_company_name(si.organization_id, s.name)
   ORDER BY si.issue_date DESC;
$function$;

REVOKE ALL ON FUNCTION public.list_self_billed_purchase_invoices() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.list_self_billed_purchase_invoices() TO authenticated;

-- Data health: flag purchase invoices raised against our own company.
CREATE OR REPLACE VIEW public.v_finance_data_health AS
SELECT * FROM (
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
        FROM vendor_payments vp JOIN purchase_orders po ON po.id = vp.po_id
       WHERE vp.currency IS NOT NULL AND po.currency IS NOT NULL
         AND upper(btrim(vp.currency)) <> upper(btrim(po.currency))
       GROUP BY vp.organization_id
      UNION ALL
      SELECT si.organization_id, 'supplier_invoice_currency_mismatch', 'high', count(*),
             'Supplier invoices whose currency differs from their purchase order.'
        FROM supplier_invoices si JOIN purchase_orders po ON po.id = si.purchase_order_id
       WHERE si.currency IS NOT NULL AND po.currency IS NOT NULL
         AND upper(btrim(si.currency)) <> upper(btrim(po.currency))
       GROUP BY si.organization_id
      UNION ALL
      SELECT si.organization_id, 'foreign_doc_missing_fx', 'medium', count(*),
             'Foreign-currency supplier invoices with no FX rate or base amount recorded.'
        FROM supplier_invoices si
       WHERE si.currency IS NOT NULL
         AND upper(si.currency) <> upper(COALESCE((SELECT o.currency FROM organizations o WHERE o.id = si.organization_id),'USD'))
         AND (si.fx_rate IS NULL OR si.fx_rate <= 0 OR si.base_amount IS NULL)
       GROUP BY si.organization_id
      UNION ALL
      SELECT si.organization_id, 'self_billed_purchase_invoice', 'high', count(*),
             'Purchase invoices raised against our own company instead of a real supplier.'
        FROM supplier_invoices si JOIN suppliers s ON s.id = si.supplier_id
       WHERE lower(COALESCE(si.status,'')) NOT IN ('cancelled','void','credited')
         AND public.is_own_company_name(si.organization_id, s.name)
       GROUP BY si.organization_id
    ) s
   WHERE count > 0
) v
WHERE organization_id = public.current_org_id() OR public.is_platform_admin();