
-- 1) Ensure org config toggle default
UPDATE public.organizations
   SET config = coalesce(config,'{}'::jsonb) || jsonb_build_object('require_dual_approval_for_hq_ops', coalesce(config->>'require_dual_approval_for_hq_ops','true')::boolean)
 WHERE (config ? 'require_dual_approval_for_hq_ops') IS NOT TRUE;

-- 2) Depot audit trigger
CREATE OR REPLACE FUNCTION public.trg_audit_depot_changes()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  changed jsonb := '{}'::jsonb;
  k text;
  old_v jsonb;
  new_v jsonb;
  tracked_cols text[] := ARRAY[
    'name','code','location','timezone','currency',
    'address_line1','address_line2','city','country','postal_code',
    'phone','email','website','tax_id','registration_number','logo_url',
    'bank_name','bank_account','bank_branch','is_hq'
  ];
BEGIN
  IF TG_OP <> 'UPDATE' THEN RETURN NEW; END IF;
  FOREACH k IN ARRAY tracked_cols LOOP
    EXECUTE format('SELECT to_jsonb($1.%I), to_jsonb($2.%I)', k, k) INTO old_v, new_v USING OLD, NEW;
    IF old_v IS DISTINCT FROM new_v THEN
      changed := changed || jsonb_build_object(k, jsonb_build_object('before', old_v, 'after', new_v));
    END IF;
  END LOOP;

  -- config sub-sections
  FOREACH k IN ARRAY ARRAY['gate_rules','scales','equipment'] LOOP
    old_v := coalesce(OLD.config,'{}'::jsonb)->k;
    new_v := coalesce(NEW.config,'{}'::jsonb)->k;
    IF old_v IS DISTINCT FROM new_v THEN
      changed := changed || jsonb_build_object('config.'||k, jsonb_build_object('before', old_v, 'after', new_v));
    END IF;
  END LOOP;

  IF changed <> '{}'::jsonb THEN
    INSERT INTO public.depot_lifecycle_events(depot_id, organization_id, event, actor, payload)
    VALUES (NEW.id, NEW.organization_id, 'profile_updated', auth.uid(),
            jsonb_build_object('changed_fields', changed));
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS depots_audit_changes ON public.depots;
CREATE TRIGGER depots_audit_changes
BEFORE UPDATE ON public.depots
FOR EACH ROW EXECUTE FUNCTION public.trg_audit_depot_changes();

REVOKE ALL ON FUNCTION public.trg_audit_depot_changes() FROM PUBLIC, anon, authenticated;

-- 3) Preview retirement RPC
CREATE OR REPLACE FUNCTION public.preview_depot_retirement(_depot_id uuid, _target_hq_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  _org uuid; _is_hq boolean; _hq_org uuid;
  _hq record;
  active_containers int := 0; yard_blocks int := 0;
  open_work_orders int := 0; open_invoices int := 0; open_pos int := 0;
  open_leases int := 0; open_appts int := 0; unrec_accounts int := 0;
  container_sample jsonb := '[]'::jsonb; block_sample jsonb := '[]'::jsonb;
  blockers jsonb := '[]'::jsonb; transferable jsonb := '[]'::jsonb;
  ready boolean;
BEGIN
  IF NOT public.can_admin_depot(_depot_id) THEN RAISE EXCEPTION 'Not permitted'; END IF;
  SELECT organization_id, is_hq INTO _org, _is_hq FROM public.depots WHERE id = _depot_id;
  IF _org IS NULL THEN RAISE EXCEPTION 'Depot not found'; END IF;
  IF _is_hq THEN RAISE EXCEPTION 'Headquarters cannot be retired'; END IF;

  SELECT id, name, code, organization_id INTO _hq FROM public.depots WHERE id = _target_hq_id AND is_hq;
  IF _hq.id IS NULL OR _hq.organization_id <> _org THEN
    RAISE EXCEPTION 'Target must be the HQ depot of the same organization';
  END IF;

  SELECT count(*) INTO active_containers FROM public.containers
    WHERE depot_id = _depot_id AND status::text NOT IN ('sold','converted','off_hired','disposed');
  SELECT count(*) INTO yard_blocks FROM public.yard_blocks WHERE depot_id = _depot_id;

  SELECT coalesce(jsonb_agg(x),'[]'::jsonb) INTO container_sample FROM (
    SELECT id, container_no, status::text AS status FROM public.containers
    WHERE depot_id = _depot_id AND status::text NOT IN ('sold','converted','off_hired','disposed')
    ORDER BY container_no LIMIT 20
  ) x;
  SELECT coalesce(jsonb_agg(x),'[]'::jsonb) INTO block_sample FROM (
    SELECT id, name FROM public.yard_blocks WHERE depot_id = _depot_id ORDER BY name LIMIT 20
  ) x;

  -- Best-effort other counts (guard for column existence via EXCEPTION)
  BEGIN SELECT count(*) INTO open_work_orders FROM public.work_orders WHERE depot_id = _depot_id AND status::text NOT IN ('completed','cancelled','closed'); EXCEPTION WHEN OTHERS THEN open_work_orders := 0; END;
  BEGIN SELECT count(*) INTO open_invoices FROM public.invoices WHERE depot_id = _depot_id AND status::text NOT IN ('paid','void','cancelled'); EXCEPTION WHEN OTHERS THEN open_invoices := 0; END;
  BEGIN SELECT count(*) INTO open_pos FROM public.purchase_orders WHERE depot_id = _depot_id AND status::text NOT IN ('closed','cancelled','received'); EXCEPTION WHEN OTHERS THEN open_pos := 0; END;
  BEGIN SELECT count(*) INTO open_leases FROM public.lease_agreements WHERE depot_id = _depot_id AND status::text NOT IN ('terminated','closed','expired'); EXCEPTION WHEN OTHERS THEN open_leases := 0; END;
  BEGIN SELECT count(*) INTO open_appts FROM public.gate_appointments WHERE depot_id = _depot_id AND status::text NOT IN ('completed','cancelled','no_show'); EXCEPTION WHEN OTHERS THEN open_appts := 0; END;
  BEGIN SELECT count(*) INTO unrec_accounts FROM public.financial_accounts WHERE depot_id = _depot_id AND coalesce(reconciled,false) = false; EXCEPTION WHEN OTHERS THEN unrec_accounts := 0; END;

  -- Classify: containers + yard_blocks are auto-transferable; others block until user closes them
  transferable := jsonb_build_array(
    jsonb_build_object('key','containers','label','Containers to reassign to HQ','count',active_containers),
    jsonb_build_object('key','yard_blocks','label','Yard blocks to remove/move','count',yard_blocks)
  );

  IF open_work_orders   > 0 THEN blockers := blockers || jsonb_build_array(jsonb_build_object('key','open_work_orders','label','Open work orders','count',open_work_orders)); END IF;
  IF open_invoices      > 0 THEN blockers := blockers || jsonb_build_array(jsonb_build_object('key','open_invoices','label','Unpaid invoices','count',open_invoices)); END IF;
  IF open_pos           > 0 THEN blockers := blockers || jsonb_build_array(jsonb_build_object('key','open_pos','label','Open purchase orders','count',open_pos)); END IF;
  IF open_leases        > 0 THEN blockers := blockers || jsonb_build_array(jsonb_build_object('key','open_leases','label','Active lease agreements','count',open_leases)); END IF;
  IF open_appts         > 0 THEN blockers := blockers || jsonb_build_array(jsonb_build_object('key','open_appts','label','Open gate appointments','count',open_appts)); END IF;
  IF unrec_accounts     > 0 THEN blockers := blockers || jsonb_build_array(jsonb_build_object('key','unrec_accounts','label','Unreconciled financial accounts','count',unrec_accounts)); END IF;

  ready := (jsonb_array_length(blockers) = 0);

  INSERT INTO public.depot_lifecycle_events(depot_id, organization_id, event, actor, payload)
  VALUES (_depot_id, _org, 'retire_preflight_ran', auth.uid(),
          jsonb_build_object('target_hq', _hq.id, 'blockers', blockers, 'transferable', transferable, 'ready', ready));

  RETURN jsonb_build_object(
    'ok', true,
    'target_hq', jsonb_build_object('id',_hq.id,'name',_hq.name,'code',_hq.code),
    'counts', jsonb_build_object(
      'active_containers', active_containers,
      'yard_blocks', yard_blocks,
      'open_work_orders', open_work_orders,
      'open_invoices', open_invoices,
      'open_pos', open_pos,
      'open_leases', open_leases,
      'open_appointments', open_appts,
      'unreconciled_accounts', unrec_accounts
    ),
    'container_sample', container_sample,
    'block_sample', block_sample,
    'transferable', transferable,
    'blockers', blockers,
    'ready', ready
  );
END $$;

REVOKE ALL ON FUNCTION public.preview_depot_retirement(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.preview_depot_retirement(uuid, uuid) TO authenticated;

-- 4) Extend retire_depot to log richer lifecycle event
CREATE OR REPLACE FUNCTION public.retire_depot(_depot_id uuid, _target_hq_id uuid, _confirm_reconciled boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  _org uuid; _hq_org uuid; _is_hq boolean;
  _active_containers int; _yard_blocks int;
  _blockers jsonb;
BEGIN
  IF NOT public.can_admin_depot(_depot_id) THEN RAISE EXCEPTION 'Not permitted'; END IF;
  SELECT organization_id, is_hq INTO _org, _is_hq FROM public.depots WHERE id = _depot_id;
  IF _org IS NULL THEN RAISE EXCEPTION 'Depot not found'; END IF;
  IF _is_hq THEN RAISE EXCEPTION 'Headquarters cannot be retired.'; END IF;

  SELECT organization_id INTO _hq_org FROM public.depots WHERE id = _target_hq_id AND is_hq;
  IF _hq_org IS NULL OR _hq_org <> _org THEN
    RAISE EXCEPTION 'Target must be the HQ depot of the same organization';
  END IF;

  SELECT count(*) INTO _active_containers FROM public.containers
    WHERE depot_id = _depot_id AND status::text NOT IN ('sold','converted','off_hired','disposed');
  SELECT count(*) INTO _yard_blocks FROM public.yard_blocks WHERE depot_id = _depot_id;

  _blockers := jsonb_build_object('active_containers', _active_containers, 'yard_blocks', _yard_blocks);

  IF NOT _confirm_reconciled THEN
    RETURN jsonb_build_object('ok', true, 'blockers', _blockers, 'ready', true);
  END IF;

  UPDATE public.containers SET depot_id = _target_hq_id WHERE depot_id = _depot_id;
  DELETE FROM public.yard_blocks WHERE depot_id = _depot_id;

  INSERT INTO public.depot_lifecycle_events(depot_id, organization_id, event, actor, payload)
  VALUES (_depot_id, _org, 'retire_completed', auth.uid(),
          jsonb_build_object('transferred_to', _target_hq_id, 'containers_moved', _active_containers, 'yard_blocks_removed', _yard_blocks));

  DELETE FROM public.depots WHERE id = _depot_id;

  RETURN jsonb_build_object('ok', true, 'deleted', true);
END $$;

REVOKE ALL ON FUNCTION public.retire_depot(uuid, uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.retire_depot(uuid, uuid, boolean) TO authenticated;

-- 5) Approval request RPCs for HQ operations
CREATE OR REPLACE FUNCTION public.request_depot_hq_promotion(_depot_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE _org uuid; _req uuid; _admins int;
BEGIN
  IF NOT public.can_admin_depot(_depot_id) THEN RAISE EXCEPTION 'Not permitted'; END IF;
  SELECT organization_id INTO _org FROM public.depots WHERE id = _depot_id;
  IF _org IS NULL THEN RAISE EXCEPTION 'Depot not found'; END IF;

  SELECT count(*) INTO _admins FROM public.organization_members
    WHERE organization_id=_org AND status='active' AND role::text IN ('org_owner','admin');
  IF _admins < 2 AND NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Dual approval requires at least two admins in the organization';
  END IF;

  INSERT INTO public.approval_requests(organization_id, doc_type, doc_id, status, requested_by)
  VALUES (_org, 'depot_promote_hq', _depot_id, 'pending', auth.uid())
  RETURNING id INTO _req;

  INSERT INTO public.depot_lifecycle_events(depot_id, organization_id, event, actor, payload)
  VALUES (_depot_id, _org, 'promote_requested', auth.uid(), jsonb_build_object('request_id', _req));

  RETURN jsonb_build_object('ok', true, 'request_id', _req);
END $$;
REVOKE ALL ON FUNCTION public.request_depot_hq_promotion(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.request_depot_hq_promotion(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.request_depot_retirement(_depot_id uuid, _target_hq_id uuid, _preview jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE _org uuid; _req uuid; _admins int;
BEGIN
  IF NOT public.can_admin_depot(_depot_id) THEN RAISE EXCEPTION 'Not permitted'; END IF;
  SELECT organization_id INTO _org FROM public.depots WHERE id = _depot_id;
  IF _org IS NULL THEN RAISE EXCEPTION 'Depot not found'; END IF;

  SELECT count(*) INTO _admins FROM public.organization_members
    WHERE organization_id=_org AND status='active' AND role::text IN ('org_owner','admin');
  IF _admins < 2 AND NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Dual approval requires at least two admins in the organization';
  END IF;

  INSERT INTO public.approval_requests(organization_id, doc_type, doc_id, status, requested_by, decision_note)
  VALUES (_org, 'depot_retire', _depot_id, 'pending', auth.uid(),
          jsonb_build_object('target_hq_id', _target_hq_id, 'preview', _preview)::text)
  RETURNING id INTO _req;

  INSERT INTO public.depot_lifecycle_events(depot_id, organization_id, event, actor, payload)
  VALUES (_depot_id, _org, 'retire_requested', auth.uid(),
          jsonb_build_object('request_id', _req, 'target_hq_id', _target_hq_id, 'preview', _preview));

  RETURN jsonb_build_object('ok', true, 'request_id', _req);
END $$;
REVOKE ALL ON FUNCTION public.request_depot_retirement(uuid, uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.request_depot_retirement(uuid, uuid, jsonb) TO authenticated;

-- 6) Extend decide_approval_request to handle depot ops
CREATE OR REPLACE FUNCTION public.decide_approval_request(_request_id uuid, _decision text, _notes text DEFAULT NULL::text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  req public.approval_requests%ROWTYPE;
  uid uuid := auth.uid();
  new_status approval_doc_status;
  sql text;
  meta jsonb;
  target_hq uuid;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF _decision NOT IN ('approved','rejected') THEN RAISE EXCEPTION 'Invalid decision'; END IF;

  SELECT * INTO req FROM public.approval_requests WHERE id = _request_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Approval request not found'; END IF;
  IF req.status <> 'pending' THEN RAISE EXCEPTION 'Already decided'; END IF;

  IF NOT (has_role(uid,'admin'::app_role) OR req.assigned_to = uid OR public.is_platform_admin()) THEN
    RAISE EXCEPTION 'Not authorized to decide this request';
  END IF;

  -- Depot ops require a *different* admin than the requester
  IF req.doc_type IN ('depot_promote_hq','depot_retire') AND req.requested_by = uid AND NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'A different administrator must approve this request';
  END IF;

  new_status := CASE WHEN _decision='approved' THEN 'approved'::approval_doc_status ELSE 'rejected'::approval_doc_status END;

  UPDATE public.approval_requests
     SET status = _decision, decided_by = uid, decided_at = now(),
         decision_note = coalesce(_notes, decision_note), updated_at = now()
   WHERE id = _request_id;

  IF req.doc_type = 'depot_promote_hq' THEN
    IF _decision = 'approved' THEN
      PERFORM public.set_depot_as_hq(req.doc_id);
      INSERT INTO public.depot_lifecycle_events(depot_id, organization_id, event, actor, payload)
      VALUES (req.doc_id, req.organization_id, 'promote_approved', uid, jsonb_build_object('request_id', req.id));
    ELSE
      INSERT INTO public.depot_lifecycle_events(depot_id, organization_id, event, actor, payload)
      VALUES (req.doc_id, req.organization_id, 'promote_rejected', uid, jsonb_build_object('request_id', req.id, 'note', _notes));
    END IF;
    RETURN jsonb_build_object('ok', true, 'status', new_status);
  END IF;

  IF req.doc_type = 'depot_retire' THEN
    BEGIN meta := req.decision_note::jsonb; EXCEPTION WHEN OTHERS THEN meta := '{}'::jsonb; END;
    target_hq := nullif(meta->>'target_hq_id','')::uuid;
    IF _decision = 'approved' THEN
      IF target_hq IS NULL THEN RAISE EXCEPTION 'Missing target HQ on request'; END IF;
      PERFORM public.retire_depot(req.doc_id, target_hq, true);
      -- retire_completed event is emitted by retire_depot
    ELSE
      INSERT INTO public.depot_lifecycle_events(depot_id, organization_id, event, actor, payload)
      VALUES (req.doc_id, req.organization_id, 'retire_rejected', uid, jsonb_build_object('request_id', req.id, 'note', _notes));
    END IF;
    RETURN jsonb_build_object('ok', true, 'status', new_status);
  END IF;

  -- Existing document types
  sql := CASE req.doc_type
    WHEN 'quote'           THEN 'UPDATE public.quotes SET approval_status=$1, approved_by=CASE WHEN $1=''approved'' THEN $2 ELSE approved_by END, approved_at=CASE WHEN $1=''approved'' THEN now() ELSE approved_at END, rejection_reason=CASE WHEN $1=''rejected'' THEN $3 ELSE rejection_reason END WHERE id=$4'
    WHEN 'purchase_order'  THEN 'UPDATE public.purchase_orders SET approval_status=$1, approved_by=CASE WHEN $1=''approved'' THEN $2 ELSE approved_by END, approved_at=CASE WHEN $1=''approved'' THEN now() ELSE approved_at END, rejection_reason=CASE WHEN $1=''rejected'' THEN $3 ELSE rejection_reason END WHERE id=$4'
    WHEN 'payment'         THEN 'UPDATE public.payments SET approval_status=$1, approved_by=CASE WHEN $1=''approved'' THEN $2 ELSE approved_by END, approved_at=CASE WHEN $1=''approved'' THEN now() ELSE approved_at END, rejection_reason=CASE WHEN $1=''rejected'' THEN $3 ELSE rejection_reason END WHERE id=$4'
    WHEN 'vendor_payment'  THEN 'UPDATE public.vendor_payments SET approval_status=$1, approved_by=CASE WHEN $1=''approved'' THEN $2 ELSE approved_by END, approved_at=CASE WHEN $1=''approved'' THEN now() ELSE approved_at END, rejection_reason=CASE WHEN $1=''rejected'' THEN $3 ELSE rejection_reason END WHERE id=$4'
    WHEN 'repatriation'    THEN 'UPDATE public.repatriations SET approval_status=$1, approved_at=CASE WHEN $1=''approved'' THEN now() ELSE approved_at END, approved_by=CASE WHEN $1=''approved'' THEN $2 ELSE approved_by END, rejection_reason=CASE WHEN $1=''rejected'' THEN $3 ELSE rejection_reason END WHERE id=$4'
    WHEN 'eir'             THEN 'UPDATE public.eir_records SET approval_status=$1, approved_by=CASE WHEN $1=''approved'' THEN $2 ELSE approved_by END, approved_at=CASE WHEN $1=''approved'' THEN now() ELSE approved_at END, rejection_reason=CASE WHEN $1=''rejected'' THEN $3 ELSE rejection_reason END WHERE id=$4'
    ELSE NULL END;

  IF sql IS NOT NULL THEN
    EXECUTE sql USING new_status::text, uid, _notes, req.doc_id;
  END IF;

  RETURN jsonb_build_object('ok',true,'status',new_status);
END $$;
