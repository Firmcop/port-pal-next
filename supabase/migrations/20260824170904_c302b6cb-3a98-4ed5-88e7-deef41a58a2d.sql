CREATE OR REPLACE FUNCTION public.finance_watchdog_scan(_org uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  org uuid := COALESCE(_org, current_org_id());
  new_count int := 0;
  total int := 0;
  cleared int := 0;
BEGIN
  IF org IS NULL THEN RAISE EXCEPTION 'organization not resolved'; END IF;

  DROP TABLE IF EXISTS _wd;
  CREATE TEMP TABLE _wd ON COMMIT DROP AS
  SELECT * FROM finance_watchdog_detect(org);

  SELECT COUNT(*) INTO total FROM _wd;

  WITH ins AS (
    INSERT INTO ai_findings (organization_id, job, finding_type, severity, entity_table, entity_id,
                             entity_label, title, details, amount, currency, dedupe_key)
    SELECT org, 'finance_watchdog', d.finding_type, d.severity, d.entity_table, d.entity_id,
           d.entity_label, d.title, d.details, d.amount, d.currency, d.dedupe_key
    FROM _wd d
    ON CONFLICT (organization_id, dedupe_key) DO UPDATE
      SET last_seen_at = now(),
          occurrences = ai_findings.occurrences + 1,
          details = EXCLUDED.details,
          amount = EXCLUDED.amount,
          currency = EXCLUDED.currency,
          title = EXCLUDED.title,
          severity = EXCLUDED.severity,
          cleared_at = NULL,
          status = CASE WHEN ai_findings.status = 'resolved' THEN 'open' ELSE ai_findings.status END
    RETURNING (xmax = 0) AS inserted
  )
  SELECT COUNT(*) FILTER (WHERE inserted) INTO new_count FROM ins;

  WITH cl AS (
    UPDATE ai_findings f
       SET status = 'resolved', cleared_at = now(), review_note = COALESCE(f.review_note,'Auto-cleared: no longer detected')
     WHERE f.organization_id = org
       AND f.job = 'finance_watchdog'
       AND f.status IN ('open','acknowledged')
       AND NOT EXISTS (SELECT 1 FROM _wd d WHERE d.dedupe_key = f.dedupe_key)
    RETURNING 1
  )
  SELECT COUNT(*) INTO cleared FROM cl;

  INSERT INTO ai_job_state (organization_id, job, last_run_at, last_run_findings, last_error)
  VALUES (org, 'finance_watchdog', now(), total, NULL)
  ON CONFLICT (organization_id, job) DO UPDATE
    SET last_run_at = now(), last_run_findings = EXCLUDED.last_run_findings, last_error = NULL;

  DROP TABLE IF EXISTS _wd;
  RETURN jsonb_build_object('organization_id', org, 'detected', total, 'new', new_count, 'cleared', cleared);
END;
$$;