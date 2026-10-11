-- =====================================================================
-- Queues and scheduled jobs for the port-pal-prod project.
-- A database restore copies tables but not pgmq queues or pg_cron jobs,
-- so they are recreated here. Job names match the old project.
-- 'generate-recurring-opex' is not recreated: it is replaced by
-- 'finance-daily-recurring-expenses' (20261008020000_fix_expenses_projects).
-- The email-queue job is set up separately once the email provider is chosen.
-- =====================================================================

-- Email queues (used by enqueue_email / read_email_batch / move_to_dlq)
DO $$ BEGIN PERFORM pgmq.create('auth_emails');              EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN PERFORM pgmq.create('transactional_emails');     EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN PERFORM pgmq.create('auth_emails_dlq');          EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN PERFORM pgmq.create('transactional_emails_dlq'); EXCEPTION WHEN OTHERS THEN NULL; END $$;

-- Replace any job with the same name so this can be re-run.
DO $$
DECLARE j text;
BEGIN
  FOREACH j IN ARRAY ARRAY['expire-trials-hourly','reconcile-repatriation-ro-mismatches-daily',
    'generate-due-recurring-transfers','process-push-notifications','db_load_daily_snapshot',
    'finance-watchdog-nightly','loan-due-scan-daily','daily-commitment-reminders'] LOOP
    PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = j;
  END LOOP;
END $$;

SELECT cron.schedule('expire-trials-hourly', '0 * * * *', $$SELECT public.expire_trials();$$);
SELECT cron.schedule('reconcile-repatriation-ro-mismatches-daily', '17 2 * * *', $$SELECT public.reconcile_repatriation_ro_mismatches();$$);
SELECT cron.schedule('generate-due-recurring-transfers', '5 * * * *', $$SELECT public.generate_due_recurring_transfers();$$);
SELECT cron.schedule('db_load_daily_snapshot', '5 0 * * *', $$SELECT public.capture_db_load_snapshot(50);$$);
SELECT cron.schedule('loan-due-scan-daily', '0 6 * * *', $$SELECT public.loan_due_scan();$$);
SELECT cron.schedule('daily-commitment-reminders', '0 6 * * *', $$SELECT public.run_commitment_reminders(7);$$);

-- Edge-function jobs (anon key is the public client key of this project)
SELECT cron.schedule('process-push-notifications', '* * * * *', $$
  SELECT CASE WHEN EXISTS (SELECT 1 FROM public.push_notification_queue WHERE status = 'pending' LIMIT 1)
    THEN net.http_post(
      url := 'https://oagthtplaxgbvpijargj.supabase.co/functions/v1/push-notify',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'apikey', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9hZ3RodHBsYXhnYnZwaWphcmdqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTE0NjU5NzYsImV4cCI6MjEwNzA0MTk3Nn0.12FZixqDnM6lz8_naJY5Sc471j0GuREGJ_kg5S0hysI',
        'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9hZ3RodHBsYXhnYnZwaWphcmdqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTE0NjU5NzYsImV4cCI6MjEwNzA0MTk3Nn0.12FZixqDnM6lz8_naJY5Sc471j0GuREGJ_kg5S0hysI'),
      body := '{}'::jsonb)
    ELSE NULL END;
$$);

SELECT cron.schedule('finance-watchdog-nightly', '0 2 * * *', $$
  SELECT net.http_post(
    url := 'https://oagthtplaxgbvpijargj.supabase.co/functions/v1/finance-watchdog-scan',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9hZ3RodHBsYXhnYnZwaWphcmdqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTE0NjU5NzYsImV4cCI6MjEwNzA0MTk3Nn0.12FZixqDnM6lz8_naJY5Sc471j0GuREGJ_kg5S0hysI',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9hZ3RodHBsYXhnYnZwaWphcmdqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTE0NjU5NzYsImV4cCI6MjEwNzA0MTk3Nn0.12FZixqDnM6lz8_naJY5Sc471j0GuREGJ_kg5S0hysI'),
    body := jsonb_build_object('time', now()));
$$);
