
CREATE OR REPLACE FUNCTION public.post_trip_revenue_to_ledger(_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE _r logistics_trip_revenue%ROWTYPE; _curr text; _label text;
BEGIN
  SELECT * INTO _r FROM logistics_trip_revenue WHERE id = _id;
  IF NOT FOUND OR COALESCE(_r.amount,0) <= 0 THEN RETURN; END IF;
  -- invoiced trips get their revenue from the customer invoice posting
  IF _r.invoice_id IS NOT NULL THEN RETURN; END IF;
  IF EXISTS (SELECT 1 FROM accounting_transactions WHERE reference_type='trip_revenue' AND reference_id=_id) THEN RETURN; END IF;
  _curr := COALESCE(_r.currency, (SELECT currency FROM organizations WHERE id=_r.organization_id), 'USD');
  _label := 'Logistics revenue — trip ' || COALESCE((SELECT ref FROM logistics_trips WHERE id=_r.trip_id), substr(_r.trip_id::text,1,8));

  INSERT INTO accounting_transactions(transaction_number, transaction_date, account_type, category, description,
    debit_amount, credit_amount, reference_type, reference_id, organization_id, currency)
  VALUES ('TRP-AR-'||substr(replace(_id::text,'-',''),1,10), COALESCE(_r.created_at, now()),
    'asset','accounts_receivable', _label, _r.amount, 0, 'trip_revenue', _id, _r.organization_id, _curr);

  INSERT INTO accounting_transactions(transaction_number, transaction_date, account_type, category, description,
    debit_amount, credit_amount, reference_type, reference_id, organization_id, currency)
  VALUES ('TRP-REV-'||substr(replace(_id::text,'-',''),1,10), COALESCE(_r.created_at, now()),
    'revenue','logistics_revenue', _label, 0, _r.amount, 'trip_revenue', _id, _r.organization_id, _curr);
END;
$$;

-- Guard: the Data Health auto-balance may only clear small rounding differences.
CREATE OR REPLACE FUNCTION public.post_currency_balancing_journal(_currency text, _reason text DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _org uuid := current_org_id();
  _diff numeric;
  _id uuid;
BEGIN
  IF _org IS NULL THEN RAISE EXCEPTION 'no_organization'; END IF;
  IF NOT (is_org_admin(_org) OR has_role(auth.uid(),'admin') OR has_role(auth.uid(),'org_owner') OR has_role(auth.uid(),'accountant')) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  SELECT round(COALESCE(sum(debit_amount) - sum(credit_amount),0),2) INTO _diff
    FROM accounting_transactions
   WHERE organization_id = _org AND upper(currency) = upper(_currency);

  IF _diff IS NULL OR abs(_diff) <= 0.01 THEN RETURN NULL; END IF;

  IF abs(_diff) > 1000 THEN
    RAISE EXCEPTION 'difference_too_large: % % is a real posting problem, not a rounding difference. Use the Control Room to find the one-sided documents.', _diff, upper(_currency);
  END IF;

  INSERT INTO accounting_transactions (
    transaction_number, transaction_date, account_type, category, description,
    debit_amount, credit_amount, reference_type, organization_id, currency)
  VALUES ('JRN-BAL-'||to_char(now(),'YYYYMMDD-HH24MISS')||'-'||upper(_currency), now(),
    'expense'::account_type, 'fx_gain_loss',
    COALESCE(NULLIF(_reason,''),'Rounding adjustment')||' ('||upper(_currency)||')',
    CASE WHEN _diff < 0 THEN -_diff ELSE 0 END,
    CASE WHEN _diff > 0 THEN _diff ELSE 0 END,
    'rounding_adjustment', _org, upper(_currency))
  RETURNING id INTO _id;

  RETURN _id;
END;
$$;

REVOKE ALL ON FUNCTION public.post_currency_balancing_journal(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.post_currency_balancing_journal(text, text) TO authenticated;
