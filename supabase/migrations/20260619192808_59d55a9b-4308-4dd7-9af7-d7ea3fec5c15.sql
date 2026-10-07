
-- Ensure pg_stat_statements is available
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Snapshot table
CREATE TABLE IF NOT EXISTS public.db_load_snapshots (
  id BIGSERIAL PRIMARY KEY,
  captured_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  queryid BIGINT,
  query_text TEXT NOT NULL,
  calls BIGINT NOT NULL,
  total_ms NUMERIC NOT NULL,
  mean_ms NUMERIC NOT NULL,
  max_ms NUMERIC NOT NULL,
  rows BIGINT NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_db_load_snapshots_captured_at ON public.db_load_snapshots(captured_at DESC);
CREATE INDEX IF NOT EXISTS idx_db_load_snapshots_queryid ON public.db_load_snapshots(queryid);

GRANT SELECT ON public.db_load_snapshots TO authenticated;
GRANT ALL ON public.db_load_snapshots TO service_role;

ALTER TABLE public.db_load_snapshots ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "platform_admin_read_db_load" ON public.db_load_snapshots;
CREATE POLICY "platform_admin_read_db_load" ON public.db_load_snapshots
  FOR SELECT TO authenticated
  USING (public.is_platform_admin());

-- Live top queries (security definer; restricted to platform admins)
CREATE OR REPLACE FUNCTION public.get_top_db_queries(p_limit INT DEFAULT 25)
RETURNS TABLE (
  queryid BIGINT,
  query_text TEXT,
  calls BIGINT,
  total_ms NUMERIC,
  mean_ms NUMERIC,
  max_ms NUMERIC,
  rows BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'permission denied' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
    SELECT s.queryid,
           s.query::text,
           s.calls,
           round(s.total_exec_time::numeric, 2),
           round(s.mean_exec_time::numeric, 2),
           round(s.max_exec_time::numeric, 2),
           s.rows
      FROM pg_stat_statements s
      JOIN pg_database d ON d.oid = s.dbid
     WHERE d.datname = current_database()
     ORDER BY s.total_exec_time DESC
     LIMIT GREATEST(1, LEAST(p_limit, 200));
END;
$$;

REVOKE ALL ON FUNCTION public.get_top_db_queries(INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_top_db_queries(INT) TO authenticated;

-- Capture a snapshot of the top N queries
CREATE OR REPLACE FUNCTION public.capture_db_load_snapshot(p_limit INT DEFAULT 50)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  n INT;
BEGIN
  IF NOT public.is_platform_admin() AND current_user <> 'postgres' THEN
    RAISE EXCEPTION 'permission denied' USING ERRCODE = '42501';
  END IF;
  WITH ins AS (
    INSERT INTO public.db_load_snapshots (queryid, query_text, calls, total_ms, mean_ms, max_ms, rows)
    SELECT s.queryid,
           s.query::text,
           s.calls,
           round(s.total_exec_time::numeric, 2),
           round(s.mean_exec_time::numeric, 2),
           round(s.max_exec_time::numeric, 2),
           s.rows
      FROM pg_stat_statements s
      JOIN pg_database d ON d.oid = s.dbid
     WHERE d.datname = current_database()
     ORDER BY s.total_exec_time DESC
     LIMIT GREATEST(1, LEAST(p_limit, 200))
    RETURNING 1
  )
  SELECT count(*) INTO n FROM ins;
  RETURN n;
END;
$$;

REVOKE ALL ON FUNCTION public.capture_db_load_snapshot(INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.capture_db_load_snapshot(INT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.capture_db_load_snapshot(INT) TO service_role;

-- Detect spikes: compare latest snapshot vs previous one
CREATE OR REPLACE FUNCTION public.get_db_load_spikes(
  p_limit INT DEFAULT 20,
  p_min_total_ms NUMERIC DEFAULT 1000,
  p_growth_factor NUMERIC DEFAULT 2.0
)
RETURNS TABLE (
  queryid BIGINT,
  query_text TEXT,
  prev_total_ms NUMERIC,
  curr_total_ms NUMERIC,
  delta_total_ms NUMERIC,
  growth_factor NUMERIC,
  prev_calls BIGINT,
  curr_calls BIGINT,
  call_delta BIGINT,
  prev_at TIMESTAMPTZ,
  curr_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_curr TIMESTAMPTZ;
  v_prev TIMESTAMPTZ;
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'permission denied' USING ERRCODE = '42501';
  END IF;

  SELECT max(captured_at) INTO v_curr FROM public.db_load_snapshots;
  IF v_curr IS NULL THEN RETURN; END IF;
  SELECT max(captured_at) INTO v_prev FROM public.db_load_snapshots WHERE captured_at < v_curr;
  IF v_prev IS NULL THEN RETURN; END IF;

  RETURN QUERY
    WITH curr AS (
      SELECT * FROM public.db_load_snapshots WHERE captured_at = v_curr
    ), prev AS (
      SELECT * FROM public.db_load_snapshots WHERE captured_at = v_prev
    )
    SELECT c.queryid,
           c.query_text,
           p.total_ms AS prev_total_ms,
           c.total_ms AS curr_total_ms,
           (c.total_ms - p.total_ms) AS delta_total_ms,
           CASE WHEN p.total_ms > 0 THEN round(c.total_ms / p.total_ms, 2) ELSE NULL END AS growth_factor,
           p.calls AS prev_calls,
           c.calls AS curr_calls,
           (c.calls - p.calls) AS call_delta,
           v_prev AS prev_at,
           v_curr AS curr_at
      FROM curr c
      JOIN prev p ON p.queryid = c.queryid
     WHERE c.total_ms >= p_min_total_ms
       AND p.total_ms > 0
       AND (c.total_ms / NULLIF(p.total_ms, 0)) >= p_growth_factor
     ORDER BY (c.total_ms - p.total_ms) DESC
     LIMIT GREATEST(1, LEAST(p_limit, 200));
END;
$$;

REVOKE ALL ON FUNCTION public.get_db_load_spikes(INT, NUMERIC, NUMERIC) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_db_load_spikes(INT, NUMERIC, NUMERIC) TO authenticated;

-- Daily cron at 00:05 UTC; skip if already scheduled
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'db_load_daily_snapshot') THEN
    PERFORM cron.schedule(
      'db_load_daily_snapshot',
      '5 0 * * *',
      $cron$ SELECT public.capture_db_load_snapshot(50); $cron$
    );
  END IF;
END $$;
