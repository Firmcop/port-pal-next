-- ============== Audit log ==============
DROP TABLE IF EXISTS public.repatriation_release_unlinks;

CREATE TABLE public.repatriation_release_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  repatriation_id uuid NOT NULL REFERENCES public.repatriations(id) ON DELETE CASCADE,
  event_type text NOT NULL CHECK (event_type IN ('linked','unlinked','ro_auto_aligned','reconciled')),
  release_instruction_id uuid,
  previous_ro text,
  new_ro text,
  expected_ro text,
  reason text,
  performed_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_rel_audit_repatriation ON public.repatriation_release_audit(repatriation_id, created_at DESC);
CREATE INDEX idx_rel_audit_org ON public.repatriation_release_audit(organization_id);

ALTER TABLE public.repatriation_release_audit ENABLE ROW LEVEL SECURITY;

CREATE POLICY "rel_audit_select" ON public.repatriation_release_audit
  FOR SELECT USING (
    public.is_platform_admin()
    OR (organization_id = public.current_org_id()
        AND (public.has_role(auth.uid(),'admin'::app_role) OR public.has_role(auth.uid(),'gate_clerk'::app_role)))
  );

-- Inserts happen through SECURITY DEFINER triggers/RPCs only; no user-facing INSERT policy.

-- ============== Mismatches ==============
CREATE TABLE public.repatriation_ro_mismatches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  repatriation_id uuid NOT NULL REFERENCES public.repatriations(id) ON DELETE CASCADE,
  release_instruction_id uuid,
  expected_ro text,
  actual_ro text,
  detected_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  resolved_by uuid,
  resolution_note text,
  UNIQUE(repatriation_id)
);

CREATE INDEX idx_ro_mismatches_org_open ON public.repatriation_ro_mismatches(organization_id) WHERE resolved_at IS NULL;

ALTER TABLE public.repatriation_ro_mismatches ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ro_mismatches_select" ON public.repatriation_ro_mismatches
  FOR SELECT USING (
    public.is_platform_admin()
    OR (organization_id = public.current_org_id()
        AND (public.has_role(auth.uid(),'admin'::app_role) OR public.has_role(auth.uid(),'gate_clerk'::app_role)))
  );

CREATE POLICY "ro_mismatches_update" ON public.repatriation_ro_mismatches
  FOR UPDATE USING (
    organization_id = public.current_org_id()
    AND (public.has_role(auth.uid(),'admin'::app_role) OR public.has_role(auth.uid(),'gate_clerk'::app_role))
  );

-- ============== Updated validation trigger (audit + enforcement) ==============
CREATE OR REPLACE FUNCTION public.validate_repatriation_release_link()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _ri RECORD;
  _was_linked boolean := false;
  _prev_ro text := NULL;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    _was_linked := OLD.release_instruction_id IS NOT NULL;
    _prev_ro := OLD.release_order_no;
  END IF;

  IF NEW.release_instruction_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT id, instruction_number, organization_id, container_id
    INTO _ri
    FROM public.release_instructions
    WHERE id = NEW.release_instruction_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'release_instruction_not_found';
  END IF;

  IF _ri.organization_id IS DISTINCT FROM NEW.organization_id THEN
    RAISE EXCEPTION 'release_instruction_org_mismatch';
  END IF;

  IF _ri.container_id IS NOT NULL
     AND NEW.container_id IS NOT NULL
     AND _ri.container_id <> NEW.container_id THEN
    RAISE EXCEPTION 'release_instruction_container_mismatch';
  END IF;

  IF NEW.release_order_no IS DISTINCT FROM _ri.instruction_number THEN
    -- On UPDATE: if user explicitly tried to change RO while keeping the link, block it.
    IF TG_OP = 'UPDATE'
       AND OLD.release_instruction_id IS NOT DISTINCT FROM NEW.release_instruction_id
       AND OLD.release_order_no IS DISTINCT FROM NEW.release_order_no THEN
      RAISE EXCEPTION 'release_order_locked_to_instruction:%', _ri.instruction_number;
    END IF;
    -- Auto-align silently
    NEW.release_order_no := _ri.instruction_number;
    INSERT INTO public.repatriation_release_audit (
      organization_id, repatriation_id, event_type, release_instruction_id,
      previous_ro, new_ro, expected_ro, performed_by
    ) VALUES (
      NEW.organization_id, NEW.id, 'ro_auto_aligned', NEW.release_instruction_id,
      _prev_ro, _ri.instruction_number, _ri.instruction_number, auth.uid()
    );
  END IF;

  -- Log linking when newly linked or instruction changed
  IF (TG_OP = 'INSERT')
     OR (TG_OP = 'UPDATE' AND OLD.release_instruction_id IS DISTINCT FROM NEW.release_instruction_id) THEN
    INSERT INTO public.repatriation_release_audit (
      organization_id, repatriation_id, event_type, release_instruction_id,
      previous_ro, new_ro, performed_by
    ) VALUES (
      NEW.organization_id, NEW.id, 'linked', NEW.release_instruction_id,
      _prev_ro, NEW.release_order_no, auth.uid()
    );
  END IF;

  RETURN NEW;
END;
$$;

-- ============== Updated unlink RPC (writes audit) ==============
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

  INSERT INTO public.repatriation_release_audit (
    organization_id, repatriation_id, event_type, release_instruction_id,
    previous_ro, new_ro, reason, performed_by
  ) VALUES (
    _rep.organization_id, _rep.id, 'unlinked', _rep.release_instruction_id,
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

-- ============== Reconciliation function ==============
CREATE OR REPLACE FUNCTION public.reconcile_repatriation_ro_mismatches()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _open_count int;
  _resolved RECORD;
BEGIN
  -- Auto-resolve previously open rows that now match
  FOR _resolved IN
    SELECT m.id, m.organization_id, m.repatriation_id, m.release_instruction_id, r.release_order_no
    FROM public.repatriation_ro_mismatches m
    JOIN public.repatriations r ON r.id = m.repatriation_id
    LEFT JOIN public.release_instructions ri ON ri.id = r.release_instruction_id
    WHERE m.resolved_at IS NULL
      AND (r.release_instruction_id IS NULL OR r.release_order_no = ri.instruction_number)
  LOOP
    UPDATE public.repatriation_ro_mismatches
      SET resolved_at = now(), resolution_note = COALESCE(resolution_note, 'auto-resolved by reconciliation')
      WHERE id = _resolved.id;
    INSERT INTO public.repatriation_release_audit (
      organization_id, repatriation_id, event_type, release_instruction_id,
      new_ro, reason
    ) VALUES (
      _resolved.organization_id, _resolved.repatriation_id, 'reconciled', _resolved.release_instruction_id,
      _resolved.release_order_no, 'mismatch resolved'
    );
  END LOOP;

  -- Upsert current mismatches
  INSERT INTO public.repatriation_ro_mismatches (
    organization_id, repatriation_id, release_instruction_id, expected_ro, actual_ro
  )
  SELECT r.organization_id, r.id, r.release_instruction_id, ri.instruction_number, r.release_order_no
  FROM public.repatriations r
  JOIN public.release_instructions ri ON ri.id = r.release_instruction_id
  WHERE r.release_instruction_id IS NOT NULL
    AND r.release_order_no IS DISTINCT FROM ri.instruction_number
  ON CONFLICT (repatriation_id) DO UPDATE
    SET expected_ro = EXCLUDED.expected_ro,
        actual_ro = EXCLUDED.actual_ro,
        release_instruction_id = EXCLUDED.release_instruction_id,
        detected_at = now(),
        resolved_at = NULL,
        resolved_by = NULL,
        resolution_note = NULL;

  SELECT count(*) INTO _open_count FROM public.repatriation_ro_mismatches WHERE resolved_at IS NULL;
  RETURN _open_count;
END;
$$;

REVOKE ALL ON FUNCTION public.reconcile_repatriation_ro_mismatches() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reconcile_repatriation_ro_mismatches() TO authenticated;

COMMENT ON TABLE public.repatriations IS
  'All writes must go through SQL DML so trigger validate_repatriation_release_link enforces RO/instruction parity. Do not use COPY or service-role bypasses for direct mutations.';