-- 1. Schema additions
ALTER TABLE public.repatriations
  ADD COLUMN IF NOT EXISTS currency text,
  ADD COLUMN IF NOT EXISTS invoice_id uuid REFERENCES public.invoices(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS rate_amount_applied numeric,
  ADD COLUMN IF NOT EXISTS rate_applied_at timestamptz;

ALTER TABLE public.logistics_trips
  ADD COLUMN IF NOT EXISTS cost_allocation_basis text NOT NULL DEFAULT 'revenue';

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
                 WHERE t.typname = 'logistics_cost_category' AND e.enumlabel = 'driver_salary') THEN
    ALTER TYPE public.logistics_cost_category ADD VALUE 'driver_salary';
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
                 WHERE t.typname = 'logistics_cost_category' AND e.enumlabel = 'mileage') THEN
    ALTER TYPE public.logistics_cost_category ADD VALUE 'mileage';
  END IF;
END $$;

-- 2. Rate card application: as-of date + snapshot + currency
CREATE OR REPLACE FUNCTION public.apply_repat_rate_card(_repatriation_id uuid, _rate_card_id uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _rep record; _card record; _size text; _as_of date;
BEGIN
  SELECT * INTO _rep FROM public.repatriations WHERE id = _repatriation_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'repatriation_not_found'; END IF;
  IF NOT (public.is_platform_admin()
          OR (_rep.organization_id = public.current_org_id()
              AND (public.has_role(auth.uid(),'admin'::app_role)
                   OR public.has_role(auth.uid(),'yard_operator'::app_role)))) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  IF _rep.status::text IN ('completed','cancelled') THEN
    RAISE EXCEPTION 'repatriation_closed_cannot_reprice';
  END IF;

  _as_of := COALESCE(_rep.dispatched_at, _rep.requested_at, now())::date;
  SELECT c.size::text INTO _size FROM public.containers c WHERE c.id = _rep.container_id;

  IF _rate_card_id IS NOT NULL THEN
    SELECT * INTO _card FROM public.repat_rate_cards
      WHERE id = _rate_card_id AND organization_id = _rep.organization_id;
  ELSE
    SELECT rc.* INTO _card FROM public.repat_rate_cards rc
    WHERE rc.organization_id = _rep.organization_id AND rc.is_active
      AND rc.container_size = COALESCE(_size, rc.container_size)
      AND lower(btrim(rc.destination)) = lower(btrim(COALESCE(_rep.destination,'')))
      AND (NULLIF(btrim(COALESCE(_rep.origin,'')),'') IS NULL
           OR lower(btrim(rc.origin)) = lower(btrim(_rep.origin)))
      AND (rc.shipping_line IS NULL
           OR lower(btrim(rc.shipping_line)) = lower(btrim(COALESCE(_rep.shipping_line,''))))
      AND rc.effective_from <= _as_of
      AND (rc.effective_to IS NULL OR rc.effective_to >= _as_of)
    ORDER BY (rc.shipping_line IS NOT NULL) DESC, rc.effective_from DESC
    LIMIT 1;
  END IF;

  IF _card.id IS NULL THEN RAISE EXCEPTION 'repat_rate_card_not_found'; END IF;

  UPDATE public.repatriations
     SET rate_card_id = _card.id,
         charge_amount = _card.rate_amount,
         handling_amount = _card.handling_fee,
         rate_amount_applied = _card.rate_amount,
         rate_applied_at = now(),
         currency = COALESCE(NULLIF(btrim(_card.currency),''), currency,
                             (SELECT o.currency FROM public.organizations o WHERE o.id = _rep.organization_id)),
         origin = COALESCE(NULLIF(btrim(origin),''), _card.origin)
   WHERE id = _repatriation_id;

  RETURN _card.id;
END;
$function$;

-- 3. Preview honours the repatriation currency
CREATE OR REPLACE FUNCTION public.preview_repatriation_bill(_repatriation_id uuid)
 RETURNS TABLE(gate_in numeric, storage numeric, storage_days integer, handling numeric, repat_fee numeric, currency text, owner text, already_invoiced boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _rep record; _c record; _tariff record;
  _org uuid; _owner text;
  _currency text; _customer_currency text;
  _rate numeric := 0; _free int := 0;
  _dwell int := 0; _billable int := 0;
  _gate_out_at timestamptz;
  _existing uuid;
BEGIN
  SELECT * INTO _rep FROM public.repatriations WHERE id = _repatriation_id;
  IF NOT FOUND THEN RETURN; END IF;
  _org := _rep.organization_id;
  IF _rep.container_id IS NULL THEN RETURN; END IF;
  SELECT * INTO _c FROM public.containers WHERE id = _rep.container_id;
  IF NOT FOUND THEN RETURN; END IF;
  _owner := btrim(COALESCE(_c.owner,''));

  SELECT c.currency INTO _customer_currency FROM public.customers c
    WHERE c.organization_id = _org AND lower(btrim(c.company_name)) = lower(_owner)
    LIMIT 1;
  _currency := COALESCE(NULLIF(btrim(_rep.currency),''),
                        NULLIF(_customer_currency,''),
                        (SELECT o.currency FROM public.organizations o WHERE o.id = _org),
                        'USD');

  SELECT t.* INTO _tariff
  FROM public.tariffs t
  WHERE t.organization_id = _org AND t.is_active = true
    AND t.container_size = _c.size::text AND t.container_category = _c.category::text
    AND (t.container_category <> 'dry' OR t.height_class::text = COALESCE(_c.height_class::text,'LC'))
  ORDER BY t.updated_at DESC LIMIT 1;

  _rate := COALESCE(_tariff.rate_per_day, 0);
  _free := COALESCE(_tariff.free_days, 0);
  _gate_out_at := COALESCE(_rep.dispatched_at, _c.gate_out_at, now());
  IF _c.gate_in_at IS NOT NULL AND _rate > 0 THEN
    _dwell := GREATEST(0, CEIL(EXTRACT(EPOCH FROM (_gate_out_at - _c.gate_in_at)) / 86400.0)::int);
    _billable := GREATEST(0, _dwell - _free);
  END IF;

  SELECT id INTO _existing FROM public.invoices
    WHERE organization_id = _org AND invoice_number = 'REP-' || _rep.repatriation_number LIMIT 1;

  RETURN QUERY SELECT
    COALESCE(_tariff.gate_in_fee, 0)::numeric,
    (_rate * _billable)::numeric,
    _billable,
    COALESCE(_rep.handling_amount, _tariff.handling_fee, 0)::numeric,
    COALESCE(_rep.charge_amount, 0)::numeric,
    _currency,
    _owner,
    (_existing IS NOT NULL);
END;
$function$;

-- 4. Billing: repatriation currency, explicit transport + handling lines, invoice link
CREATE OR REPLACE FUNCTION public.bill_repatriation_to_owner(_repatriation_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _rep record; _c record; _org uuid; _owner text;
  _customer_id uuid; _customer_currency text; _currency text;
  _gate_in_amt numeric := 0; _storage_amt numeric := 0;
  _handling_amt numeric := 0; _repat_amt numeric := 0;
  _dwell_days int := 0; _billable_days int := 0;
  _rate_per_day numeric := 0; _free_days int := 0;
  _gate_out_at timestamptz;
  _tariff record; _invoice_id uuid; _existing_invoice uuid;
  _invoice_number text; _subtotal numeric := 0;
  _route text; _size text;
BEGIN
  SELECT * INTO _rep FROM public.repatriations WHERE id = _repatriation_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'repatriation_not_found'; END IF;
  _org := _rep.organization_id;

  IF NOT (
    public.is_platform_admin()
    OR public.has_role(auth.uid(),'admin'::app_role)
    OR public.has_role(auth.uid(),'yard_operator'::app_role)
    OR public.has_role(auth.uid(),'gate_clerk'::app_role)
  ) THEN
    RAISE EXCEPTION 'forbidden_role';
  END IF;

  IF _rep.container_id IS NULL THEN RAISE EXCEPTION 'repatriation_no_container'; END IF;
  SELECT * INTO _c FROM public.containers WHERE id = _rep.container_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'container_not_found'; END IF;
  _size := _c.size::text;

  _owner := btrim(COALESCE(_c.owner, ''));
  IF _owner = '' THEN RAISE EXCEPTION 'repatriation_owner_missing'; END IF;

  _invoice_number := 'REP-' || _rep.repatriation_number;
  SELECT id INTO _existing_invoice FROM public.invoices
    WHERE organization_id = _org AND invoice_number = _invoice_number LIMIT 1;
  IF _existing_invoice IS NOT NULL THEN
    UPDATE public.repatriations SET invoice_id = _existing_invoice WHERE id = _repatriation_id;
    RAISE EXCEPTION 'repatriation_already_invoiced';
  END IF;

  _customer_id := public.find_or_create_customer_by_name(_org, _owner);
  SELECT currency INTO _customer_currency FROM public.customers WHERE id = _customer_id;
  _currency := COALESCE(NULLIF(btrim(_rep.currency),''),
                        NULLIF(btrim(_customer_currency),''),
                        (SELECT currency FROM public.organizations WHERE id = _org), 'USD');

  SELECT t.* INTO _tariff
  FROM public.tariffs t
  WHERE t.organization_id = _org AND t.is_active = true
    AND t.container_size = _size AND t.container_category = _c.category::text
    AND (t.container_category <> 'dry' OR t.height_class::text = COALESCE(_c.height_class::text,'LC'))
  ORDER BY t.updated_at DESC LIMIT 1;

  IF _tariff.id IS NOT NULL THEN
    _gate_in_amt := COALESCE(_tariff.gate_in_fee, 0);
    _rate_per_day := COALESCE(_tariff.rate_per_day, 0);
    _free_days := COALESCE(_tariff.free_days, 0);
  END IF;
  _handling_amt := COALESCE(_rep.handling_amount, _tariff.handling_fee, 0);

  _gate_out_at := COALESCE(_rep.dispatched_at, _c.gate_out_at, now());
  IF _c.gate_in_at IS NOT NULL AND _gate_out_at IS NOT NULL AND _rate_per_day > 0 THEN
    _dwell_days := GREATEST(0, CEIL(EXTRACT(EPOCH FROM (_gate_out_at - _c.gate_in_at)) / 86400.0)::int);
    _billable_days := GREATEST(0, _dwell_days - _free_days);
    _storage_amt := _rate_per_day * _billable_days;
  END IF;

  _repat_amt := COALESCE(_rep.charge_amount, 0);
  _route := NULLIF(btrim(COALESCE(_rep.origin,'') || CASE WHEN COALESCE(_rep.origin,'') <> '' THEN ' -> ' ELSE '' END || COALESCE(_rep.destination,'')), '');

  _subtotal := _gate_in_amt + _storage_amt + _handling_amt + _repat_amt;
  IF _subtotal <= 0 THEN RAISE EXCEPTION 'repatriation_nothing_to_bill'; END IF;

  INSERT INTO public.invoices (
    invoice_number, customer_name, container_id, invoice_type,
    subtotal, tax_rate, tax_amount, total_amount, currency, status,
    created_by, organization_id, source_eir_id, notes
  ) VALUES (
    _invoice_number, _owner, _c.id, 'other',
    _subtotal, 0, 0, _subtotal, _currency, 'draft',
    auth.uid(), _org, _rep.eir_id,
    'Repatriation invoice for ' || _rep.repatriation_number
  ) RETURNING id INTO _invoice_id;

  IF _gate_in_amt > 0 THEN
    INSERT INTO public.invoice_line_items (invoice_id, description, quantity, unit_price, total_price, charge_type, organization_id)
    VALUES (_invoice_id, 'Gate-in fee - ' || _c.container_number, 1, _gate_in_amt, _gate_in_amt, 'gate_fee', _org);
  END IF;
  IF _storage_amt > 0 THEN
    INSERT INTO public.invoice_line_items (invoice_id, description, quantity, unit_price, total_price, charge_type, organization_id, period_from, period_to)
    VALUES (_invoice_id,
            'Storage - ' || _c.container_number || ' (' || _billable_days || ' billable days, ' || _dwell_days || ' dwell)',
            _billable_days, _rate_per_day, _storage_amt, 'storage', _org, _c.gate_in_at, _gate_out_at);
  END IF;
  IF _repat_amt > 0 THEN
    INSERT INTO public.invoice_line_items (invoice_id, description, quantity, unit_price, total_price, charge_type, organization_id)
    VALUES (_invoice_id,
            'Repatriation transport' || COALESCE(' - ' || _route, '') || ' - ' || _c.container_number
              || ' (' || COALESCE(_size,'') || 'ft, ' || _rep.repatriation_number || ')',
            1, _repat_amt, _repat_amt, 'other', _org);
  END IF;
  IF _handling_amt > 0 THEN
    INSERT INTO public.invoice_line_items (invoice_id, description, quantity, unit_price, total_price, charge_type, organization_id)
    VALUES (_invoice_id, 'Handling - ' || _c.container_number || ' (' || _rep.repatriation_number || ')',
            1, _handling_amt, _handling_amt, 'handling', _org);
  END IF;

  UPDATE public.repatriations
     SET invoice_id = _invoice_id,
         currency = COALESCE(NULLIF(btrim(currency),''), _currency)
   WHERE id = _repatriation_id;

  PERFORM public.log_org_event(_org, 'repatriation_invoiced',
    jsonb_build_object('invoice_id', _invoice_id, 'invoice_number', _invoice_number,
      'repatriation_id', _repatriation_id, 'repatriation_number', _rep.repatriation_number,
      'container_id', _c.id, 'container_number', _c.container_number, 'owner', _owner,
      'currency', _currency, 'total', _subtotal, 'gate_in', _gate_in_amt,
      'storage', _storage_amt, 'storage_days', _billable_days,
      'handling', _handling_amt, 'repat_fee', _repat_amt, 'route', _route));

  RETURN _invoice_id;
END;
$function$;

-- 5. Trip cost allocation: trip basis, per-line currency conversion, fx flag
DROP FUNCTION IF EXISTS public.trip_cost_allocation(uuid, text);
CREATE OR REPLACE FUNCTION public.trip_cost_allocation(_trip_id uuid, _basis text DEFAULT NULL::text)
 RETURNS TABLE(source text, label text, revenue numeric, allocated_cost numeric, margin numeric, currency text, cost_currency text, fx_ok boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _org uuid;
  _total_cost numeric := 0;
  _total_rev numeric := 0;
  _lines int := 0;
  _cur text;
  _trip record;
  _use_basis text;
BEGIN
  SELECT t.* INTO _trip FROM public.logistics_trips t WHERE t.id = _trip_id;
  IF _trip.id IS NULL THEN RETURN; END IF;
  _org := _trip.organization_id;
  IF NOT (public.is_platform_admin() OR _org = public.current_org_id()) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  _use_basis := COALESCE(NULLIF(btrim(_basis),''), _trip.cost_allocation_basis, 'revenue');

  SELECT COALESCE((SELECT o.currency FROM public.organizations o WHERE o.id = _org),'USD') INTO _cur;

  SELECT COALESCE(SUM(c.amount),0) INTO _total_cost
    FROM public.logistics_trip_costs c WHERE c.trip_id = _trip_id;

  CREATE TEMP TABLE _rev_lines (source text, label text, revenue numeric, currency text) ON COMMIT DROP;

  INSERT INTO _rev_lines
  SELECT 'cargo',
         COALESCE('Transport order ' || o.order_number, 'Cargo revenue'),
         r.amount, COALESCE(r.currency, _cur)
  FROM public.logistics_trip_revenue r
  LEFT JOIN public.logistics_transport_orders o ON o.id = r.transport_order_id
  WHERE r.trip_id = _trip_id;

  INSERT INTO _rev_lines
  SELECT 'repat',
         'Repatriation ' || rp.repatriation_number,
         COALESCE(rp.charge_amount,0) + COALESCE(rp.handling_amount,0),
         COALESCE(NULLIF(btrim(rp.currency),''), _cur)
  FROM public.repatriations rp
  WHERE rp.trip_id = _trip_id;

  SELECT COALESCE(SUM(l.revenue),0), COUNT(*) INTO _total_rev, _lines FROM _rev_lines l;
  IF _lines = 0 THEN RETURN; END IF;

  RETURN QUERY
  WITH raw AS (
    SELECT l.source, l.label, l.revenue, l.currency,
           CASE
             WHEN _use_basis = 'equal' OR _total_rev <= 0 THEN ROUND(_total_cost / _lines, 2)
             ELSE ROUND(_total_cost * (l.revenue / NULLIF(_total_rev,0)), 2)
           END AS cost_in_org_ccy
    FROM _rev_lines l
  ), conv AS (
    SELECT r.*,
           CASE WHEN upper(r.currency) = upper(_cur) THEN 1::numeric
                ELSE (SELECT fr.rate FROM public.fx_rates fr
                       WHERE fr.organization_id = _org
                         AND upper(fr.from_currency) = upper(_cur)
                         AND upper(fr.to_currency) = upper(r.currency)
                         AND fr.rate_date <= COALESCE(_trip.trip_date, CURRENT_DATE)
                       ORDER BY fr.rate_date DESC LIMIT 1)
           END AS fx
    FROM raw r
  )
  SELECT c.source, c.label, c.revenue,
         ROUND(c.cost_in_org_ccy * COALESCE(c.fx, 1), 2),
         c.revenue - ROUND(c.cost_in_org_ccy * COALESCE(c.fx, 1), 2),
         c.currency,
         _cur,
         (c.fx IS NOT NULL)
  FROM conv c
  ORDER BY c.source, c.label;
END;
$function$;

-- 6. Profitability: invoice-driven revenue, repat currency, cost basis flag
DROP FUNCTION IF EXISTS public.repat_profitability(date, date);
CREATE OR REPLACE FUNCTION public.repat_profitability(_from date DEFAULT NULL::date, _to date DEFAULT NULL::date)
 RETURNS TABLE(repatriation_id uuid, repatriation_number text, container_number text, origin text, destination text,
               shipping_line text, status text, execution_mode text, charge_amount numeric, handling_amount numeric,
               revenue numeric, direct_cost numeric, allocated_trip_cost numeric, margin numeric, margin_pct numeric,
               currency text, invoice_id uuid, invoice_number text, invoice_status text, invoice_total numeric,
               cost_basis text, fx_ok boolean)
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
           COALESCE((SELECT SUM(rc.amount) FROM public.repatriation_costs rc
                      WHERE rc.repatriation_id = rp.id),0)
             + COALESCE(rp.carrier_cost,0) AS direct,
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
  ), calc AS (
    SELECT b.*,
           COALESCE(b.inv_total, COALESCE(b.charge_amount,0) + COALESCE(b.handling_amount,0)) AS rev,
           COALESCE(b.alloc,0) AS alloc_cost
    FROM base b
  )
  SELECT k.id, k.repatriation_number, k.container_number,
         k.origin, k.destination, k.shipping_line, k.status::text,
         k.execution_mode, COALESCE(k.charge_amount,0), COALESCE(k.handling_amount,0),
         k.rev, k.direct, k.alloc_cost,
         k.rev - k.direct - k.alloc_cost,
         CASE WHEN k.rev > 0 THEN ROUND(((k.rev - k.direct - k.alloc_cost) / k.rev) * 100, 1) ELSE 0 END,
         COALESCE(NULLIF(btrim(k.currency),''), NULLIF(btrim(k.inv_currency),''),
                  (SELECT o.currency FROM public.organizations o WHERE o.id = k.organization_id),'USD'),
         k.invoice_id, k.inv_no, k.inv_status, k.inv_total,
         CASE WHEN k.trip_id IS NOT NULL AND k.alloc IS NOT NULL THEN 'actual'
              WHEN k.trip_id IS NOT NULL THEN 'no_trip_costs'
              ELSE 'estimated' END,
         COALESCE(k.alloc_fx_ok, true)
  FROM calc k
  ORDER BY k.requested_at DESC;
$function$;

-- 7. Backfill currency from matching rate cards, and invoice links
UPDATE public.repatriations rp
   SET currency = rc.currency
  FROM public.repat_rate_cards rc, public.containers c
 WHERE rp.currency IS NULL
   AND c.id = rp.container_id
   AND rc.organization_id = rp.organization_id
   AND rc.is_active
   AND rc.container_size = c.size::text
   AND lower(btrim(rc.destination)) = lower(btrim(COALESCE(rp.destination,'')))
   AND NULLIF(btrim(rc.currency),'') IS NOT NULL;

UPDATE public.repatriations rp
   SET invoice_id = inv.id
  FROM public.invoices inv
 WHERE rp.invoice_id IS NULL
   AND inv.organization_id = rp.organization_id
   AND inv.invoice_number = 'REP-' || rp.repatriation_number;