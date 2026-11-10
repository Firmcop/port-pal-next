-- =====================================================================
-- Ledger lines tagged USD with no exchange rate (finance fixes #9 and part
-- of #10, 10 Nov 2026). 108 lines, all from May-June 2026 when fx_rates
-- had no rates, were valued at 1 (a USD amount counted as the same number
-- of shillings). Checked against each source document:
--  * goods receipts (28), supplier payments (24): the PO / payment is in KES
--    -> the line is relabelled KES (its value does not change);
--  * trip costs (20): KES amounts typed as USD (e.g. fuel at Astrol 39,320)
--    -> line and trip cost relabelled KES;
--  * repatriation costs (12): real USD (transporters 425-550, handling 30)
--    -> valued at that day's USD/KES rate;
--  * one cancelled USD bill and its reversal (4): valued at the bill date's
--    rate on both, so they still cancel out;
--  * ten USD gate-in / transport invoices (20): all cancelled but never
--    taken out of receivables and revenue -> valued at their date's rate,
--    then reversed on the date they were cancelled.
-- The ledger must still balance; every change is in finance_audit_log.
-- =====================================================================
DO $$
DECLARE
  _org constant uuid := '6b29b65b-fa63-4dcf-9854-ede5c9a8320b';
  r record; _rate numeric; _n_kes int := 0; _n_fx int := 0; _n_rev int := 0;
BEGIN
  -- KES amounts that were labelled USD
  FOR r IN
    SELECT a.id, a.reference_type, a.reference_id, a.debit_amount, a.credit_amount
      FROM accounting_transactions a
     WHERE a.organization_id = _org AND upper(coalesce(a.currency, 'KES')) = 'USD' AND (a.fx_rate IS NULL OR a.fx_rate = 1)
       AND (a.reference_type = 'trip_cost'
            OR (a.reference_type = 'vendor_payment' AND EXISTS (SELECT 1 FROM vendor_payments v WHERE v.id = a.reference_id AND upper(coalesce(v.currency, 'KES')) = 'KES'))
            OR (a.reference_type = 'goods_receipt' AND EXISTS (SELECT 1 FROM goods_receipts g JOIN purchase_orders p ON p.id = g.po_id
                                                               WHERE g.id = a.reference_id AND upper(coalesce(p.currency, 'KES')) = 'KES')))
  LOOP
    UPDATE accounting_transactions SET currency = 'KES', fx_rate = 1, base_currency = 'KES' WHERE id = r.id;
    INSERT INTO finance_audit_log (organization_id, entity_type, entity_id, action, summary)
    VALUES (_org, 'accounting_transactions', r.id, 'currency_label_corrected',
            jsonb_build_object('from', 'USD', 'to', 'KES', 'source', r.reference_type, 'debit', r.debit_amount, 'credit', r.credit_amount,
                               'note', 'Source document is in KES; value unchanged'));
    _n_kes := _n_kes + 1;
  END LOOP;
  UPDATE logistics_trip_costs t SET currency = 'KES'
   WHERE upper(t.currency) = 'USD'
     AND EXISTS (SELECT 1 FROM accounting_transactions a WHERE a.reference_type = 'trip_cost' AND a.reference_id = t.id AND a.currency = 'KES');

  -- real USD: repatriation costs at their own date's rate
  FOR r IN
    SELECT a.id, a.transaction_date FROM accounting_transactions a
     WHERE a.organization_id = _org AND upper(a.currency) = 'USD' AND (a.fx_rate IS NULL OR a.fx_rate = 1)
       AND a.reference_type = 'repatriation_cost'
  LOOP
    _rate := get_fx_rate(_org, 'USD', 'KES', (r.transaction_date AT TIME ZONE 'Africa/Nairobi')::date);
    IF _rate IS NULL THEN RAISE EXCEPTION 'no USD rate for %', r.transaction_date; END IF;
    UPDATE accounting_transactions SET fx_rate = _rate, base_currency = 'KES' WHERE id = r.id;
    INSERT INTO finance_audit_log (organization_id, entity_type, entity_id, action, summary)
    VALUES (_org, 'accounting_transactions', r.id, 'fx_rate_applied', jsonb_build_object('rate', _rate, 'source', 'repatriation_cost'));
    _n_fx := _n_fx + 1;
  END LOOP;

  -- cancelled USD bill and its reversal: the bill date's rate on all four lines
  FOR r IN
    SELECT si.id, si.issue_date FROM supplier_invoices si
     WHERE EXISTS (SELECT 1 FROM accounting_transactions a
                    WHERE a.reference_id = si.id AND a.reference_type IN ('supplier_invoices', 'supplier_invoices_reversal')
                      AND upper(a.currency) = 'USD' AND (a.fx_rate IS NULL OR a.fx_rate = 1))
  LOOP
    _rate := get_fx_rate(_org, 'USD', 'KES', r.issue_date);
    UPDATE accounting_transactions SET fx_rate = _rate, base_currency = 'KES'
     WHERE reference_id = r.id AND reference_type IN ('supplier_invoices', 'supplier_invoices_reversal')
       AND upper(currency) = 'USD' AND (fx_rate IS NULL OR fx_rate = 1);
    _n_fx := _n_fx + 1;
  END LOOP;

  -- cancelled USD invoices still in receivables: value, then reverse
  FOR r IN
    SELECT DISTINCT i.id, i.invoice_number, i.voided_at, i.updated_at, min(a.transaction_date) OVER (PARTITION BY i.id) posted_on
      FROM invoices i JOIN accounting_transactions a ON a.reference_type = 'invoice' AND a.reference_id = i.id
     WHERE i.organization_id = _org AND i.status::text = 'cancelled'
       AND upper(a.currency) = 'USD' AND (a.fx_rate IS NULL OR a.fx_rate = 1)
  LOOP
    _rate := get_fx_rate(_org, 'USD', 'KES', (r.posted_on AT TIME ZONE 'Africa/Nairobi')::date);
    UPDATE accounting_transactions SET fx_rate = _rate, base_currency = 'KES'
     WHERE reference_type = 'invoice' AND reference_id = r.id AND (fx_rate IS NULL OR fx_rate = 1);
    PERFORM post_reversal_of('invoice', r.id, 'invoice ' || r.invoice_number || ' was cancelled',
                             greatest(coalesce(r.voided_at, r.updated_at), r.posted_on));
    INSERT INTO finance_audit_log (organization_id, entity_type, entity_id, action, summary)
    VALUES (_org, 'invoices', r.id, 'cancelled_invoice_reversed',
            jsonb_build_object('invoice', r.invoice_number, 'rate', _rate, 'note', 'Cancelled invoice was still in receivables and revenue'));
    _n_rev := _n_rev + 1;
  END LOOP;

  IF (SELECT round(sum((debit_amount - credit_amount) * coalesce(fx_rate, 1)), 2) FROM accounting_transactions) <> 0 THEN
    RAISE EXCEPTION 'ledger out of balance';
  END IF;
  IF EXISTS (SELECT 1 FROM accounting_transactions WHERE upper(coalesce(currency, 'KES')) <> 'KES' AND (fx_rate IS NULL OR fx_rate = 1)) THEN
    RAISE EXCEPTION 'USD lines without a rate remain: %',
      (SELECT count(*) FROM accounting_transactions WHERE upper(coalesce(currency, 'KES')) <> 'KES' AND (fx_rate IS NULL OR fx_rate = 1));
  END IF;
  RAISE NOTICE 'relabelled KES: %, valued at rate: %, cancelled invoices reversed: %', _n_kes, _n_fx, _n_rev;
END $$;
