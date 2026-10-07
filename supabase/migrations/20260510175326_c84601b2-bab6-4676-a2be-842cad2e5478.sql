-- Audit log
CREATE TABLE IF NOT EXISTS public.repatriation_release_unlinks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  repatriation_id uuid NOT NULL REFERENCES public.repatriations(id) ON DELETE CASCADE,
  previous_release_instruction_id uuid,
  previous_release_order_no text,
  new_release_order_no text NOT NULL,
  reason text NOT NULL,
  performed_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_rel_unlinks_repatriation ON public.repatriation_release_unlinks(repatriation_id);
CREATE INDEX IF NOT EXISTS idx_rel_unlinks_org ON public.repatriation_release_unlinks(organization_id);

ALTER TABLE public.repatriation_release_unlinks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "rel_unlinks_select" ON public.repatriation_release_unlinks;
CREATE POLICY "rel_unlinks_select" ON public.repatriation_release_unlinks
  FOR SELECT USING (
    public.is_platform_admin()
    OR (organization_id = public.current_org_id()
        AND (public.has_role(auth.uid(),'admin'::app_role) OR public.has_role(auth.uid(),'gate_clerk'::app_role)))
  );

DROP POLICY IF EXISTS "rel_unlinks_insert" ON public.repatriation_release_unlinks;
CREATE POLICY "rel_unlinks_insert" ON public.repatriation_release_unlinks
  FOR INSERT WITH CHECK (
    organization_id = public.current_org_id()
    AND (public.has_role(auth.uid(),'admin'::app_role) OR public.has_role(auth.uid(),'gate_clerk'::app_role))
  );

-- RPC
CREATE OR REPLACE FUNCTION public.unlink_repatriation_release(
  _repatriation_id uuid,
  _new_release_order_no text,
  _reason text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _rep RECORD;
  _audit_id uuid;
BEGIN
  IF NOT (public.has_role(auth.uid(),'admin'::app_role) OR public.has_role(auth.uid(),'gate_clerk'::app_role)) THEN
    RAISE EXCEPTION 'forbidden_role';
  END IF;

  IF _new_release_order_no IS NULL OR length(trim(_new_release_order_no)) = 0 THEN
    RAISE EXCEPTION 'new_release_order_no_required';
  END IF;
  IF _reason IS NULL OR length(trim(_reason)) < 3 THEN
    RAISE EXCEPTION 'reason_required';
  END IF;

  SELECT id, organization_id, release_instruction_id, release_order_no
    INTO _rep
    FROM public.repatriations
    WHERE id = _repatriation_id;

  IF NOT FOUND THEN RAISE EXCEPTION 'repatriation_not_found'; END IF;
  IF _rep.organization_id <> public.current_org_id() AND NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'forbidden_org';
  END IF;
  IF _rep.release_instruction_id IS NULL THEN
    RAISE EXCEPTION 'not_linked';
  END IF;

  INSERT INTO public.repatriation_release_unlinks (
    organization_id, repatriation_id, previous_release_instruction_id,
    previous_release_order_no, new_release_order_no, reason, performed_by
  ) VALUES (
    _rep.organization_id, _rep.id, _rep.release_instruction_id,
    _rep.release_order_no, trim(_new_release_order_no), trim(_reason), auth.uid()
  ) RETURNING id INTO _audit_id;

  UPDATE public.repatriations
    SET release_instruction_id = NULL,
        release_order_no = trim(_new_release_order_no)
    WHERE id = _rep.id;

  RETURN jsonb_build_object('ok', true, 'audit_id', _audit_id);
END;
$$;

REVOKE ALL ON FUNCTION public.unlink_repatriation_release(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.unlink_repatriation_release(uuid, text, text) TO authenticated;