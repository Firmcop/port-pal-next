
ALTER TABLE public.contra_settlements
  ADD COLUMN IF NOT EXISTS settlement_account_id uuid REFERENCES public.financial_accounts(id),
  ADD COLUMN IF NOT EXISTS cash_amount numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cash_fx_rate numeric,
  ADD COLUMN IF NOT EXISTS cash_payment_id uuid,
  ADD COLUMN IF NOT EXISTS bank_charge_amount numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS bank_charge_expense_id uuid;

ALTER TABLE public.vendor_payments
  ADD COLUMN IF NOT EXISTS bank_charge_amount numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS bank_charge_expense_id uuid;

-- Bank charges GL account + expense category
CREATE OR REPLACE FUNCTION public.ensure_bank_charges_category(_org uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE _gl uuid; _cat uuid;
BEGIN
  SELECT id INTO _gl FROM public.gl_accounts
   WHERE organization_id = _org AND (code = '6700' OR system_code = 'bank_charges')
   LIMIT 1;
  IF _gl IS NULL THEN
    INSERT INTO public.gl_accounts(organization_id, code, name, account_type, is_system, system_code)
    VALUES (_org, '6700', 'Bank Charges', 'expense', true, 'bank_charges')
    RETURNING id INTO _gl;
  END IF;

  SELECT id INTO _cat FROM public.expense_categories
   WHERE organization_id = _org AND (code = 'bank_charges' OR lower(name) = 'bank charges')
   LIMIT 1;
  IF _cat IS NULL THEN
    INSERT INTO public.expense_categories(organization_id, code, name, gl_account_id, sort_order)
    VALUES (_org, 'bank_charges', 'Bank Charges', _gl, 90)
    RETURNING id INTO _cat;
  END IF;

  RETURN _gl;
END;
$$;

-- Posts a paid operating expense for a bank charge; returns the expense id
CREATE OR REPLACE FUNCTION public.post_bank_charge_expense(
  _account_id uuid,
  _amount numeric,
  _date date,
  _reference text DEFAULT NULL,
  _note text DEFAULT NULL,
  _currency text DEFAULT NULL,
  _fx_rate numeric DEFAULT NULL,
  _supplier_id uuid DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _org uuid := public.current_org_id();
  _gl uuid;
  _cat uuid;
  _cur text;
  _eid uuid;
BEGIN
  IF _org IS NULL THEN RAISE EXCEPTION 'No organization context'; END IF;
  IF COALESCE(_amount,0) <= 0 THEN RETURN NULL; END IF;
  IF _account_id IS NULL THEN RAISE EXCEPTION 'financial_account_required_for_bank_charge'; END IF;

  _gl := public.ensure_bank_charges_category(_org);
  SELECT id INTO _cat FROM public.expense_categories
   WHERE organization_id = _org AND (code = 'bank_charges' OR lower(name) = 'bank charges') LIMIT 1;

  _cur := upper(btrim(COALESCE(NULLIF(_currency,''),
            (SELECT currency FROM public.financial_accounts WHERE id = _account_id),
            (SELECT currency FROM public.organizations WHERE id = _org))));

  _eid := public.post_operating_expense(
    _expense_date := COALESCE(_date, CURRENT_DATE),
    _payment_mode := 'paid',
    _lines := jsonb_build_array(jsonb_build_object(
                'gl_account_id', _gl,
                'category_id', _cat,
                'description', COALESCE(NULLIF(_note,''), 'Bank charges' ||
                                COALESCE(' — ' || NULLIF(_reference,''), '')),
                'amount', _amount,
                'tax_amount', 0)),
    _supplier_id := NULL,
    _payee := 'Bank charges',
    _financial_account_id := _account_id,
    _due_date := NULL,
    _currency := _cur,
    _fx_rate := _fx_rate,
    _depot_id := NULL,
    _project_id := NULL,
    _reference := _reference,
    _notes := _note,
    _attachment_url := NULL,
    _submit := true
  );

  RETURN _eid;
END;
$$;

REVOKE ALL ON FUNCTION public.post_bank_charge_expense(uuid, numeric, date, text, text, text, numeric, uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.post_bank_charge_expense(uuid, numeric, date, text, text, text, numeric, uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.ensure_bank_charges_category(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.ensure_bank_charges_category(uuid) TO authenticated;

-- Vendor payment against a PO, with declared FX rate and optional bank charge
CREATE OR REPLACE FUNCTION public.record_vendor_payment(
  _po_id uuid,
  _amount numeric,
  _account_id uuid,
  _method payment_method,
  _reference text,
  _paid_at timestamp with time zone,
  _notes text,
  _currency text DEFAULT NULL,
  _fx_rate numeric DEFAULT NULL,
  _bank_charge numeric DEFAULT 0,
  _bank_charge_note text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE _po purchase_orders%ROWTYPE; _pid uuid; _num text; _paid numeric; _cur text;
        _acct_cur text; _charge_expense uuid;
BEGIN
  IF _amount IS NULL OR _amount <= 0 THEN RAISE EXCEPTION 'invalid_amount'; END IF;
  IF _account_id IS NULL THEN RAISE EXCEPTION 'financial_account_required'; END IF;
  SELECT * INTO _po FROM purchase_orders WHERE id = _po_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'po_not_found'; END IF;

  _cur := NULLIF(btrim(COALESCE(_currency, _po.currency, '')), '');
  SELECT upper(currency) INTO _acct_cur FROM public.financial_accounts WHERE id = _account_id;
  IF _acct_cur IS NOT NULL AND _cur IS NOT NULL AND upper(_cur) <> _acct_cur
     AND COALESCE(_fx_rate,0) <= 0 THEN
    RAISE EXCEPTION 'fx_rate_required';
  END IF;

  _num := 'VPAY-'||to_char(now(),'YYYYMMDD')||'-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,6));
  INSERT INTO public.vendor_payments(
    payment_number, po_id, supplier_id, amount, payment_method, reference_number,
    paid_at, notes, recorded_by, organization_id, financial_account_id, conversion_id,
    currency, fx_rate, bank_charge_amount
  ) VALUES (
    _num,_po_id,_po.supplier_id,_amount,_method,_reference,COALESCE(_paid_at,now()),_notes,
    auth.uid(),_po.organization_id,_account_id,_po.conversion_id,
    _cur, _fx_rate, COALESCE(_bank_charge,0)
  )
  RETURNING id INTO _pid;

  IF COALESCE(_bank_charge,0) > 0 THEN
    _charge_expense := public.post_bank_charge_expense(
      _account_id, _bank_charge, COALESCE(_paid_at, now())::date, _num,
      COALESCE(_bank_charge_note, 'Bank charges on supplier payment ' || _num), NULL, NULL, _po.supplier_id);
    UPDATE public.vendor_payments SET bank_charge_expense_id = _charge_expense WHERE id = _pid;
  END IF;

  SELECT COALESCE(sum(amount),0) INTO _paid FROM vendor_payments WHERE po_id = _po_id;
  IF _paid >= COALESCE(_po.total_cost,0) AND COALESCE(_po.total_cost,0) > 0 THEN
    UPDATE purchase_orders SET status='paid' WHERE id=_po_id AND status<>'paid';
  END IF;
  RETURN _pid;
END;
$$;

REVOKE ALL ON FUNCTION public.record_vendor_payment(uuid, numeric, uuid, payment_method, text, timestamptz, text, text, numeric, numeric, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.record_vendor_payment(uuid, numeric, uuid, payment_method, text, timestamptz, text, text, numeric, numeric, text) TO authenticated;

-- On-account supplier payment with declared FX rate and optional bank charge
CREATE OR REPLACE FUNCTION public.record_supplier_onaccount_payment(
  _supplier_id uuid,
  _amount numeric,
  _account_id uuid,
  _method payment_method,
  _reference text,
  _paid_at timestamp with time zone,
  _notes text,
  _currency text DEFAULT NULL,
  _fx_rate numeric DEFAULT NULL,
  _allocations jsonb DEFAULT NULL,
  _bank_charge numeric DEFAULT 0,
  _bank_charge_note text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _org uuid := public.current_org_id();
  _cur text;
  _acct_cur text;
  _pid uuid;
  _num text;
  _line jsonb;
  _due numeric;
  _sum numeric := 0;
  _allocated numeric := 0;
  _charge_expense uuid;
BEGIN
  IF _org IS NULL THEN RAISE EXCEPTION 'No organization context'; END IF;
  IF _amount IS NULL OR _amount <= 0 THEN RAISE EXCEPTION 'invalid_amount'; END IF;
  IF _account_id IS NULL THEN RAISE EXCEPTION 'financial_account_required'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.suppliers WHERE id = _supplier_id AND organization_id = _org) THEN
    RAISE EXCEPTION 'supplier_not_found';
  END IF;

  _cur := upper(btrim(COALESCE(NULLIF(_currency,''),
            (SELECT currency FROM public.suppliers WHERE id = _supplier_id),
            (SELECT currency FROM public.organizations WHERE id = _org))));

  SELECT upper(currency) INTO _acct_cur FROM public.financial_accounts WHERE id = _account_id;
  IF _acct_cur IS NOT NULL AND _acct_cur <> _cur AND COALESCE(_fx_rate,0) <= 0 THEN
    RAISE EXCEPTION 'fx_rate_required';
  END IF;

  IF _allocations IS NOT NULL AND jsonb_typeof(_allocations) = 'array' THEN
    FOR _line IN SELECT * FROM jsonb_array_elements(_allocations) LOOP
      SELECT GREATEST(si.total_amount - COALESCE(si.paid_amount,0), 0) INTO _due
        FROM public.supplier_invoices si
       WHERE si.id = (_line->>'supplier_invoice_id')::uuid
         AND si.organization_id = _org
         AND si.supplier_id = _supplier_id;
      IF _due IS NULL THEN RAISE EXCEPTION 'allocation_invoice_not_found'; END IF;
      IF COALESCE((_line->>'amount')::numeric,0) > _due + 0.01 THEN
        RAISE EXCEPTION 'allocation_exceeds_invoice_balance';
      END IF;
      _sum := _sum + COALESCE((_line->>'amount')::numeric,0);
    END LOOP;
    IF _sum > _amount + 0.01 THEN RAISE EXCEPTION 'allocation_exceeds_payment'; END IF;
  END IF;

  _num := 'VPAY-'||to_char(now(),'YYYYMMDD')||'-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,6));

  IF _allocations IS NOT NULL THEN
    PERFORM set_config('cdms.skip_auto_allocate', 'on', true);
  END IF;

  INSERT INTO public.vendor_payments(
    payment_number, po_id, supplier_id, amount, payment_method, reference_number,
    paid_at, notes, recorded_by, organization_id, financial_account_id,
    currency, fx_rate, bank_charge_amount
  ) VALUES (
    _num, NULL, _supplier_id, _amount, _method, _reference,
    COALESCE(_paid_at, now()), _notes, auth.uid(), _org, _account_id,
    _cur, _fx_rate, COALESCE(_bank_charge,0)
  ) RETURNING id INTO _pid;

  PERFORM set_config('cdms.skip_auto_allocate', 'off', true);

  IF _allocations IS NOT NULL AND jsonb_typeof(_allocations) = 'array' THEN
    FOR _line IN SELECT * FROM jsonb_array_elements(_allocations) LOOP
      IF COALESCE((_line->>'amount')::numeric,0) > 0 THEN
        INSERT INTO public.vendor_payment_allocations
          (organization_id, payment_id, supplier_invoice_id, amount, method, rule_applied, fx_rate, created_by, note)
        VALUES (_org, _pid, (_line->>'supplier_invoice_id')::uuid,
                (_line->>'amount')::numeric, 'manual', 'manual_split', _fx_rate, auth.uid(),
                NULLIF(_line->>'note',''));
        _allocated := _allocated + (_line->>'amount')::numeric;
      END IF;
    END LOOP;
  ELSE
    SELECT COALESCE(sum(amount),0) INTO _allocated
      FROM public.vendor_payment_allocations WHERE payment_id = _pid;
  END IF;

  IF COALESCE(_bank_charge,0) > 0 THEN
    _charge_expense := public.post_bank_charge_expense(
      _account_id, _bank_charge, COALESCE(_paid_at, now())::date, _num,
      COALESCE(_bank_charge_note, 'Bank charges on supplier payment ' || _num), NULL, NULL, _supplier_id);
    UPDATE public.vendor_payments SET bank_charge_expense_id = _charge_expense WHERE id = _pid;
  END IF;

  INSERT INTO public.finance_audit_log(organization_id, actor_user_id, entity_type, entity_id, entity_ref, action, summary)
  VALUES (_org, auth.uid(), 'vendor_payment', _pid, _num, 'onaccount_payment_recorded',
          jsonb_build_object('supplier_id', _supplier_id, 'amount', _amount, 'currency', _cur,
                             'allocated', _allocated, 'unallocated', _amount - _allocated,
                             'fx_rate', _fx_rate, 'bank_charge', COALESCE(_bank_charge,0),
                             'mode', CASE WHEN _allocations IS NULL THEN 'auto_fifo' ELSE 'manual_split' END));

  RETURN jsonb_build_object('payment_id', _pid, 'payment_number', _num, 'currency', _cur,
                            'amount', _amount, 'allocated', _allocated,
                            'unallocated', _amount - _allocated,
                            'bank_charge_expense_id', _charge_expense);
END;
$$;

REVOKE ALL ON FUNCTION public.record_supplier_onaccount_payment(uuid, numeric, uuid, payment_method, text, timestamptz, text, text, numeric, jsonb, numeric, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.record_supplier_onaccount_payment(uuid, numeric, uuid, payment_method, text, timestamptz, text, text, numeric, jsonb, numeric, text) TO authenticated;
