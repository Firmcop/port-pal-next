ALTER TABLE public.repatriations
  ADD COLUMN IF NOT EXISTS carrier_cost_currency text,
  ADD COLUMN IF NOT EXISTS carrier_fx_rate numeric;

UPDATE public.repatriations rp
   SET carrier_cost_currency = COALESCE(
     NULLIF(btrim(rp.currency),''),
     (SELECT o.currency FROM public.organizations o WHERE o.id = rp.organization_id),
     'USD')
 WHERE carrier_cost_currency IS NULL;

CREATE OR REPLACE FUNCTION public.set_repatriation_execution(
  _repatriation_id uuid,
  _mode text,
  _carrier_id uuid DEFAULT NULL::uuid,
  _carrier_cost numeric DEFAULT 0,
  _trip_id uuid DEFAULT NULL::uuid,
  _carrier_cost_currency text DEFAULT NULL::text,
  _carrier_fx_rate numeric DEFAULT NULL::numeric
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _rep record; _rev numeric; _cur text;
BEGIN
  IF _mode NOT IN ('own_truck','subcontracted') THEN RAISE EXCEPTION 'invalid_execution_mode'; END IF;
  SELECT * INTO _rep FROM public.repatriations WHERE id = _repatriation_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'repatriation_not_found'; END IF;
  IF NOT (public.is_platform_admin()
          OR (_rep.organization_id = public.current_org_id()
              AND (public.has_role(auth.uid(),'admin'::app_role)
                   OR public.has_role(auth.uid(),'yard_operator'::app_role)))) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  IF _mode = 'subcontracted' AND _carrier_id IS NULL THEN
    RAISE EXCEPTION 'carrier_required';
  END IF;

  _cur := upper(COALESCE(NULLIF(btrim(_carrier_cost_currency),''),
                         NULLIF(btrim(_rep.currency),''),
                         (SELECT o.currency FROM public.organizations o WHERE o.id = _rep.organization_id),
                         'USD'));

  UPDATE public.repatriations
     SET execution_mode = _mode,
         carrier_id = CASE WHEN _mode = 'subcontracted' THEN _carrier_id ELSE NULL END,
         carrier_cost = CASE WHEN _mode = 'subcontracted' THEN COALESCE(_carrier_cost,0) ELSE 0 END,
         carrier_cost_currency = CASE WHEN _mode = 'subcontracted' THEN _cur ELSE carrier_cost_currency END,
         carrier_fx_rate = CASE
             WHEN _mode <> 'subcontracted' THEN NULL
             WHEN _cur = upper(COALESCE(NULLIF(btrim(_rep.currency),''),
                                        (SELECT o.currency FROM public.organizations o WHERE o.id = _rep.organization_id),
                                        'USD')) THEN NULL
             WHEN COALESCE(_carrier_fx_rate,0) > 0 THEN _carrier_fx_rate
             ELSE NULL END,
         trip_id = CASE WHEN _mode = 'own_truck' THEN _trip_id ELSE NULL END
   WHERE id = _repatriation_id;

  IF _mode = 'own_truck' AND _trip_id IS NOT NULL THEN
    _rev := COALESCE(_rep.charge_amount,0) + COALESCE(_rep.handling_amount,0);
    IF _rev > 0 AND NOT EXISTS (
      SELECT 1 FROM public.logistics_trip_revenue r
      WHERE r.trip_id = _trip_id AND r.transport_order_id IS NULL
    ) THEN
      INSERT INTO public.logistics_trip_revenue (organization_id, trip_id, amount)
      VALUES (_rep.organization_id, _trip_id, _rev);
    END IF;
  END IF;
END;
$function$;

DROP FUNCTION IF EXISTS public.repat_profitability(date, date);

CREATE OR REPLACE FUNCTION public.repat_profitability(_from date DEFAULT NULL::date, _to date DEFAULT NULL::date)
 RETURNS TABLE(repatriation_id uuid, repatriation_number text, container_number text, origin text, destination text, shipping_line text, status text, execution_mode text, charge_amount numeric, handling_amount numeric, revenue numeric, direct_cost numeric, allocated_trip_cost numeric, margin numeric, margin_pct numeric, currency text, invoice_id uuid, invoice_number text, invoice_status text, invoice_total numeric, cost_basis text, fx_ok boolean, carrier_cost numeric, carrier_cost_currency text, carrier_cost_converted numeric, carrier_fx_ok boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH base AS (
    SELECT rp.*,
           c.container_number,
           inv.invoice_number AS inv_no,
           inv.status::text   AS inv_status,
           inv.total_amount   AS inv_total,
           inv.currency       AS inv_currency,
           COALESCE(NULLIF(btrim(rp.currency),''), NULLIF(btrim(inv.currency),''),
                    (SELECT o.currency FROM public.organizations o WHERE o.id = rp.organization_id),'USD') AS bill_cur,
           COALESCE((SELECT SUM(rc.amount) FROM public.repatriation_costs rc
                      WHERE rc.repatriation_id = rp.id),0) AS other_costs,
           (SELECT a.allocated_cost FROM public.trip_cost_allocation(rp.trip_id) a
              WHERE a.source = 'repat'
                AND a.label = 'Repatriation ' || rp.repatriation_number
              LIMIT 1) AS alloc,
           (SELECT a.fx_ok FROM public.trip_cost_allocation(rp.trip_id) a
              WHERE a.source = 'repat'
                AND a.label = 'Repatriation ' || rp.repatriation_number
              LIMIT 1) AS alloc_fx_ok
    FROM public.repatriations rp
    LEFT JOIN public.containers c ON c.id = rp.container_id
    LEFT JOIN public.invoices inv ON inv.id = rp.invoice_id
    WHERE (public.is_platform_admin() OR rp.organization_id = public.current_org_id())
      AND (_from IS NULL OR rp.requested_at::date >= _from)
      AND (_to IS NULL OR rp.requested_at::date <= _to)
  ), fx AS (
    SELECT b.*,
           upper(COALESCE(NULLIF(btrim(b.carrier_cost_currency),''), b.bill_cur)) AS car_cur,
           CASE
             WHEN COALESCE(b.carrier_cost,0) = 0 THEN 1
             WHEN upper(COALESCE(NULLIF(btrim(b.carrier_cost_currency),''), b.bill_cur)) = upper(b.bill_cur) THEN 1
             WHEN COALESCE(b.carrier_fx_rate,0) > 0 THEN b.carrier_fx_rate
             ELSE COALESCE(public.get_fx_rate(b.organization_id,
                                              upper(COALESCE(NULLIF(btrim(b.carrier_cost_currency),''), b.bill_cur)),
                                              upper(b.bill_cur),
                                              COALESCE(b.dispatched_at::date, b.requested_at::date)), 0)
           END AS car_rate
    FROM base b
  ), calc AS (
    SELECT f.*,
           COALESCE(f.carrier_cost,0) * CASE WHEN f.car_rate > 0 THEN f.car_rate ELSE 1 END AS carrier_conv,
           COALESCE(f.inv_total, COALESCE(f.charge_amount,0) + COALESCE(f.handling_amount,0)) AS rev,
           COALESCE(f.alloc,0) AS alloc_cost
    FROM fx f
  )
  SELECT k.id, k.repatriation_number, k.container_number,
         k.origin, k.destination, k.shipping_line, k.status::text,
         k.execution_mode, COALESCE(k.charge_amount,0), COALESCE(k.handling_amount,0),
         k.rev,
         k.other_costs + k.carrier_conv,
         k.alloc_cost,
         k.rev - (k.other_costs + k.carrier_conv) - k.alloc_cost,
         CASE WHEN k.rev > 0 THEN ROUND(((k.rev - (k.other_costs + k.carrier_conv) - k.alloc_cost) / k.rev) * 100, 1) ELSE 0 END,
         k.bill_cur,
         k.invoice_id, k.inv_no, k.inv_status, k.inv_total,
         CASE WHEN k.trip_id IS NOT NULL AND k.alloc IS NOT NULL THEN 'actual'
              WHEN k.trip_id IS NOT NULL THEN 'no_trip_costs'
              ELSE 'estimated' END,
         COALESCE(k.alloc_fx_ok, true),
         COALESCE(k.carrier_cost,0),
         k.car_cur,
         k.carrier_conv,
         (k.car_rate > 0)
  FROM calc k
  ORDER BY k.requested_at DESC;
$function$;