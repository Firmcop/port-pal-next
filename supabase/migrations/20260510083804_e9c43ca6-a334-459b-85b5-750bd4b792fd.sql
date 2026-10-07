-- Reports aggregation RPC: returns all dashboard metrics in one round-trip,
-- aggregated server-side so we never hit the 1000-row client cap.
CREATE OR REPLACE FUNCTION public.report_summary(_days int DEFAULT 14)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  _org uuid := public.current_org_id();
  _result jsonb;
BEGIN
  IF _org IS NULL AND NOT public.is_platform_admin() THEN
    RETURN jsonb_build_object('error','no_org');
  END IF;

  WITH
  c AS (
    SELECT * FROM public.containers
    WHERE _org IS NULL OR organization_id = _org
  ),
  m AS (
    SELECT * FROM public.container_movements
    WHERE (_org IS NULL OR organization_id = _org)
      AND created_at >= now() - make_interval(days => _days)
  ),
  inv AS (
    SELECT * FROM public.invoices
    WHERE _org IS NULL OR organization_id = _org
  ),
  wo AS (
    SELECT * FROM public.work_orders
    WHERE _org IS NULL OR organization_id = _org
  ),
  ins AS (
    SELECT * FROM public.inspections
    WHERE _org IS NULL OR organization_id = _org
  ),
  yb AS (
    SELECT * FROM public.yard_blocks
    WHERE _org IS NULL OR organization_id = _org
  ),
  -- KPIs
  kpi AS (
    SELECT
      (SELECT count(*) FROM c) AS total_containers,
      (SELECT count(*) FROM c WHERE block_id IS NOT NULL) AS in_yard,
      (SELECT COALESCE(round(avg(EXTRACT(EPOCH FROM (COALESCE(gate_out_at, now()) - gate_in_at))/86400))::int, 0)
         FROM c WHERE gate_in_at IS NOT NULL) AS avg_dwell_days,
      (SELECT COALESCE(sum(total_amount),0) FROM inv) AS total_revenue,
      (SELECT COALESCE(sum(total_amount),0) FROM inv WHERE status='paid') AS paid_revenue,
      (SELECT count(*) FROM wo) AS work_orders_total,
      (SELECT count(*) FROM wo WHERE status='completed') AS work_orders_completed
  ),
  -- Throughput (last N days, daily buckets)
  throughput AS (
    SELECT jsonb_agg(t ORDER BY t->>'date') AS data FROM (
      SELECT jsonb_build_object(
        'date', to_char(d::date, 'Mon DD'),
        'gate_in', count(*) FILTER (WHERE m.movement_type='gate_in'),
        'gate_out', count(*) FILTER (WHERE m.movement_type='gate_out')
      ) AS t
      FROM generate_series(date_trunc('day', now()) - make_interval(days => _days-1), date_trunc('day', now()), interval '1 day') d
      LEFT JOIN m ON date_trunc('day', m.created_at) = d
      GROUP BY d
    ) s
  ),
  -- Status / category distribution
  status_dist AS (
    SELECT jsonb_agg(jsonb_build_object('name', replace(status::text,'_',' '), 'value', cnt)) AS data
    FROM (SELECT status, count(*) cnt FROM c GROUP BY status) x
  ),
  category_dist AS (
    SELECT jsonb_agg(jsonb_build_object('name', replace(category::text,'_',' '), 'value', cnt)) AS data
    FROM (SELECT category, count(*) cnt FROM c GROUP BY category) x
  ),
  -- Yard utilization
  yard_util AS (
    SELECT jsonb_agg(jsonb_build_object(
      'block', yb.name,
      'used', (SELECT count(*) FROM c WHERE c.block_id = yb.id),
      'capacity', yb.max_bays * yb.max_rows * yb.max_tiers,
      'pct', CASE WHEN yb.max_bays * yb.max_rows * yb.max_tiers > 0
                  THEN round(100.0 * (SELECT count(*) FROM c WHERE c.block_id = yb.id) / (yb.max_bays * yb.max_rows * yb.max_tiers))
                  ELSE 0 END
    )) AS data
    FROM yb
  ),
  -- Revenue
  revenue_by_type AS (
    SELECT jsonb_agg(jsonb_build_object('name', replace(invoice_type::text,'_',' '), 'value', round(sum(total_amount))::int)) AS data
    FROM inv GROUP BY invoice_type
  ),
  revenue_by_status AS (
    SELECT jsonb_agg(jsonb_build_object('name', status::text, 'value', round(sum(total_amount))::int)) AS data
    FROM inv GROUP BY status
  ),
  -- M&R
  wo_status AS (
    SELECT jsonb_agg(jsonb_build_object('name', replace(status::text,'_',' '), 'value', cnt)) AS data
    FROM (SELECT status, count(*) cnt FROM wo GROUP BY status) x
  ),
  wo_priority AS (
    SELECT jsonb_agg(jsonb_build_object('name', priority::text, 'value', cnt)) AS data
    FROM (SELECT priority, count(*) cnt FROM wo GROUP BY priority) x
  ),
  grade_dist AS (
    SELECT jsonb_agg(jsonb_build_object('name', 'Grade ' || condition_grade, 'value', cnt) ORDER BY condition_grade) AS data
    FROM (SELECT condition_grade, count(*) cnt FROM ins GROUP BY condition_grade) x
  ),
  -- Stock by owner / shipping line
  stock_owner AS (
    SELECT jsonb_agg(jsonb_build_object(
      'name', owner_name,
      'total', total, 'available', available, 'damaged', damaged, 'in_repair', in_repair, 'other', other
    ) ORDER BY total DESC) AS data
    FROM (
      SELECT COALESCE(owner,'Unassigned') owner_name,
        count(*) total,
        count(*) FILTER (WHERE status='available') available,
        count(*) FILTER (WHERE status='damaged') damaged,
        count(*) FILTER (WHERE status IN ('in_repair','repair_pending')) in_repair,
        count(*) FILTER (WHERE status NOT IN ('available','damaged','in_repair','repair_pending')) other
      FROM c GROUP BY 1
    ) x
  ),
  stock_line AS (
    SELECT jsonb_agg(jsonb_build_object(
      'name', line_name,
      'total', total, 'available', available, 'damaged', damaged, 'in_repair', in_repair, 'other', other
    ) ORDER BY total DESC) AS data
    FROM (
      SELECT COALESCE(shipping_line,'Unassigned') line_name,
        count(*) total,
        count(*) FILTER (WHERE status='available') available,
        count(*) FILTER (WHERE status='damaged') damaged,
        count(*) FILTER (WHERE status IN ('in_repair','repair_pending')) in_repair,
        count(*) FILTER (WHERE status NOT IN ('available','damaged','in_repair','repair_pending')) other
      FROM c GROUP BY 1
    ) x
  ),
  stock_size_owner AS (
    SELECT jsonb_agg(jsonb_build_object(
      'name', owner_name, '20ft', s20, '40ft', s40, '45ft', s45
    ) ORDER BY (s20+s40+s45) DESC) AS data
    FROM (
      SELECT COALESCE(owner,'Unassigned') owner_name,
        count(*) FILTER (WHERE size::text='20') s20,
        count(*) FILTER (WHERE size::text='40') s40,
        count(*) FILTER (WHERE size::text='45') s45
      FROM c GROUP BY 1
    ) x
  )
  SELECT jsonb_build_object(
    'kpi', to_jsonb(kpi.*),
    'throughput', COALESCE(throughput.data, '[]'::jsonb),
    'status_dist', COALESCE(status_dist.data, '[]'::jsonb),
    'category_dist', COALESCE(category_dist.data, '[]'::jsonb),
    'yard_util', COALESCE(yard_util.data, '[]'::jsonb),
    'revenue_by_type', COALESCE(revenue_by_type.data, '[]'::jsonb),
    'revenue_by_status', COALESCE(revenue_by_status.data, '[]'::jsonb),
    'wo_status', COALESCE(wo_status.data, '[]'::jsonb),
    'wo_priority', COALESCE(wo_priority.data, '[]'::jsonb),
    'grade_dist', COALESCE(grade_dist.data, '[]'::jsonb),
    'stock_owner', COALESCE(stock_owner.data, '[]'::jsonb),
    'stock_line', COALESCE(stock_line.data, '[]'::jsonb),
    'stock_size_owner', COALESCE(stock_size_owner.data, '[]'::jsonb)
  ) INTO _result
  FROM kpi, throughput, status_dist, category_dist, yard_util,
       revenue_by_type, revenue_by_status, wo_status, wo_priority, grade_dist,
       stock_owner, stock_line, stock_size_owner;

  RETURN _result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.report_summary(int) TO authenticated;