
-- ============= payroll_runs =============
CREATE TABLE public.payroll_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL DEFAULT current_org_id() REFERENCES organizations(id) ON DELETE CASCADE,
  period_start date NOT NULL,
  period_end date NOT NULL,
  division text,
  idempotency_key text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approving','posted','partial','failed')),
  total_payslips int NOT NULL DEFAULT 0,
  posted_count int NOT NULL DEFAULT 0,
  pending_approval_count int NOT NULL DEFAULT 0,
  failed_count int NOT NULL DEFAULT 0,
  triggered_by uuid,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  error_log jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, idempotency_key)
);
CREATE INDEX idx_payroll_runs_org ON public.payroll_runs(organization_id, started_at DESC);
ALTER TABLE public.payroll_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Org members view payroll_runs" ON public.payroll_runs FOR SELECT USING (organization_id = current_org_id() OR is_platform_admin());

CREATE TABLE public.payroll_run_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES payroll_runs(id) ON DELETE CASCADE,
  payslip_id uuid NOT NULL REFERENCES payslips(id) ON DELETE CASCADE,
  action text NOT NULL CHECK (action IN ('submitted','posted','skipped','failed')),
  error text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_payroll_run_items_run ON public.payroll_run_items(run_id);
ALTER TABLE public.payroll_run_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Org members view run items" ON public.payroll_run_items FOR SELECT USING (
  EXISTS (SELECT 1 FROM payroll_runs r WHERE r.id = run_id AND (r.organization_id = current_org_id() OR is_platform_admin()))
);

-- ============= execute_payroll_run RPC =============
CREATE OR REPLACE FUNCTION public.execute_payroll_run(
  _period_start date, _period_end date, _division text, _idempotency_key text
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _org uuid := current_org_id();
  _existing uuid;
  _run_id uuid;
  _requires_approval boolean;
  _ps RECORD;
  _posted int := 0; _pending int := 0; _failed int := 0; _total int := 0;
  _errs jsonb := '[]'::jsonb;
  _final text;
BEGIN
  -- idempotency
  SELECT id INTO _existing FROM payroll_runs
   WHERE organization_id = _org AND idempotency_key = _idempotency_key;
  IF _existing IS NOT NULL THEN RETURN _existing; END IF;

  SELECT COALESCE((config->>'payslip_requires_approval')::boolean, false)
    INTO _requires_approval FROM organizations WHERE id = _org;

  INSERT INTO payroll_runs (organization_id, period_start, period_end, division, idempotency_key, triggered_by, status)
    VALUES (_org, _period_start, _period_end, _division, _idempotency_key, auth.uid(), 'pending')
    RETURNING id INTO _run_id;

  FOR _ps IN
    SELECT p.id, p.status, p.approval_status
      FROM payslips p
      LEFT JOIN employees e ON e.id = p.employee_id
     WHERE p.organization_id = _org
       AND p.pay_date BETWEEN _period_start AND _period_end
       AND p.status = 'draft'
       AND (_division IS NULL OR e.division = _division)
  LOOP
    _total := _total + 1;
    BEGIN
      IF _requires_approval AND _ps.approval_status NOT IN ('approved') THEN
        IF _ps.approval_status IN ('not_required','rejected') OR _ps.approval_status IS NULL THEN
          PERFORM submit_payslip_for_approval(_ps.id);
        END IF;
        _pending := _pending + 1;
        INSERT INTO payroll_run_items(run_id, payslip_id, action) VALUES (_run_id, _ps.id, 'submitted');
      ELSE
        PERFORM post_payslip(_ps.id);
        _posted := _posted + 1;
        INSERT INTO payroll_run_items(run_id, payslip_id, action) VALUES (_run_id, _ps.id, 'posted');
      END IF;
    EXCEPTION WHEN OTHERS THEN
      _failed := _failed + 1;
      _errs := _errs || jsonb_build_object('payslip_id', _ps.id, 'error', SQLERRM);
      INSERT INTO payroll_run_items(run_id, payslip_id, action, error) VALUES (_run_id, _ps.id, 'failed', SQLERRM);
    END;
  END LOOP;

  _final := CASE
    WHEN _total = 0 THEN 'posted'
    WHEN _failed = _total THEN 'failed'
    WHEN _pending > 0 AND _posted = 0 AND _failed = 0 THEN 'approving'
    WHEN _failed > 0 OR _pending > 0 THEN 'partial'
    ELSE 'posted'
  END;

  UPDATE payroll_runs SET
    total_payslips = _total, posted_count = _posted, pending_approval_count = _pending,
    failed_count = _failed, error_log = _errs, status = _final, completed_at = now()
   WHERE id = _run_id;

  PERFORM log_org_event(_org, 'payroll_run_completed',
    jsonb_build_object('run_id', _run_id, 'period_start', _period_start, 'period_end', _period_end,
      'total', _total, 'posted', _posted, 'pending_approval', _pending, 'failed', _failed));

  RETURN _run_id;
END $$;

-- ============= link_payslip_payment RPC =============
CREATE OR REPLACE FUNCTION public.link_payslip_payment(_payslip_id uuid, _txn_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _org uuid := current_org_id(); _account uuid; _date timestamptz;
BEGIN
  SELECT financial_account_id, transaction_date INTO _account, _date
    FROM accounting_transactions WHERE id = _txn_id AND organization_id = _org;
  IF _account IS NULL THEN RAISE EXCEPTION 'Transaction not found'; END IF;

  UPDATE payslips
     SET status = 'paid',
         paid_at = COALESCE(paid_at, _date),
         paid_from_account_id = _account,
         accounting_transaction_id = _txn_id,
         updated_at = now()
   WHERE id = _payslip_id AND organization_id = _org AND status IN ('posted','paid');

  PERFORM log_org_event(_org, 'payslip_payment_reconciled',
    jsonb_build_object('payslip_id', _payslip_id, 'transaction_id', _txn_id));
END $$;

-- ============= notify_payslip_event =============
CREATE OR REPLACE FUNCTION public.notify_payslip_event(_payslip_id uuid, _event text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _org uuid; _ref text; _emp_name text; _net numeric; _submitter uuid; _created_by uuid;
  _title text; _msg text; _type text := 'info'; _r RECORD;
BEGIN
  SELECT p.organization_id, p.reference, p.net_pay, p.submitted_by, p.created_by, e.name
    INTO _org, _ref, _net, _submitter, _created_by, _emp_name
    FROM payslips p LEFT JOIN employees e ON e.id = p.employee_id
   WHERE p.id = _payslip_id;
  IF _org IS NULL THEN RETURN; END IF;

  CASE _event
    WHEN 'created' THEN _title := 'Payslip created'; _msg := _ref || ' for ' || COALESCE(_emp_name,'employee');
    WHEN 'submitted_for_approval' THEN _title := 'Payslip needs approval'; _msg := _ref || ' for ' || COALESCE(_emp_name,'employee') || ' is awaiting approval'; _type := 'warning';
    WHEN 'approved' THEN _title := 'Payslip approved'; _msg := _ref || ' has been approved'; _type := 'success';
    WHEN 'rejected' THEN _title := 'Payslip rejected'; _msg := _ref || ' was rejected'; _type := 'error';
    WHEN 'paid' THEN _title := 'Payslip paid'; _msg := _ref || ' has been paid'; _type := 'success';
    ELSE RETURN;
  END CASE;

  IF _event = 'submitted_for_approval' THEN
    -- notify org admins/owners
    FOR _r IN SELECT user_id FROM organization_members
              WHERE organization_id = _org AND status='active' AND role IN ('owner','admin','manager') LOOP
      INSERT INTO notifications(organization_id, user_id, title, message, type, reference_id, reference_type)
        VALUES (_org, _r.user_id, _title, _msg, _type, _payslip_id, 'payslip');
    END LOOP;
  ELSIF _event IN ('approved','rejected','paid') THEN
    IF _submitter IS NOT NULL THEN
      INSERT INTO notifications(organization_id, user_id, title, message, type, reference_id, reference_type)
        VALUES (_org, _submitter, _title, _msg, _type, _payslip_id, 'payslip');
    END IF;
    IF _created_by IS NOT NULL AND _created_by <> COALESCE(_submitter, '00000000-0000-0000-0000-000000000000'::uuid) THEN
      INSERT INTO notifications(organization_id, user_id, title, message, type, reference_id, reference_type)
        VALUES (_org, _created_by, _title, _msg, _type, _payslip_id, 'payslip');
    END IF;
  ELSIF _event = 'created' AND _created_by IS NOT NULL THEN
    INSERT INTO notifications(organization_id, user_id, title, message, type, reference_id, reference_type)
      VALUES (_org, _created_by, _title, _msg, _type, _payslip_id, 'payslip');
  END IF;
END $$;

-- ============= triggers on payslips =============
CREATE OR REPLACE FUNCTION public.trg_payslip_notify() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM notify_payslip_event(NEW.id, 'created');
    RETURN NEW;
  END IF;
  IF NEW.approval_status IS DISTINCT FROM OLD.approval_status THEN
    IF NEW.approval_status = 'pending' THEN PERFORM notify_payslip_event(NEW.id, 'submitted_for_approval'); END IF;
    IF NEW.approval_status = 'approved' THEN PERFORM notify_payslip_event(NEW.id, 'approved'); END IF;
    IF NEW.approval_status = 'rejected' THEN PERFORM notify_payslip_event(NEW.id, 'rejected'); END IF;
  END IF;
  IF NEW.status = 'paid' AND OLD.status <> 'paid' THEN
    PERFORM notify_payslip_event(NEW.id, 'paid');
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS payslip_notify_ins ON public.payslips;
DROP TRIGGER IF EXISTS payslip_notify_upd ON public.payslips;
CREATE TRIGGER payslip_notify_ins AFTER INSERT ON public.payslips FOR EACH ROW EXECUTE FUNCTION trg_payslip_notify();
CREATE TRIGGER payslip_notify_upd AFTER UPDATE ON public.payslips FOR EACH ROW EXECUTE FUNCTION trg_payslip_notify();

-- ============= payslip_pdf_settings =============
CREATE TABLE public.payslip_pdf_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL DEFAULT current_org_id() REFERENCES organizations(id) ON DELETE CASCADE,
  language text,
  logo_url text,
  header_address text,
  footer_text text,
  signature_block_text text,
  currency_code text NOT NULL DEFAULT 'USD',
  currency_symbol text NOT NULL DEFAULT '$',
  currency_position text NOT NULL DEFAULT 'before' CHECK (currency_position IN ('before','after')),
  decimal_places int NOT NULL DEFAULT 2 CHECK (decimal_places BETWEEN 0 AND 4),
  accent_color text NOT NULL DEFAULT '#1e3a5f',
  show_qr boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, language)
);
CREATE INDEX idx_payslip_pdf_settings_org ON public.payslip_pdf_settings(organization_id);
ALTER TABLE public.payslip_pdf_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Org members view pdf settings" ON public.payslip_pdf_settings
  FOR SELECT USING (organization_id = current_org_id() OR is_platform_admin());
CREATE POLICY "Admins manage pdf settings" ON public.payslip_pdf_settings
  FOR ALL USING (organization_id = current_org_id() AND has_role(auth.uid(),'admin'))
  WITH CHECK (organization_id = current_org_id() AND has_role(auth.uid(),'admin'));

CREATE TRIGGER payslip_pdf_settings_updated BEFORE UPDATE ON public.payslip_pdf_settings
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
