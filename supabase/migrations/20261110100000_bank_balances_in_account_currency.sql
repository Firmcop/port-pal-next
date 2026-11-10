-- =====================================================================
-- Bank account balances (finance fix #2, 10 Nov 2026).
-- financial_account_balances added raw debit/credit amounts whatever their
-- currency (a USD 2,500 payment from ABSA KES counted as KES 2,500), and
-- added financial_accounts.opening_balance on top of the opening-balance
-- ledger line, counting the opening twice.
-- Now each line is converted to the account's currency (through the base
-- currency at the line's own rate), and opening_balance is only added when
-- the account has no opening-balance line in the ledger.
-- =====================================================================
CREATE OR REPLACE FUNCTION public.amount_in_account_currency(
  _amount numeric, _line_currency text, _line_fx numeric, _account_currency text, _org uuid, _on date)
RETURNS numeric LANGUAGE sql STABLE SET search_path TO 'public' AS $$
  SELECT CASE
    WHEN upper(coalesce(_line_currency, b.base)) = upper(coalesce(_account_currency, b.base)) THEN _amount
    WHEN upper(coalesce(_account_currency, b.base)) = b.base THEN _amount * coalesce(_line_fx, 1)
    ELSE _amount * coalesce(_line_fx, 1) / NULLIF(get_fx_rate(_org, _account_currency, b.base, _on), 0)
  END
  FROM (SELECT upper(coalesce((SELECT currency FROM organizations WHERE id = _org), 'KES')) AS base) b;
$$;

CREATE OR REPLACE VIEW public.financial_account_balances WITH (security_invoker = true) AS
WITH lines AS (
  SELECT at.financial_account_id,
         public.amount_in_account_currency(at.debit_amount - at.credit_amount, at.currency, at.fx_rate,
                                            fa.currency, fa.organization_id,
                                            (at.transaction_date AT TIME ZONE 'Africa/Nairobi')::date) AS amount,
         at.cleared_at,
         at.reference_type
    FROM accounting_transactions at
    JOIN financial_accounts fa ON fa.id = at.financial_account_id
), agg AS (
  SELECT financial_account_id,
         sum(amount) AS net_movement,
         sum(amount) FILTER (WHERE cleared_at IS NOT NULL) AS cleared_movement,
         bool_or(reference_type = 'opening_balance') AS has_opening_line
    FROM lines GROUP BY financial_account_id
)
SELECT fa.id AS account_id,
       fa.organization_id,
       fa.name,
       fa.account_type,
       fa.currency,
       fa.opening_balance,
       fa.is_active,
       round(coalesce(agg.net_movement, 0), 2) AS net_movement,
       round(CASE WHEN coalesce(agg.has_opening_line, false) THEN 0 ELSE fa.opening_balance END
             + coalesce(agg.net_movement, 0), 2) AS current_balance,
       round(CASE WHEN coalesce(agg.has_opening_line, false) THEN 0 ELSE fa.opening_balance END
             + coalesce(agg.cleared_movement, 0), 2) AS cleared_balance
  FROM financial_accounts fa
  LEFT JOIN agg ON agg.financial_account_id = fa.id;

GRANT SELECT ON public.financial_account_balances TO authenticated;
