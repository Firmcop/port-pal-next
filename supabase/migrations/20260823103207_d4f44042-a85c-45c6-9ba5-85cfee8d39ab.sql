CREATE OR REPLACE FUNCTION public.backfill_container_transport_costs(_vendor text DEFAULT 'Transport (Historic)'::text, _rate_20 numeric DEFAULT 32500, _rate_40 numeric DEFAULT 40000, _currency text DEFAULT 'KES'::text, _dry_run boolean DEFAULT true)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _org uuid := current_org_id();
  _c record;
  _amt numeric;
  _rows jsonb := '[]'::jsonb;
  _processed int := 0;
  _skipped int := 0;
  _sales int := 0;
  _convs int := 0;
  _total numeric := 0;
  _sale record;
  _conv record;
  _delta numeric;
BEGIN
  IF _org IS NULL THEN RAISE EXCEPTION 'no_organization'; END IF;
  IF NOT (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'org_owner')
          OR public.is_platform_admin()) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  FOR _c IN
    SELECT c.id, c.container_number, c.size::text AS size, c.status::text AS status
      FROM public.containers c
     WHERE c.organization_id = _org
     ORDER BY c.container_number
  LOOP
    IF EXISTS (
      SELECT 1 FROM public.supplier_invoices si
       WHERE si.organization_id = _org
         AND si.container_id = _c.id
         AND si.reason = 'acquisition_transport'
    ) THEN
      _skipped := _skipped + 1;
      CONTINUE;
    END IF;

    _amt := CASE WHEN _c.size IN ('40','45') THEN _rate_40 ELSE _rate_20 END;
    IF _amt IS NULL OR _amt <= 0 THEN _skipped := _skipped + 1; CONTINUE; END IF;

    _rows := _rows || jsonb_build_object(
      'container_id', _c.id, 'container_number', _c.container_number,
      'size', _c.size, 'status', _c.status, 'amount', _amt, 'currency', _currency);
    _processed := _processed + 1;
    _total := _total + _amt;

    IF _dry_run THEN CONTINUE; END IF;

    PERFORM public.record_container_service_invoice(
      _container_id := _c.id,
      _vendor_name  := _vendor,
      _amount       := _amt,
      _currency     := _currency,
      _service_kind := 'transport',
      _reference    := _c.container_number,
      _fx_rate      := NULL::numeric);

    UPDATE public.containers
       SET transport_cost = _amt,
           transport_currency = _currency,
           transport_vendor = _vendor,
           updated_at = now()
     WHERE id = _c.id;

    FOR _sale IN
      SELECT id, sale_number, status::text AS status,
             COALESCE(transport_offloading_cost,0) AS cur
        FROM public.container_sales
       WHERE organization_id = _org AND container_id = _c.id
    LOOP
      _delta := _amt - _sale.cur;
      IF _delta <> 0 THEN
        UPDATE public.container_sales
           SET transport_offloading_cost = _amt, updated_at = now()
         WHERE id = _sale.id;
        IF _sale.status = 'sold' THEN
          INSERT INTO public.accounting_transactions (
            transaction_number, account_type, category, description,
            debit_amount, credit_amount, reference_type, reference_id, organization_id, currency
          ) VALUES (
            'TXN-SALE-ADJ-' || substr(replace(gen_random_uuid()::text,'-',''),1,10),
            'expense', 'cost_adjustment',
            'Historic transport cost backfill — ' || COALESCE(_sale.sale_number, _c.container_number),
            CASE WHEN _delta > 0 THEN _delta ELSE 0 END,
            CASE WHEN _delta < 0 THEN -_delta ELSE 0 END,
            'container_sales', _sale.id, _org, _currency
          );
        END IF;
        _sales := _sales + 1;
      END IF;
    END LOOP;

    FOR _conv IN
      SELECT id, COALESCE(transport_offloading_cost,0) AS cur
        FROM public.container_conversions
       WHERE organization_id = _org AND container_id = _c.id
    LOOP
      IF _amt <> _conv.cur THEN
        UPDATE public.container_conversions
           SET transport_offloading_cost = _amt, updated_at = now()
         WHERE id = _conv.id;
        _convs := _convs + 1;
      END IF;
    END LOOP;

    INSERT INTO public.finance_audit_log (organization_id, entity_type, entity_id, action, summary)
    VALUES (_org, 'containers', _c.id, 'transport_cost_backfill',
      jsonb_build_object('container_number', _c.container_number, 'size', _c.size,
        'amount', _amt, 'currency', _currency, 'vendor', _vendor,
        'reason', 'Historic transport cost backfill'));
  END LOOP;

  RETURN jsonb_build_object(
    'dry_run', _dry_run,
    'processed', _processed,
    'skipped', _skipped,
    'sales_restated', _sales,
    'conversions_restated', _convs,
    'total_amount', _total,
    'currency', _currency,
    'rows', _rows
  );
END;
$function$;