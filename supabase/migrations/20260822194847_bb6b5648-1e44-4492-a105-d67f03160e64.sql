
CREATE OR REPLACE FUNCTION public.preview_container_acquisition_costs(
  _container_id uuid,
  _purchase numeric DEFAULT 0,
  _purchase_currency text DEFAULT NULL,
  _transport numeric DEFAULT 0,
  _transport_vendor text DEFAULT NULL,
  _transport_currency text DEFAULT NULL,
  _offloading numeric DEFAULT 0,
  _offloading_vendor text DEFAULT NULL,
  _offloading_currency text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  _org uuid := current_org_id();
  _orgcur text;
  _cnum text; _owner text; _cstatus text;
  _kinds text[] := ARRAY['purchase','acquisition_transport','acquisition_crane_offloading'];
  _k text; _target numeric; _vendor text; _kcur text;
  _inv RECORD; _delta numeric; _action text; _ledger text;
  _components jsonb := '[]'::jsonb;
  _blockers jsonb := '[]'::jsonb;
  _warnings jsonb := '[]'::jsonb;
  _rate numeric;
BEGIN
  IF _container_id IS NULL THEN RAISE EXCEPTION 'Container is required'; END IF;

  SELECT upper(COALESCE(currency,'USD')) INTO _orgcur FROM public.organizations WHERE id = _org;
  _orgcur := COALESCE(_orgcur,'USD');

  SELECT container_number, owner, status::text INTO _cnum, _owner, _cstatus
    FROM public.containers WHERE id = _container_id AND organization_id = _org;
  IF _cnum IS NULL THEN RAISE EXCEPTION 'Container not found in this organization'; END IF;

  FOREACH _k IN ARRAY _kinds LOOP
    _target := ROUND(GREATEST(COALESCE(
                 CASE _k WHEN 'purchase' THEN _purchase
                         WHEN 'acquisition_transport' THEN _transport
                         ELSE _offloading END, 0), 0), 2);
    _vendor := btrim(COALESCE(
                 CASE _k WHEN 'purchase' THEN _owner
                         WHEN 'acquisition_transport' THEN _transport_vendor
                         ELSE _offloading_vendor END, ''));
    _kcur := upper(COALESCE(NULLIF(btrim(COALESCE(
                 CASE _k WHEN 'purchase' THEN _purchase_currency
                         WHEN 'acquisition_transport' THEN _transport_currency
                         ELSE _offloading_currency END, '')),''), _orgcur));

    SELECT si.* INTO _inv
      FROM public.supplier_invoices si
     WHERE si.organization_id = _org
       AND si.container_id = _container_id
       AND si.reason = _k
       AND lower(si.status) NOT IN ('cancelled','void','credited')
     ORDER BY si.created_at DESC LIMIT 1;

    _action := 'unchanged'; _ledger := NULL; _delta := 0;

    IF _inv.id IS NULL THEN
      IF _target > 0 THEN
        _action := 'create';
        _delta := _target;
        _ledger := 'Payable increase ' || _kcur || ' ' || to_char(_target,'FM999999990.00');
      END IF;
    ELSE
      _delta := _target - COALESCE(_inv.total_amount,0);
      IF _target <= 0 THEN
        _action := 'cancel';
        _ledger := 'Payable reversal ' || COALESCE(_inv.currency,_kcur) || ' ' || to_char(COALESCE(_inv.total_amount,0),'FM999999990.00');
      ELSIF ROUND(_delta,2) <> 0 OR upper(COALESCE(_inv.currency,'')) <> _kcur THEN
        _action := 'adjust';
        _ledger := CASE WHEN _delta >= 0 THEN 'Payable increase ' ELSE 'Payable decrease ' END
                   || _kcur || ' ' || to_char(abs(_delta),'FM999999990.00');
      END IF;
    END IF;

    IF _target > 0 AND _vendor = '' THEN
      IF _k = 'purchase' THEN
        _blockers := _blockers || jsonb_build_object('component', _k, 'code','missing_owner',
          'message','The container has no registered owner, so the seller invoice cannot be raised.',
          'fix','Set the container owner on the container record, then retry.');
      ELSE
        _blockers := _blockers || jsonb_build_object('component', _k, 'code','missing_vendor',
          'message','An amount is set but no vendor is named.',
          'fix','Enter the vendor name, or pick the organisation default vendor in Settings.');
      END IF;
    END IF;

    IF _target > 0 AND _kcur <> _orgcur THEN
      BEGIN
        _rate := public.get_fx_rate(_org, _kcur, _orgcur, CURRENT_DATE);
      EXCEPTION WHEN OTHERS THEN
        _rate := NULL;
      END;
      IF _rate IS NULL OR _rate = 0 THEN
        _blockers := _blockers || jsonb_build_object('component', _k, 'code','missing_fx_rate',
          'message','No exchange rate for ' || _kcur || ' to ' || _orgcur || ' today.',
          'fix','Add the ' || _kcur || ' to ' || _orgcur || ' rate under Finance -> FX Rates, then retry.');
      END IF;
    END IF;

    IF _inv.id IS NOT NULL AND COALESCE(_inv.paid_amount,0) > 0 AND _target < COALESCE(_inv.paid_amount,0) THEN
      _blockers := _blockers || jsonb_build_object('component', _k, 'code','below_paid_amount',
        'message', _inv.invoice_number || ' already has ' || COALESCE(_inv.paid_amount,0)::text || ' ' || COALESCE(_inv.currency,_kcur) || ' paid.',
        'fix','Raise a credit note or refund against the invoice instead of lowering it below the amount paid.');
    END IF;

    IF _action <> 'unchanged' AND _cstatus IN ('sold','converted','in_conversion') THEN
      _warnings := _warnings || jsonb_build_object('component', _k, 'code','container_consumed',
        'message','This container is ' || replace(_cstatus,'_',' ') || '; the cost may already be carried into a sale or conversion job.',
        'fix','Confirm the job or sale margin is re-checked after saving.');
    END IF;

    IF _action = 'cancel' AND EXISTS (
      SELECT 1 FROM public.edi_exports e WHERE e.supplier_invoice_id = _inv.id
    ) THEN
      _warnings := _warnings || jsonb_build_object('component', _k, 'code','edi_exported',
        'message', _inv.invoice_number || ' has already been exported over EDI.',
        'fix','Re-send the corrected EDI export after saving.');
    END IF;

    _components := _components || jsonb_build_object(
      'component', _k,
      'action', _action,
      'vendor', NULLIF(_vendor,''),
      'currency', _kcur,
      'invoice_id', _inv.id,
      'invoice_number', _inv.invoice_number,
      'invoice_status', _inv.status,
      'paid_amount', COALESCE(_inv.paid_amount,0),
      'old_amount', COALESCE(_inv.total_amount,0),
      'old_currency', _inv.currency,
      'new_amount', _target,
      'delta', ROUND(_delta,2),
      'purchase_order_id', _inv.purchase_order_id,
      'ledger', _ledger);
  END LOOP;

  RETURN jsonb_build_object(
    'container_id', _container_id,
    'container_number', _cnum,
    'container_status', _cstatus,
    'owner', _owner,
    'org_currency', _orgcur,
    'components', _components,
    'blockers', _blockers,
    'warnings', _warnings);
END
$fn$;

REVOKE ALL ON FUNCTION public.preview_container_acquisition_costs(uuid, numeric, text, numeric, text, text, numeric, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.preview_container_acquisition_costs(uuid, numeric, text, numeric, text, text, numeric, text, text) TO authenticated;
