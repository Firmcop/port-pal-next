-- 1. Rate cards -------------------------------------------------------------
CREATE TABLE public.repat_rate_cards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL DEFAULT current_org_id() REFERENCES public.organizations(id),
  origin text NOT NULL,
  destination text NOT NULL,
  container_size text NOT NULL DEFAULT '20',
  shipping_line text,
  rate_amount numeric(14,2) NOT NULL DEFAULT 0,
  handling_fee numeric(14,2) NOT NULL DEFAULT 30,
  currency text,
  effective_from date NOT NULL DEFAULT CURRENT_DATE,
  effective_to date,
  is_active boolean NOT NULL DEFAULT true,
  notes text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.repat_rate_cards TO authenticated;
GRANT ALL ON public.repat_rate_cards TO service_role;

ALTER TABLE public.repat_rate_cards ENABLE ROW LEVEL SECURITY;

CREATE POLICY "repat_rate_cards_org_select" ON public.repat_rate_cards
FOR SELECT USING (organization_id = current_org_id() OR is_platform_admin());

CREATE POLICY "repat_rate_cards_org_write" ON public.repat_rate_cards
FOR ALL TO authenticated
USING ((organization_id = current_org_id() OR is_platform_admin())
       AND (has_role(auth.uid(),'admin'::app_role) OR is_platform_admin()
            OR has_permission(auth.uid(),'logistics'::text,'edit'::app_action)))
WITH CHECK ((organization_id = current_org_id() OR is_platform_admin())
       AND (has_role(auth.uid(),'admin'::app_role) OR is_platform_admin()
            OR has_permission(auth.uid(),'logistics'::text,'edit'::app_action)));

CREATE INDEX idx_repat_rate_cards_lookup
  ON public.repat_rate_cards (organization_id, container_size, effective_from DESC);

CREATE TRIGGER set_currency_from_org_trg BEFORE INSERT ON public.repat_rate_cards
FOR EACH ROW EXECUTE FUNCTION public.set_currency_from_org();

CREATE TRIGGER update_repat_rate_cards_updated_at BEFORE UPDATE ON public.repat_rate_cards
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 2. Repatriation columns ----------------------------------------------------
ALTER TABLE public.repatriations
  ADD COLUMN origin text,
  ADD COLUMN rate_card_id uuid REFERENCES public.repat_rate_cards(id) ON DELETE SET NULL,
  ADD COLUMN handling_amount numeric(14,2),
  ADD COLUMN execution_mode text NOT NULL DEFAULT 'own_truck',
  ADD COLUMN carrier_id uuid REFERENCES public.logistics_carriers(id),
  ADD COLUMN carrier_cost numeric(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN trip_id uuid REFERENCES public.logistics_trips(id) ON DELETE SET NULL;

ALTER TABLE public.repatriations
  ADD CONSTRAINT repatriations_execution_mode_check
  CHECK (execution_mode IN ('own_truck','subcontracted'));

-- 3. Rate lookup -------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.lookup_repat_rate(
  _origin text, _destination text, _size text,
  _shipping_line text DEFAULT NULL, _on date DEFAULT CURRENT_DATE
)
RETURNS TABLE(rate_card_id uuid, rate_amount numeric, handling_fee numeric, currency text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT r.id, r.rate_amount, r.handling_fee,
         COALESCE(r.currency, (SELECT o.currency FROM public.organizations o WHERE o.id = r.organization_id), 'USD')
  FROM public.repat_rate_cards r
  WHERE r.organization_id = public.current_org_id()
    AND r.is_active
    AND r.container_size = COALESCE(NULLIF(btrim(_size),''), r.container_size)
    AND lower(btrim(r.destination)) = lower(btrim(COALESCE(_destination,'')))
    AND (NULLIF(btrim(COALESCE(_origin,'')),'') IS NULL
         OR lower(btrim(r.origin)) = lower(btrim(_origin)))
    AND (r.shipping_line IS NULL
         OR lower(btrim(r.shipping_line)) = lower(btrim(COALESCE(_shipping_line,''))))
    AND r.effective_from <= _on
    AND (r.effective_to IS NULL OR r.effective_to >= _on)
  ORDER BY (r.shipping_line IS NOT NULL) DESC, r.effective_from DESC
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.lookup_repat_rate(text,text,text,text,date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.lookup_repat_rate(text,text,text,text,date) TO authenticated, service_role;

-- 4. Preview: handling now honours the repat-level amount ---------------------
CREATE OR REPLACE FUNCTION public.preview_repatriation_bill(_repatriation_id uuid)
RETURNS TABLE(gate_in numeric, storage numeric, storage_days integer, handling numeric,
              repat_fee numeric, currency text, owner text, already_invoiced boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
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
  _currency := COALESCE(NULLIF(_customer_currency,''),
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

-- 5. Trip cost allocation ----------------------------------------------------
CREATE OR REPLACE FUNCTION public.trip_cost_allocation(_trip_id uuid, _basis text DEFAULT 'revenue')
RETURNS TABLE(source text, label text, revenue numeric, allocated_cost numeric, margin numeric, currency text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  _org uuid;
  _total_cost numeric := 0;
  _total_rev numeric := 0;
  _lines int := 0;
  _cur text;
BEGIN
  SELECT t.organization_id INTO _org FROM public.logistics_trips t WHERE t.id = _trip_id;
  IF _org IS NULL THEN RETURN; END IF;
  IF NOT (public.is_platform_admin() OR _org = public.current_org_id()) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  SELECT COALESCE(SUM(c.amount),0) INTO _total_cost
    FROM public.logistics_trip_costs c WHERE c.trip_id = _trip_id;

  CREATE TEMP TABLE _rev_lines (source text, label text, revenue numeric, currency text) ON COMMIT DROP;

  INSERT INTO _rev_lines
  SELECT 'cargo',
         COALESCE('Transport order ' || o.order_number, 'Cargo revenue'),
         r.amount, r.currency
  FROM public.logistics_trip_revenue r
  LEFT JOIN public.logistics_transport_orders o ON o.id = r.transport_order_id
  WHERE r.trip_id = _trip_id;

  INSERT INTO _rev_lines
  SELECT 'repat',
         'Repatriation ' || rp.repatriation_number,
         COALESCE(rp.charge_amount,0) + COALESCE(rp.handling_amount,0),
         (SELECT o.currency FROM public.organizations o WHERE o.id = rp.organization_id)
  FROM public.repatriations rp
  WHERE rp.trip_id = _trip_id;

  SELECT COALESCE(SUM(l.revenue),0), COUNT(*) INTO _total_rev, _lines FROM _rev_lines l;
  IF _lines = 0 THEN RETURN; END IF;
  SELECT COALESCE((SELECT o.currency FROM public.organizations o WHERE o.id = _org),'USD') INTO _cur;

  RETURN QUERY
  SELECT l.source, l.label, l.revenue,
         CASE
           WHEN _basis = 'equal' OR _total_rev <= 0 THEN ROUND(_total_cost / _lines, 2)
           ELSE ROUND(_total_cost * (l.revenue / _total_rev), 2)
         END,
         l.revenue - CASE
           WHEN _basis = 'equal' OR _total_rev <= 0 THEN ROUND(_total_cost / _lines, 2)
           ELSE ROUND(_total_cost * (l.revenue / _total_rev), 2)
         END,
         COALESCE(l.currency, _cur)
  FROM _rev_lines l
  ORDER BY l.source, l.label;
END;
$$;

REVOKE ALL ON FUNCTION public.trip_cost_allocation(uuid,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.trip_cost_allocation(uuid,text) TO authenticated, service_role;

-- 6. Repatriation profitability ----------------------------------------------
CREATE OR REPLACE FUNCTION public.repat_profitability(_from date DEFAULT NULL, _to date DEFAULT NULL)
RETURNS TABLE(
  repatriation_id uuid, repatriation_number text, container_number text,
  origin text, destination text, shipping_line text, status text,
  execution_mode text, charge_amount numeric, handling_amount numeric,
  revenue numeric, direct_cost numeric, allocated_trip_cost numeric,
  margin numeric, margin_pct numeric, currency text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  WITH base AS (
    SELECT rp.*,
           c.container_number,
           COALESCE(rp.charge_amount,0) + COALESCE(rp.handling_amount,0) AS rev,
           COALESCE((SELECT SUM(rc.amount) FROM public.repatriation_costs rc
                      WHERE rc.repatriation_id = rp.id),0)
             + COALESCE(rp.carrier_cost,0) AS direct,
           COALESCE((SELECT a.allocated_cost FROM public.trip_cost_allocation(rp.trip_id) a
                      WHERE a.source = 'repat'
                        AND a.label = 'Repatriation ' || rp.repatriation_number
                      LIMIT 1),0) AS alloc
    FROM public.repatriations rp
    LEFT JOIN public.containers c ON c.id = rp.container_id
    WHERE (public.is_platform_admin() OR rp.organization_id = public.current_org_id())
      AND (_from IS NULL OR rp.requested_at::date >= _from)
      AND (_to IS NULL OR rp.requested_at::date <= _to)
  )
  SELECT b.id, b.repatriation_number, b.container_number,
         b.origin, b.destination, b.shipping_line, b.status::text,
         b.execution_mode, COALESCE(b.charge_amount,0), COALESCE(b.handling_amount,0),
         b.rev, b.direct, b.alloc,
         b.rev - b.direct - b.alloc,
         CASE WHEN b.rev > 0 THEN ROUND(((b.rev - b.direct - b.alloc) / b.rev) * 100, 1) ELSE 0 END,
         COALESCE((SELECT o.currency FROM public.organizations o WHERE o.id = b.organization_id),'USD')
  FROM base b
  ORDER BY b.requested_at DESC;
$$;

REVOKE ALL ON FUNCTION public.repat_profitability(date,date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.repat_profitability(date,date) TO authenticated, service_role;