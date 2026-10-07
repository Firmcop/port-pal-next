CREATE OR REPLACE FUNCTION public.correct_container_owner(
  _container_id uuid,
  _new_owner text,
  _reason text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _c record;
  _old text;
  _new text := btrim(coalesce(_new_owner, ''));
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF NOT (public.has_role(_uid, 'admin'::app_role)
          OR public.has_role(_uid, 'org_owner'::app_role)
          OR public.is_platform_admin())
  THEN RAISE EXCEPTION 'insufficient privileges'; END IF;
  IF _new = '' THEN RAISE EXCEPTION 'new owner is required'; END IF;
  IF _reason IS NULL OR btrim(_reason) = '' THEN RAISE EXCEPTION 'reason is required'; END IF;

  SELECT * INTO _c FROM public.containers WHERE id = _container_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'container not found'; END IF;
  IF NOT public.is_platform_admin() AND _c.organization_id IS DISTINCT FROM public.current_org_id() THEN
    RAISE EXCEPTION 'container belongs to another organization';
  END IF;

  _old := _c.owner;
  IF coalesce(_old, '') = _new THEN
    RETURN false;
  END IF;

  PERFORM set_config('app.edit_reason', _reason, true);
  UPDATE public.containers SET owner = _new, updated_at = now() WHERE id = _container_id;

  INSERT INTO public.finance_audit_log(
    organization_id, actor_user_id, actor_email, entity_type, entity_id, entity_ref,
    action, summary, before_data, after_data
  ) VALUES (
    _c.organization_id,
    _uid,
    (SELECT email FROM auth.users WHERE id = _uid),
    'containers',
    _container_id,
    _c.container_number,
    'container_acquisition_override',
    jsonb_build_object(
      'container_id', _container_id,
      'container_number', _c.container_number,
      'outcome', 'owner_corrected',
      'field', 'owner',
      'reason', _reason
    ),
    jsonb_build_object('owner', _old),
    jsonb_build_object('owner', _new)
  );

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.correct_container_owner(uuid, text, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.correct_container_owner(uuid, text, text) TO authenticated;