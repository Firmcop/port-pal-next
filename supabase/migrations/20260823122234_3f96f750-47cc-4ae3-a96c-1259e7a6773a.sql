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
  _target text := upper(coalesce(nullif(trim(_currency), ''), 'USD'));
  _p numeric := 0;
  _s numeric := 0;
  _r record;
  _rate numeric;
  _amt numeric;
BEGIN
  IF _container_id IS NULL THEN
    purchase := 0; services := 0; RETURN NEXT; RETURN;
  END IF;
  SELECT container_number, organization_id INTO _cnum, _org FROM containers WHERE id = _container_id;
  _org := coalesce(_org, current_org_id());
  SELECT upper(coalesce(currency,'USD')) INTO _org_ccy FROM organizations WHERE id = _org;

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