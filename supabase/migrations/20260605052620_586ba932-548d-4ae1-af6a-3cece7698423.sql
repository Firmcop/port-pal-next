-- Finance change audit log: who/what/when for postings, payments, reconciliations
CREATE TABLE public.finance_audit_log (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id uuid NOT NULL,
  actor_user_id uuid,
  actor_email text,
  entity_type text NOT NULL,            -- 'transaction','invoice','payment','vendor_payment','reconciliation','recon_line'
  entity_id uuid NOT NULL,
  entity_ref text,                       -- human-readable (invoice #, txn #, etc.)
  action text NOT NULL,                  -- 'insert','update','delete','post','void','cleared','uncleared','complete','reopen'
  summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  before_data jsonb,
  after_data jsonb,
  route text,                            -- replayable deep link
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_fal_org_created ON public.finance_audit_log (organization_id, created_at DESC);
CREATE INDEX idx_fal_entity ON public.finance_audit_log (entity_type, entity_id);
CREATE INDEX idx_fal_actor ON public.finance_audit_log (actor_user_id);

GRANT SELECT, INSERT ON public.finance_audit_log TO authenticated;
GRANT ALL ON public.finance_audit_log TO service_role;

ALTER TABLE public.finance_audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org members can read finance audit log"
ON public.finance_audit_log FOR SELECT TO authenticated
USING (organization_id = current_org_id() OR is_platform_admin());

CREATE POLICY "System can insert finance audit log"
ON public.finance_audit_log FOR INSERT TO authenticated
WITH CHECK (organization_id = current_org_id() OR is_platform_admin());

-- Realtime
ALTER TABLE public.finance_audit_log REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE public.finance_audit_log;

-- Helper: write an audit entry
CREATE OR REPLACE FUNCTION public.fal_write(
  _org uuid, _entity text, _entity_id uuid, _ref text, _action text,
  _summary jsonb, _before jsonb, _after jsonb, _route text
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _uid uuid; _email text;
BEGIN
  IF _org IS NULL THEN RETURN; END IF;
  BEGIN _uid := auth.uid(); EXCEPTION WHEN OTHERS THEN _uid := NULL; END;
  IF _uid IS NOT NULL THEN
    SELECT email INTO _email FROM auth.users WHERE id = _uid;
  END IF;
  INSERT INTO public.finance_audit_log(
    organization_id, actor_user_id, actor_email, entity_type, entity_id,
    entity_ref, action, summary, before_data, after_data, route
  ) VALUES (
    _org, _uid, _email, _entity, _entity_id,
    _ref, _action, COALESCE(_summary,'{}'::jsonb), _before, _after, _route
  );
END $$;

-- Trigger functions per entity ---------------------------------

CREATE OR REPLACE FUNCTION public.trg_fal_accounting_transactions()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _act text; _sum jsonb; _route text;
BEGIN
  IF TG_OP = 'INSERT' THEN _act := 'post';
  ELSIF TG_OP = 'UPDATE' THEN _act := CASE
    WHEN NEW.cleared_at IS DISTINCT FROM OLD.cleared_at AND NEW.cleared_at IS NOT NULL THEN 'cleared'
    WHEN NEW.cleared_at IS DISTINCT FROM OLD.cleared_at AND NEW.cleared_at IS NULL THEN 'uncleared'
    ELSE 'update' END;
  ELSE _act := 'delete'; END IF;
  _sum := jsonb_build_object(
    'txn_number', COALESCE(NEW.transaction_number, OLD.transaction_number),
    'debit', COALESCE(NEW.debit_amount, OLD.debit_amount),
    'credit', COALESCE(NEW.credit_amount, OLD.credit_amount),
    'description', COALESCE(NEW.description, OLD.description)
  );
  _route := '/finance/ledger?txn=' || COALESCE(NEW.id, OLD.id)::text;
  PERFORM fal_write(COALESCE(NEW.organization_id, OLD.organization_id),
    'transaction', COALESCE(NEW.id, OLD.id),
    COALESCE(NEW.transaction_number, OLD.transaction_number),
    _act, _sum,
    CASE WHEN TG_OP <> 'INSERT' THEN to_jsonb(OLD) ELSE NULL END,
    CASE WHEN TG_OP <> 'DELETE' THEN to_jsonb(NEW) ELSE NULL END,
    _route);
  RETURN COALESCE(NEW, OLD);
END $$;

CREATE OR REPLACE FUNCTION public.trg_fal_payments()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _act text;
BEGIN
  _act := CASE TG_OP WHEN 'INSERT' THEN 'record' WHEN 'UPDATE' THEN 'update' ELSE 'delete' END;
  PERFORM fal_write(COALESCE(NEW.organization_id, OLD.organization_id),
    'payment', COALESCE(NEW.id, OLD.id),
    COALESCE(NEW.payment_number, OLD.payment_number),
    _act,
    jsonb_build_object(
      'amount', COALESCE(NEW.amount, OLD.amount),
      'method', COALESCE(NEW.payment_method, OLD.payment_method),
      'date', COALESCE(NEW.payment_date, OLD.payment_date)),
    CASE WHEN TG_OP <> 'INSERT' THEN to_jsonb(OLD) ELSE NULL END,
    CASE WHEN TG_OP <> 'DELETE' THEN to_jsonb(NEW) ELSE NULL END,
    '/billing/payments?payment=' || COALESCE(NEW.id, OLD.id)::text);
  RETURN COALESCE(NEW, OLD);
END $$;

CREATE OR REPLACE FUNCTION public.trg_fal_vendor_payments()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _act text;
BEGIN
  _act := CASE TG_OP WHEN 'INSERT' THEN 'record' WHEN 'UPDATE' THEN 'update' ELSE 'delete' END;
  PERFORM fal_write(COALESCE(NEW.organization_id, OLD.organization_id),
    'vendor_payment', COALESCE(NEW.id, OLD.id),
    COALESCE(NEW.payment_number, OLD.payment_number),
    _act,
    jsonb_build_object(
      'amount', COALESCE(NEW.amount, OLD.amount),
      'method', COALESCE(NEW.payment_method, OLD.payment_method),
      'date', COALESCE(NEW.payment_date, OLD.payment_date)),
    CASE WHEN TG_OP <> 'INSERT' THEN to_jsonb(OLD) ELSE NULL END,
    CASE WHEN TG_OP <> 'DELETE' THEN to_jsonb(NEW) ELSE NULL END,
    '/billing/payments?vendor_payment=' || COALESCE(NEW.id, OLD.id)::text);
  RETURN COALESCE(NEW, OLD);
END $$;

CREATE OR REPLACE FUNCTION public.trg_fal_invoices()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _act text;
BEGIN
  IF TG_OP = 'INSERT' THEN _act := 'create';
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.status IS DISTINCT FROM OLD.status THEN _act := 'status:' || NEW.status;
    ELSE _act := 'update'; END IF;
  ELSE _act := 'delete'; END IF;
  PERFORM fal_write(COALESCE(NEW.organization_id, OLD.organization_id),
    'invoice', COALESCE(NEW.id, OLD.id),
    COALESCE(NEW.invoice_number, OLD.invoice_number),
    _act,
    jsonb_build_object(
      'total', COALESCE(NEW.total_amount, OLD.total_amount),
      'status', COALESCE(NEW.status, OLD.status),
      'customer_id', COALESCE(NEW.customer_id, OLD.customer_id)),
    CASE WHEN TG_OP <> 'INSERT' THEN to_jsonb(OLD) ELSE NULL END,
    CASE WHEN TG_OP <> 'DELETE' THEN to_jsonb(NEW) ELSE NULL END,
    '/billing/invoices?invoice=' || COALESCE(NEW.id, OLD.id)::text);
  RETURN COALESCE(NEW, OLD);
END $$;

CREATE OR REPLACE FUNCTION public.trg_fal_bank_reconciliations()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _act text;
BEGIN
  IF TG_OP = 'INSERT' THEN _act := 'create';
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.status IS DISTINCT FROM OLD.status THEN _act := 'status:' || NEW.status;
    ELSE _act := 'update'; END IF;
  ELSE _act := 'delete'; END IF;
  PERFORM fal_write(COALESCE(NEW.organization_id, OLD.organization_id),
    'reconciliation', COALESCE(NEW.id, OLD.id),
    COALESCE(NEW.statement_end::text, OLD.statement_end::text),
    _act,
    jsonb_build_object(
      'account_id', COALESCE(NEW.account_id, OLD.account_id),
      'opening', COALESCE(NEW.statement_opening_balance, OLD.statement_opening_balance),
      'closing', COALESCE(NEW.statement_closing_balance, OLD.statement_closing_balance),
      'status', COALESCE(NEW.status, OLD.status)),
    CASE WHEN TG_OP <> 'INSERT' THEN to_jsonb(OLD) ELSE NULL END,
    CASE WHEN TG_OP <> 'DELETE' THEN to_jsonb(NEW) ELSE NULL END,
    '/finance/reconciliations/' || COALESCE(NEW.id, OLD.id)::text);
  RETURN COALESCE(NEW, OLD);
END $$;

CREATE OR REPLACE FUNCTION public.trg_fal_recon_lines()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _act text; _org uuid;
BEGIN
  IF TG_OP = 'INSERT' THEN _act := 'add_line';
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.cleared IS DISTINCT FROM OLD.cleared THEN
      _act := CASE WHEN NEW.cleared THEN 'cleared' ELSE 'uncleared' END;
    ELSIF NEW.resolved_at IS DISTINCT FROM OLD.resolved_at AND NEW.resolved_at IS NOT NULL THEN _act := 'resolved';
    ELSIF NEW.excluded IS DISTINCT FROM OLD.excluded THEN _act := CASE WHEN NEW.excluded THEN 'excluded' ELSE 'unexcluded' END;
    ELSE _act := 'update'; END IF;
  ELSE _act := 'remove_line'; END IF;
  SELECT organization_id INTO _org FROM public.bank_reconciliations
   WHERE id = COALESCE(NEW.reconciliation_id, OLD.reconciliation_id);
  PERFORM fal_write(_org, 'recon_line', COALESCE(NEW.id, OLD.id),
    NULL, _act,
    jsonb_build_object(
      'reconciliation_id', COALESCE(NEW.reconciliation_id, OLD.reconciliation_id),
      'transaction_id', COALESCE(NEW.transaction_id, OLD.transaction_id),
      'cleared', COALESCE(NEW.cleared, OLD.cleared),
      'reason', COALESCE(NEW.override_reason, OLD.override_reason)),
    CASE WHEN TG_OP <> 'INSERT' THEN to_jsonb(OLD) ELSE NULL END,
    CASE WHEN TG_OP <> 'DELETE' THEN to_jsonb(NEW) ELSE NULL END,
    '/finance/reconciliations/' || COALESCE(NEW.reconciliation_id, OLD.reconciliation_id)::text);
  RETURN COALESCE(NEW, OLD);
END $$;

-- Attach triggers (AFTER, so prior posting triggers run first)
DROP TRIGGER IF EXISTS trg_fal_acct_txn ON public.accounting_transactions;
CREATE TRIGGER trg_fal_acct_txn AFTER INSERT OR UPDATE OR DELETE ON public.accounting_transactions
FOR EACH ROW EXECUTE FUNCTION public.trg_fal_accounting_transactions();

DROP TRIGGER IF EXISTS trg_fal_payments ON public.payments;
CREATE TRIGGER trg_fal_payments AFTER INSERT OR UPDATE OR DELETE ON public.payments
FOR EACH ROW EXECUTE FUNCTION public.trg_fal_payments();

DROP TRIGGER IF EXISTS trg_fal_vendor_payments ON public.vendor_payments;
CREATE TRIGGER trg_fal_vendor_payments AFTER INSERT OR UPDATE OR DELETE ON public.vendor_payments
FOR EACH ROW EXECUTE FUNCTION public.trg_fal_vendor_payments();

DROP TRIGGER IF EXISTS trg_fal_invoices ON public.invoices;
CREATE TRIGGER trg_fal_invoices AFTER INSERT OR UPDATE OR DELETE ON public.invoices
FOR EACH ROW EXECUTE FUNCTION public.trg_fal_invoices();

DROP TRIGGER IF EXISTS trg_fal_bank_recon ON public.bank_reconciliations;
CREATE TRIGGER trg_fal_bank_recon AFTER INSERT OR UPDATE OR DELETE ON public.bank_reconciliations
FOR EACH ROW EXECUTE FUNCTION public.trg_fal_bank_reconciliations();

DROP TRIGGER IF EXISTS trg_fal_recon_lines ON public.bank_reconciliation_lines;
CREATE TRIGGER trg_fal_recon_lines AFTER INSERT OR UPDATE OR DELETE ON public.bank_reconciliation_lines
FOR EACH ROW EXECUTE FUNCTION public.trg_fal_recon_lines();