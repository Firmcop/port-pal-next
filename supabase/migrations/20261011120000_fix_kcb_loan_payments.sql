-- =====================================================================
-- One-off: KCB loan payment corrections (run after the single-org merge).
--
-- 1. Instalments #19 and #20 of loan AA24358K6P1K were entered twice on
--    15 Sep 2026 (20:59 without a reference, then 21:05/21:06 with the
--    instalment reference). The first set is removed: its ledger lines are
--    reversed on the same date (the audit trail stays), the payment rows are
--    deleted and the schedule is re-applied.
-- 2. The 7 Oct 2026 payment on AA241859QRT8 had no bank account; it is set
--    to KCB KES, the account every other KCB loan payment uses.
-- 3. The bank-side lines of the loan payments had no GL account because
--    they were posted in an organisation without account 1000; they now
--    use 1000 Cash on Hand like every other bank line.
-- Idempotent.
-- =====================================================================

DO $$
DECLARE
  _org  constant uuid := '6b29b65b-fa63-4dcf-9854-ede5c9a8320b';
  _kcb  constant uuid := 'f9260e9f-b8c6-410b-a445-29091e3a185e';           -- KCB KES
  _loan constant uuid := 'f3f7410d-c50a-49b3-94c8-248882657856';           -- AA24358K6P1K
  _dups constant uuid[] := ARRAY['2fc3b917-f03d-4906-bf12-f5aed5efde94',   -- #19 interest
                                 'bb02ef3a-ae25-4eab-a25b-1abe7ca03b7c',   -- #19 principal
                                 '36849eb4-4aa2-4b6d-bb08-ae8d037aee5b',   -- #20 interest
                                 '41b0009b-669d-44c2-86d0-76ae13bb70b4']::uuid[]; -- #20 principal
  _oct  constant uuid[] := ARRAY['1b752012-6571-4bb0-af04-26a27594d062',
                                 '6e78088c-cfcd-465c-b6c7-79db31c79b1f']::uuid[];
  _cash uuid;
  _id uuid;
  _on timestamptz;
BEGIN
  IF EXISTS (SELECT 1 FROM public.loan_facilities WHERE organization_id <> _org) THEN
    RAISE EXCEPTION 'Run the single-organisation merge (20261011110000) first';
  END IF;
  SELECT id INTO _cash FROM public.gl_accounts WHERE organization_id = _org AND code = '1000';

  -- 2. bank account for the 7 Oct payment
  UPDATE public.loan_transactions SET financial_account_id = _kcb
   WHERE id = ANY(_oct) AND financial_account_id IS NULL;
  UPDATE public.accounting_transactions SET financial_account_id = _kcb
   WHERE reference_type = 'loan_transaction' AND reference_id = ANY(_oct)
     AND category = 'cash' AND financial_account_id IS NULL;

  -- 3. GL account on bank-side loan lines
  UPDATE public.accounting_transactions SET gl_account_id = _cash
   WHERE organization_id = _org AND reference_type = 'loan_transaction'
     AND category = 'cash' AND gl_account_id IS NULL;

  -- 1. remove the duplicate entries
  FOREACH _id IN ARRAY _dups LOOP
    SELECT min(transaction_date) INTO _on FROM public.accounting_transactions
     WHERE reference_type = 'loan_transaction' AND reference_id = _id;
    IF _on IS NOT NULL THEN
      PERFORM public.post_reversal_of('loan_transaction', _id, 'duplicate instalment entry', _on);
    END IF;
    DELETE FROM public.loan_transactions WHERE id = _id;
  END LOOP;
  PERFORM public.apply_loan_payments_to_schedule(_loan);
END $$;
