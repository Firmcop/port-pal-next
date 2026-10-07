-- 1. Allow supplier payments that are not tied to a single PO ------------------
ALTER TABLE public.vendor_payments ALTER COLUMN po_id DROP NOT NULL;

-- 2. Preview a FIFO allocation for a lumpsum payment --------------------------
CREATE OR REPLACE FUNCTION public.preview_supplier_payment_allocation(
  _supplier_id uuid,
  _amount numeric,
  _currency text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  _org uuid := public.current_org_id();
  _cur text;
  _left numeric := COALESCE(_amount, 0);
  _take numeric;
  _rows jsonb := '[]'::jsonb;
  _inv record;
BEGIN
  IF _org IS NULL THEN RAISE EXCEPTION 'No organization context'; END IF;
  _cur := upper(btrim(COALESCE(NULLIF(_currency, ''),
            (SELECT currency FROM public.suppliers WHERE id = _supplier_id),
            (SELECT currency FROM public.organizations WHERE id = _org))));

  FOR _inv IN
    SELECT si.id, si.invoice_number, si.currency, si.issue_date, si.due_date,
           si.total_amount, COALESCE(si.paid_amount,0) AS paid,
           GREATEST(si.total_amount - COALESCE(si.paid_amount,0), 0) AS due
      FROM public.supplier_invoices si
     WHERE si.organization_id = _org
       AND si.supplier_id = _supplier_id
       AND COALESCE(si.status,'') NOT IN ('cancelled')
       AND si.total_amount > COALESCE(si.paid_amount,0)
       AND upper(btrim(COALESCE(si.currency,''))) = _cur
     ORDER BY si.due_date, si.issue_date, si.created_at
  LOOP
    _take := LEAST(GREATEST(_left,0), _inv.due);
    _rows := _rows || jsonb_build_object(
      'supplier_invoice_id', _inv.id,
      'invoice_number', _inv.invoice_number,
      'currency', _inv.currency,
      'issue_date', _inv.issue_date,
      'due_date', _inv.due_date,
      'total_amount', _inv.total_amount,
      'paid_amount', _inv.paid,
      'due', _inv.due,
      'proposed', _take);
    _left := _left - _take;
  END LOOP;

  RETURN jsonb_build_object(
    'currency', _cur,
    'amount', COALESCE(_amount,0),
    'allocated', COALESCE(_amount,0) - GREATEST(_left,0),
    'unallocated', GREATEST(_left,0),
    'lines', _rows);
END;
$$;

-- 3. Record a lumpsum / on-account supplier payment ---------------------------
CREATE OR REPLACE FUNCTION public.record_supplier_onaccount_payment(
  _supplier_id uuid,
  _amount numeric,
  _account_id uuid,
  _method payment_method DEFAULT 'bank_transfer',
  _reference text DEFAULT NULL,
  _paid_at timestamptz DEFAULT NULL,
  _notes text DEFAULT NULL,
  _currency text DEFAULT NULL,
  _fx_rate numeric DEFAULT NULL,
  _allocations jsonb DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  _org uuid := public.current_org_id();
  _cur text;
  _pid uuid;
  _num text;
  _line jsonb;
  _due numeric;
  _sum numeric := 0;
  _allocated numeric := 0;
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

  -- validate a manual split before anything is written
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

  -- suppress the auto-FIFO trigger when the caller supplied a manual split
  IF _allocations IS NOT NULL THEN
    PERFORM set_config('cdms.skip_auto_allocate', 'on', true);
  END IF;

  INSERT INTO public.vendor_payments(
    payment_number, po_id, supplier_id, amount, payment_method, reference_number,
    paid_at, notes, recorded_by, organization_id, financial_account_id,
    currency, fx_rate
  ) VALUES (
    _num, NULL, _supplier_id, _amount, _method, _reference,
    COALESCE(_paid_at, now()), _notes, auth.uid(), _org, _account_id,
    _cur, _fx_rate
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

  INSERT INTO public.finance_audit_log(organization_id, actor_user_id, entity_type, entity_id, entity_ref, action, summary)
  VALUES (_org, auth.uid(), 'vendor_payment', _pid, _num, 'onaccount_payment_recorded',
          jsonb_build_object('supplier_id', _supplier_id, 'amount', _amount, 'currency', _cur,
                             'allocated', _allocated, 'unallocated', _amount - _allocated,
                             'mode', CASE WHEN _allocations IS NULL THEN 'auto_fifo' ELSE 'manual_split' END));

  RETURN jsonb_build_object('payment_id', _pid, 'payment_number', _num, 'currency', _cur,
                            'amount', _amount, 'allocated', _allocated,
                            'unallocated', _amount - _allocated);
END;
$$;

-- 4. Honour the manual-split suppression flag in the auto-allocate trigger ----
CREATE OR REPLACE FUNCTION public.trg_auto_allocate_vendor_payment()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF COALESCE(current_setting('cdms.skip_auto_allocate', true), 'off') = 'on' THEN
    RETURN NEW;
  END IF;
  PERFORM public.allocate_vendor_payment(NEW.id);
  RETURN NEW;
END;
$$;

-- 5. Allocate (or re-allocate) an existing payment with an explicit split -----
CREATE OR REPLACE FUNCTION public.allocate_vendor_payment_manual(
  _payment_id uuid,
  _allocations jsonb,
  _reason text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  _org uuid := public.current_org_id();
  _p public.vendor_payments%ROWTYPE;
  _line jsonb;
  _due numeric;
  _sum numeric := 0;
  _existing numeric;
BEGIN
  SELECT * INTO _p FROM public.vendor_payments WHERE id = _payment_id AND organization_id = _org;
  IF NOT FOUND THEN RAISE EXCEPTION 'payment_not_found'; END IF;
  IF jsonb_typeof(_allocations) <> 'array' THEN RAISE EXCEPTION 'allocations_must_be_array'; END IF;

  FOR _line IN SELECT * FROM jsonb_array_elements(_allocations) LOOP
    SELECT GREATEST(si.total_amount - COALESCE(si.paid_amount,0), 0)
             + COALESCE((SELECT sum(a.amount) FROM public.vendor_payment_allocations a
                          WHERE a.payment_id = _payment_id AND a.supplier_invoice_id = si.id), 0)
      INTO _due
      FROM public.supplier_invoices si
     WHERE si.id = (_line->>'supplier_invoice_id')::uuid
       AND si.organization_id = _org AND si.supplier_id = _p.supplier_id;
    IF _due IS NULL THEN RAISE EXCEPTION 'allocation_invoice_not_found'; END IF;
    IF COALESCE((_line->>'amount')::numeric,0) > _due + 0.01 THEN
      RAISE EXCEPTION 'allocation_exceeds_invoice_balance';
    END IF;
    _sum := _sum + COALESCE((_line->>'amount')::numeric,0);
  END LOOP;
  IF _sum > _p.amount + 0.01 THEN RAISE EXCEPTION 'allocation_exceeds_payment'; END IF;

  SELECT COALESCE(sum(amount),0) INTO _existing
    FROM public.vendor_payment_allocations WHERE payment_id = _payment_id;

  DELETE FROM public.vendor_payment_allocations WHERE payment_id = _payment_id;

  FOR _line IN SELECT * FROM jsonb_array_elements(_allocations) LOOP
    IF COALESCE((_line->>'amount')::numeric,0) > 0 THEN
      INSERT INTO public.vendor_payment_allocations
        (organization_id, payment_id, supplier_invoice_id, amount, method, rule_applied, fx_rate, created_by, note)
      VALUES (_org, _payment_id, (_line->>'supplier_invoice_id')::uuid,
              (_line->>'amount')::numeric, 'manual', 'manual_split', _p.fx_rate, auth.uid(), _reason);
    END IF;
  END LOOP;

  INSERT INTO public.finance_audit_log(organization_id, actor_user_id, entity_type, entity_id, entity_ref, action, summary, before_data, after_data)
  VALUES (_org, auth.uid(), 'vendor_payment', _payment_id, _p.payment_number, 'payment_reallocated',
          jsonb_build_object('reason', _reason),
          jsonb_build_object('allocated', _existing),
          jsonb_build_object('allocated', _sum));

  RETURN jsonb_build_object('payment_id', _payment_id, 'allocated', _sum,
                            'unallocated', _p.amount - _sum);
END;
$$;

-- 6. Unallocated supplier credit queue ---------------------------------------
CREATE OR REPLACE VIEW public.v_unallocated_vendor_payments AS
SELECT vp.id AS payment_id,
       vp.organization_id,
       vp.payment_number,
       vp.supplier_id,
       s.name AS supplier_name,
       vp.po_id,
       vp.amount,
       vp.currency,
       vp.paid_at,
       COALESCE(a.allocated, 0) AS allocated,
       vp.amount - COALESCE(a.allocated, 0) AS unallocated
  FROM public.vendor_payments vp
  JOIN public.suppliers s ON s.id = vp.supplier_id
  LEFT JOIN (SELECT payment_id, sum(amount) AS allocated
               FROM public.vendor_payment_allocations GROUP BY payment_id) a
         ON a.payment_id = vp.id
 WHERE vp.amount - COALESCE(a.allocated, 0) > 0.01;

GRANT SELECT ON public.v_unallocated_vendor_payments TO authenticated;

REVOKE ALL ON FUNCTION public.preview_supplier_payment_allocation(uuid, numeric, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.record_supplier_onaccount_payment(uuid, numeric, uuid, payment_method, text, timestamptz, text, text, numeric, jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.allocate_vendor_payment_manual(uuid, jsonb, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.preview_supplier_payment_allocation(uuid, numeric, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_supplier_onaccount_payment(uuid, numeric, uuid, payment_method, text, timestamptz, text, text, numeric, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.allocate_vendor_payment_manual(uuid, jsonb, text) TO authenticated;