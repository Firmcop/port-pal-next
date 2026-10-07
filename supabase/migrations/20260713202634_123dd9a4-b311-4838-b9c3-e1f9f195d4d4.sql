
-- ============================================================
-- 1. Payments.currency (inherited from invoice via trigger)
-- ============================================================
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS currency text;

CREATE OR REPLACE FUNCTION public.set_payment_currency_from_invoice()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.currency IS NULL AND NEW.invoice_id IS NOT NULL THEN
    SELECT currency INTO NEW.currency FROM public.invoices WHERE id = NEW.invoice_id;
  END IF;
  IF NEW.currency IS NULL THEN
    SELECT COALESCE(currency, 'USD') INTO NEW.currency
      FROM public.organizations WHERE id = NEW.organization_id;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.set_payment_currency_from_invoice() FROM PUBLIC, anon;

DROP TRIGGER IF EXISTS trg_set_payment_currency ON public.payments;
CREATE TRIGGER trg_set_payment_currency
BEFORE INSERT OR UPDATE ON public.payments
FOR EACH ROW EXECUTE FUNCTION public.set_payment_currency_from_invoice();

-- ============================================================
-- 2. Category → GL account mapping helper + auto-linking trigger
-- ============================================================
CREATE OR REPLACE FUNCTION public.category_to_gl_code(_category text, _account_type account_type)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE _category
    WHEN 'container_sale'               THEN '4030'
    WHEN 'container_sale_cogs'          THEN '5000'
    WHEN 'accounts_receivable'          THEN '1100'
    WHEN 'accounts_payable'             THEN '2000'
    WHEN 'container_acquisition_payable' THEN '2010'
    WHEN 'cash'                         THEN '1000'
    WHEN 'inventory'                    THEN '1200'
    WHEN 'gate_fee'                     THEN '4010'
    WHEN 'storage'                      THEN '4000'
    WHEN 'handling'                     THEN '4010'
    WHEN 'repair_revenue'               THEN '4020'
    WHEN 'conversion_revenue'           THEN '4040'
    WHEN 'lease_revenue'                THEN '4050'
    WHEN 'logistics_revenue'            THEN '4060'
    WHEN 'fuel'                         THEN '6400'
    WHEN 'tolls'                        THEN '6400'
    WHEN 'loading'                      THEN '6400'
    WHEN 'permits'                      THEN '6400'
    WHEN 'truck_hire'                   THEN '6400'
    WHEN 'driver_allowance'             THEN '6400'
    WHEN 'repairs'                      THEN '6500'
    WHEN 'payroll'                      THEN '6000'
    WHEN 'payroll_payment'              THEN '2300'
    WHEN 'input_tax'                    THEN '2210'
    WHEN 'output_tax'                   THEN '2200'
    WHEN 'rent'                         THEN '6100'
    WHEN 'utilities'                    THEN '6200'
    WHEN 'office'                       THEN '6300'
    WHEN 'bank_charges'                 THEN '6700'
    WHEN 'fx_gain_loss'                 THEN '6800'
    WHEN 'other'                        THEN CASE _account_type::text
                                              WHEN 'revenue' THEN '4900'
                                              WHEN 'expense' THEN '6900'
                                              WHEN 'cost_of_goods' THEN '5000'
                                              ELSE NULL END
    ELSE NULL
  END;
$$;
REVOKE ALL ON FUNCTION public.category_to_gl_code(text, account_type) FROM PUBLIC, anon;

CREATE OR REPLACE FUNCTION public.set_gl_account_from_category()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _code text;
BEGIN
  IF NEW.gl_account_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  _code := public.category_to_gl_code(NEW.category, NEW.account_type);
  IF _code IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT id INTO NEW.gl_account_id
    FROM public.gl_accounts
   WHERE organization_id = NEW.organization_id
     AND code = _code
   LIMIT 1;

  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.set_gl_account_from_category() FROM PUBLIC, anon;

DROP TRIGGER IF EXISTS trg_set_gl_account_from_category ON public.accounting_transactions;
CREATE TRIGGER trg_set_gl_account_from_category
BEFORE INSERT OR UPDATE ON public.accounting_transactions
FOR EACH ROW EXECUTE FUNCTION public.set_gl_account_from_category();

-- ============================================================
-- 3. FX helper: convert an amount to the org's base currency
-- ============================================================
CREATE OR REPLACE FUNCTION public.convert_to_base(
  _amount numeric,
  _from_ccy text,
  _org_id uuid,
  _as_of date DEFAULT CURRENT_DATE
) RETURNS numeric
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  _base text;
  _rate numeric;
BEGIN
  IF _amount IS NULL THEN RETURN 0; END IF;
  SELECT COALESCE(currency, 'USD') INTO _base FROM public.organizations WHERE id = _org_id;
  IF _from_ccy IS NULL OR _from_ccy = _base THEN
    RETURN _amount;
  END IF;

  SELECT rate INTO _rate
    FROM public.fx_rates
   WHERE organization_id = _org_id
     AND currency_from = _from_ccy
     AND currency_to = _base
     AND as_of_date <= _as_of
   ORDER BY as_of_date DESC
   LIMIT 1;

  IF _rate IS NULL THEN
    -- Try reverse pair
    SELECT 1.0 / rate INTO _rate
      FROM public.fx_rates
     WHERE organization_id = _org_id
       AND currency_from = _base
       AND currency_to = _from_ccy
       AND as_of_date <= _as_of
     ORDER BY as_of_date DESC
     LIMIT 1;
  END IF;

  RETURN _amount * COALESCE(_rate, 1.0);
END;
$$;
REVOKE ALL ON FUNCTION public.convert_to_base(numeric, text, uuid, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.convert_to_base(numeric, text, uuid, date) TO authenticated;

-- ============================================================
-- 4. Rewrite finance_dashboard_metrics with base-currency totals
-- ============================================================
DROP VIEW IF EXISTS public.finance_dashboard_metrics CASCADE;

CREATE VIEW public.finance_dashboard_metrics
WITH (security_invoker = true) AS
WITH cash AS (
  SELECT fa.organization_id,
         fa.currency,
         (COALESCE(SUM(fa.opening_balance), 0::numeric)
          + COALESCE(SUM(at.debit_amount - at.credit_amount)
                     FILTER (WHERE at.id IS NOT NULL), 0::numeric)) AS amount
    FROM financial_accounts fa
    LEFT JOIN accounting_transactions at ON at.financial_account_id = fa.id
   WHERE fa.is_active
     AND fa.account_type = ANY (ARRAY['bank'::financial_account_type,'cash'::financial_account_type,'mobile_money'::financial_account_type])
   GROUP BY fa.organization_id, fa.currency
), ar AS (
  SELECT i.organization_id,
         i.currency,
         COALESCE(SUM(i.total_amount - COALESCE(
           (SELECT SUM(p.amount) FROM payments p WHERE p.invoice_id = i.id), 0::numeric)), 0::numeric) AS amount
    FROM invoices i
   WHERE i.status = ANY (ARRAY['draft'::invoice_status,'sent'::invoice_status,'overdue'::invoice_status])
     AND i.voided_at IS NULL
   GROUP BY i.organization_id, i.currency
), mtd AS (
  SELECT at.organization_id,
         at.currency,
         COALESCE(SUM(at.credit_amount) FILTER (WHERE at.account_type = 'revenue'::account_type), 0::numeric) AS revenue,
         COALESCE(SUM(at.debit_amount)  FILTER (WHERE at.account_type = 'expense'::account_type), 0::numeric) AS expense,
         COALESCE(SUM(at.debit_amount)  FILTER (WHERE at.account_type = 'cost_of_goods'::account_type), 0::numeric) AS cogs,
         COALESCE(SUM(at.debit_amount)  FILTER (WHERE at.account_type = 'asset'::account_type AND at.category = 'input_tax'), 0::numeric) AS input_vat
    FROM accounting_transactions at
   WHERE at.transaction_date >= date_trunc('month', now())
   GROUP BY at.organization_id, at.currency
), recon AS (
  SELECT br.organization_id,
         COUNT(*) FILTER (WHERE br.status = 'in_progress'::bank_reconciliation_status) AS in_progress_count,
         COUNT(*) FILTER (WHERE br.status = 'completed'::bank_reconciliation_status) AS completed_count,
         COUNT(*) FILTER (WHERE br.status = 'completed'::bank_reconciliation_status AND br.completed_at >= now() - interval '30 days') AS recent_completed
    FROM bank_reconciliations br
   GROUP BY br.organization_id
)
SELECT o.id AS organization_id,
       COALESCE(o.currency, 'USD') AS base_currency,
       -- per-currency breakdowns (kept for UI chips)
       COALESCE((SELECT json_agg(json_build_object('currency', c.currency, 'amount', c.amount))
                   FROM cash c WHERE c.organization_id = o.id), '[]'::json) AS cash_on_hand,
       COALESCE((SELECT json_agg(json_build_object('currency', a.currency, 'amount', a.amount))
                   FROM ar a WHERE a.organization_id = o.id), '[]'::json) AS receivables,
       -- base-currency totals (FX-normalized)
       COALESCE((SELECT SUM(public.convert_to_base(c.amount, c.currency, o.id)) FROM cash c WHERE c.organization_id = o.id), 0::numeric) AS cash_total,
       COALESCE((SELECT SUM(public.convert_to_base(a.amount, a.currency, o.id)) FROM ar a WHERE a.organization_id = o.id), 0::numeric) AS receivables_total,
       COALESCE((SELECT SUM(public.convert_to_base(m.revenue, m.currency, o.id)) FROM mtd m WHERE m.organization_id = o.id), 0::numeric) AS mtd_revenue,
       COALESCE((SELECT SUM(public.convert_to_base(m.expense, m.currency, o.id)) FROM mtd m WHERE m.organization_id = o.id), 0::numeric) AS mtd_expense,
       COALESCE((SELECT SUM(public.convert_to_base(m.cogs,    m.currency, o.id)) FROM mtd m WHERE m.organization_id = o.id), 0::numeric) AS mtd_cogs,
       COALESCE((SELECT SUM(public.convert_to_base(m.revenue - m.expense - m.cogs, m.currency, o.id)) FROM mtd m WHERE m.organization_id = o.id), 0::numeric) AS mtd_net,
       COALESCE((SELECT SUM(public.convert_to_base(m.input_vat, m.currency, o.id)) FROM mtd m WHERE m.organization_id = o.id), 0::numeric) AS mtd_input_vat,
       COALESCE((SELECT r.in_progress_count FROM recon r WHERE r.organization_id = o.id), 0::bigint) AS recon_in_progress,
       COALESCE((SELECT r.completed_count   FROM recon r WHERE r.organization_id = o.id), 0::bigint) AS recon_completed,
       COALESCE((SELECT r.recent_completed  FROM recon r WHERE r.organization_id = o.id), 0::bigint) AS recon_recent
  FROM organizations o;

GRANT SELECT ON public.finance_dashboard_metrics TO authenticated;

-- ============================================================
-- 5. Finance data-health view (integrity findings per org)
-- ============================================================
CREATE OR REPLACE VIEW public.v_finance_data_health
WITH (security_invoker = true) AS
SELECT organization_id, finding_code, severity, count, detail FROM (
  SELECT organization_id,
         'orphan_gl_account'::text AS finding_code,
         'high'::text AS severity,
         COUNT(*) AS count,
         'Ledger entries not linked to a Chart of Accounts row.'::text AS detail
    FROM public.accounting_transactions
   WHERE gl_account_id IS NULL
   GROUP BY organization_id
  UNION ALL
  SELECT organization_id, 'null_currency', 'medium', COUNT(*),
         'Ledger entries with missing currency code.'
    FROM public.accounting_transactions
   WHERE currency IS NULL
   GROUP BY organization_id
  UNION ALL
  SELECT organization_id, 'unbalanced_currency_ledger', 'high', COUNT(*),
         'Currency buckets whose debit and credit totals do not match.'
    FROM (
      SELECT organization_id, currency,
             SUM(debit_amount) - SUM(credit_amount) AS diff
        FROM public.accounting_transactions
       WHERE currency IS NOT NULL
       GROUP BY organization_id, currency
      HAVING ABS(SUM(debit_amount) - SUM(credit_amount)) > 0.01
    ) x
   GROUP BY organization_id
  UNION ALL
  SELECT organization_id, 'unbilled_container_sale', 'medium', COUNT(*),
         'Container sales in listed/sold state without a linked invoice.'
    FROM public.container_sales
   WHERE invoice_id IS NULL AND status IN ('listed','sold')
   GROUP BY organization_id
  UNION ALL
  SELECT organization_id, 'payment_missing_currency', 'low', COUNT(*),
         'Payments recorded without a currency (should inherit from invoice).'
    FROM public.payments
   WHERE currency IS NULL
   GROUP BY organization_id
) s
WHERE count > 0;

GRANT SELECT ON public.v_finance_data_health TO authenticated;

-- ============================================================
-- 6. Admin RPC: post a balancing journal to fix currency drift
-- ============================================================
CREATE OR REPLACE FUNCTION public.post_currency_balancing_journal(
  _currency text,
  _reason text DEFAULT 'Ledger reconciliation'
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _org uuid := current_org_id();
  _diff numeric;
  _fx_acct uuid;
  _txn_id uuid;
BEGIN
  IF NOT (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'accountant'::app_role) OR is_platform_admin()) THEN
    RAISE EXCEPTION 'permission denied';
  END IF;

  SELECT SUM(debit_amount) - SUM(credit_amount) INTO _diff
    FROM public.accounting_transactions
   WHERE organization_id = _org AND currency = _currency;

  IF _diff IS NULL OR ABS(_diff) < 0.01 THEN
    RAISE EXCEPTION 'ledger for % is already balanced', _currency;
  END IF;

  SELECT id INTO _fx_acct FROM public.gl_accounts
   WHERE organization_id = _org AND code = '6800' LIMIT 1;

  INSERT INTO public.accounting_transactions(
    transaction_number, transaction_date, account_type, category, description,
    debit_amount, credit_amount, organization_id, gl_account_id, currency
  ) VALUES (
    'JRN-BAL-'||to_char(now(),'YYYYMMDD-HH24MISS')||'-'||_currency,
    now(), 'expense'::account_type, 'fx_gain_loss',
    _reason || ' (' || _currency || ')',
    CASE WHEN _diff < 0 THEN ABS(_diff) ELSE 0 END,
    CASE WHEN _diff > 0 THEN _diff ELSE 0 END,
    _org, _fx_acct, _currency
  ) RETURNING id INTO _txn_id;

  RETURN _txn_id;
END;
$$;
REVOKE ALL ON FUNCTION public.post_currency_balancing_journal(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.post_currency_balancing_journal(text, text) TO authenticated;

-- ============================================================
-- 7. RPC: bill any listed container sales that have no invoice
-- ============================================================
CREATE OR REPLACE FUNCTION public.bill_unbilled_container_sales()
RETURNS TABLE(sale_id uuid, invoice_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _org uuid := current_org_id();
  _sale RECORD;
  _inv_id uuid;
  _num text;
BEGIN
  IF NOT (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'accountant'::app_role) OR is_platform_admin()) THEN
    RAISE EXCEPTION 'permission denied';
  END IF;

  FOR _sale IN
    SELECT cs.* FROM public.container_sales cs
     WHERE cs.organization_id = _org
       AND cs.invoice_id IS NULL
       AND cs.status IN ('listed','sold')
  LOOP
    _num := 'INV-CS-'||to_char(now(),'YYYYMMDD')||'-'||substr(_sale.id::text,1,8);
    INSERT INTO public.invoices(
      invoice_number, customer_id, invoice_date, due_date,
      subtotal, tax_amount, total_amount, status, currency, organization_id, notes
    ) VALUES (
      _num, _sale.customer_id, COALESCE(_sale.sale_date, CURRENT_DATE),
      COALESCE(_sale.sale_date, CURRENT_DATE) + 30,
      COALESCE(_sale.sale_price, 0), 0, COALESCE(_sale.sale_price, 0),
      'sent'::invoice_status, COALESCE(_sale.currency, 'USD'), _org,
      'Auto-generated for container sale '||_sale.id
    ) RETURNING id INTO _inv_id;

    UPDATE public.container_sales SET invoice_id = _inv_id WHERE id = _sale.id;
    sale_id := _sale.id; invoice_id := _inv_id;
    RETURN NEXT;
  END LOOP;
END;
$$;
REVOKE ALL ON FUNCTION public.bill_unbilled_container_sales() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bill_unbilled_container_sales() TO authenticated;
