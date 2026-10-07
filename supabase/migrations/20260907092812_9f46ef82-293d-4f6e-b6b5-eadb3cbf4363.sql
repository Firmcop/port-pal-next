-- 1. Reference ("EIR") rates per container size, in USD
CREATE OR REPLACE FUNCTION public.container_reference_rate(_size text)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $$
  SELECT CASE regexp_replace(coalesce(_size,''), '\D', '', 'g')
    WHEN '20' THEN 700::numeric
    WHEN '40' THEN 1700::numeric
    WHEN '45' THEN 1700::numeric
    ELSE NULL::numeric
  END
$$;

-- 2. Live purchase price of a container, in the currency it was invoiced in
CREATE OR REPLACE FUNCTION public.container_purchase_price(_container_id uuid)
RETURNS TABLE(amount numeric, currency text)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _cnum text;
  _org uuid;
  _ccy_count int;
  _ccy text;
  _org_ccy text;
BEGIN
  IF _container_id IS NULL THEN RETURN; END IF;
  SELECT container_number, organization_id INTO _cnum, _org FROM containers WHERE id = _container_id;
  _org := coalesce(_org, current_org_id());
  SELECT upper(coalesce(o.currency,'USD')) INTO _org_ccy FROM organizations o WHERE o.id = _org;

  SELECT count(DISTINCT upper(coalesce(si.currency,'USD'))), min(upper(coalesce(si.currency,'USD')))
    INTO _ccy_count, _ccy
    FROM supplier_invoices si
   WHERE si.reason = 'purchase'
     AND lower(coalesce(si.status,'')) NOT IN ('cancelled','void','credited','draft_void')
     AND (si.container_id = _container_id OR (_cnum IS NOT NULL AND si.reference = _cnum));

  IF coalesce(_ccy_count,0) = 0 THEN
    amount := 0; currency := coalesce(_org_ccy,'USD'); RETURN NEXT; RETURN;
  END IF;

  IF _ccy_count = 1 THEN
    SELECT round(sum(coalesce(si.total_amount,0)),2) INTO amount
      FROM supplier_invoices si
     WHERE si.reason = 'purchase'
       AND lower(coalesce(si.status,'')) NOT IN ('cancelled','void','credited','draft_void')
       AND (si.container_id = _container_id OR (_cnum IS NOT NULL AND si.reference = _cnum));
    currency := _ccy;
    RETURN NEXT; RETURN;
  END IF;

  BEGIN
    SELECT s.purchase INTO amount FROM container_acquisition_split(_container_id, _org_ccy) s;
  EXCEPTION WHEN OTHERS THEN
    amount := NULL;
  END;
  currency := coalesce(_org_ccy,'USD');
  RETURN NEXT;
END;
$$;

-- 3. Snapshot purchase price + reference rate on gate-in EIRs
ALTER TABLE public.eir_records
  ADD COLUMN IF NOT EXISTS purchase_price_snapshot numeric,
  ADD COLUMN IF NOT EXISTS purchase_price_currency text,
  ADD COLUMN IF NOT EXISTS reference_rate numeric;

CREATE OR REPLACE FUNCTION public.set_eir_purchase_snapshot()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _p record;
  _size text;
BEGIN
  IF NEW.eir_type <> 'gate_in' OR NEW.container_id IS NULL THEN RETURN NEW; END IF;
  IF NEW.purchase_price_snapshot IS NULL THEN
    BEGIN
      SELECT * INTO _p FROM container_purchase_price(NEW.container_id);
      NEW.purchase_price_snapshot := _p.amount;
      NEW.purchase_price_currency := coalesce(NEW.purchase_price_currency, _p.currency);
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
  END IF;
  IF NEW.reference_rate IS NULL THEN
    SELECT c.size::text INTO _size FROM containers c WHERE c.id = NEW.container_id;
    NEW.reference_rate := container_reference_rate(_size);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_eir_purchase_snapshot ON public.eir_records;
CREATE TRIGGER trg_eir_purchase_snapshot
  BEFORE INSERT ON public.eir_records
  FOR EACH ROW EXECUTE FUNCTION public.set_eir_purchase_snapshot();

-- backfill existing gate-in records
UPDATE public.eir_records e
   SET reference_rate = container_reference_rate(c.size::text)
  FROM public.containers c
 WHERE c.id = e.container_id AND e.eir_type = 'gate_in' AND e.reference_rate IS NULL;

DO $backfill$
DECLARE r record; p record;
BEGIN
  FOR r IN SELECT id, container_id FROM public.eir_records
            WHERE eir_type = 'gate_in' AND container_id IS NOT NULL AND purchase_price_snapshot IS NULL
  LOOP
    BEGIN
      SELECT * INTO p FROM container_purchase_price(r.container_id);
      UPDATE public.eir_records SET purchase_price_snapshot = p.amount, purchase_price_currency = p.currency WHERE id = r.id;
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
  END LOOP;
END
$backfill$;

-- 4. Supplier purchase-price variance report
CREATE OR REPLACE FUNCTION public.supplier_purchase_price_variance(_from date DEFAULT NULL, _to date DEFAULT NULL)
RETURNS TABLE(
  supplier_id uuid,
  supplier_name text,
  container_id uuid,
  container_number text,
  size text,
  category text,
  invoice_id uuid,
  invoice_number text,
  supplier_ref text,
  issue_date date,
  currency text,
  amount numeric,
  reference_rate numeric,
  reference_rate_converted numeric,
  variance numeric
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE _org uuid := current_org_id();
BEGIN
  RETURN QUERY
  WITH base AS (
    SELECT si.id AS inv_id, si.invoice_number, si.supplier_ref, si.issue_date,
           upper(coalesce(si.currency,'USD')) AS ccy, coalesce(si.total_amount,0) AS amt,
           si.supplier_id AS sup_id, s.name AS sup_name,
           c.id AS cid, c.container_number AS cnum, c.size::text AS csize, c.category::text AS ccat,
           container_reference_rate(c.size::text) AS refrate
      FROM supplier_invoices si
      LEFT JOIN suppliers s ON s.id = si.supplier_id
      LEFT JOIN containers c ON c.id = si.container_id OR (si.container_id IS NULL AND c.container_number = si.reference)
     WHERE si.reason = 'purchase'
       AND lower(coalesce(si.status,'')) NOT IN ('cancelled','void','credited','draft_void')
       AND (si.organization_id = _org OR is_platform_admin())
       AND (_from IS NULL OR si.issue_date >= _from)
       AND (_to IS NULL OR si.issue_date <= _to)
  )
  SELECT b.sup_id, coalesce(b.sup_name, 'Unknown supplier'), b.cid, b.cnum, b.csize, b.ccat,
         b.inv_id, b.invoice_number, b.supplier_ref, b.issue_date, b.ccy, b.amt, b.refrate,
         conv.rr,
         CASE WHEN conv.rr IS NULL THEN NULL ELSE round(b.amt - conv.rr, 2) END
    FROM base b
    CROSS JOIN LATERAL (
      SELECT CASE
               WHEN b.refrate IS NULL THEN NULL
               WHEN b.ccy = 'USD' THEN b.refrate
               ELSE (SELECT round(b.refrate * r, 2) FROM (SELECT get_fx_rate(_org, 'USD', b.ccy, coalesce(b.issue_date, current_date)) AS r) x WHERE x.r IS NOT NULL AND x.r > 0)
             END AS rr
    ) conv
   ORDER BY coalesce(b.sup_name,''), b.csize, b.issue_date DESC NULLS LAST;
END;
$$;

REVOKE ALL ON FUNCTION public.supplier_purchase_price_variance(date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.supplier_purchase_price_variance(date, date) TO authenticated;
REVOKE ALL ON FUNCTION public.container_purchase_price(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.container_purchase_price(uuid) TO authenticated;

-- 5. Full cost journey for one container
CREATE OR REPLACE FUNCTION public.container_cost_journey(_container_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _org uuid;
  _cnum text;
  _org_ccy text;
  _res jsonb;
  _p record;
BEGIN
  IF _container_id IS NULL THEN RETURN '{}'::jsonb; END IF;
  SELECT container_number, organization_id INTO _cnum, _org FROM containers WHERE id = _container_id;
  IF _org IS NOT NULL AND _org <> current_org_id() AND NOT is_platform_admin() THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;
  SELECT upper(coalesce(o.currency,'USD')) INTO _org_ccy FROM organizations o WHERE o.id = coalesce(_org, current_org_id());
  SELECT * INTO _p FROM container_purchase_price(_container_id);

  SELECT jsonb_build_object(
    'purchase_price', _p.amount,
    'purchase_currency', _p.currency,
    'reference_rate', (SELECT container_reference_rate(c.size::text) FROM containers c WHERE c.id = _container_id),
    'org_currency', _org_ccy,
    'invoices', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'id', si.id, 'invoice_number', si.invoice_number, 'supplier_ref', si.supplier_ref,
        'reason', si.reason, 'supplier', s.name, 'issue_date', si.issue_date,
        'currency', upper(coalesce(si.currency,'USD')), 'amount', si.total_amount,
        'paid_amount', si.paid_amount, 'fx_rate', si.fx_rate, 'base_amount', si.base_amount,
        'status', si.status, 'pricing_basis', si.pricing_basis, 'pricing_note', si.pricing_note
      ) ORDER BY si.issue_date, si.created_at)
      FROM supplier_invoices si LEFT JOIN suppliers s ON s.id = si.supplier_id
      WHERE si.reason IN ('purchase','acquisition_transport','acquisition_crane_offloading')
        AND (si.container_id = _container_id OR (_cnum IS NOT NULL AND si.reference = _cnum))
    ), '[]'::jsonb),
    'eirs', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'id', e.id, 'eir_number', e.eir_number, 'eir_type', e.eir_type,
        'created_at', e.created_at, 'condition_grade', e.condition_grade,
        'owner_at_issue', e.owner_at_issue, 'new_owner', e.new_owner,
        'gate_fee_amount', e.gate_fee_amount, 'gate_fee_currency', e.gate_fee_currency,
        'purchase_price_snapshot', e.purchase_price_snapshot,
        'purchase_price_currency', e.purchase_price_currency,
        'reference_rate', e.reference_rate
      ) ORDER BY e.created_at)
      FROM eir_records e WHERE e.container_id = _container_id
    ), '[]'::jsonb),
    'conversions', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'id', cc.id, 'conversion_id', cv.id, 'conversion_number', cv.conversion_number,
        'status', cv.status, 'job_kind', cv.job_kind, 'currency', cv.currency,
        'project_id', cv.project_id,
        'container_cost', cc.container_cost, 'transport_offloading_cost', cc.transport_offloading_cost,
        'role', cc.role, 'attached_at', cc.created_at
      ) ORDER BY cc.created_at)
      FROM conversion_containers cc
      JOIN container_conversions cv ON cv.id = cc.conversion_id
      WHERE cc.container_id = _container_id
    ), '[]'::jsonb),
    'children', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'id', ch.id, 'container_number', ch.container_number, 'size', ch.size,
        'acquisition_cost', ch.acquisition_cost, 'status', ch.status
      ) ORDER BY ch.container_number)
      FROM containers ch WHERE ch.parent_container_id = _container_id
    ), '[]'::jsonb),
    'sales', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'id', cs.id, 'sale_number', cs.sale_number, 'status', cs.status,
        'buyer_name', cs.buyer_name, 'entry_price', cs.entry_price,
        'selling_price', cs.selling_price, 'currency', cs.currency,
        'markup_percentage', cs.markup_percentage, 'sold_at', cs.sold_at,
        'invoice_id', cs.invoice_id, 'invoice_number', i.invoice_number,
        'invoice_total', i.total_amount, 'invoice_currency', i.currency, 'invoice_status', i.status
      ) ORDER BY cs.created_at)
      FROM container_sales cs LEFT JOIN invoices i ON i.id = cs.invoice_id
      WHERE cs.container_id = _container_id
    ), '[]'::jsonb)
  ) INTO _res;

  RETURN _res;
END;
$$;

REVOKE ALL ON FUNCTION public.container_cost_journey(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.container_cost_journey(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.container_reference_rate(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.container_reference_rate(text) TO authenticated;