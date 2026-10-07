
-- Chargeback workflow for asset issues
CREATE TYPE public.asset_chargeback_status AS ENUM ('none','pending_approval','approved','rejected','invoiced','partially_paid','paid','waived');

ALTER TABLE public.asset_issues
  ADD COLUMN chargeback_status public.asset_chargeback_status NOT NULL DEFAULT 'none',
  ADD COLUMN chargeback_submitted_by uuid,
  ADD COLUMN chargeback_submitted_at timestamptz,
  ADD COLUMN chargeback_decided_by uuid,
  ADD COLUMN chargeback_decided_at timestamptz,
  ADD COLUMN chargeback_decision_notes text,
  ADD COLUMN chargeback_amount_paid numeric NOT NULL DEFAULT 0;

CREATE TABLE public.asset_chargeback_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  issue_id uuid NOT NULL REFERENCES public.asset_issues(id) ON DELETE CASCADE,
  amount numeric NOT NULL CHECK (amount > 0),
  currency text,
  method text NOT NULL DEFAULT 'cash',
  reference text,
  notes text,
  paid_at timestamptz NOT NULL DEFAULT now(),
  recorded_by uuid,
  transaction_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.asset_chargeback_payments TO authenticated;
GRANT ALL ON public.asset_chargeback_payments TO service_role;

ALTER TABLE public.asset_chargeback_payments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org read chargeback payments" ON public.asset_chargeback_payments
  FOR SELECT USING (organization_id = public.current_org_id() OR public.is_platform_admin());
CREATE POLICY "org write chargeback payments" ON public.asset_chargeback_payments
  FOR ALL USING (organization_id = public.current_org_id())
  WITH CHECK (organization_id = public.current_org_id());

CREATE TRIGGER trg_asset_cb_pay_currency BEFORE INSERT ON public.asset_chargeback_payments
  FOR EACH ROW EXECUTE FUNCTION public.set_currency_from_org();

CREATE INDEX idx_asset_cb_payments_issue ON public.asset_chargeback_payments(issue_id);

-- Submit a chargeback for approval
CREATE OR REPLACE FUNCTION public.submit_asset_chargeback(
  p_issue_id uuid, p_amount numeric, p_notes text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_org uuid := public.current_org_id(); v_issue public.asset_issues%ROWTYPE;
BEGIN
  SELECT * INTO v_issue FROM public.asset_issues WHERE id=p_issue_id AND organization_id=v_org FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Issue not found'; END IF;
  IF v_issue.status NOT IN ('damaged','lost') THEN RAISE EXCEPTION 'Chargeback only allowed on damaged/lost issues'; END IF;
  IF v_issue.chargeback_status NOT IN ('none','rejected') THEN RAISE EXCEPTION 'Chargeback already in progress'; END IF;
  IF COALESCE(p_amount,0) <= 0 THEN RAISE EXCEPTION 'Amount must be positive'; END IF;

  UPDATE public.asset_issues SET
    damage_charge_amount = p_amount,
    chargeback_status = 'pending_approval',
    chargeback_submitted_by = auth.uid(),
    chargeback_submitted_at = now(),
    chargeback_decision_notes = p_notes,
    chargeback_decided_by = NULL,
    chargeback_decided_at = NULL
  WHERE id = p_issue_id;
END $$;

REVOKE ALL ON FUNCTION public.submit_asset_chargeback(uuid,numeric,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_asset_chargeback(uuid,numeric,text) TO authenticated;

-- Approve: post receivable + optional invoice
CREATE OR REPLACE FUNCTION public.approve_asset_chargeback(
  p_issue_id uuid, p_notes text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_org uuid := public.current_org_id();
  v_issue public.asset_issues%ROWTYPE;
  v_txn_id uuid;
  v_holder text;
BEGIN
  SELECT * INTO v_issue FROM public.asset_issues WHERE id=p_issue_id AND organization_id=v_org FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Issue not found'; END IF;
  IF v_issue.chargeback_status <> 'pending_approval' THEN RAISE EXCEPTION 'Chargeback not pending approval'; END IF;
  IF NOT (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'org_owner') OR public.has_role(auth.uid(),'accountant') OR public.has_role(auth.uid(),'asset_manager')) THEN
    RAISE EXCEPTION 'Not authorized to approve chargebacks';
  END IF;

  SELECT COALESCE(e.name, c.name, v_issue.issued_to_name, 'holder')
    INTO v_holder
  FROM (SELECT 1) x
  LEFT JOIN public.employees e ON e.id = v_issue.issued_to_employee_id
  LEFT JOIN public.customers c ON c.id = v_issue.issued_to_customer_id;

  INSERT INTO public.accounting_transactions(
    organization_id, transaction_date, account_type, category, description,
    debit_amount, credit_amount, reference_type, reference_id, currency, created_by
  ) VALUES (
    v_org, now()::date, 'asset', 'asset_chargeback',
    format('Asset chargeback receivable from %s (issue %s)', v_holder, p_issue_id),
    v_issue.damage_charge_amount, 0, 'asset_issue', v_issue.id, v_issue.currency, auth.uid()
  ) RETURNING id INTO v_txn_id;

  INSERT INTO public.accounting_transactions(
    organization_id, transaction_date, account_type, category, description,
    debit_amount, credit_amount, reference_type, reference_id, currency, created_by
  ) VALUES (
    v_org, now()::date, 'income', 'asset_chargeback',
    format('Asset chargeback recovery from %s', v_holder),
    0, v_issue.damage_charge_amount, 'asset_issue', v_issue.id, v_issue.currency, auth.uid()
  );

  UPDATE public.asset_issues SET
    chargeback_status = 'approved',
    chargeback_decided_by = auth.uid(),
    chargeback_decided_at = now(),
    chargeback_decision_notes = COALESCE(p_notes, chargeback_decision_notes),
    charge_transaction_id = v_txn_id
  WHERE id = p_issue_id;

  RETURN v_txn_id;
END $$;

REVOKE ALL ON FUNCTION public.approve_asset_chargeback(uuid,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.approve_asset_chargeback(uuid,text) TO authenticated;

-- Reject or waive
CREATE OR REPLACE FUNCTION public.reject_asset_chargeback(
  p_issue_id uuid, p_reason text
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_org uuid := public.current_org_id();
BEGIN
  IF NOT (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'org_owner') OR public.has_role(auth.uid(),'accountant') OR public.has_role(auth.uid(),'asset_manager')) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  IF COALESCE(p_reason,'') = '' THEN RAISE EXCEPTION 'Reason required'; END IF;
  UPDATE public.asset_issues SET
    chargeback_status = 'rejected',
    chargeback_decided_by = auth.uid(),
    chargeback_decided_at = now(),
    chargeback_decision_notes = p_reason
  WHERE id = p_issue_id AND organization_id=v_org AND chargeback_status='pending_approval';
  IF NOT FOUND THEN RAISE EXCEPTION 'Chargeback not pending approval'; END IF;
END $$;

REVOKE ALL ON FUNCTION public.reject_asset_chargeback(uuid,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reject_asset_chargeback(uuid,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.waive_asset_chargeback(
  p_issue_id uuid, p_reason text
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_org uuid := public.current_org_id();
BEGIN
  IF NOT (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'org_owner')) THEN
    RAISE EXCEPTION 'Only admins can waive chargebacks';
  END IF;
  IF COALESCE(p_reason,'') = '' THEN RAISE EXCEPTION 'Reason required'; END IF;
  UPDATE public.asset_issues SET
    chargeback_status = 'waived',
    chargeback_decided_by = auth.uid(),
    chargeback_decided_at = now(),
    chargeback_decision_notes = p_reason,
    damage_charge_amount = 0
  WHERE id = p_issue_id AND organization_id=v_org
    AND chargeback_status IN ('pending_approval','approved','partially_paid','invoiced');
  IF NOT FOUND THEN RAISE EXCEPTION 'Chargeback not in a waivable state'; END IF;
END $$;

REVOKE ALL ON FUNCTION public.waive_asset_chargeback(uuid,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.waive_asset_chargeback(uuid,text) TO authenticated;

-- Record a payment
CREATE OR REPLACE FUNCTION public.record_asset_chargeback_payment(
  p_issue_id uuid, p_amount numeric, p_method text DEFAULT 'cash',
  p_reference text DEFAULT NULL, p_notes text DEFAULT NULL, p_paid_at timestamptz DEFAULT now()
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_org uuid := public.current_org_id();
  v_issue public.asset_issues%ROWTYPE;
  v_pay_id uuid;
  v_txn_id uuid;
  v_new_paid numeric;
  v_new_status public.asset_chargeback_status;
BEGIN
  SELECT * INTO v_issue FROM public.asset_issues WHERE id=p_issue_id AND organization_id=v_org FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Issue not found'; END IF;
  IF v_issue.chargeback_status NOT IN ('approved','partially_paid','invoiced') THEN
    RAISE EXCEPTION 'Chargeback must be approved before recording payment';
  END IF;
  IF COALESCE(p_amount,0) <= 0 THEN RAISE EXCEPTION 'Amount must be positive'; END IF;
  v_new_paid := v_issue.chargeback_amount_paid + p_amount;
  IF v_new_paid > v_issue.damage_charge_amount + 0.001 THEN
    RAISE EXCEPTION 'Payment exceeds chargeback balance';
  END IF;

  -- Cash/bank in, receivable down
  INSERT INTO public.accounting_transactions(
    organization_id, transaction_date, account_type, category, description,
    debit_amount, credit_amount, reference_type, reference_id, currency, created_by
  ) VALUES (
    v_org, p_paid_at::date, 'asset', 'cash_bank',
    format('Chargeback payment received (issue %s, %s)', p_issue_id, p_method),
    p_amount, 0, 'asset_issue', v_issue.id, v_issue.currency, auth.uid()
  ) RETURNING id INTO v_txn_id;

  INSERT INTO public.accounting_transactions(
    organization_id, transaction_date, account_type, category, description,
    debit_amount, credit_amount, reference_type, reference_id, currency, created_by
  ) VALUES (
    v_org, p_paid_at::date, 'asset', 'asset_chargeback',
    format('Chargeback receivable settlement (issue %s)', p_issue_id),
    0, p_amount, 'asset_issue', v_issue.id, v_issue.currency, auth.uid()
  );

  INSERT INTO public.asset_chargeback_payments(
    organization_id, issue_id, amount, currency, method, reference, notes, paid_at, recorded_by, transaction_id
  ) VALUES (
    v_org, p_issue_id, p_amount, v_issue.currency, p_method, p_reference, p_notes, p_paid_at, auth.uid(), v_txn_id
  ) RETURNING id INTO v_pay_id;

  v_new_status := CASE
    WHEN v_new_paid >= v_issue.damage_charge_amount - 0.001 THEN 'paid'::public.asset_chargeback_status
    ELSE 'partially_paid'::public.asset_chargeback_status
  END;

  UPDATE public.asset_issues SET
    chargeback_amount_paid = v_new_paid,
    chargeback_status = v_new_status
  WHERE id = p_issue_id;

  RETURN v_pay_id;
END $$;

REVOKE ALL ON FUNCTION public.record_asset_chargeback_payment(uuid,numeric,text,text,text,timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_asset_chargeback_payment(uuid,numeric,text,text,text,timestamptz) TO authenticated;

CREATE TRIGGER trg_asset_cb_pay_updated_at BEFORE UPDATE ON public.asset_chargeback_payments
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
