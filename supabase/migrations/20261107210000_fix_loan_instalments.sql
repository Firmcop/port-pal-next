-- =====================================================================
-- KCB loans: instalments recorded but still shown as overdue (7 Nov 2026).
--
-- Cause: a later rewrite of post_loan_transaction dropped the call that
-- re-applies payments to the repayment schedule, so pay_loan_instalment
-- saved the payment but the instalment stayed "overdue". Instalment #27 of
-- AA241859QRT8 (due 28 Sep) was therefore entered three times (4, 6, 7 Nov),
-- the 7 Nov copy with no bank account.
--
-- 1. The 6 Nov and 7 Nov copies of #27 are reversed on their own dates and
--    removed (audit trail kept).
-- 2. The remaining payments are dated when KCB actually took them (KCB
--    statement 1198736267): #27 on 30 Sep (179,552.20), #21 of AA24358K6P1K
--    on 26 Sep (5,931.85 on 23 Sep + 101,137.70 on 26 Sep).
-- 3. The 2,745.50 KCB took on 23 Oct is recorded as a part payment of
--    instalment #22 of AA24358K6P1K (due 23 Oct).
-- 4. Both loans default to the KCB KES account for payments.
-- 5. A trigger re-applies payments to the schedule whenever a loan
--    transaction is added, changed or removed, so this cannot recur.
-- Idempotent.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.trg_loan_txn_apply_schedule()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    PERFORM public.apply_loan_payments_to_schedule(OLD.loan_id);
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') AND (TG_OP = 'INSERT' OR NEW.loan_id IS DISTINCT FROM OLD.loan_id) THEN
    PERFORM public.apply_loan_payments_to_schedule(NEW.loan_id);
  END IF;
  RETURN NULL;
END $$;

CREATE OR REPLACE TRIGGER trg_loan_txn_apply_schedule
AFTER INSERT OR DELETE OR UPDATE OF amount, txn_type, loan_id ON public.loan_transactions
FOR EACH ROW EXECUTE FUNCTION public.trg_loan_txn_apply_schedule();

DO $$
DECLARE
  _org   constant uuid := '6b29b65b-fa63-4dcf-9854-ede5c9a8320b';
  _kcb   constant uuid := 'f9260e9f-b8c6-410b-a445-29091e3a185e';   -- KCB KES
  _asset constant uuid := '07eba24f-4771-4d9e-a5f1-27cd0afee7d2';   -- AA241859QRT8
  _unsec constant uuid := 'f3f7410d-c50a-49b3-94c8-248882657856';   -- AA24358K6P1K
  _dups  constant uuid[] := ARRAY['24f8ee4a-ec20-4863-9322-1e9fcae5d24b',  -- #27 interest, 6 Nov
                                  '966d2e23-bf51-48ae-a1a2-5ef37f88ef18',  -- #27 principal, 6 Nov
                                  'ea71a5bd-5f78-4884-ad0f-c5b3ce140bb2',  -- #27 interest, 7 Nov
                                  '61461575-e945-4639-b62b-e843d9e7bd8a']::uuid[]; -- #27 principal, 7 Nov
  _sep30 constant uuid[] := ARRAY['60a9e5c2-d671-4466-983a-5b1873866c0c', '768bb25e-a626-4c64-a145-9f6e9020f579']::uuid[];
  _sep26 constant uuid[] := ARRAY['46bc6ec4-0514-4cf3-8f53-8285424f8d92', 'd57c73eb-580b-4ef1-87e8-abab9a2338d9']::uuid[];
  _id uuid; _on timestamptz; _line uuid;
BEGIN
  -- 1. duplicates of #27
  FOREACH _id IN ARRAY _dups LOOP
    SELECT min(transaction_date) INTO _on FROM public.accounting_transactions
     WHERE reference_type = 'loan_transaction' AND reference_id = _id;
    IF _on IS NOT NULL THEN
      PERFORM public.post_reversal_of('loan_transaction', _id, 'duplicate instalment entry', _on);
    END IF;
    IF EXISTS (SELECT 1 FROM public.loan_transactions WHERE id = _id) THEN
      INSERT INTO public.finance_audit_log (organization_id, entity_type, entity_id, action, summary)
      SELECT _org, 'loan_transactions', t.id, 'duplicate_instalment_removed',
             jsonb_build_object('loan', t.loan_id, 'date', t.txn_date, 'type', t.txn_type, 'amount', t.amount, 'ref', t.external_ref)
        FROM public.loan_transactions t WHERE t.id = _id;
      DELETE FROM public.loan_transactions WHERE id = _id;
    END IF;
  END LOOP;

  -- 2. date payments when KCB took them
  UPDATE public.loan_transactions SET txn_date = DATE '2026-09-30', value_date = DATE '2026-09-30'
   WHERE id = ANY(_sep30) AND txn_date <> DATE '2026-09-30';
  UPDATE public.accounting_transactions SET transaction_date = TIMESTAMPTZ '2026-09-30 12:00+03'
   WHERE reference_type = 'loan_transaction' AND reference_id = ANY(_sep30)
     AND transaction_date::date <> DATE '2026-09-30';
  UPDATE public.loan_transactions SET txn_date = DATE '2026-09-26', value_date = DATE '2026-09-26'
   WHERE id = ANY(_sep26) AND txn_date <> DATE '2026-09-26';
  UPDATE public.accounting_transactions SET transaction_date = TIMESTAMPTZ '2026-09-26 12:00+03'
   WHERE reference_type = 'loan_transaction' AND reference_id = ANY(_sep26)
     AND transaction_date::date <> DATE '2026-09-26';

  -- 4. default payment account
  UPDATE public.loan_facilities SET financial_account_id = _kcb
   WHERE id IN (_asset, _unsec) AND financial_account_id IS NULL;

  -- 5. schedule from recorded payments
  PERFORM public.apply_loan_payments_to_schedule(_asset);
  PERFORM public.apply_loan_payments_to_schedule(_unsec);

  -- 3. 23 Oct part payment of #22 (unsecured)
  IF NOT EXISTS (SELECT 1 FROM public.loan_transactions WHERE loan_id = _unsec AND external_ref = 'FT26296K26T0') THEN
    SELECT id INTO _line FROM public.loan_schedule_lines WHERE loan_id = _unsec AND seq = 22;
    PERFORM public.pay_loan_instalment(_unsec, _line, DATE '2026-10-23', 2745.50, _kcb, 'FT26296K26T0',
                                       'KCB automatic deduction 23 Oct 2026 (part of instalment #22)');
  END IF;
END $$;
