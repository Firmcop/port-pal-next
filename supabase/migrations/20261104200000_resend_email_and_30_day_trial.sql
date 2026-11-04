-- =====================================================================
-- Email through Resend + 30-day trials (decided 4 Nov 2026).
--
-- 1. Trials last 30 days: column default and restart_trial.
-- 2. The email queue is drained by a scheduled job every 10 seconds, only
--    when a queue holds a message that is ready. The job proves itself to
--    process-email-queue with a random secret kept in the database vault;
--    email_cron_secret_ok() lets the function check it (service role only).
-- =====================================================================

-- 1. 30-day trials
ALTER TABLE public.organizations ALTER COLUMN trial_ends_at SET DEFAULT (now() + interval '30 days');

CREATE OR REPLACE FUNCTION public.restart_trial(_org_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _new_end timestamptz;
  _restart_count int;
BEGIN
  IF NOT (public.is_org_admin(_org_id) OR public.is_platform_admin()) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  SELECT count(*) INTO _restart_count
    FROM public.org_lifecycle_events
    WHERE organization_id = _org_id AND event_type = 'trial_restarted';
  IF _restart_count >= 1 AND NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'already_restarted';
  END IF;

  _new_end := now() + interval '30 days';
  UPDATE public.organizations
    SET trial_ends_at = _new_end, status = 'trial'::org_status
    WHERE id = _org_id;

  PERFORM public.log_org_event(_org_id, 'trial_restarted',
    jsonb_build_object('new_trial_ends_at', _new_end), auth.uid());

  RETURN jsonb_build_object('ok', true, 'trial_ends_at', _new_end);
END;
$function$;

-- 2. Scheduled sending
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'email_queue_cron_secret') THEN
    PERFORM vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'email_queue_cron_secret',
                                'Sent by the process-email-queue scheduled job');
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.email_cron_secret_ok(_secret text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $$
  SELECT coalesce(_secret IS NOT NULL AND _secret = (
    SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'email_queue_cron_secret' LIMIT 1), false)
$$;
REVOKE ALL ON FUNCTION public.email_cron_secret_ok(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.email_cron_secret_ok(text) TO service_role;

DO $$
BEGIN
  PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'process-email-queue';
END $$;

SELECT cron.schedule('process-email-queue', '10 seconds', $job$
  SELECT CASE
    WHEN (SELECT retry_after_until FROM public.email_send_state LIMIT 1) > now() THEN NULL
    WHEN EXISTS (SELECT 1 FROM pgmq.q_auth_emails WHERE vt <= now())
      OR EXISTS (SELECT 1 FROM pgmq.q_transactional_emails WHERE vt <= now())
    THEN net.http_post(
      url := 'https://oagthtplaxgbvpijargj.supabase.co/functions/v1/process-email-queue',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'apikey', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9hZ3RodHBsYXhnYnZwaWphcmdqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTE0NjU5NzYsImV4cCI6MjEwNzA0MTk3Nn0.12FZixqDnM6lz8_naJY5Sc471j0GuREGJ_kg5S0hysI',
        'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9hZ3RodHBsYXhnYnZwaWphcmdqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTE0NjU5NzYsImV4cCI6MjEwNzA0MTk3Nn0.12FZixqDnM6lz8_naJY5Sc471j0GuREGJ_kg5S0hysI',
        'x-cron-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'email_queue_cron_secret' LIMIT 1)),
      body := '{}'::jsonb,
      timeout_milliseconds := 30000)
    ELSE NULL END;
$job$);
