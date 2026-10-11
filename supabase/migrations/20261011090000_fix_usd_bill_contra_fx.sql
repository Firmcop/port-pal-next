-- =====================================================================
-- One-off data correction: USD supplier bills whose inventory contra line
-- was posted at a different FX rate than the bill itself.
--
-- An earlier audit correction ("Missing contra entry added") debited
-- container inventory (1200) at FX 128.5 while the bill's payable (2010)
-- sits at the bill rate (130.8). In USD each bill balances, but in KES the
-- ledger is short by 9,314.36.
--
-- The ledger is append-only, so each wrong line is reversed at its own
-- rate and re-posted at the bill's rate (same date, account and reference).
-- Only lines whose bill does not balance in base currency are touched, and
-- the migration is idempotent (it skips lines already corrected).
-- =====================================================================

WITH bad AS (
  SELECT at.*, si.fx_rate AS bill_fx, si.invoice_number
  FROM public.accounting_transactions at
  JOIN public.supplier_invoices si ON si.id = at.reference_id
  WHERE at.reference_type = 'supplier_invoices'
    AND at.description LIKE 'Missing contra entry added%'
    AND si.fx_rate IS NOT NULL
    AND at.fx_rate IS NOT NULL
    AND at.fx_rate <> si.fx_rate
    AND (SELECT round(sum((x.debit_amount - x.credit_amount) * coalesce(x.fx_rate, 1)), 2)
           FROM public.accounting_transactions x
          WHERE x.reference_type = 'supplier_invoices' AND x.reference_id = si.id) <> 0
    AND NOT EXISTS (SELECT 1 FROM public.accounting_transactions d
                     WHERE d.transaction_number = 'FXFIX-' || left(at.id::text, 8) || '-R')
),
rows AS (
  -- reverse the line at its original rate
  SELECT 'FXFIX-' || left(id::text, 8) || '-R' AS transaction_number, transaction_date, account_type, category,
         'FX correction: reverse contra at ' || fx_rate || ' — bill ' || invoice_number AS description,
         credit_amount AS debit_amount, debit_amount AS credit_amount,
         reference_type, reference_id, organization_id, gl_account_id, currency, fx_rate, base_currency, depot_id, project_id
  FROM bad
  UNION ALL
  -- re-post it at the bill's rate
  SELECT 'FXFIX-' || left(id::text, 8) || '-P', transaction_date, account_type, category,
         'FX correction: contra at bill rate ' || bill_fx || ' — bill ' || invoice_number,
         debit_amount, credit_amount,
         reference_type, reference_id, organization_id, gl_account_id, currency, bill_fx, base_currency, depot_id, project_id
  FROM bad
)
INSERT INTO public.accounting_transactions
  (transaction_number, transaction_date, account_type, category, description, debit_amount, credit_amount,
   reference_type, reference_id, organization_id, gl_account_id, currency, fx_rate, base_currency, depot_id, project_id)
SELECT transaction_number, transaction_date, account_type, category, description, debit_amount, credit_amount,
       reference_type, reference_id, organization_id, gl_account_id, currency, fx_rate, base_currency, depot_id, project_id
FROM rows;
