-- =====================================================================
-- Notifications for conversion jobs (11 Nov 2026).
-- Nothing told anyone when a job was created or moved on, so production
-- and sales staff had to go looking. Now an in-app notification (and a
-- web push unless the person switched "Conversion Jobs" push off in
-- Settings > Notifications) goes out when a job is
--   created, started, completed, cancelled, or linked to a project.
-- Recipients: admins, production managers, sales managers and the project's
-- manager, except the person who made the change. The bell and the push
-- open the job (/conversions/<id>).
-- =====================================================================
CREATE OR REPLACE FUNCTION public.trg_notify_conversion_job()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  _actor uuid := auth.uid();
  _event text; _title text; _msg text; _what text; _p_name text; _p_code text; _p_mgr uuid; _cust text; _u uuid; _n uuid;
BEGIN
  IF TG_OP = 'INSERT' THEN
    _event := 'created';
  ELSIF NEW.status IS DISTINCT FROM OLD.status AND NEW.status::text IN ('in_progress', 'completed', 'cancelled') THEN
    _event := NEW.status::text;
  ELSIF NEW.project_id IS DISTINCT FROM OLD.project_id AND NEW.project_id IS NOT NULL THEN
    _event := 'linked';
  ELSE
    RETURN NEW;
  END IF;

  SELECT name, code, manager_user_id INTO _p_name, _p_code, _p_mgr FROM projects WHERE id = NEW.project_id;
  SELECT company_name INTO _cust FROM customers WHERE id = NEW.customer_id;
  _what := coalesce(
    NULLIF(btrim(NEW.product_name), ''),
    CASE WHEN coalesce(NEW.description, '') !~* '^\s*(from quote|production for)' 
         THEN NULLIF(btrim(left(split_part(coalesce(NEW.description, ''), E'\n', 1), 60)), '') END,
    initcap(replace(coalesce(NEW.product_type::text, NEW.job_kind::text, 'conversion'), '_', ' ')) || ' job');

  _title := CASE _event
    WHEN 'created' THEN 'New conversion job ' || NEW.conversion_number
    WHEN 'in_progress' THEN 'Job started: ' || NEW.conversion_number
    WHEN 'completed' THEN 'Job completed: ' || NEW.conversion_number
    WHEN 'cancelled' THEN 'Job cancelled: ' || NEW.conversion_number
    ELSE NEW.conversion_number || ' linked to project ' || coalesce(_p_code, _p_name, '') END;
  _msg := _what || coalesce(' — ' || _cust, '') || coalesce(' · Project ' || coalesce(_p_code || ' ' || _p_name, _p_name), '');

  FOR _u IN
    SELECT DISTINCT r.user_id FROM user_roles r
      JOIN organization_members m ON m.user_id = r.user_id AND m.organization_id = NEW.organization_id AND m.status = 'active'
     WHERE r.role::text IN ('admin', 'production_manager', 'sales_manager')
    UNION
    SELECT _p_mgr WHERE _p_mgr IS NOT NULL
  LOOP
    CONTINUE WHEN _u IS NULL OR _u IS NOT DISTINCT FROM _actor;
    -- cancel_conversion() already tells admins, yard operators and gate clerks
    CONTINUE WHEN _event = 'cancelled' AND EXISTS (SELECT 1 FROM user_roles x WHERE x.user_id = _u
                                                    AND x.role::text IN ('admin', 'yard_operator', 'gate_clerk'));
    INSERT INTO notifications (user_id, organization_id, title, message, type, reference_id, reference_type)
    VALUES (_u, NEW.organization_id, _title, _msg, 'conversion', NEW.id, 'container_conversions')
    RETURNING id INTO _n;
    IF NOT EXISTS (SELECT 1 FROM notification_preferences p
                    WHERE p.user_id = _u AND p.event_category = 'conversion_jobs' AND p.channel = 'web_push' AND NOT p.enabled) THEN
      BEGIN
        INSERT INTO push_notification_queue (notification_id, channel, recipient, payload, status)
        VALUES (_n, 'web_push', _u::text,
                jsonb_build_object('title', _title, 'body', _msg, 'url', '/conversions/' || NEW.id::text), 'pending');
      EXCEPTION WHEN OTHERS THEN NULL;
      END;
    END IF;
  END LOOP;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- a notification problem must never block saving the job
  RAISE WARNING 'conversion job notification failed: %', SQLERRM;
  RETURN NEW;
END $$;

CREATE OR REPLACE TRIGGER trg_notify_conversion_job
AFTER INSERT OR UPDATE OF status, project_id ON public.container_conversions
FOR EACH ROW EXECUTE FUNCTION public.trg_notify_conversion_job();

-- push_notification_queue.status allows pending/sent/failed: 'queued' made every
-- push insert fail silently (here and in notify_approval_target).
DO $$
DECLARE _f text; _def text;
BEGIN
  FOREACH _f IN ARRAY ARRAY['trg_notify_conversion_job', 'notify_approval_target'] LOOP
    SELECT pg_get_functiondef(p.oid) INTO _def FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = _f;
    IF position('''queued''' IN _def) > 0 THEN
      EXECUTE replace(_def, '''queued''', '''pending''');
    END IF;
  END LOOP;
END $$;
