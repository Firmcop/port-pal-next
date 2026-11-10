-- Completing a bank reconciliation summed cleared lines' raw amounts, so a
-- USD line on a KES account counted at face value. Use the same conversion
-- as financial_account_balances (amount_in_account_currency).
DO $$
DECLARE _def text; _old text := 'SELECT COALESCE(SUM(at.debit_amount - at.credit_amount), 0) INTO v_cleared_total';
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO _def FROM pg_proc p
   WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'complete_bank_reconciliation';
  IF position(_old IN _def) = 0 THEN
    IF position('amount_in_account_currency' IN _def) > 0 THEN RETURN; END IF;
    RAISE EXCEPTION 'complete_bank_reconciliation changed; patch by hand';
  END IF;
  _def := replace(_def, _old,
    'SELECT COALESCE(SUM(public.amount_in_account_currency(at.debit_amount - at.credit_amount, at.currency, at.fx_rate,'
    || ' (SELECT fa.currency FROM public.financial_accounts fa WHERE fa.id = v_recon.account_id), at.organization_id,'
    || ' (at.transaction_date AT TIME ZONE ''Africa/Nairobi'')::date)), 0) INTO v_cleared_total');
  EXECUTE _def;
END $$;
