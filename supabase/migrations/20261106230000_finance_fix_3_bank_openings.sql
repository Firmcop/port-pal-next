-- =====================================================================
-- Finance fix 3 (6 Nov 2026): bank opening balances from the statements.
--
-- 1. The three transfers entered on the evening of 6 Nov (ABSA -> M-Pesa
--    1,172,622.38; ABSA -> KCB 493,837.10; ABSA -> HFCB 12,928.00) were
--    balance adjustments, not real money movements (confirmed by Firmcop).
--    They are voided: every line is mirrored and the transfer marked void.
-- 2. Opening balances at go-live, taken from the bank statements:
--      ABSA 2043015012   50,277.54  on 1 May 2026 (statement opening)
--      KCB 1198736267   489,488.80  on 1 May 2026 (closing 30 Apr 2026)
--      M-Pesa 0714521170 46,114.74  on 6 May 2026 (statement start)
--    The opening-balance trigger posts each against retained earnings.
-- Idempotent.
-- =====================================================================

DO $$
DECLARE t record;
BEGIN
  FOR t IN SELECT * FROM public.inter_account_transfers
            WHERE transfer_number IN ('TRF-MW59YN6E', 'TRF-MW5A4ZGL', 'TRF-MW5A67TW') AND voided_at IS NULL
  LOOP
    INSERT INTO public.accounting_transactions
      (transaction_number, transaction_date, account_type, category, description, debit_amount, credit_amount,
       reference_type, reference_id, organization_id, financial_account_id, currency, fx_rate, base_currency, gl_account_id)
    SELECT replace(a.transaction_number, 'TRF-', 'TRF-VOID-'), a.transaction_date, a.account_type, a.category,
           'Reversal of transfer ' || t.transfer_number || ' (balance adjustment, not a real transfer)',
           a.credit_amount, a.debit_amount, 'inter_account_transfer_void', t.id, a.organization_id,
           a.financial_account_id, a.currency, a.fx_rate, a.base_currency, a.gl_account_id
      FROM public.accounting_transactions a
     WHERE a.reference_type = 'inter_account_transfer' AND a.reference_id = t.id;
    UPDATE public.inter_account_transfers SET voided_at = now() WHERE id = t.id;
  END LOOP;
END $$;

UPDATE public.financial_accounts SET opening_balance_date = DATE '2026-05-01', opening_balance = 50277.54
 WHERE name = 'ABSA KES' AND opening_balance IS DISTINCT FROM 50277.54;
UPDATE public.financial_accounts SET opening_balance_date = DATE '2026-05-01', opening_balance = 489488.80
 WHERE btrim(name) = 'KCB KES' AND opening_balance IS DISTINCT FROM 489488.80;
UPDATE public.financial_accounts SET opening_balance_date = DATE '2026-05-06', opening_balance = 46114.74
 WHERE name = 'MPESA' AND opening_balance IS DISTINCT FROM 46114.74;
