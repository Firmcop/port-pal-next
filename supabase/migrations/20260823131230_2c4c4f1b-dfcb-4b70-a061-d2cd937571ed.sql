
-- 1. Block acquisition invoices on split child containers -------------------
CREATE OR REPLACE FUNCTION public.block_child_acquisition_invoice()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE _parent uuid;
BEGIN
  IF NEW.reason IN ('purchase','acquisition_transport','acquisition_crane_offloading')
     AND NEW.container_id IS NOT NULL THEN
    SELECT parent_container_id INTO _parent FROM public.containers WHERE id = NEW.container_id;
    IF _parent IS NOT NULL THEN
      -- Split children inherit their cost from the mother unit's allocation.
      RETURN NULL;
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_block_child_acquisition_invoice ON public.supplier_invoices;
CREATE TRIGGER trg_block_child_acquisition_invoice
BEFORE INSERT ON public.supplier_invoices
FOR EACH ROW EXECUTE FUNCTION public.block_child_acquisition_invoice();

-- 2. Split children skipped by the transport backfill ------------------------
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
       AND c.parent_container_id IS NULL
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

-- 3. A split child's acquisition cost is its allocated share -----------------
CREATE OR REPLACE FUNCTION public.container_acquisition_split(_container_id uuid, _currency text)
 RETURNS TABLE(purchase numeric, services numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _org uuid;
  _org_ccy text;
  _cnum text;
  _parent uuid;
  _target text := upper(coalesce(nullif(trim(_currency), ''), 'USD'));
  _p numeric := 0;
  _s numeric := 0;
  _r record;
  _rate numeric;
  _amt numeric;
  _alloc record;
BEGIN
  IF _container_id IS NULL THEN
    purchase := 0; services := 0; RETURN NEXT; RETURN;
  END IF;
  SELECT container_number, organization_id, parent_container_id
    INTO _cnum, _org, _parent FROM containers WHERE id = _container_id;
  _org := coalesce(_org, current_org_id());
  SELECT upper(coalesce(currency,'USD')) INTO _org_ccy FROM organizations WHERE id = _org;

  IF _parent IS NOT NULL THEN
    SELECT coc.container_cost, coc.total_cost
      INTO _alloc
      FROM conversion_output_costs coc
     WHERE coc.output_kind = 'container' AND coc.output_id = _container_id
     ORDER BY coc.created_at DESC LIMIT 1;
    IF FOUND THEN
      purchase := round(coalesce(_alloc.container_cost,0), 2);
      services := round(greatest(coalesce(_alloc.total_cost,0) - coalesce(_alloc.container_cost,0), 0), 2);
    ELSE
      SELECT coalesce(acquisition_cost,0) INTO _amt FROM containers WHERE id = _container_id;
      purchase := round(coalesce(_amt,0), 2);
      services := 0;
    END IF;
    RETURN NEXT; RETURN;
  END IF;

  FOR _r IN
    SELECT si.total_amount, si.base_amount, si.fx_rate, si.reason,
           upper(coalesce(si.currency, _target)) AS ccy,
           coalesce(si.issue_date, current_date) AS on_date
      FROM supplier_invoices si
     WHERE si.reason IN ('purchase','acquisition_transport','acquisition_crane_offloading')
       AND lower(coalesce(si.status,'')) NOT IN ('cancelled','void','credited','draft_void')
       AND (si.container_id = _container_id OR (_cnum IS NOT NULL AND si.reference = _cnum))
  LOOP
    IF _r.ccy = _target THEN
      _amt := coalesce(_r.total_amount, 0);
    ELSIF _target = coalesce(_org_ccy, _target) AND coalesce(_r.base_amount, 0) > 0 THEN
      _amt := _r.base_amount;
    ELSIF _target = coalesce(_org_ccy, _target) AND coalesce(_r.fx_rate, 0) > 0 THEN
      _amt := round(coalesce(_r.total_amount, 0) * _r.fx_rate, 2);
    ELSE
      _rate := get_fx_rate(_org, _r.ccy, _target, _r.on_date::date);
      IF _rate IS NULL OR _rate <= 0 THEN
        RAISE EXCEPTION 'missing_fx_rate: no rate % -> % on %. Add it under Finance FX Rates.', _r.ccy, _target, _r.on_date;
      END IF;
      _amt := round(coalesce(_r.total_amount, 0) * _rate, 2);
    END IF;

    IF _r.reason = 'purchase' THEN _p := _p + _amt; ELSE _s := _s + _amt; END IF;
  END LOOP;

  purchase := round(_p, 2);
  services := round(_s, 2);
  RETURN NEXT;
END;
$function$;
