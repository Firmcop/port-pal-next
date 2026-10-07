
-- 1. Approval columns
ALTER TABLE public.payslips
  ADD COLUMN IF NOT EXISTS approval_status text NOT NULL DEFAULT 'not_required'
    CHECK (approval_status IN ('not_required','pending','approved','rejected')),
  ADD COLUMN IF NOT EXISTS submitted_for_approval_at timestamptz,
  ADD COLUMN IF NOT EXISTS submitted_by uuid,
  ADD COLUMN IF NOT EXISTS approved_by uuid,
  ADD COLUMN IF NOT EXISTS approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS approval_comment text;

-- 2. Submit for approval
CREATE OR REPLACE FUNCTION public.submit_payslip_for_approval(_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE ps RECORD;
BEGIN
  SELECT * INTO ps FROM public.payslips WHERE id=_id;
  IF ps IS NULL THEN RAISE EXCEPTION 'Payslip not found'; END IF;
  IF ps.organization_id <> current_org_id() THEN RAISE EXCEPTION 'Forbidden'; END IF;
  IF ps.status <> 'draft' THEN RAISE EXCEPTION 'Only draft payslips can be submitted'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.payslip_lines WHERE payslip_id=_id) THEN
    RAISE EXCEPTION 'Add at least one line before submitting';
  END IF;
  UPDATE public.payslips
     SET approval_status='pending', submitted_for_approval_at=now(), submitted_by=auth.uid(),
         approved_by=NULL, approved_at=NULL, approval_comment=NULL
   WHERE id=_id;
  INSERT INTO public.org_lifecycle_events (organization_id, event_type, actor_user_id, details)
  VALUES (ps.organization_id,'payslip_submitted_for_approval', auth.uid(),
          jsonb_build_object('payslip_id', ps.id, 'reference', ps.reference));
END $$;

-- 3. Approve
CREATE OR REPLACE FUNCTION public.approve_payslip(_id uuid, _comment text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE ps RECORD;
BEGIN
  SELECT * INTO ps FROM public.payslips WHERE id=_id;
  IF ps IS NULL THEN RAISE EXCEPTION 'Payslip not found'; END IF;
  IF ps.organization_id <> current_org_id() THEN RAISE EXCEPTION 'Forbidden'; END IF;
  IF NOT has_role(auth.uid(),'admin'::app_role) THEN RAISE EXCEPTION 'Admin required'; END IF;
  IF ps.approval_status <> 'pending' THEN RAISE EXCEPTION 'Payslip is not awaiting approval'; END IF;
  UPDATE public.payslips
     SET approval_status='approved', approved_by=auth.uid(), approved_at=now(),
         approval_comment=_comment
   WHERE id=_id;
  INSERT INTO public.org_lifecycle_events (organization_id, event_type, actor_user_id, details)
  VALUES (ps.organization_id,'payslip_approved', auth.uid(),
          jsonb_build_object('payslip_id', ps.id, 'reference', ps.reference, 'comment', _comment));
END $$;

-- 4. Reject (returns to draft for editing)
CREATE OR REPLACE FUNCTION public.reject_payslip(_id uuid, _comment text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE ps RECORD;
BEGIN
  SELECT * INTO ps FROM public.payslips WHERE id=_id;
  IF ps IS NULL THEN RAISE EXCEPTION 'Payslip not found'; END IF;
  IF ps.organization_id <> current_org_id() THEN RAISE EXCEPTION 'Forbidden'; END IF;
  IF NOT has_role(auth.uid(),'admin'::app_role) THEN RAISE EXCEPTION 'Admin required'; END IF;
  IF ps.approval_status <> 'pending' THEN RAISE EXCEPTION 'Payslip is not awaiting approval'; END IF;
  UPDATE public.payslips
     SET approval_status='rejected', approved_by=auth.uid(), approved_at=now(),
         approval_comment=_comment
   WHERE id=_id;
  INSERT INTO public.org_lifecycle_events (organization_id, event_type, actor_user_id, details)
  VALUES (ps.organization_id,'payslip_rejected', auth.uid(),
          jsonb_build_object('payslip_id', ps.id, 'reference', ps.reference, 'comment', _comment));
END $$;

-- 5. Update post_payslip to enforce approval when org config requires it
CREATE OR REPLACE FUNCTION public.post_payslip(_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  ps RECORD; emp RECORD; txn_id uuid; txn_no text; org_cfg jsonb; require_approval boolean;
BEGIN
  SELECT * INTO ps FROM public.payslips WHERE id = _id;
  IF ps IS NULL THEN RAISE EXCEPTION 'Payslip not found'; END IF;
  IF ps.organization_id <> current_org_id() THEN RAISE EXCEPTION 'Forbidden'; END IF;
  IF NOT has_role(auth.uid(),'admin'::app_role) THEN RAISE EXCEPTION 'Admin required'; END IF;
  IF ps.status <> 'draft' THEN RAISE EXCEPTION 'Only draft payslips can be posted'; END IF;

  SELECT config INTO org_cfg FROM public.organizations WHERE id = ps.organization_id;
  require_approval := COALESCE((org_cfg->>'payslip_requires_approval')::boolean, false);
  IF require_approval AND ps.approval_status <> 'approved' THEN
    RAISE EXCEPTION 'Payslip must be approved before posting';
  END IF;

  SELECT * INTO emp FROM public.employees WHERE id = ps.employee_id;
  txn_no := 'PSL-TXN-' || to_char(now(),'YYYYMMDDHH24MISS') || '-' || substring(_id::text,1,4);

  INSERT INTO public.accounting_transactions
    (transaction_number, transaction_date, account_type, category, description,
     debit_amount, credit_amount, reference_type, reference_id, organization_id, created_by)
  VALUES
    (txn_no, ps.pay_date, 'expense', 'payroll',
     'Payroll: ' || emp.name || ' (' || ps.reference || ')',
     ps.gross_pay + ps.total_contributions, 0,
     'payslip', ps.id, ps.organization_id, auth.uid())
  RETURNING id INTO txn_id;

  UPDATE public.payslips
     SET status='posted', posted_at=now(), accounting_transaction_id=txn_id
   WHERE id=_id;

  INSERT INTO public.org_lifecycle_events (organization_id, event_type, actor_user_id, details)
  VALUES (ps.organization_id,'payslip_posted', auth.uid(),
          jsonb_build_object('payslip_id', ps.id, 'reference', ps.reference, 'net_pay', ps.net_pay));

  RETURN txn_id;
END $$;

-- 6. Aggregate payment status view
CREATE OR REPLACE VIEW public.employee_payroll_status AS
SELECT e.id AS employee_id, e.organization_id,
       COALESCE(SUM(CASE WHEN p.status='posted' THEN p.net_pay ELSE 0 END),0) AS pending_amount,
       COALESCE(SUM(CASE WHEN p.status='paid' THEN p.net_pay ELSE 0 END),0) AS paid_amount,
       MAX(CASE WHEN p.status='paid' THEN p.paid_at END) AS last_paid_at,
       COUNT(*) FILTER (WHERE p.status='draft') AS draft_count,
       COUNT(*) FILTER (WHERE p.status='posted') AS posted_count,
       COUNT(*) FILTER (WHERE p.status='paid') AS paid_count
FROM public.employees e
LEFT JOIN public.payslips p ON p.employee_id = e.id
GROUP BY e.id, e.organization_id;

ALTER VIEW public.employee_payroll_status SET (security_invoker = true);
