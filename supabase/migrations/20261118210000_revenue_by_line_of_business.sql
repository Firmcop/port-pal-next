-- =====================================================================
-- Revenue by line of business (18 Nov 2026) — gap analysis, phase 1.
-- Every customer invoice posted all its revenue to 4900 Other Income
-- (invoice_type is 'other' for sales, conversions and haulage alike), so the
-- P&L could not show what each line of business earns.
--
-- invoice_revenue_split(invoice) splits an invoice's net (before VAT) across
-- revenue categories:
--   container sale invoices (linked sale, INV-CS-/CSL-)      -> container_sale  4030
--   haulage invoices (LOG-)                                    -> logistics_revenue 4060
--   gate fee / storage / lease / repair / handling types       -> their own accounts
--   repatriation charges (REP-/RPT-)                           -> handling 4010
--   anything else, line by line:
--     transport / offloading / delivery / crane lines          -> logistics_revenue 4060
--     the rest: conversion work if the invoice is a conversion
--       (linked job, project, or any fabrication line)         -> conversion_revenue 4040
--     otherwise                                                -> container_sale 4030
--   discounts and rounding are shared pro rata, so the split always adds up
--   to the invoice net exactly.
-- sync_invoice_ledger posts one revenue line per category.
-- Past invoices are re-classed by a separate one-off step, dated on the
-- original posting so each month's P&L is corrected in its own month.
-- =====================================================================
CREATE OR REPLACE FUNCTION public.invoice_line_revenue_kind(_desc text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path TO 'public' AS $$
  SELECT CASE
    WHEN coalesce(_desc, '') ~* '(discount)' THEN 'shared'
    WHEN coalesce(_desc, '') ~* '(transport|offload|off-load|delivery|deliver to|haulage|crane|trucking|logistics|lifting)' THEN 'logistics_revenue'
    WHEN coalesce(_desc, '') ~* '(fabricat|install|partition|door|paint|electric|wiring|window|roof|insulat|conver|works|stall|floor|ceiling|plumb|design|cabinet|kitchen|toilet|framing|truss|panel|cladding|gypsum|tile|shelv|welding|customi|furring|aluminium|aluminum|sized)' THEN 'conversion_revenue'
    ELSE 'goods'
  END;
$$;

CREATE OR REPLACE FUNCTION public.invoice_revenue_split(_invoice_id uuid)
RETURNS TABLE(category text, amount numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  _inv invoices%ROWTYPE; _net numeric; _whole text := NULL; _is_conv boolean;
  _tot numeric; _acc numeric := 0; _n int; _i int := 0; r record; _src uuid;
BEGIN
  SELECT * INTO _inv FROM invoices WHERE id = _invoice_id;
  IF NOT FOUND THEN RETURN; END IF;
  _net := COALESCE(_inv.subtotal, _inv.total_amount - COALESCE(_inv.tax_amount, 0), 0);

  -- a credit note follows the invoice it credits
  IF _inv.credit_of_invoice_id IS NOT NULL AND _inv.credit_of_invoice_id <> _inv.id THEN
    SELECT sum(s.amount), count(*) INTO _tot, _n FROM public.invoice_revenue_split(_inv.credit_of_invoice_id) s;
    IF COALESCE(_tot, 0) <> 0 THEN
      FOR r IN SELECT s.category AS cat, s.amount AS amt FROM public.invoice_revenue_split(_inv.credit_of_invoice_id) s ORDER BY abs(s.amount) LOOP
        _i := _i + 1;
        category := r.cat;
        amount := CASE WHEN _i = _n THEN round(_net - _acc, 2) ELSE round(_net * r.amt / _tot, 2) END;
        _acc := _acc + amount;
        RETURN NEXT;
      END LOOP;
      RETURN;
    END IF;
  END IF;

  _whole := CASE _inv.invoice_type::text
              WHEN 'gate_fee' THEN 'gate_fee' WHEN 'storage' THEN 'storage' WHEN 'lease' THEN 'lease_revenue'
              WHEN 'repair' THEN 'repair_revenue' WHEN 'logistics' THEN 'logistics_revenue' WHEN 'handling' THEN 'handling'
              ELSE NULL END;
  IF _whole IS NULL THEN
    IF EXISTS (SELECT 1 FROM container_sales cs WHERE cs.invoice_id = _inv.id)
       OR _inv.invoice_number ~ '^(INV-CS-|CSL-)' THEN
      _whole := 'container_sale';
    ELSIF _inv.invoice_number ~ '^LOG-' THEN
      _whole := 'logistics_revenue';
    ELSIF _inv.invoice_number ~ '^(REP-|RPT-|RPH-)' THEN
      _whole := 'handling';
    END IF;
  END IF;
  IF _whole IS NOT NULL THEN
    category := _whole; amount := _net; RETURN NEXT; RETURN;
  END IF;

  _is_conv := COALESCE(_inv.notes, '') ~* '^conversion job'
    OR _inv.project_id IS NOT NULL
    OR EXISTS (SELECT 1 FROM container_conversions c JOIN quotes q ON q.id = c.quote_id
                WHERE q.quote_number = _inv.customer_reference AND q.organization_id = _inv.organization_id)
    OR EXISTS (SELECT 1 FROM invoice_line_items li WHERE li.invoice_id = _inv.id
                AND public.invoice_line_revenue_kind(li.description) = 'conversion_revenue');

  -- line amounts by category; discount lines are shared pro rata
  SELECT sum(t), count(DISTINCT c) INTO _tot, _n FROM (
    SELECT CASE WHEN public.invoice_line_revenue_kind(li.description) = 'logistics_revenue' THEN 'logistics_revenue'
                WHEN _is_conv THEN 'conversion_revenue' ELSE 'container_sale' END AS c,
           COALESCE(li.total_price, 0) AS t
      FROM invoice_line_items li
     WHERE li.invoice_id = _inv.id AND public.invoice_line_revenue_kind(li.description) <> 'shared'
       AND COALESCE(li.total_price, 0) > 0) x;
  IF COALESCE(_tot, 0) <= 0 THEN
    category := CASE WHEN _is_conv THEN 'conversion_revenue' ELSE 'other' END; amount := _net;
    RETURN NEXT; RETURN;
  END IF;

  FOR r IN
    SELECT c AS cat, sum(t) AS amt FROM (
      SELECT CASE WHEN public.invoice_line_revenue_kind(li.description) = 'logistics_revenue' THEN 'logistics_revenue'
                  WHEN _is_conv THEN 'conversion_revenue' ELSE 'container_sale' END AS c,
             COALESCE(li.total_price, 0) AS t
        FROM invoice_line_items li
       WHERE li.invoice_id = _inv.id AND public.invoice_line_revenue_kind(li.description) <> 'shared'
         AND COALESCE(li.total_price, 0) > 0) x
     GROUP BY c ORDER BY sum(t)
  LOOP
    _i := _i + 1;
    category := r.cat;
    amount := CASE WHEN _i = _n THEN round(_net - _acc, 2) ELSE round(_net * r.amt / _tot, 2) END;
    _acc := _acc + amount;
    RETURN NEXT;
  END LOOP;
END $$;

-- invoice posting: one revenue line per category from invoice_revenue_split
CREATE OR REPLACE FUNCTION public.sync_invoice_ledger(_invoice_id uuid)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE _inv invoices%ROWTYPE; _net numeric; _tax numeric; _desired jsonb := '[]'; r record;
        _base text; _fx numeric; _posted boolean; _date timestamptz; _cur text;
BEGIN
  SELECT * INTO _inv FROM invoices WHERE id = _invoice_id;
  IF NOT FOUND THEN RETURN; END IF;
  SELECT currency INTO _base FROM organizations WHERE id = _inv.organization_id;
  _posted := EXISTS (SELECT 1 FROM accounting_transactions WHERE reference_type = 'invoice' AND reference_id = _invoice_id);
  -- cancelled invoices already reversed under 'invoice_reversal' (older cancels): never reverse twice
  IF _inv.status = 'cancelled' AND EXISTS (SELECT 1 FROM accounting_transactions
                                            WHERE reference_type = 'invoice_reversal' AND reference_id = _invoice_id) THEN
    RETURN;
  END IF;

  -- 'credited' stays posted (the credit note carries the reversal); 'cancelled' is reversed.
  IF _inv.status IN ('sent', 'paid', 'overdue', 'credited') AND COALESCE(_inv.total_amount, 0) <> 0 THEN
    _net := COALESCE(_inv.subtotal, _inv.total_amount - COALESCE(_inv.tax_amount, 0));
    _tax := COALESCE(_inv.tax_amount, 0);
    _cur := COALESCE(_inv.currency, _base);
    _fx := public.get_fx_rate(_inv.organization_id, _cur, _base, COALESCE(_inv.issued_at, now())::date);
    _desired := jsonb_build_array(
      jsonb_build_object('category', 'accounts_receivable', 'account_type', 'asset', 'amount', _inv.total_amount,
                         'currency', _cur, 'fx_rate', _fx));
    FOR r IN SELECT * FROM public.invoice_revenue_split(_invoice_id) LOOP
      CONTINUE WHEN r.amount = 0;
      _desired := _desired || jsonb_build_object('category', r.category, 'account_type', 'revenue', 'amount', -r.amount,
                                                 'currency', _cur, 'fx_rate', _fx);
    END LOOP;
    IF _tax <> 0 THEN
      _desired := _desired || jsonb_build_object('category', 'output_tax', 'account_type', 'liability', 'amount', -_tax,
                                                 'currency', _cur, 'fx_rate', _fx);
    END IF;
  END IF;

  -- First posting is dated on the invoice; later corrections and reversals today.
  _date := CASE WHEN _posted THEN now() ELSE COALESCE(_inv.issued_at, now()) END;
  PERFORM public.ledger_sync_lines(_inv.organization_id, 'invoice', _invoice_id,
    CASE WHEN _inv.total_amount < 0 THEN 'CN-' ELSE 'AR-' END || substring(_inv.invoice_number FROM 1 FOR 30) || '-' || substring(_invoice_id::text, 1, 8),
    CASE WHEN _inv.credit_of_invoice_id IS NOT NULL THEN 'Credit note ' ELSE 'Invoice ' END
      || _inv.invoice_number || COALESCE(' — ' || _inv.customer_name, ''),
    _date, _desired);
END $function$;

-- ---------------------------------------------------------------------
-- One-off: re-class revenue already posted to Other Income (4900).
-- Per invoice, dated on its original revenue posting, same currency and
-- rate: Dr Other Income (what was posted), Cr the split. Where the books
-- carry less than the invoice (5 container-sale invoices whose price was
-- restated after posting) the receivable is brought up to the invoice on
-- the same date. Afterwards sync_invoice_ledger finds nothing to change.
-- ---------------------------------------------------------------------
DO $$
DECLARE r record; s record; _n int; _split numeric; _bad int; _left numeric; _num text;
BEGIN
  FOR r IN
    SELECT at.reference_id AS inv_id, sum(at.credit_amount - at.debit_amount) AS posted,
           min(at.transaction_date) AS on_date, max(at.currency) AS cur, max(at.fx_rate) AS fx,
           max(at.base_currency) AS base, max(at.organization_id::text)::uuid AS org,
           (SELECT i.invoice_number FROM invoices i WHERE i.id = at.reference_id) AS inv_no
      FROM accounting_transactions at
     WHERE at.reference_type = 'invoice' AND at.category = 'other' AND at.account_type = 'revenue'
     GROUP BY at.reference_id
    HAVING abs(sum(at.credit_amount - at.debit_amount)) > 0.005
  LOOP
    _n := 0;
    _num := 'AR-' || substring(r.inv_no FROM 1 FOR 30) || '-RCL';
    SELECT COALESCE(sum(amount), 0) INTO _split FROM public.invoice_revenue_split(r.inv_id) WHERE category <> 'other';
    CONTINUE WHEN _split = 0;
    -- clear Other Income
    _n := _n + 1;
    INSERT INTO accounting_transactions (transaction_number, transaction_date, account_type, category, description,
      debit_amount, credit_amount, reference_type, reference_id, organization_id, currency, fx_rate, base_currency)
    VALUES (_num || '-' || _n, r.on_date, 'revenue', 'other', 'Revenue re-classed by line of business — ' || r.inv_no,
            greatest(r.posted, 0), greatest(-r.posted, 0), 'invoice', r.inv_id, r.org, r.cur, r.fx, r.base);
    FOR s IN SELECT category, amount FROM public.invoice_revenue_split(r.inv_id) WHERE category <> 'other' AND amount <> 0 LOOP
      _n := _n + 1;
      INSERT INTO accounting_transactions (transaction_number, transaction_date, account_type, category, description,
        debit_amount, credit_amount, reference_type, reference_id, organization_id, currency, fx_rate, base_currency)
      VALUES (_num || '-' || _n, r.on_date, 'revenue', s.category, 'Revenue re-classed by line of business — ' || r.inv_no,
              greatest(-s.amount, 0), greatest(s.amount, 0), 'invoice', r.inv_id, r.org, r.cur, r.fx, r.base);
    END LOOP;
    -- receivable catch-up where the invoice was restated after posting
    IF abs(_split - r.posted) > 0.005 THEN
      _n := _n + 1;
      INSERT INTO accounting_transactions (transaction_number, transaction_date, account_type, category, description,
        debit_amount, credit_amount, reference_type, reference_id, organization_id, currency, fx_rate, base_currency)
      VALUES (_num || '-' || _n, r.on_date, 'asset', 'accounts_receivable',
              'Receivable brought up to the restated invoice — ' || r.inv_no,
              greatest(_split - r.posted, 0), greatest(r.posted - _split, 0), 'invoice', r.inv_id, r.org, r.cur, r.fx, r.base);
    END IF;
  END LOOP;

  -- every invoice still balances and has nothing left for the sync to change
  SELECT count(*) INTO _bad FROM (
    SELECT reference_id FROM accounting_transactions WHERE reference_type = 'invoice'
     GROUP BY reference_id HAVING abs(sum(debit_amount - credit_amount)) > 0.01) x;
  IF _bad > 0 THEN RAISE EXCEPTION 'revenue re-class: % invoices out of balance', _bad; END IF;
  SELECT COALESCE(sum(credit_amount - debit_amount), 0) INTO _left FROM accounting_transactions
   WHERE reference_type = 'invoice' AND category = 'other' AND account_type = 'revenue'
     AND reference_id IN (SELECT i.id FROM invoices i
                           WHERE EXISTS (SELECT 1 FROM public.invoice_revenue_split(i.id) sp WHERE sp.category <> 'other'));
  IF abs(_left) > 0.01 THEN RAISE EXCEPTION 'revenue re-class: % still in Other Income', _left; END IF;
END $$;
