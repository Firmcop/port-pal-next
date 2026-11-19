-- =====================================================================
-- One set of job figures (19 Nov 2026) — step 2.
--  1. Labour: casual wages paid by M-Pesa sit in 5030 with no job. Each week,
--     the labour recorded against jobs (attendance lines with a job, and labour
--     entered on the job) claims its share of that week's untagged labour cost:
--     the recorded amounts, scaled down if the week's wages were less. What no
--     job claims stays general labour. Re-run nightly for the last 8 weeks.
--  2. Work in progress: while a job is open (not completed, not cancelled and
--     not yet invoiced) its costs are held in 1220 Work in Progress, month by
--     month; they move to cost of sales in the month it is completed, invoiced
--     or cancelled.
--  3. job_ledger_costs: a job's figures straight from the books;
--     project_job_costs now reads them, so job, project and company figures agree.
--  4. Cash to sort: M-Pesa material purchases with no job can be tagged to one.
-- =====================================================================

-- 1. labour --------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.allocate_labour_week(_org uuid, _week_start date)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _from timestamptz; _to timestamptz; _pool numeric; _claim numeric; _f numeric; _gl uuid; _gt text;
        _desired jsonb := '[]'; r record; _ref uuid; _on timestamptz;
BEGIN
  _from := (_week_start::timestamp) AT TIME ZONE 'Africa/Nairobi';
  _to := ((_week_start + 7)::timestamp) AT TIME ZONE 'Africa/Nairobi';
  _ref := md5('labour-allocation:' || _org::text || ':' || _week_start::text)::uuid;
  SELECT id, account_type::text INTO _gl, _gt FROM gl_accounts WHERE organization_id = _org AND code = '5030';
  IF _gl IS NULL THEN RETURN 0; END IF;

  -- this week's wages not yet on any job
  SELECT COALESCE(sum((debit_amount - credit_amount) * COALESCE(fx_rate, 1)), 0) INTO _pool
    FROM accounting_transactions
   WHERE organization_id = _org AND gl_account_id = _gl AND conversion_id IS NULL AND project_id IS NULL
     AND reference_type IS DISTINCT FROM 'labour_allocation'
     AND transaction_date >= _from AND transaction_date < _to;

  -- what jobs recorded this week
  SELECT COALESCE(sum(amt), 0) INTO _claim FROM (SELECT cv, pj, sum(amt) AS amt FROM (
    SELECT al.conversion_id cv, COALESCE(al.project_id, c.project_id) pj, al.amount amt
      FROM attendance_lines al LEFT JOIN container_conversions c ON c.id = al.conversion_id
     WHERE al.organization_id = _org AND COALESCE(al.is_correction, false) = false
       AND (al.conversion_id IS NOT NULL OR al.project_id IS NOT NULL)
       AND al.work_date >= _week_start AND al.work_date < _week_start + 7
    UNION ALL
    SELECT cl.conversion_id, c.project_id, cl.total_cost
      FROM conversion_labour cl JOIN container_conversions c ON c.id = cl.conversion_id
     WHERE cl.organization_id = _org AND COALESCE(cl.source, 'manual') <> 'payroll'   -- payroll rows mirror attendance
       AND cl.created_at >= _from AND cl.created_at < _to
  ) x WHERE amt > 0 GROUP BY 1, 2) cl;
  _f := CASE WHEN _claim <= 0 OR _pool <= 0 THEN 0 ELSE least(1, _pool / _claim) END;

  IF _f > 0 THEN
    FOR r IN SELECT cv, pj, round(amt * _f, 2) a FROM (SELECT cv, pj, sum(amt) AS amt FROM (
    SELECT al.conversion_id cv, COALESCE(al.project_id, c.project_id) pj, al.amount amt
      FROM attendance_lines al LEFT JOIN container_conversions c ON c.id = al.conversion_id
     WHERE al.organization_id = _org AND COALESCE(al.is_correction, false) = false
       AND (al.conversion_id IS NOT NULL OR al.project_id IS NOT NULL)
       AND al.work_date >= _week_start AND al.work_date < _week_start + 7
    UNION ALL
    SELECT cl.conversion_id, c.project_id, cl.total_cost
      FROM conversion_labour cl JOIN container_conversions c ON c.id = cl.conversion_id
     WHERE cl.organization_id = _org AND COALESCE(cl.source, 'manual') <> 'payroll'   -- payroll rows mirror attendance
       AND cl.created_at >= _from AND cl.created_at < _to
  ) x WHERE amt > 0 GROUP BY 1, 2) cl LOOP
      CONTINUE WHEN r.a = 0;
      _desired := _desired
        || jsonb_build_object('gl_account_id', _gl, 'account_type', _gt, 'category', 'labour_allocation',
                              'amount', r.a, 'conversion_id', r.cv, 'project_id', r.pj)
        || jsonb_build_object('gl_account_id', _gl, 'account_type', _gt, 'category', 'labour_allocation',
                              'amount', -r.a);
    END LOOP;
  END IF;

  _on := public.cash_sort_post_date(_org, ((_week_start + 6)::timestamp + time '12:00') AT TIME ZONE 'Africa/Nairobi');
  RETURN public.ledger_sync_tagged(_org, 'labour_allocation', _ref,
           'LABALLOC-' || to_char(_week_start, 'YYYYMMDD'),
           'Casual labour for the week of ' || to_char(_week_start, 'DD Mon YYYY') || ' shared to jobs by recorded labour',
           _on, _desired);
END $$;

CREATE OR REPLACE FUNCTION public.allocate_labour_recent(_weeks int DEFAULT 8)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE o record; w date; _n int := 0;
BEGIN
  FOR o IN SELECT id FROM organizations LOOP
    FOR w IN SELECT generate_series(date_trunc('week', current_date)::date - 7 * (_weeks - 1),
                                    date_trunc('week', current_date)::date, interval '7 days')::date LOOP
      _n := _n + public.allocate_labour_week(o.id, w);
    END LOOP;
  END LOOP;
  RETURN _n;
END $$;

-- 2. work in progress ------------------------------------------------------
-- a job is open at a moment if started, not completed/cancelled and not invoiced yet
CREATE OR REPLACE FUNCTION public.job_open_at(_conversion_id uuid, _at timestamptz)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT c.created_at <= _at
     AND (c.completed_at IS NULL OR c.completed_at > _at)
     AND (c.cancelled_at IS NULL OR c.cancelled_at > _at)
     AND NOT (c.status::text = 'completed' AND c.completed_at IS NULL)
     AND NOT (c.status::text = 'cancelled' AND c.cancelled_at IS NULL)
     AND NOT EXISTS (SELECT 1 FROM accounting_transactions at
                      WHERE at.conversion_id = c.id AND at.account_type = 'revenue'
                        AND at.reference_type = 'invoice' AND at.transaction_date <= _at
                      GROUP BY at.conversion_id HAVING sum(at.credit_amount - at.debit_amount) > 0)
    FROM container_conversions c WHERE c.id = _conversion_id;
$$;

CREATE OR REPLACE FUNCTION public.sync_job_wip(_conversion_id uuid)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE c container_conversions%ROWTYPE; _wip uuid; m date; _end timestamptz; _n int := 0; _open boolean;
        _desired jsonb; r record; _tot numeric; _cur_month date := date_trunc('month', current_date)::date;
BEGIN
  SELECT * INTO c FROM container_conversions WHERE id = _conversion_id;
  IF NOT FOUND THEN RETURN 0; END IF;
  _wip := public.ensure_gl_account(c.organization_id, '1220', 'Work in Progress', 'asset', 'work_in_progress');

  FOR m IN SELECT generate_series(date_trunc('month', c.created_at)::date, _cur_month, interval '1 month')::date LOOP
    -- month end (or now for the current month)
    _end := CASE WHEN m = _cur_month THEN now()
                 ELSE (((m + interval '1 month')::date)::timestamp AT TIME ZONE 'Africa/Nairobi') - interval '1 second' END;
    _open := public.job_open_at(c.id, _end);
    _desired := '[]'::jsonb; _tot := 0;
    -- WIP target at this month end minus target at the previous month end, by cost account
    FOR r IN
      WITH cost AS (
        SELECT at.gl_account_id gl, at.account_type::text t,
               sum((at.debit_amount - at.credit_amount) * COALESCE(at.fx_rate, 1))
                 FILTER (WHERE at.transaction_date <= _end) AS upto_now,
               sum((at.debit_amount - at.credit_amount) * COALESCE(at.fx_rate, 1))
                 FILTER (WHERE at.transaction_date < (m::timestamp AT TIME ZONE 'Africa/Nairobi')) AS upto_prev
          FROM accounting_transactions at JOIN gl_accounts g ON g.id = at.gl_account_id
         WHERE at.conversion_id = c.id AND g.code LIKE '5%'          -- direct job costs
           AND at.account_type IN ('cost_of_goods', 'expense')
           AND at.reference_type IS DISTINCT FROM 'job_wip'
         GROUP BY 1, 2)
      SELECT gl, t,
             round(CASE WHEN _open THEN COALESCE(upto_now, 0) ELSE 0 END
                 - CASE WHEN m > date_trunc('month', c.created_at)::date
                             AND public.job_open_at(c.id, (m::timestamp AT TIME ZONE 'Africa/Nairobi') - interval '1 second')
                        THEN COALESCE(upto_prev, 0) ELSE 0 END, 2) AS mv
        FROM cost
    LOOP
      CONTINUE WHEN r.mv = 0;
      _desired := _desired || jsonb_build_object('gl_account_id', r.gl, 'account_type', r.t, 'category', 'job_wip',
                                                 'amount', -r.mv, 'conversion_id', c.id, 'project_id', c.project_id);
      _tot := _tot + r.mv;
    END LOOP;
    IF _tot <> 0 THEN
      _desired := _desired || jsonb_build_object('gl_account_id', _wip, 'account_type', 'asset', 'category', 'job_wip',
                                                 'amount', _tot, 'conversion_id', c.id, 'project_id', c.project_id);
    END IF;
    _n := _n + public.ledger_sync_tagged(c.organization_id, 'job_wip', md5('job-wip:' || c.id::text || ':' || m::text)::uuid,
              'WIP-' || c.conversion_number || '-' || to_char(m, 'YYYYMM'),
              'Work in progress ' || c.conversion_number || ' — ' || to_char(m, 'Mon YYYY'),
              public.cash_sort_post_date(c.organization_id, CASE WHEN m = _cur_month THEN now() ELSE _end END),
              _desired);
  END LOOP;
  RETURN _n;
END $$;

CREATE OR REPLACE FUNCTION public.sync_all_job_wip()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _n int := 0; c record;
BEGIN
  FOR c IN SELECT id FROM container_conversions LOOP
    _n := _n + public.sync_job_wip(c.id);
  END LOOP;
  RETURN _n;
END $$;

CREATE OR REPLACE FUNCTION public.trg_job_wip_on_status()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  PERFORM public.sync_job_wip(NEW.id);
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'job WIP update failed: %', SQLERRM;
  RETURN NULL;
END $$;
-- named to run after the container posting on the same status change
CREATE OR REPLACE TRIGGER trg_zz_job_wip_on_status AFTER UPDATE OF status ON public.container_conversions
  FOR EACH ROW WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION public.trg_job_wip_on_status();

-- nightly: labour for the last 8 weeks, then WIP for every job
CREATE OR REPLACE FUNCTION public.job_costing_nightly()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  PERFORM public.allocate_labour_recent(8);
  PERFORM public.sync_all_job_wip();
END $$;
REVOKE ALL ON FUNCTION public.job_costing_nightly() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.allocate_labour_week(uuid, date) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.sync_job_wip(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sync_job_wip(uuid) TO authenticated;

DO $$ BEGIN PERFORM cron.unschedule('job-costing-nightly'); EXCEPTION WHEN OTHERS THEN NULL; END $$;
SELECT cron.schedule('job-costing-nightly', '35 0 * * *', 'SELECT public.job_costing_nightly()');

-- 3. job figures from the books ------------------------------------------------
CREATE OR REPLACE VIEW public.job_ledger_costs WITH (security_invoker = on) AS
SELECT c.id AS conversion_id, c.organization_id, c.conversion_number, c.project_id, c.status,
       round(COALESCE(sum(v.k) FILTER (WHERE v.code = '5010' AND NOT v.wip), 0), 2) AS container_cost,
       round(COALESCE(sum(v.k) FILTER (WHERE v.code = '5020' AND NOT v.wip), 0), 2) AS material_cost,
       round(COALESCE(sum(v.k) FILTER (WHERE v.code = '5030' AND NOT v.wip), 0), 2) AS labour_cost,
       round(COALESCE(sum(v.k) FILTER (WHERE v.t IN ('cost_of_goods', 'expense') AND v.code NOT IN ('5010', '5020', '5030') AND NOT v.wip), 0), 2) AS other_cost,
       round(COALESCE(sum(v.k) FILTER (WHERE v.t IN ('cost_of_goods', 'expense') AND NOT v.wip), 0), 2) AS total_cost,
       round(COALESCE(sum(v.k) FILTER (WHERE v.code = '1220'), 0), 2) AS wip_balance,
       round(COALESCE(-sum(v.k) FILTER (WHERE v.t = 'revenue'), 0), 2) AS revenue
  FROM container_conversions c
  LEFT JOIN LATERAL (
    SELECT g.code, at.account_type::text t, at.reference_type = 'job_wip' AS wip,
           (at.debit_amount - at.credit_amount) * COALESCE(at.fx_rate, 1) AS k
      FROM accounting_transactions at JOIN gl_accounts g ON g.id = at.gl_account_id
     WHERE at.conversion_id = c.id
  ) v ON true
 GROUP BY c.id, c.organization_id, c.conversion_number, c.project_id, c.status;
GRANT SELECT ON public.job_ledger_costs TO authenticated;
COMMENT ON VIEW public.job_ledger_costs IS 'A job''s costs and sales from the books (by account). wip_balance = costs held in work in progress.';

CREATE OR REPLACE VIEW public.project_job_costs WITH (security_invoker = on) AS
SELECT j.project_id, j.organization_id,
       sum(j.material_cost) AS material_cost,
       sum(j.labour_cost) AS labour_cost,
       sum(j.other_cost) AS service_cost,
       sum(j.container_cost) AS container_cost,
       sum(j.container_cost + j.material_cost + j.labour_cost + j.other_cost) AS job_cost_total
  FROM job_ledger_costs j
 WHERE j.project_id IS NOT NULL
 GROUP BY j.project_id, j.organization_id;

-- 4. cash to sort: material purchases with no job -------------------------------
CREATE TABLE IF NOT EXISTS public.cash_sort_job_tags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  ledger_line_id uuid NOT NULL UNIQUE REFERENCES public.accounting_transactions(id) ON DELETE CASCADE,
  conversion_id uuid REFERENCES public.container_conversions(id) ON DELETE SET NULL,
  overhead boolean NOT NULL DEFAULT false,
  note text,
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.cash_sort_job_tags ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY cash_sort_job_tags_select ON public.cash_sort_job_tags FOR SELECT TO authenticated
    USING (organization_id = public.current_org_id() OR public.is_platform_admin());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
GRANT SELECT ON public.cash_sort_job_tags TO authenticated;

CREATE OR REPLACE VIEW public.v_cash_to_sort WITH (security_invoker = on) AS
SELECT at.id AS ledger_line_id, at.organization_id, g.code AS holding_code,
       CASE g.code WHEN '2150' THEN 'receipt' WHEN '1099' THEN 'missing_account' ELSE 'material_job' END AS kind,
       at.transaction_date::date AS on_date,
       at.credit_amount + at.debit_amount AS amount,
       (at.credit_amount + at.debit_amount)
         - COALESCE((SELECT sum(a.amount) FROM cash_sort_actions a WHERE a.ledger_line_id = at.id AND a.reversed_at IS NULL), 0) AS remaining,
       regexp_replace(at.description, '^\[review\] ', '') AS description,
       at.reference_type, at.reference_id, at.financial_account_id, at.currency,
       substring(at.description FROM '\(M-Pesa ([A-Z0-9]+)\)') AS mpesa_code
  FROM accounting_transactions at
  JOIN gl_accounts g ON g.id = at.gl_account_id
 WHERE (g.code = '2150' AND at.credit_amount > 0 AND at.reference_type = 'bank_statement_import')
    OR (g.code = '1099' AND at.credit_amount > 0)
    OR (g.code = '5020' AND at.debit_amount > 0 AND at.reference_type = 'bank_statement_import'
        AND at.conversion_id IS NULL AND at.project_id IS NULL
        AND NOT EXISTS (SELECT 1 FROM cash_sort_job_tags t WHERE t.ledger_line_id = at.id));
GRANT SELECT ON public.v_cash_to_sort TO authenticated;

-- jobs that were running on a date (to suggest where materials went)
CREATE OR REPLACE FUNCTION public.jobs_running_on(_on date)
RETURNS TABLE(conversion_id uuid, conversion_number text, label text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT c.id, c.conversion_number,
         c.conversion_number || COALESCE(' — ' || NULLIF(c.product_name, ''), '') || COALESCE(' — ' || cu.company_name, '')
    FROM container_conversions c LEFT JOIN customers cu ON cu.id = c.customer_id
   WHERE c.organization_id = public.current_org_id()
     AND c.created_at::date <= _on + 7
     AND COALESCE(c.completed_at, c.cancelled_at, now())::date >= _on - 7
     AND c.status::text <> 'cancelled'
   ORDER BY c.created_at DESC;
$$;
GRANT EXECUTE ON FUNCTION public.jobs_running_on(date) TO authenticated;

-- tag a purchase to a job (or mark it workshop overhead): only the tag changes
CREATE OR REPLACE FUNCTION public.cash_sort_tag_job(_ledger_line_id uuid, _conversion_id uuid, _note text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE l accounting_transactions%ROWTYPE; _code text; _pj uuid; _amt numeric;
BEGIN
  SELECT * INTO l FROM accounting_transactions WHERE id = _ledger_line_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Line not found'; END IF;
  PERFORM public.assert_finance_writer_for(l.organization_id);
  SELECT code INTO _code FROM gl_accounts WHERE id = l.gl_account_id;
  IF _code <> '5020' OR l.conversion_id IS NOT NULL OR EXISTS (SELECT 1 FROM cash_sort_job_tags t WHERE t.ledger_line_id = l.id) THEN RAISE EXCEPTION 'This line is not waiting for a job'; END IF;
  _amt := l.debit_amount + l.credit_amount;
  IF _conversion_id IS NOT NULL THEN
    SELECT project_id INTO _pj FROM container_conversions WHERE id = _conversion_id AND organization_id = l.organization_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Job not found'; END IF;
    UPDATE accounting_transactions SET conversion_id = _conversion_id, project_id = COALESCE(project_id, _pj) WHERE id = l.id;
    INSERT INTO cash_sort_job_tags (organization_id, ledger_line_id, conversion_id, note)
    VALUES (l.organization_id, l.id, _conversion_id, NULLIF(btrim(COALESCE(_note, '')), ''));
    PERFORM public.sync_job_wip(_conversion_id);
  ELSE
    INSERT INTO cash_sort_job_tags (organization_id, ledger_line_id, overhead, note)
    VALUES (l.organization_id, l.id, true, COALESCE(NULLIF(btrim(COALESCE(_note, '')), ''), 'Workshop overhead'));
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.cash_sort_tag_job(uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cash_sort_tag_job(uuid, uuid, text) TO authenticated;

-- backfill: labour since May, then WIP for every job
DO $$
DECLARE o record; w date;
BEGIN
  FOR o IN SELECT id FROM organizations LOOP
    FOR w IN SELECT generate_series('2026-04-27'::date, date_trunc('week', current_date)::date, interval '7 days')::date LOOP
      PERFORM public.allocate_labour_week(o.id, w);
    END LOOP;
  END LOOP;
END $$;
SELECT public.sync_all_job_wip();
