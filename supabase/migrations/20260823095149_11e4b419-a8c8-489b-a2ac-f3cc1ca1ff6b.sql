
CREATE TABLE IF NOT EXISTS public.accounting_policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL UNIQUE,
  netting_enabled boolean NOT NULL DEFAULT true,
  presentation_basis text NOT NULL DEFAULT 'gross_with_disclosure',
  require_setoff_evidence boolean NOT NULL DEFAULT true,
  offset_approval_threshold numeric NOT NULL DEFAULT 0,
  same_currency_only boolean NOT NULL DEFAULT true,
  policy_note text,
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT accounting_policies_basis_chk CHECK (presentation_basis IN ('gross_with_disclosure','net_presentation'))
);

GRANT SELECT, INSERT, UPDATE ON public.accounting_policies TO authenticated;
GRANT ALL ON public.accounting_policies TO service_role;
ALTER TABLE public.accounting_policies ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "org members read accounting policy" ON public.accounting_policies;
CREATE POLICY "org members read accounting policy" ON public.accounting_policies
  FOR SELECT TO authenticated
  USING (organization_id = public.current_org_id() OR public.is_platform_admin());

DROP POLICY IF EXISTS "finance admins manage accounting policy" ON public.accounting_policies;
CREATE POLICY "finance admins manage accounting policy" ON public.accounting_policies
  FOR ALL TO authenticated
  USING (organization_id = public.current_org_id()
         AND (has_role(auth.uid(),'admin') OR has_role(auth.uid(),'org_owner')
              OR has_role(auth.uid(),'accountant') OR public.is_platform_admin()))
  WITH CHECK (organization_id = public.current_org_id()
         AND (has_role(auth.uid(),'admin') OR has_role(auth.uid(),'org_owner')
              OR has_role(auth.uid(),'accountant') OR public.is_platform_admin()));

CREATE OR REPLACE FUNCTION public.get_accounting_policy()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE _org uuid := public.current_org_id(); _p public.accounting_policies%ROWTYPE;
BEGIN
  IF _org IS NULL THEN RAISE EXCEPTION 'No organization context'; END IF;
  SELECT * INTO _p FROM public.accounting_policies WHERE organization_id = _org;
  RETURN jsonb_build_object(
    'organization_id', _org,
    'netting_enabled', COALESCE(_p.netting_enabled, true),
    'presentation_basis', COALESCE(_p.presentation_basis, 'gross_with_disclosure'),
    'require_setoff_evidence', COALESCE(_p.require_setoff_evidence, true),
    'offset_approval_threshold', COALESCE(_p.offset_approval_threshold, 0),
    'same_currency_only', COALESCE(_p.same_currency_only, true),
    'policy_note', _p.policy_note,
    'updated_at', _p.updated_at,
    'is_default', _p.id IS NULL
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.save_accounting_policy(
  _netting_enabled boolean,
  _presentation_basis text,
  _require_setoff_evidence boolean,
  _offset_approval_threshold numeric,
  _same_currency_only boolean,
  _policy_note text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE _org uuid := public.current_org_id(); _before jsonb;
BEGIN
  IF _org IS NULL THEN RAISE EXCEPTION 'No organization context'; END IF;
  IF NOT (has_role(auth.uid(),'admin') OR has_role(auth.uid(),'org_owner')
          OR has_role(auth.uid(),'accountant') OR public.is_platform_admin()) THEN
    RAISE EXCEPTION 'not_authorised';
  END IF;
  _before := public.get_accounting_policy();

  INSERT INTO public.accounting_policies(organization_id, netting_enabled, presentation_basis,
      require_setoff_evidence, offset_approval_threshold, same_currency_only, policy_note, updated_by, updated_at)
  VALUES (_org, COALESCE(_netting_enabled,true), COALESCE(_presentation_basis,'gross_with_disclosure'),
          COALESCE(_require_setoff_evidence,true), GREATEST(COALESCE(_offset_approval_threshold,0),0),
          COALESCE(_same_currency_only,true), _policy_note, auth.uid(), now())
  ON CONFLICT (organization_id) DO UPDATE
    SET netting_enabled = EXCLUDED.netting_enabled,
        presentation_basis = EXCLUDED.presentation_basis,
        require_setoff_evidence = EXCLUDED.require_setoff_evidence,
        offset_approval_threshold = EXCLUDED.offset_approval_threshold,
        same_currency_only = EXCLUDED.same_currency_only,
        policy_note = EXCLUDED.policy_note,
        updated_by = auth.uid(), updated_at = now();

  INSERT INTO public.finance_audit_log(organization_id, actor_user_id, entity_type, entity_id, entity_ref, action, summary)
  VALUES (_org, auth.uid(), 'accounting_policy', _org, 'netting_policy', 'accounting_policy_updated',
          jsonb_build_object('before', _before, 'after', public.get_accounting_policy()));

  RETURN public.get_accounting_policy();
END;
$$;

REVOKE ALL ON FUNCTION public.get_accounting_policy() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.get_accounting_policy() TO authenticated;
REVOKE ALL ON FUNCTION public.save_accounting_policy(boolean, text, boolean, numeric, boolean, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.save_accounting_policy(boolean, text, boolean, numeric, boolean, text) TO authenticated;

-- Contra settlements: evidence, policy snapshot and approval routing
ALTER TABLE public.contra_settlements
  ADD COLUMN IF NOT EXISTS evidence_ref text,
  ADD COLUMN IF NOT EXISTS policy_snapshot jsonb,
  ADD COLUMN IF NOT EXISTS approval_request_id uuid;
