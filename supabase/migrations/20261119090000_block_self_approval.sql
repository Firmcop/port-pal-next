-- =====================================================================
-- Segregation of duties (19 Nov 2026) — gap analysis, phase 1.
-- Nobody approves a finance document they raised themselves. The company
-- owner (organization_members.role = 'org_owner') may still do so, as the
-- last resort when no one else can approve. Platform admins too.
-- Applies to: approval requests, operating expenses, expense claims,
-- customer payments and supplier payments.
-- =====================================================================
CREATE OR REPLACE FUNCTION public.is_org_owner(_user uuid, _org uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT EXISTS (SELECT 1 FROM organization_members m
                  WHERE m.user_id = _user AND m.organization_id = _org AND m.role = 'org_owner'
                    AND COALESCE(m.status, 'active') = 'active');
$$;

CREATE OR REPLACE FUNCTION public.trg_block_self_approval()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _approver uuid; _raiser uuid; _approving boolean;
BEGIN
  IF TG_TABLE_NAME = 'approval_requests' THEN
    _approving := NEW.status::text = 'approved' AND OLD.status::text IS DISTINCT FROM 'approved';
    _approver := COALESCE(NEW.decided_by, auth.uid());
    _raiser := NEW.requested_by;
  ELSIF TG_TABLE_NAME IN ('operating_expenses', 'expense_claims') THEN
    _approving := NEW.approved_by IS NOT NULL AND OLD.approved_by IS DISTINCT FROM NEW.approved_by;
    _approver := NEW.approved_by;
    _raiser := COALESCE(NEW.submitted_by, NEW.created_by);
  ELSE -- payments, vendor_payments
    _approving := NEW.approved_by IS NOT NULL AND OLD.approved_by IS DISTINCT FROM NEW.approved_by;
    _approver := NEW.approved_by;
    _raiser := COALESCE(NEW.recorded_by, NEW.created_by);
  END IF;

  IF _approving AND _approver IS NOT NULL AND _approver = _raiser
     AND NOT public.is_org_owner(_approver, NEW.organization_id)
     AND NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'You cannot approve something you raised yourself. Ask your manager or the company owner to approve it.'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_block_self_approval ON public.approval_requests;
CREATE TRIGGER trg_block_self_approval BEFORE UPDATE OF status, decided_by ON public.approval_requests
  FOR EACH ROW EXECUTE FUNCTION public.trg_block_self_approval();
DROP TRIGGER IF EXISTS trg_block_self_approval ON public.operating_expenses;
CREATE TRIGGER trg_block_self_approval BEFORE UPDATE OF approved_by ON public.operating_expenses
  FOR EACH ROW EXECUTE FUNCTION public.trg_block_self_approval();
DROP TRIGGER IF EXISTS trg_block_self_approval ON public.expense_claims;
CREATE TRIGGER trg_block_self_approval BEFORE UPDATE OF approved_by ON public.expense_claims
  FOR EACH ROW EXECUTE FUNCTION public.trg_block_self_approval();
DROP TRIGGER IF EXISTS trg_block_self_approval ON public.payments;
CREATE TRIGGER trg_block_self_approval BEFORE UPDATE OF approved_by ON public.payments
  FOR EACH ROW EXECUTE FUNCTION public.trg_block_self_approval();
DROP TRIGGER IF EXISTS trg_block_self_approval ON public.vendor_payments;
CREATE TRIGGER trg_block_self_approval BEFORE UPDATE OF approved_by ON public.vendor_payments
  FOR EACH ROW EXECUTE FUNCTION public.trg_block_self_approval();
