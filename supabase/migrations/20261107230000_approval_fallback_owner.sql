-- =====================================================================
-- Approval requests reach someone (7 Nov 2026).
--
-- evaluate_approval_required routed a request only to the requester's
-- manager (profiles.manager_id). Nobody has a manager set, so requests were
-- created unassigned and no one was notified. Fall back to the company
-- owner (an org_owner member other than the requester), so payments raised
-- by the accountant and other limited roles notify the owner, who approves
-- them in Finance > Approvals. Admins can still decide any request.
-- =====================================================================
CREATE OR REPLACE FUNCTION public.evaluate_approval_required(_doc_type text, _org_id uuid, _amount numeric, _created_by uuid)
RETURNS TABLE(required boolean, assignee uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  pol public.approval_policies%ROWTYPE;
  creator_roles text[];
  is_limited boolean := false;
  mgr uuid;
BEGIN
  IF _created_by IS NULL THEN
    RETURN QUERY SELECT false, NULL::uuid; RETURN;
  END IF;

  -- Admins always bypass
  IF has_role(_created_by, 'admin'::app_role) THEN
    RETURN QUERY SELECT false, NULL::uuid; RETURN;
  END IF;

  SELECT * INTO pol FROM public.approval_policies
   WHERE organization_id = _org_id AND document_type = _doc_type AND enabled = true;
  IF NOT FOUND THEN
    RETURN QUERY SELECT false, NULL::uuid; RETURN;
  END IF;

  SELECT array_agg(role::text) INTO creator_roles FROM public.user_roles WHERE user_id = _created_by;
  IF creator_roles IS NOT NULL AND creator_roles && pol.limited_roles THEN
    is_limited := true;
  END IF;

  IF NOT is_limited AND COALESCE(_amount, 0) < COALESCE(pol.min_amount, 0) THEN
    RETURN QUERY SELECT false, NULL::uuid; RETURN;
  END IF;

  -- Routing: the requester's manager, otherwise the company owner
  SELECT p.manager_id INTO mgr FROM public.profiles p
   WHERE (p.user_id = _created_by OR p.id = _created_by) AND p.manager_id IS DISTINCT FROM _created_by
   LIMIT 1;
  IF mgr IS NULL THEN
    SELECT m.user_id INTO mgr FROM public.organization_members m
     WHERE m.organization_id = _org_id AND m.role = 'org_owner' AND m.user_id <> _created_by
     ORDER BY m.created_at LIMIT 1;
  END IF;
  RETURN QUERY SELECT true, mgr;
END $$;
