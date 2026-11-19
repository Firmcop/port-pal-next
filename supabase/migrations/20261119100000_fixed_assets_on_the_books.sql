-- =====================================================================
-- Fixed assets on the books (19 Nov 2026) — gap analysis, phase 1.
-- The register held 3 assets but none were on the balance sheet and none
-- had been depreciated.
--  * capitalise_fixed_asset(asset, source, ...) puts an asset's cost on the
--    Fixed Assets account (1500), dated on its acquisition date, against:
--      'expense' — an expense it was wrongly booked to (that ledger line's account)
--      'account' — the bank / cash account that paid for it
--      'payable' — a supplier still to be paid (Accounts Payable)
--      'opening' — owned before Port Pal started (Opening Balance Equity)
--  * capitalisation threshold: KES 20,000 (fixed_assets_capitalisation_threshold);
--    items below it stay in the register for tracking but are expensed.
--  * only capitalised assets are depreciated; a monthly job runs the previous
--    month's depreciation on the 2nd.
-- =====================================================================
ALTER TABLE public.fixed_assets ADD COLUMN IF NOT EXISTS capitalised_at timestamptz;
ALTER TABLE public.fixed_assets ADD COLUMN IF NOT EXISTS capitalised_source text;
ALTER TABLE public.fixed_assets ADD COLUMN IF NOT EXISTS below_threshold boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN public.fixed_assets.capitalised_at IS 'When the cost was posted to Fixed Assets (1500). Only capitalised assets are depreciated.';
COMMENT ON COLUMN public.fixed_assets.below_threshold IS 'Cost below the capitalisation threshold: tracked in the register, expensed, not depreciated.';

CREATE OR REPLACE FUNCTION public.fixed_assets_capitalisation_threshold(_org uuid)
RETURNS numeric LANGUAGE sql STABLE SET search_path TO 'public' AS $$ SELECT 20000::numeric $$;

CREATE OR REPLACE FUNCTION public.capitalise_fixed_asset(_asset_id uuid, _source text, _source_ledger_id uuid DEFAULT NULL,
                                                         _financial_account_id uuid DEFAULT NULL, _supplier_id uuid DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE a fixed_assets%ROWTYPE; _on timestamptz; _cur text; _fa uuid; _src accounting_transactions%ROWTYPE;
        _cr_cat text; _cr_type account_type; _cr_gl uuid := NULL; _cr_fa uuid := NULL; _what text;
BEGIN
  SELECT * INTO a FROM fixed_assets WHERE id = _asset_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Asset not found'; END IF;
  PERFORM public.assert_finance_writer_for(a.organization_id);
  IF a.capitalised_at IS NOT NULL THEN RAISE EXCEPTION '% is already on the books', a.code; END IF;
  IF COALESCE(a.cost, 0) <= 0 THEN RAISE EXCEPTION 'Enter the cost of % first', a.name; END IF;
  _on := (COALESCE(a.acquisition_date, current_date)::timestamp + time '12:00') AT TIME ZONE 'Africa/Nairobi';
  PERFORM public.assert_period_open(a.organization_id, _on::date);
  _cur := (SELECT currency FROM organizations WHERE id = a.organization_id);
  _fa := public.ensure_gl_account(a.organization_id, '1500', 'Fixed Assets', 'asset', 'fixed_asset');

  IF _source = 'expense' THEN
    SELECT * INTO _src FROM accounting_transactions WHERE id = _source_ledger_id AND organization_id = a.organization_id;
    IF NOT FOUND OR COALESCE(_src.debit_amount, 0) <= 0 THEN RAISE EXCEPTION 'Pick the expense the asset was booked to'; END IF;
    _cr_cat := _src.category; _cr_type := _src.account_type; _cr_gl := _src.gl_account_id;
    _what := 'moved from expense ' || COALESCE(_src.transaction_number, '');
  ELSIF _source = 'account' THEN
    IF _financial_account_id IS NULL THEN RAISE EXCEPTION 'Pick the account that paid for it'; END IF;
    _cr_cat := 'cash'; _cr_type := 'asset'; _cr_fa := _financial_account_id;
    _what := 'paid from account';
  ELSIF _source = 'payable' THEN
    _cr_cat := 'accounts_payable'; _cr_type := 'liability';
    _what := 'owed to supplier';
  ELSIF _source = 'opening' THEN
    _cr_cat := 'opening_balance_equity'; _cr_type := 'equity';
    _what := 'owned before go-live';
  ELSE
    RAISE EXCEPTION 'Unknown source %', _source;
  END IF;

  INSERT INTO accounting_transactions (transaction_number, transaction_date, account_type, category, description,
    debit_amount, credit_amount, reference_type, reference_id, organization_id, gl_account_id, financial_account_id,
    currency, fx_rate, base_currency, depot_id)
  VALUES ('FA-' || substring(a.id::text, 1, 8) || '-1', _on, 'asset', 'fixed_asset', 'Fixed asset ' || a.code || ' ' || a.name,
          a.cost, 0, 'fixed_asset_acquisition', a.id, a.organization_id, _fa, NULL, _cur, 1, _cur, a.depot_id),
         ('FA-' || substring(a.id::text, 1, 8) || '-2', _on, _cr_type, _cr_cat, 'Fixed asset ' || a.code || ' — ' || _what,
          0, a.cost, 'fixed_asset_acquisition', a.id, a.organization_id, _cr_gl, _cr_fa, _cur, 1, _cur, a.depot_id);

  UPDATE fixed_assets SET capitalised_at = now(), capitalised_source = _source, gl_asset_account = _fa, updated_at = now()
   WHERE id = a.id;
END $$;
REVOKE ALL ON FUNCTION public.capitalise_fixed_asset(uuid, text, uuid, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.capitalise_fixed_asset(uuid, text, uuid, uuid, uuid) TO authenticated;

-- only assets on the books are depreciated
DO $$
DECLARE _def text;
        _old text := 'WHERE organization_id = org AND status = ''active''';
        _new text := 'WHERE organization_id = org AND status = ''active'' AND capitalised_at IS NOT NULL';
BEGIN
  SELECT pg_get_functiondef('public.run_depreciation(uuid)'::regprocedure) INTO _def;
  IF position('capitalised_at IS NOT NULL' IN _def) = 0 THEN
    IF position(_old IN _def) = 0 THEN RAISE EXCEPTION 'run_depreciation: anchor not found'; END IF;
    EXECUTE replace(_def, _old, _new);
  END IF;
END $$;

-- monthly: last month's depreciation, on the 2nd
CREATE OR REPLACE FUNCTION public.run_due_depreciation()
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE p record; _n int := 0;
BEGIN
  FOR p IN
    SELECT fp.id FROM fiscal_periods fp
     WHERE fp.end_date < current_date
       AND fp.status::text = 'open'
       AND EXISTS (SELECT 1 FROM fixed_assets f WHERE f.organization_id = fp.organization_id
                    AND f.capitalised_at IS NOT NULL AND f.status = 'active' AND f.acquisition_date <= fp.end_date)
       AND NOT EXISTS (SELECT 1 FROM fixed_asset_depreciation_runs r WHERE r.period_id = fp.id)
     ORDER BY fp.start_date
  LOOP
    PERFORM public.run_depreciation(p.id);
    _n := _n + 1;
  END LOOP;
  RETURN _n;
END $$;
REVOKE ALL ON FUNCTION public.run_due_depreciation() FROM PUBLIC, anon, authenticated;

DO $$ BEGIN PERFORM cron.unschedule('fixed-asset-depreciation'); EXCEPTION WHEN OTHERS THEN NULL; END $$;
SELECT cron.schedule('fixed-asset-depreciation', '40 3 2 * *', 'SELECT public.run_due_depreciation()');

-- the register as it stands
UPDATE fixed_assets SET below_threshold = true
 WHERE COALESCE(cost, 0) > 0 AND cost < public.fixed_assets_capitalisation_threshold(organization_id) AND capitalised_at IS NULL;

-- RM18 bead rotary machine: booked to Other Expenses on 11 Aug -> Fixed Assets
DO $$
DECLARE _a uuid; _l uuid;
BEGIN
  SELECT id INTO _a FROM fixed_assets WHERE code = 'BDR' AND name ILIKE 'RM18%' AND capitalised_at IS NULL;
  SELECT id INTO _l FROM accounting_transactions
   WHERE description ILIKE 'RM18 Electric Power Bead Rotary Machine%' AND debit_amount = 68820 LIMIT 1;
  IF _a IS NOT NULL AND _l IS NOT NULL THEN
    UPDATE fixed_assets SET cost = 68820 WHERE id = _a;  -- as paid (register said 68,819.95)
    PERFORM public.capitalise_fixed_asset(_a, 'expense', _l);
  END IF;
END $$;

-- depreciation from August to last month
SELECT public.run_due_depreciation();
