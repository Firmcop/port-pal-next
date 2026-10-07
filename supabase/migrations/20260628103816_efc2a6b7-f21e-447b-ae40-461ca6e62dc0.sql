
-- 1. Approval events audit table
CREATE TABLE IF NOT EXISTS public.approval_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  request_id uuid NOT NULL REFERENCES public.approval_requests(id) ON DELETE CASCADE,
  doc_type text NOT NULL,
  doc_id uuid NOT NULL,
  action text NOT NULL CHECK (action IN ('submitted','assigned','reassigned','approved','rejected','commented')),
  actor_id uuid,
  from_user uuid,
  to_user uuid,
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT ON public.approval_events TO authenticated;
GRANT ALL ON public.approval_events TO service_role;
ALTER TABLE public.approval_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "approval_events org read"
  ON public.approval_events FOR SELECT TO authenticated
  USING (organization_id = current_org_id() OR is_platform_admin());

CREATE POLICY "approval_events service insert"
  ON public.approval_events FOR INSERT TO authenticated
  WITH CHECK (organization_id = current_org_id());

CREATE INDEX IF NOT EXISTS approval_events_doc_idx
  ON public.approval_events(doc_type, doc_id, created_at DESC);
CREATE INDEX IF NOT EXISTS approval_events_request_idx
  ON public.approval_events(request_id, created_at DESC);

-- 2. Notification helper
CREATE OR REPLACE FUNCTION public.notify_approval_target(
  _user_id uuid, _org_id uuid, _title text, _message text,
  _doc_type text, _doc_id uuid
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n_id uuid;
BEGIN
  IF _user_id IS NULL THEN RETURN; END IF;
  INSERT INTO public.notifications(user_id, organization_id, title, message, type, reference_id, reference_type)
  VALUES (_user_id, _org_id, _title, _message, 'approval', _doc_id, _doc_type)
  RETURNING id INTO n_id;

  -- Queue push (web/whatsapp dispatcher reads this)
  BEGIN
    INSERT INTO public.push_notification_queue(notification_id, channel, recipient, payload, status)
    VALUES (n_id, 'web_push', _user_id::text,
      jsonb_build_object('title', _title, 'body', _message,
        'url', CASE _doc_type
          WHEN 'quote' THEN '/quotes?open=' || _doc_id::text
          WHEN 'purchase_order' THEN '/purchase-orders?open=' || _doc_id::text
          WHEN 'payment' THEN '/finance/payments?open=' || _doc_id::text
          WHEN 'vendor_payment' THEN '/finance/vendor-payments?open=' || _doc_id::text
          WHEN 'repatriation' THEN '/repatriations?open=' || _doc_id::text
          WHEN 'eir' THEN '/eir?open=' || _doc_id::text
          ELSE '/finance/approvals' END),
      'queued');
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
END $$;

-- 3. Trigger on approval_requests
CREATE OR REPLACE FUNCTION public.approval_requests_audit_notify()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_title text; v_msg text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.approval_events(organization_id, request_id, doc_type, doc_id, action, actor_id, to_user)
    VALUES (NEW.organization_id, NEW.id, NEW.doc_type, NEW.doc_id, 'submitted', NEW.requested_by, NEW.assigned_to);

    IF NEW.assigned_to IS NOT NULL THEN
      INSERT INTO public.approval_events(organization_id, request_id, doc_type, doc_id, action, actor_id, to_user)
      VALUES (NEW.organization_id, NEW.id, NEW.doc_type, NEW.doc_id, 'assigned', NEW.requested_by, NEW.assigned_to);
    END IF;

    IF NEW.status = 'pending' THEN
      v_title := 'Approval needed: ' || NEW.doc_type;
      v_msg := COALESCE('Amount ' || NEW.amount::text, 'A document') || ' is waiting for your approval.';
      PERFORM public.notify_approval_target(NEW.assigned_to, NEW.organization_id, v_title, v_msg, NEW.doc_type, NEW.doc_id);
    END IF;

  ELSIF TG_OP = 'UPDATE' THEN
    -- Reassignment
    IF NEW.assigned_to IS DISTINCT FROM OLD.assigned_to THEN
      INSERT INTO public.approval_events(organization_id, request_id, doc_type, doc_id, action, actor_id, from_user, to_user)
      VALUES (NEW.organization_id, NEW.id, NEW.doc_type, NEW.doc_id, 'reassigned', auth.uid(), OLD.assigned_to, NEW.assigned_to);
      PERFORM public.notify_approval_target(NEW.assigned_to, NEW.organization_id,
        'Approval reassigned to you', 'A ' || NEW.doc_type || ' approval was reassigned to you.',
        NEW.doc_type, NEW.doc_id);
    END IF;

    -- Decision
    IF NEW.status IS DISTINCT FROM OLD.status AND NEW.status IN ('approved','rejected') THEN
      INSERT INTO public.approval_events(organization_id, request_id, doc_type, doc_id, action, actor_id, note)
      VALUES (NEW.organization_id, NEW.id, NEW.doc_type, NEW.doc_id, NEW.status, NEW.decided_by, NEW.decision_note);
      PERFORM public.notify_approval_target(NEW.requested_by, NEW.organization_id,
        'Your ' || NEW.doc_type || ' was ' || NEW.status,
        COALESCE(NEW.decision_note, 'See document for details.'),
        NEW.doc_type, NEW.doc_id);
    END IF;
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_approval_requests_audit_notify ON public.approval_requests;
CREATE TRIGGER trg_approval_requests_audit_notify
AFTER INSERT OR UPDATE ON public.approval_requests
FOR EACH ROW EXECUTE FUNCTION public.approval_requests_audit_notify();

-- 4. Reassign RPC
CREATE OR REPLACE FUNCTION public.reassign_approval_request(
  _request_id uuid, _new_assignee uuid, _note text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  req public.approval_requests%ROWTYPE;
  uid uuid := auth.uid();
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF NOT has_role(uid,'admin'::app_role) THEN RAISE EXCEPTION 'Only admins can reassign approvals'; END IF;

  SELECT * INTO req FROM public.approval_requests WHERE id = _request_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Request not found'; END IF;
  IF req.status <> 'pending' THEN RAISE EXCEPTION 'Only pending requests can be reassigned'; END IF;

  UPDATE public.approval_requests
     SET assigned_to = _new_assignee, updated_at = now()
   WHERE id = _request_id;

  IF _note IS NOT NULL AND length(_note) > 0 THEN
    INSERT INTO public.approval_events(organization_id, request_id, doc_type, doc_id, action, actor_id, note)
    VALUES (req.organization_id, req.id, req.doc_type, req.doc_id, 'commented', uid, _note);
  END IF;

  RETURN jsonb_build_object('ok', true);
END $$;

REVOKE ALL ON FUNCTION public.reassign_approval_request(uuid,uuid,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reassign_approval_request(uuid,uuid,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.notify_approval_target(uuid,uuid,text,text,text,uuid) TO authenticated;
