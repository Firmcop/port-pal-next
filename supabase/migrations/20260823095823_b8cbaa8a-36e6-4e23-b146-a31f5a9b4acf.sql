
REVOKE ALL ON FUNCTION public.preview_contra_settlement(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.preview_contra_settlement(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.eir_set_ownership() FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.eir_log_ownership() FROM public, anon, authenticated;

CREATE OR REPLACE FUNCTION public.counterparty_reconciliation()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _org uuid := public.current_org_id();
  _policy jsonb;
  _rows jsonb := '[]'::jsonb;
  _s record;
  _p jsonb;
  _t jsonb;
  _cur text;
  _ar numeric; _ap numeric; _off numeric;
  _offsets numeric; _cash numeric; _unalloc numeric;
  _flags jsonb;
  _cur_count int;
  _bad_lines int;
BEGIN
  IF _org IS NULL THEN RAISE EXCEPTION 'No organization context'; END IF;
  IF NOT (has_role(auth.uid(),'admin') OR has_role(auth.uid(),'org_owner')
          OR has_role(auth.uid(),'accountant') OR public.is_platform_admin()) THEN
    RAISE EXCEPTION 'not_authorised';
  END IF;
  _policy := public.get_accounting_policy();

  FOR _s IN
    SELECT sp.id, sp.name, sp.linked_customer_id,
           c.id AS customer_id, c.company_name AS customer_name
      FROM public.suppliers sp
      LEFT JOIN LATERAL (
        SELECT cu.id, cu.company_name FROM public.customers cu
         WHERE cu.organization_id = _org
           AND (cu.id = sp.linked_customer_id
                OR lower(btrim(cu.company_name)) = lower(btrim(sp.name)))
         ORDER BY (cu.id = sp.linked_customer_id) DESC LIMIT 1
      ) c ON true
     WHERE sp.organization_id = _org AND c.id IS NOT NULL
     ORDER BY sp.name
  LOOP
    _p := public.preview_contra_settlement(_s.id);
    SELECT count(*) INTO _cur_count FROM jsonb_array_elements(_p->'totals');

    SELECT COALESCE(sum(vp.amount) - COALESCE(sum(alloc.allocated),0), 0) INTO _unalloc
      FROM public.vendor_payments vp
      LEFT JOIN LATERAL (
        SELECT sum(a.amount) AS allocated FROM public.vendor_payment_allocations a
         WHERE a.payment_id = vp.id
      ) alloc ON true
     WHERE vp.organization_id = _org AND vp.supplier_id = _s.id AND vp.po_id IS NULL;

    FOR _t IN SELECT x FROM jsonb_array_elements(_p->'totals') x
    LOOP
      _cur := _t->>'currency';
      _ar := COALESCE((_t->>'ar_total')::numeric,0);
      _ap := COALESCE((_t->>'ap_total')::numeric,0);
      _off := COALESCE((_t->>'offsettable')::numeric,0);

      SELECT COALESCE(sum(amount),0), COALESCE(sum(cash_amount),0)
        INTO _offsets, _cash
        FROM public.contra_settlements
       WHERE organization_id = _org AND supplier_id = _s.id
         AND upper(currency) = _cur AND status = 'posted';

      SELECT count(*) INTO _bad_lines
        FROM public.contra_settlements cs
       WHERE cs.organization_id = _org AND cs.supplier_id = _s.id
         AND upper(cs.currency) = _cur AND cs.status = 'posted'
         AND NOT EXISTS (SELECT 1 FROM public.contra_settlement_lines l WHERE l.settlement_id = cs.id AND l.side = 'ar')
         AND NOT EXISTS (SELECT 1 FROM public.contra_settlement_lines l WHERE l.settlement_id = cs.id AND l.side = 'ap');

      _flags := '[]'::jsonb;
      IF _s.linked_customer_id IS NULL THEN
        _flags := _flags || jsonb_build_object('code','unlinked_counterparty',
          'severity','warning','message','Matched by name only — link the supplier to the customer record.');
      END IF;
      IF _off > 0.01 THEN
        _flags := _flags || jsonb_build_object('code','offset_available','severity','info',
          'message','Both sides are open — '||_cur||' '||round(_off,2)||' can be set off.');
      END IF;
      IF _off > 0.01 AND _ar - _off > 0.01 THEN
        _flags := _flags || jsonb_build_object('code','residual_receivable','severity','info',
          'message','Receivable residual of '||_cur||' '||round(_ar-_off,2)||' remains after a full set-off.');
      END IF;
      IF _off > 0.01 AND _ap - _off > 0.01 THEN
        _flags := _flags || jsonb_build_object('code','residual_payable','severity','info',
          'message','Payable residual of '||_cur||' '||round(_ap-_off,2)||' remains after a full set-off.');
      END IF;
      IF _cur_count > 1 THEN
        _flags := _flags || jsonb_build_object('code','cross_currency_exposure','severity','warning',
          'message','Balances exist in more than one currency — declare a rate before offsetting across currencies.');
      END IF;
      IF _unalloc > 0.01 THEN
        _flags := _flags || jsonb_build_object('code','unallocated_onaccount','severity','warning',
          'message','On-account supplier payments of '||round(_unalloc,2)||' are not allocated to invoices.');
      END IF;
      IF _bad_lines > 0 THEN
        _flags := _flags || jsonb_build_object('code','offset_without_documents','severity','critical',
          'message',_bad_lines||' posted set-off(s) have no matching AR or AP document lines.');
      END IF;
      IF _offsets > 0.01 AND NOT (_policy->>'netting_enabled')::boolean THEN
        _flags := _flags || jsonb_build_object('code','offsets_posted_netting_disabled','severity','critical',
          'message','Set-offs exist but the netting policy is currently switched off.');
      END IF;

      _rows := _rows || jsonb_build_object(
        'supplier_id', _s.id, 'supplier_name', _s.name,
        'customer_id', _s.customer_id, 'customer_name', _s.customer_name,
        'linked', _s.linked_customer_id IS NOT NULL,
        'currency', _cur,
        'ar_total', _ar, 'ap_total', _ap,
        'offsettable', _off,
        'offsets_posted', _offsets, 'cash_settled', _cash,
        'unallocated_onaccount', _unalloc,
        'net_position', _ar - _ap,
        'flags', _flags);
    END LOOP;
  END LOOP;

  RETURN jsonb_build_object('policy', _policy, 'generated_at', now(), 'rows', _rows);
END;
$$;

REVOKE ALL ON FUNCTION public.counterparty_reconciliation() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.counterparty_reconciliation() TO authenticated;

-- Counterparty position used by the statements screen (respects the presentation basis)
CREATE OR REPLACE FUNCTION public.counterparty_position(_supplier_id uuid DEFAULT NULL, _customer_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _org uuid := public.current_org_id();
  _sid uuid := _supplier_id;
  _p jsonb;
  _policy jsonb := public.get_accounting_policy();
  _offsets jsonb;
BEGIN
  IF _org IS NULL THEN RAISE EXCEPTION 'No organization context'; END IF;

  IF _sid IS NULL AND _customer_id IS NOT NULL THEN
    SELECT sp.id INTO _sid FROM public.suppliers sp
      LEFT JOIN public.customers cu ON cu.id = _customer_id
     WHERE sp.organization_id = _org
       AND (sp.linked_customer_id = _customer_id
            OR lower(btrim(sp.name)) = lower(btrim(cu.company_name)))
     LIMIT 1;
  END IF;

  IF _sid IS NULL THEN
    RETURN jsonb_build_object('linked', false, 'policy', _policy);
  END IF;

  _p := public.preview_contra_settlement(_sid);

  SELECT COALESCE(jsonb_agg(jsonb_build_object('currency', upper(currency),
           'offsets_posted', total, 'cash_settled', cash)), '[]'::jsonb)
    INTO _offsets
    FROM (
      SELECT currency, sum(amount) AS total, sum(COALESCE(cash_amount,0)) AS cash
        FROM public.contra_settlements
       WHERE organization_id = _org AND supplier_id = _sid AND status = 'posted'
       GROUP BY currency
    ) s;

  RETURN jsonb_build_object(
    'linked', true,
    'supplier_id', _sid,
    'supplier_name', _p->>'supplier_name',
    'customer_id', _p->>'customer_id',
    'customer_name', _p->>'customer_name',
    'totals', _p->'totals',
    'offsets', _offsets,
    'policy', _policy);
END;
$$;

REVOKE ALL ON FUNCTION public.counterparty_position(uuid, uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.counterparty_position(uuid, uuid) TO authenticated;
