
-- ─────────────────────────────────────────────────────────────
-- Container edit reason + status transition enforcement
-- ─────────────────────────────────────────────────────────────

-- 1. Enrich container audit trigger with edit reason from GUC
CREATE OR REPLACE FUNCTION public.trg_audit_containers()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _before jsonb;
  _after jsonb;
  _changed jsonb := '{}'::jsonb;
  _k text;
  _org uuid;
  _ref text;
  _action text;
  _reason text;
BEGIN
  BEGIN _reason := current_setting('app.edit_reason', true); EXCEPTION WHEN OTHERS THEN _reason := NULL; END;

  IF TG_OP = 'INSERT' THEN
    _action := 'insert'; _org := NEW.organization_id; _ref := NEW.container_number;
    _after := to_jsonb(NEW); _before := NULL;
    _changed := jsonb_build_object('created', true);
  ELSIF TG_OP = 'DELETE' THEN
    _action := 'delete'; _org := OLD.organization_id; _ref := OLD.container_number;
    _before := to_jsonb(OLD); _after := NULL;
    _changed := jsonb_build_object('deleted', true);
  ELSE
    _action := 'update'; _org := NEW.organization_id; _ref := NEW.container_number;
    _before := to_jsonb(OLD); _after := to_jsonb(NEW);
    FOR _k IN SELECT jsonb_object_keys(_after) LOOP
      IF _k IN ('updated_at') THEN CONTINUE; END IF;
      IF (_before -> _k) IS DISTINCT FROM (_after -> _k) THEN
        _changed := _changed || jsonb_build_object(_k, jsonb_build_object('from', _before -> _k, 'to', _after -> _k));
      END IF;
    END LOOP;
    IF _changed = '{}'::jsonb THEN RETURN NEW; END IF;
  END IF;

  IF _reason IS NOT NULL AND length(_reason) > 0 THEN
    _changed := _changed || jsonb_build_object('reason', _reason);
  END IF;

  PERFORM public.fal_write(
    _org, 'container', COALESCE(NEW.id, OLD.id), _ref, _action,
    _changed, _before, _after, '/inventory/' || COALESCE(NEW.id, OLD.id)::text
  );
  RETURN COALESCE(NEW, OLD);
END $$;

-- 2. Enforce practical status transitions
CREATE OR REPLACE FUNCTION public.trg_enforce_container_status_transition()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  _old text := OLD.status::text;
  _new text := NEW.status::text;
  _bypass boolean := false;
BEGIN
  IF _old = _new THEN RETURN NEW; END IF;

  BEGIN _bypass := current_setting('app.bypass_status_guard', true) = 'true'; EXCEPTION WHEN OTHERS THEN _bypass := false; END;
  IF _bypass THEN RETURN NEW; END IF;

  -- Terminal / restricted source states may only be reversed to 'available'
  IF _old IN ('converted','sold','on_lease','booked_for_repatriation') THEN
    IF _new <> 'available' THEN
      RAISE EXCEPTION 'Container is % — only reversal back to available is allowed. Use the Reverse action.', _old
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS enforce_container_status_transition ON public.containers;
CREATE TRIGGER enforce_container_status_transition
BEFORE UPDATE OF status ON public.containers
FOR EACH ROW EXECUTE FUNCTION public.trg_enforce_container_status_transition();

-- 3. Admin edit RPC that stamps the reason into the audit trail
CREATE OR REPLACE FUNCTION public.admin_update_container(_id uuid, _patch jsonb, _reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _uid uuid := auth.uid();
  _sql text;
  _keys text[];
  _sets text[] := ARRAY[]::text[];
  _k text;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF NOT (public.has_role(_uid, 'admin'::app_role) OR public.has_role(_uid, 'owner'::app_role) OR public.is_platform_admin())
  THEN RAISE EXCEPTION 'insufficient privileges'; END IF;
  IF _reason IS NULL OR btrim(_reason) = '' THEN RAISE EXCEPTION 'reason is required'; END IF;

  PERFORM set_config('app.edit_reason', _reason, true);

  -- Whitelist of editable columns
  _keys := ARRAY['container_number','category','height_class','status','owner','shipping_line',
                 'is_empty','notes','iso_type','weight_kg','tare_weight_kg','block_id','bay','row','tier','depot_id'];
  FOR _k IN SELECT unnest(_keys) LOOP
    IF _patch ? _k THEN
      _sets := _sets || format('%I = ($1->>%L)::text::%s',
        _k, _k,
        CASE _k
          WHEN 'is_empty' THEN 'boolean'
          WHEN 'weight_kg' THEN 'numeric'
          WHEN 'tare_weight_kg' THEN 'numeric'
          WHEN 'bay' THEN 'integer'
          WHEN 'row' THEN 'integer'
          WHEN 'tier' THEN 'integer'
          WHEN 'block_id' THEN 'uuid'
          WHEN 'depot_id' THEN 'uuid'
          WHEN 'status' THEN 'container_status'
          WHEN 'category' THEN 'container_category'
          ELSE 'text'
        END);
    END IF;
  END LOOP;

  IF array_length(_sets, 1) IS NULL THEN RETURN; END IF;

  _sql := format('UPDATE public.containers SET %s, updated_at = now() WHERE id = $2',
    array_to_string(_sets, ', '));
  EXECUTE _sql USING _patch, _id;
END $$;

REVOKE EXECUTE ON FUNCTION public.admin_update_container(uuid, jsonb, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_update_container(uuid, jsonb, text) TO authenticated;

-- 4. Reverse terminal status (converted/sold/on_lease/booked_for_repatriation → available)
CREATE OR REPLACE FUNCTION public.reverse_container_terminal_status(_id uuid, _reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _uid uuid := auth.uid();
  _old text;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF NOT (public.has_role(_uid, 'admin'::app_role) OR public.has_role(_uid, 'owner'::app_role) OR public.is_platform_admin())
  THEN RAISE EXCEPTION 'insufficient privileges'; END IF;
  IF _reason IS NULL OR btrim(_reason) = '' THEN RAISE EXCEPTION 'reason is required'; END IF;

  SELECT status::text INTO _old FROM public.containers WHERE id = _id;
  IF _old IS NULL THEN RAISE EXCEPTION 'container not found'; END IF;
  IF _old NOT IN ('converted','sold','on_lease','booked_for_repatriation') THEN
    RAISE EXCEPTION 'container status % is not reversible', _old;
  END IF;

  PERFORM set_config('app.edit_reason', 'Reversal from '||_old||': '||_reason, true);
  UPDATE public.containers SET status = 'available'::container_status, updated_at = now() WHERE id = _id;
END $$;

REVOKE EXECUTE ON FUNCTION public.reverse_container_terminal_status(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reverse_container_terminal_status(uuid, text) TO authenticated;
