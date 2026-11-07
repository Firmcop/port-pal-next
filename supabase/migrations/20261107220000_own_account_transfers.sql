-- =====================================================================
-- Own-account transfers from the bank statements (7 Nov 2026).
--
-- The M-Pesa import parked own-account movements in 1090 Transfers in
-- transit. Each one confirmed by the other bank's statement (ABSA
-- 2043015012, KCB 1198736267; HFCB taken from the M-Pesa statement, no
-- HFCB statement yet) becomes an inter-account transfer: the M-Pesa line
-- becomes the transfer's M-Pesa leg and the 1090 line becomes the other
-- bank's leg, so nothing is posted twice and the transfer can be voided
-- from the app like any other.
--   ABSA -> M-Pesa 258 (16,709,000) | M-Pesa -> ABSA 3 (490,000)
--   M-Pesa -> KCB 3 (240,000)       | HFCB -> M-Pesa 10 (221,000)
-- 13 lines stay in 1090 for review: they are not on the Firmcop ABSA/KCB
-- statements (KCB paybill to other people's accounts, ABSA paybill to
-- accounts Z4LA# / 2034454607, three 18,000 receipts from another ABSA
-- account).
-- Also:
--  * M-Pesa import lines were stored 3 hours late (statement times read
--    as UTC); they are moved back to Nairobi time.
--  * Opening-balance lines get their bank account so the bank screens
--    include them.
-- Idempotent.
-- =====================================================================
DO $$
DECLARE
  _org  constant uuid := '6b29b65b-fa63-4dcf-9854-ede5c9a8320b';
  _absa constant uuid := 'f1caa341-22a8-417a-b633-1854c4bb009a';
  _kcb  constant uuid := 'f9260e9f-b8c6-410b-a445-29091e3a185e';
  _mp   constant uuid := 'cf349b8d-7ba6-42d5-82a3-56d1e48ca307';
  _hfcb constant uuid := '23b94e81-a01b-412a-94c7-797ca7ef49ea';
  _hold constant text[] := ARRAY['MPESA:UE94G45ERB:89','MPESA:UEB4G4EYKE:202','MPESA:UFI4G8TWDQ:1905','MPESA:UFN4G9IOR9:2099',
    'MPESA:UGR4G1EGWO:3376','MPESA:UGR4G1ELDV:3378','MPESA:UH44G2D0XY:3687','MPESA:UIG4G7IFCO:5415','MPESA:UIT4G96JGM:5934',
    'MPESA:UJ84GA9ADY:6157','MPESA:UJK4GBORNM:6582','MPESA:UJN4G07SYJ:6713','MPESA:UK34G1KQKZ:7050'];
  r record; _n int := 0; _other uuid; _gl uuid; _from uuid; _to uuid; _lbl text; _tid uuid;
BEGIN
  -- M-Pesa times: statement local time was stored as UTC
  IF (SELECT transaction_date FROM accounting_transactions WHERE transaction_number LIKE 'MP-UE74G3WIHK-%-B' LIMIT 1)
     = TIMESTAMPTZ '2026-05-07 07:21:31+00' THEN
    UPDATE accounting_transactions SET transaction_date = transaction_date - interval '3 hours'
     WHERE reference_type = 'bank_statement_import' AND transaction_number LIKE 'MP-%';
  END IF;

  -- opening balances on their bank account
  UPDATE accounting_transactions a SET financial_account_id = fa.id
    FROM financial_accounts fa
   WHERE a.reference_type = 'opening_balance' AND a.financial_account_id IS NULL
     AND a.gl_account_id = fa.gl_account_id AND fa.organization_id = _org;

  ALTER TABLE inter_account_transfers DISABLE TRIGGER trg_inter_account_transfer_post;

  FOR r IN
    SELECT s.reference, split_part(s.reference, ':', 2) receipt, c.id cid, b.id bid, b.transaction_date ts,
           round(b.debit_amount - b.credit_amount, 2) amt, c.description cdesc
      FROM accounting_transactions c
      JOIN gl_accounts g ON g.id = c.gl_account_id AND g.code = '1090'
      JOIN bank_statement_imports s ON s.id = c.reference_id
      JOIN accounting_transactions b ON b.reference_id = s.id AND b.transaction_number LIKE 'MP-%-B'
     WHERE c.reference_type = 'bank_statement_import' AND NOT (s.reference = ANY(_hold))
     ORDER BY b.transaction_date
  LOOP
    _other := CASE WHEN r.cdesc LIKE '%ABSA Bank%' THEN _absa WHEN r.cdesc LIKE '%KCB Bank%' THEN _kcb
                   WHEN r.cdesc LIKE '%HFCB%' THEN _hfcb END;
    IF _other IS NULL THEN RAISE EXCEPTION 'unknown bank for %', r.reference; END IF;
    IF r.amt > 0 THEN _from := _other; _to := _mp; ELSE _from := _mp; _to := _other; END IF;
    _lbl := (SELECT name FROM financial_accounts WHERE id = _from) || ' to ' || (SELECT name FROM financial_accounts WHERE id = _to)
            || ' (M-Pesa ' || r.receipt || ')';
    _tid := md5('trf:' || r.reference)::uuid;
    CONTINUE WHEN EXISTS (SELECT 1 FROM inter_account_transfers WHERE id = _tid);

    INSERT INTO inter_account_transfers (id, organization_id, transfer_number, transfer_date, from_account_id, to_account_id,
           amount, fx_rate, fees, description, reference)
    VALUES (_tid, _org, 'TRF-' || r.receipt, r.ts, _from, _to, abs(r.amt), 1, 0, _lbl, 'M-Pesa statement ' || r.receipt);

    -- M-Pesa leg = the imported M-Pesa line
    UPDATE accounting_transactions SET
           transaction_number = CASE WHEN _to = _mp THEN 'TRF-IN-' ELSE 'TRF-OUT-' END || substr(_tid::text, 1, 8),
           reference_type = 'inter_account_transfer', reference_id = _tid,
           description = _lbl || CASE WHEN _to = _mp THEN ' (in)' ELSE ' (out)' END
     WHERE id = r.bid;
    -- other bank's leg = the 1090 line
    SELECT gl_account_id INTO _gl FROM financial_accounts WHERE id = _other;
    UPDATE accounting_transactions SET
           transaction_number = CASE WHEN _to = _mp THEN 'TRF-OUT-' ELSE 'TRF-IN-' END || substr(_tid::text, 1, 8),
           reference_type = 'inter_account_transfer', reference_id = _tid,
           account_type = 'asset', category = 'cash', financial_account_id = _other, gl_account_id = _gl,
           description = _lbl || CASE WHEN _to = _mp THEN ' (out)' ELSE ' (in)' END
     WHERE id = r.cid;
    _n := _n + 1;
  END LOOP;

  ALTER TABLE inter_account_transfers ENABLE TRIGGER trg_inter_account_transfer_post;

  IF (SELECT round(sum((debit_amount - credit_amount) * coalesce(fx_rate, 1)), 2) FROM accounting_transactions) <> 0 THEN
    RAISE EXCEPTION 'ledger out of balance';
  END IF;
  RAISE NOTICE 'transfers created: %', _n;
END $$;
