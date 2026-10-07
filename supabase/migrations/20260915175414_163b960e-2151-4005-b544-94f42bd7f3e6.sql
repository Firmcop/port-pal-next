-- One-step instalment payment: splits an instalment into principal / interest / penalty
-- portions and posts each through the existing post_loan_transaction pipeline.
CREATE OR REPLACE FUNCTION public.pay_loan_instalment(
  _loan_id uuid,
  _schedule_line_id uuid,
  _txn_date date DEFAULT NULL,
  _total_amount numeric DEFAULT NULL,
  _financial_account_id uuid DEFAULT NULL,
  _external_ref text DEFAULT NULL,
  _description text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  _l public.loan_facilities%ROWTYPE;
  _line public.loan_schedule_lines%ROWTYPE;
  _fa uuid;
  _pay_date date;
  _outstanding numeric;
  _total numeric;
  _ratio numeric;
  _principal numeric;
  _interest numeric;
  _penalty numeric;
  _posted_principal numeric := 0;
  _posted_interest numeric := 0;
  _posted_penalty numeric := 0;
  _txn_ids uuid[] := '{}';
  _id uuid;
  _base text;
BEGIN
  SELECT * INTO _l FROM public.loan_facilities WHERE id = _loan_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'loan_not_found'; END IF;
  IF _l.status IN ('settled','written_off') THEN
    RAISE EXCEPTION 'loan_not_active';
  END IF;

  SELECT * INTO _line FROM public.loan_schedule_lines
   WHERE id = _schedule_line_id AND loan_id = _loan_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'schedule_line_not_found'; END IF;
  IF _line.status = 'cancelled' THEN RAISE EXCEPTION 'instalment_cancelled'; END IF;

  _outstanding := round(_line.total_due - _line.paid_amount, 2);
  IF _outstanding <= 0 THEN RAISE EXCEPTION 'instalment_already_paid'; END IF;

  _total := COALESCE(round(NULLIF(_total_amount, 0), 2), _outstanding);
  IF _total <= 0 THEN RAISE EXCEPTION 'amount_must_be_positive'; END IF;
  -- Never post more than the instalment needs (surplus belongs on other lines).
  _total := LEAST(_total, _outstanding);

  _pay_date := COALESCE(_txn_date, _line.due_date, CURRENT_DATE);
  _fa := COALESCE(_financial_account_id, _l.financial_account_id);

  _ratio := CASE WHEN _line.total_due > 0 THEN _total / _line.total_due ELSE 0 END;
  _principal := round(_line.principal_due * _ratio, 2);
  _interest  := round(_line.interest_due * _ratio, 2);
  _penalty   := round(_total - _principal - _interest, 2);
  IF _penalty < 0 THEN
    -- interest cannot go negative; absorb the shortfall in interest
    _interest := GREATEST(_interest + _penalty, 0);
    _penalty := 0;
  END IF;

  _base := COALESCE(_description, format('Instalment #%s due %s — %s', _line.seq, to_char(_line.due_date, 'DD Mon YYYY'), _l.lender_name));

  IF _principal > 0 THEN
    _id := public.post_loan_transaction(_loan_id, _pay_date, 'principal_payment', _principal,
      _base || ' — principal', _fa, _external_ref, NULL, 'instalment');
    IF _id IS NOT NULL THEN _txn_ids := array_append(_txn_ids, _id); _posted_principal := _principal; END IF;
  END IF;

  IF _interest > 0 THEN
    _id := public.post_loan_transaction(_loan_id, _pay_date, 'interest_payment', _interest,
      _base || ' — interest', _fa, _external_ref, NULL, 'instalment');
    IF _id IS NOT NULL THEN _txn_ids := array_append(_txn_ids, _id); _posted_interest := _interest; END IF;
  END IF;

  IF _penalty > 0 THEN
    _id := public.post_loan_transaction(_loan_id, _pay_date, 'penalty_payment', _penalty,
      _base || ' — penalty', _fa, _external_ref, NULL, 'instalment');
    IF _id IS NOT NULL THEN _txn_ids := array_append(_txn_ids, _id); _posted_penalty := _penalty; END IF;
  END IF;

  IF array_length(_txn_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'nothing_posted';
  END IF;

  RETURN jsonb_build_object(
    'schedule_line_id', _line.id,
    'seq', _line.seq,
    'txn_ids', to_jsonb(_txn_ids),
    'principal', _posted_principal,
    'interest', _posted_interest,
    'penalty', _posted_penalty,
    'total', _posted_principal + _posted_interest + _posted_penalty,
    'currency', COALESCE(_l.currency, (SELECT currency FROM public.organizations WHERE id = _l.organization_id))
  );
END $$;

REVOKE ALL ON FUNCTION public.pay_loan_instalment(uuid, uuid, date, numeric, uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pay_loan_instalment(uuid, uuid, date, numeric, uuid, text, text) TO authenticated;