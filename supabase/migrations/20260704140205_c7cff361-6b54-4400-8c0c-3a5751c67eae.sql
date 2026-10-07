-- Audit trail for container edits (reuse finance_audit_log as generic org audit)
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
BEGIN
  IF TG_OP = 'INSERT' THEN
    _action := 'insert';
    _org := NEW.organization_id;
    _ref := NEW.container_number;
    _after := to_jsonb(NEW);
    _before := NULL;
    _changed := jsonb_build_object('created', true);
  ELSIF TG_OP = 'DELETE' THEN
    _action := 'delete';
    _org := OLD.organization_id;
    _ref := OLD.container_number;
    _before := to_jsonb(OLD);
    _after := NULL;
    _changed := jsonb_build_object('deleted', true);
  ELSE
    _action := 'update';
    _org := NEW.organization_id;
    _ref := NEW.container_number;
    _before := to_jsonb(OLD);
    _after := to_jsonb(NEW);
    -- Build a diff of changed fields only, ignore noisy timestamps
    FOR _k IN SELECT jsonb_object_keys(_after) LOOP
      IF _k IN ('updated_at') THEN CONTINUE; END IF;
      IF (_before -> _k) IS DISTINCT FROM (_after -> _k) THEN
        _changed := _changed || jsonb_build_object(_k, jsonb_build_object('from', _before -> _k, 'to', _after -> _k));
      END IF;
    END LOOP;
    IF _changed = '{}'::jsonb THEN
      RETURN NEW; -- no meaningful change, skip audit
    END IF;
  END IF;

  PERFORM public.fal_write(
    _org, 'container', COALESCE(NEW.id, OLD.id), _ref, _action,
    _changed, _before, _after, '/inventory/' || COALESCE(NEW.id, OLD.id)::text
  );

  RETURN COALESCE(NEW, OLD);
END $$;

DROP TRIGGER IF EXISTS audit_containers_iud ON public.containers;
CREATE TRIGGER audit_containers_iud
AFTER INSERT OR UPDATE OR DELETE ON public.containers
FOR EACH ROW EXECUTE FUNCTION public.trg_audit_containers();