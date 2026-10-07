
ALTER TABLE public.contra_settlements DROP CONSTRAINT IF EXISTS contra_settlements_status_check;
ALTER TABLE public.contra_settlements ADD CONSTRAINT contra_settlements_status_check
  CHECK (status = ANY (ARRAY['draft','pending_approval','rejected','posted','reversed']));

CREATE TABLE IF NOT EXISTS public.payment_allocation_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  payment_id uuid NOT NULL REFERENCES public.vendor_payments(id) ON DELETE CASCADE,
  supplier_id uuid NOT NULL REFERENCES public.suppliers(id) ON DELETE RESTRICT,
  currency text,
  amount numeric NOT NULL,
  proposal jsonb NOT NULL DEFAULT '[]'::jsonb,
  requested_allocations jsonb NOT NULL DEFAULT '[]'::jsonb,
  deviates_from_proposal boolean NOT NULL DEFAULT false,
  reason text,
  status text NOT NULL DEFAULT 'pending',
  approval_request_id uuid,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  decided_by uuid,
  decided_at timestamptz,
  decision_note text,
  CONSTRAINT payment_allocation_requests_status_chk CHECK (status IN ('pending','approved','rejected','cancelled'))
);

CREATE INDEX IF NOT EXISTS payment_allocation_requests_org_status_idx
  ON public.payment_allocation_requests(organization_id, status);

GRANT SELECT, INSERT, UPDATE ON public.payment_allocation_requests TO authenticated;
GRANT ALL ON public.payment_allocation_requests TO service_role;
ALTER TABLE public.payment_allocation_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "org finance reads allocation requests" ON public.payment_allocation_requests;
CREATE POLICY "org finance reads allocation requests" ON public.payment_allocation_requests
  FOR SELECT TO authenticated
  USING (organization_id = public.current_org_id() OR public.is_platform_admin());

DROP POLICY IF EXISTS "finance staff manage allocation requests" ON public.payment_allocation_requests;
CREATE POLICY "finance staff manage allocation requests" ON public.payment_allocation_requests
  FOR ALL TO authenticated
  USING (organization_id = public.current_org_id()
         AND (has_role(auth.uid(),'admin') OR has_role(auth.uid(),'org_owner')
              OR has_role(auth.uid(),'accountant') OR public.is_platform_admin()))
  WITH CHECK (organization_id = public.current_org_id()
         AND (has_role(auth.uid(),'admin') OR has_role(auth.uid(),'org_owner')
              OR has_role(auth.uid(),'accountant') OR public.is_platform_admin()));

-- Threshold for allocation approvals (0 / missing = never require approval)
CREATE OR REPLACE FUNCTION public.allocation_approval_threshold(_org uuid)
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(min_amount, 0) FROM public.approval_policies
   WHERE organization_id = _org AND document_type = 'payment_allocation' AND enabled = true
   LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.allocation_approval_threshold(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.allocation_approval_threshold(uuid) TO authenticated;

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
  _bank_charge_note text DEFAULT NULL,
  _skip_approval boolean DEFAULT false
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
  _proposal jsonb;
  _desired jsonb := '[]'::jsonb;
  _deviates boolean := false;
  _threshold numeric;
  _needs_approval boolean := false;
  _areq uuid;
  _req uuid;
  _mgr uuid;
  _prop numeric;
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

  -- FIFO proposal used both as the default split and as the approval baseline
  _proposal := public.preview_supplier_payment_allocation(_supplier_id, _amount, _cur);

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

      SELECT COALESCE((p->>'proposed')::numeric,0) INTO _prop
        FROM jsonb_array_elements(_proposal->'lines') p
       WHERE p->>'supplier_invoice_id' = _line->>'supplier_invoice_id';
      IF abs(COALESCE(_prop,0) - COALESCE((_line->>'amount')::numeric,0)) > 0.01 THEN
        _deviates := true;
      END IF;
    END LOOP;
    IF _sum > _amount + 0.01 THEN RAISE EXCEPTION 'allocation_exceeds_payment'; END IF;

    -- proposal lines dropped entirely also count as a deviation
    IF NOT _deviates AND EXISTS (
      SELECT 1 FROM jsonb_array_elements(_proposal->'lines') p
       WHERE COALESCE((p->>'proposed')::numeric,0) > 0.01
         AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(_allocations) a
                          WHERE a->>'supplier_invoice_id' = p->>'supplier_invoice_id')
    ) THEN _deviates := true; END IF;

    _desired := _allocations;
  ELSE
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
             'supplier_invoice_id', p->>'supplier_invoice_id',
             'invoice_number', p->>'invoice_number',
             'amount', (p->>'proposed')::numeric)), '[]'::jsonb)
      INTO _desired
      FROM jsonb_array_elements(_proposal->'lines') p
     WHERE COALESCE((p->>'proposed')::numeric,0) > 0.005;
  END IF;

  _threshold := COALESCE(public.allocation_approval_threshold(_org), 0);
  _needs_approval := NOT COALESCE(_skip_approval,false)
                     AND jsonb_array_length(_desired) > 0
                     AND (_deviates OR (_threshold > 0 AND _amount > _threshold))
                     AND NOT (has_role(auth.uid(),'admin') OR public.is_platform_admin());

  _num := 'VPAY-'||to_char(now(),'YYYYMMDD')||'-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,6));

  PERFORM set_config('cdms.skip_auto_allocate', 'on', true);

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

  IF _needs_approval THEN
    INSERT INTO public.payment_allocation_requests(organization_id, payment_id, supplier_id, currency,
      amount, proposal, requested_allocations, deviates_from_proposal, reason, created_by)
    VALUES (_org, _pid, _supplier_id, _cur, _amount, COALESCE(_proposal->'lines','[]'::jsonb),
            _desired, _deviates,
            CASE WHEN _deviates THEN 'Manual split deviates from the oldest-first proposal'
                 ELSE 'Payment above the allocation approval threshold' END,
            auth.uid())
    RETURNING id INTO _areq;

    SELECT manager_id INTO _mgr FROM public.profiles WHERE id = auth.uid();
    INSERT INTO public.approval_requests(organization_id, doc_type, doc_id, status, requested_by, amount, assigned_to)
    VALUES (_org, 'payment_allocation', _areq, 'pending', auth.uid(), _amount, _mgr)
    RETURNING id INTO _req;
    UPDATE public.payment_allocation_requests SET approval_request_id = _req WHERE id = _areq;
  ELSE
    FOR _line IN SELECT * FROM jsonb_array_elements(_desired) LOOP
      IF COALESCE((_line->>'amount')::numeric,0) > 0 THEN
        INSERT INTO public.vendor_payment_allocations
          (organization_id, payment_id, supplier_invoice_id, amount, method, rule_applied, fx_rate, created_by, note)
        VALUES (_org, _pid, (_line->>'supplier_invoice_id')::uuid,
                (_line->>'amount')::numeric, 'manual',
                CASE WHEN _allocations IS NULL THEN 'auto_fifo' ELSE 'manual_split' END,
                _fx_rate, auth.uid(), NULLIF(_line->>'note',''));
        _allocated := _allocated + (_line->>'amount')::numeric;
      END IF;
    END LOOP;
  END IF;

  IF COALESCE(_bank_charge,0) > 0 THEN
    _charge_expense := public.post_bank_charge_expense(
      _account_id, _bank_charge, COALESCE(_paid_at, now())::date, _num,
      COALESCE(_bank_charge_note, 'Bank charges on supplier payment ' || _num), NULL, NULL, _supplier_id);
    UPDATE public.vendor_payments SET bank_charge_expense_id = _charge_expense WHERE id = _pid;
  END IF;

  INSERT INTO public.finance_audit_log(organization_id, actor_user_id, entity_type, entity_id, entity_ref, action, summary)
  VALUES (_org, auth.uid(), 'vendor_payment', _pid, _num,
          CASE WHEN _needs_approval THEN 'onaccount_payment_pending_allocation' ELSE 'onaccount_payment_recorded' END,
          jsonb_build_object('supplier_id', _supplier_id, 'amount', _amount, 'currency', _cur,
                             'allocated', _allocated, 'unallocated', _amount - _allocated,
                             'fx_rate', _fx_rate, 'bank_charge', COALESCE(_bank_charge,0),
                             'proposal', COALESCE(_proposal->'lines','[]'::jsonb),
                             'requested', _desired,
                             'deviates', _deviates, 'threshold', _threshold,
                             'mode', CASE WHEN _allocations IS NULL THEN 'auto_fifo' ELSE 'manual_split' END));

  RETURN jsonb_build_object('payment_id', _pid, 'payment_number', _num, 'currency', _cur,
                            'amount', _amount, 'allocated', _allocated,
                            'unallocated', _amount - _allocated,
                            'allocation_status', CASE WHEN _needs_approval THEN 'pending_approval' ELSE 'allocated' END,
                            'allocation_request_id', _areq,
                            'deviates', _deviates,
                            'bank_charge_expense_id', _charge_expense);
END;
$$;

REVOKE ALL ON FUNCTION public.record_supplier_onaccount_payment(uuid, numeric, uuid, payment_method, text, timestamptz, text, text, numeric, jsonb, numeric, text, boolean) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.record_supplier_onaccount_payment(uuid, numeric, uuid, payment_method, text, timestamptz, text, text, numeric, jsonb, numeric, text, boolean) TO authenticated;
DROP FUNCTION IF EXISTS public.record_supplier_onaccount_payment(uuid, numeric, uuid, payment_method, text, timestamptz, text, text, numeric, jsonb, numeric, text);

-- Edit a pending allocation request before it is approved
CREATE OR REPLACE FUNCTION public.revise_payment_allocation_request(
  _request_id uuid, _allocations jsonb, _note text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE _r public.payment_allocation_requests%ROWTYPE; _sum numeric := 0; _line jsonb; _due numeric;
BEGIN
  SELECT * INTO _r FROM public.payment_allocation_requests WHERE id = _request_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'request_not_found'; END IF;
  IF _r.status <> 'pending' THEN RAISE EXCEPTION 'already_decided'; END IF;
  IF _r.organization_id <> public.current_org_id() AND NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'not_authorised';
  END IF;

  FOR _line IN SELECT * FROM jsonb_array_elements(_allocations) LOOP
    SELECT GREATEST(si.total_amount - COALESCE(si.paid_amount,0),0) INTO _due
      FROM public.supplier_invoices si
     WHERE si.id = (_line->>'supplier_invoice_id')::uuid AND si.supplier_id = _r.supplier_id;
    IF _due IS NULL THEN RAISE EXCEPTION 'allocation_invoice_not_found'; END IF;
    IF COALESCE((_line->>'amount')::numeric,0) > _due + 0.01 THEN RAISE EXCEPTION 'allocation_exceeds_invoice_balance'; END IF;
    _sum := _sum + COALESCE((_line->>'amount')::numeric,0);
  END LOOP;
  IF _sum > _r.amount + 0.01 THEN RAISE EXCEPTION 'allocation_exceeds_payment'; END IF;

  UPDATE public.payment_allocation_requests
     SET requested_allocations = _allocations, reason = COALESCE(_note, reason)
   WHERE id = _request_id;

  INSERT INTO public.finance_audit_log(organization_id, actor_user_id, entity_type, entity_id, entity_ref, action, summary)
  VALUES (_r.organization_id, auth.uid(), 'payment_allocation', _request_id, NULL, 'allocation_request_revised',
          jsonb_build_object('before', _r.requested_allocations, 'after', _allocations, 'note', _note));

  RETURN jsonb_build_object('ok', true, 'allocated', _sum, 'unallocated', _r.amount - _sum);
END;
$$;

-- Approve / reject finance approvals that the generic router does not handle
CREATE OR REPLACE FUNCTION public.decide_finance_approval(
  _request_id uuid, _decision text, _note text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _req public.approval_requests%ROWTYPE;
  _uid uuid := auth.uid();
  _r public.payment_allocation_requests%ROWTYPE;
  _line jsonb;
  _allocated numeric := 0;
  _res jsonb;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF _decision NOT IN ('approved','rejected') THEN RAISE EXCEPTION 'invalid_decision'; END IF;

  SELECT * INTO _req FROM public.approval_requests WHERE id = _request_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'request_not_found'; END IF;
  IF _req.status <> 'pending' THEN RAISE EXCEPTION 'already_decided'; END IF;
  IF _req.doc_type NOT IN ('payment_allocation','contra_settlement') THEN
    RETURN public.decide_approval_request(_request_id, _decision, _note);
  END IF;
  IF NOT (has_role(_uid,'admin') OR has_role(_uid,'org_owner') OR has_role(_uid,'accountant')
          OR _req.assigned_to = _uid OR public.is_platform_admin()) THEN
    RAISE EXCEPTION 'not_authorised';
  END IF;

  UPDATE public.approval_requests
     SET status = _decision, decided_by = _uid, decided_at = now(),
         decision_note = COALESCE(_note, decision_note), updated_at = now()
   WHERE id = _request_id;

  IF _req.doc_type = 'payment_allocation' THEN
    SELECT * INTO _r FROM public.payment_allocation_requests WHERE id = _req.doc_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'request_not_found'; END IF;

    IF _decision = 'approved' THEN
      FOR _line IN SELECT * FROM jsonb_array_elements(_r.requested_allocations) LOOP
        IF COALESCE((_line->>'amount')::numeric,0) > 0 THEN
          INSERT INTO public.vendor_payment_allocations
            (organization_id, payment_id, supplier_invoice_id, amount, method, rule_applied, created_by, note)
          VALUES (_r.organization_id, _r.payment_id, (_line->>'supplier_invoice_id')::uuid,
                  (_line->>'amount')::numeric, 'manual', 'approved_allocation', _uid, _note);
          _allocated := _allocated + (_line->>'amount')::numeric;
        END IF;
      END LOOP;
    END IF;

    UPDATE public.payment_allocation_requests
       SET status = CASE WHEN _decision = 'approved' THEN 'approved' ELSE 'rejected' END,
           decided_by = _uid, decided_at = now(), decision_note = _note
     WHERE id = _r.id;

    INSERT INTO public.finance_audit_log(organization_id, actor_user_id, entity_type, entity_id, entity_ref, action, summary)
    VALUES (_r.organization_id, _uid, 'payment_allocation', _r.id, NULL,
            'allocation_'||_decision,
            jsonb_build_object('payment_id', _r.payment_id, 'proposal', _r.proposal,
                               'applied', CASE WHEN _decision='approved' THEN _r.requested_allocations ELSE '[]'::jsonb END,
                               'allocated', _allocated,
                               'left_on_account', _r.amount - _allocated, 'note', _note));

    RETURN jsonb_build_object('ok', true, 'status', _decision, 'allocated', _allocated,
                              'left_on_account', _r.amount - _allocated);
  END IF;

  -- contra settlement
  IF _decision = 'approved' THEN
    _res := public._post_contra_core(_req.doc_id);
    RETURN jsonb_build_object('ok', true, 'status', 'approved', 'settlement', _res);
  END IF;

  UPDATE public.contra_settlements SET status = 'rejected' WHERE id = _req.doc_id;
  INSERT INTO public.finance_audit_log(organization_id, actor_user_id, entity_type, entity_id, entity_ref, action, summary)
  VALUES (_req.organization_id, _uid, 'contra_settlement', _req.doc_id, NULL, 'contra_settlement_rejected',
          jsonb_build_object('note', _note));
  RETURN jsonb_build_object('ok', true, 'status', 'rejected');
END;
$$;

REVOKE ALL ON FUNCTION public.revise_payment_allocation_request(uuid, jsonb, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.revise_payment_allocation_request(uuid, jsonb, text) TO authenticated;
REVOKE ALL ON FUNCTION public.decide_finance_approval(uuid, text, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.decide_finance_approval(uuid, text, text) TO authenticated;
