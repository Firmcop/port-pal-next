
-- ============================================================
-- A. Invoice -> Ledger auto-post (idempotent)
-- ============================================================
CREATE OR REPLACE FUNCTION public.post_invoice_to_ledger(_invoice_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _inv invoices%ROWTYPE;
  _net numeric(14,2);
  _tax numeric(14,2);
BEGIN
  SELECT * INTO _inv FROM invoices WHERE id = _invoice_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'invoice_not_found'; END IF;

  -- Idempotency: skip if already posted
  IF EXISTS (
    SELECT 1 FROM accounting_transactions
    WHERE reference_type = 'invoice' AND reference_id = _invoice_id
      AND account_type = 'revenue'
  ) THEN RETURN; END IF;

  _net := COALESCE(_inv.subtotal, _inv.total_amount - COALESCE(_inv.tax_amount,0));
  _tax := COALESCE(_inv.tax_amount, 0);

  -- AR debit (asset)
  INSERT INTO accounting_transactions(
    transaction_number, transaction_date, account_type, category, description,
    debit_amount, credit_amount, reference_type, reference_id, organization_id, currency
  ) VALUES (
    'AR-'||substring(_inv.invoice_number from 1 for 30)||'-'||substring(_inv.id::text,1,8),
    COALESCE(_inv.issued_at, now()),
    'asset', 'accounts_receivable',
    'AR — Invoice '||_inv.invoice_number||COALESCE(' — '||_inv.customer_name,''),
    _inv.total_amount, 0,
    'invoice', _inv.id, _inv.organization_id, _inv.currency
  );

  -- Revenue credit
  INSERT INTO accounting_transactions(
    transaction_number, transaction_date, account_type, category, description,
    debit_amount, credit_amount, reference_type, reference_id, organization_id, currency
  ) VALUES (
    'REV-'||substring(_inv.invoice_number from 1 for 30)||'-'||substring(_inv.id::text,1,8),
    COALESCE(_inv.issued_at, now()),
    'revenue',
    CASE _inv.invoice_type::text
      WHEN 'gate_fee' THEN 'gate_fee'
      WHEN 'storage' THEN 'storage'
      WHEN 'lease' THEN 'lease'
      WHEN 'repair' THEN 'repair'
      WHEN 'logistics' THEN 'logistics'
      ELSE 'other'
    END,
    'Revenue — Invoice '||_inv.invoice_number||COALESCE(' — '||_inv.customer_name,''),
    0, _net,
    'invoice', _inv.id, _inv.organization_id, _inv.currency
  );

  -- Tax (output VAT liability)
  IF _tax > 0 THEN
    INSERT INTO accounting_transactions(
      transaction_number, transaction_date, account_type, category, description,
      debit_amount, credit_amount, reference_type, reference_id, organization_id, currency
    ) VALUES (
      'TAX-'||substring(_inv.invoice_number from 1 for 30)||'-'||substring(_inv.id::text,1,8),
      COALESCE(_inv.issued_at, now()),
      'liability', 'output_tax',
      'Output tax — Invoice '||_inv.invoice_number,
      0, _tax,
      'invoice', _inv.id, _inv.organization_id, _inv.currency
    );
  END IF;
END $$;

REVOKE EXECUTE ON FUNCTION public.post_invoice_to_ledger(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.post_invoice_to_ledger(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.trg_invoice_autopost_ledger()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.status IN ('sent','paid','overdue')
     AND COALESCE(NEW.total_amount, 0) > 0
     AND (TG_OP = 'INSERT'
          OR OLD.status IS DISTINCT FROM NEW.status
          OR OLD.total_amount IS DISTINCT FROM NEW.total_amount) THEN
    PERFORM public.post_invoice_to_ledger(NEW.id);
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_invoice_autopost_ledger ON public.invoices;
CREATE TRIGGER trg_invoice_autopost_ledger
  AFTER INSERT OR UPDATE OF status, total_amount ON public.invoices
  FOR EACH ROW EXECUTE FUNCTION public.trg_invoice_autopost_ledger();

-- ============================================================
-- B. Invoice paid-status integrity
-- ============================================================
CREATE OR REPLACE FUNCTION public.trg_invoice_paid_integrity()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _paid numeric(14,2);
BEGIN
  IF NEW.status = 'paid' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM NEW.status) THEN
    SELECT COALESCE(SUM(amount), 0) INTO _paid FROM payments WHERE invoice_id = NEW.id;
    IF _paid + 0.01 < COALESCE(NEW.total_amount, 0) THEN
      RAISE EXCEPTION 'invoice_paid_integrity: cannot set status=paid on % (paid=%, total=%)',
        NEW.invoice_number, _paid, NEW.total_amount
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_invoice_paid_integrity ON public.invoices;
CREATE TRIGGER trg_invoice_paid_integrity
  BEFORE INSERT OR UPDATE OF status ON public.invoices
  FOR EACH ROW EXECUTE FUNCTION public.trg_invoice_paid_integrity();

-- ============================================================
-- C. Container sale -> Invoice integrity
-- ============================================================
CREATE OR REPLACE FUNCTION public.backfill_sale_invoice(_sale_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _sale container_sales%ROWTYPE;
  _container containers%ROWTYPE;
  _invoice_id uuid;
  _invoice_number text;
BEGIN
  SELECT * INTO _sale FROM container_sales WHERE id = _sale_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'sale_not_found'; END IF;
  IF _sale.invoice_id IS NOT NULL THEN RETURN _sale.invoice_id; END IF;

  SELECT * INTO _container FROM containers WHERE id = _sale.container_id;

  _invoice_number := 'CSL-'||to_char(COALESCE(_sale.sold_at, now()),'YYYYMMDD')||'-'||substring(_sale.id::text,1,6);
  _invoice_id := gen_random_uuid();

  INSERT INTO invoices(
    id, invoice_number, customer_name, total_amount, subtotal, tax_amount, tax_rate,
    status, invoice_type, issued_at, organization_id, currency, container_id, notes
  ) VALUES (
    _invoice_id, _invoice_number, COALESCE(_sale.buyer_name,'—'),
    _sale.selling_price, _sale.selling_price, 0, 0,
    'sent', 'other', COALESCE(_sale.sold_at, now()),
    _sale.organization_id, 'USD', _sale.container_id,
    'Auto-generated for sale '||_sale.sale_number
  );

  INSERT INTO invoice_line_items(invoice_id, description, quantity, unit_price, total_price, organization_id)
  VALUES (_invoice_id,
    'Container sale — '||COALESCE(_container.container_number,'—')||' to '||COALESCE(_sale.buyer_name,'—'),
    1, _sale.selling_price, _sale.selling_price, _sale.organization_id);

  UPDATE container_sales SET invoice_id = _invoice_id, updated_at = now() WHERE id = _sale_id;
  RETURN _invoice_id;
END $$;

REVOKE EXECUTE ON FUNCTION public.backfill_sale_invoice(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.backfill_sale_invoice(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.trg_sale_sold_requires_invoice()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.status = 'sold' AND NEW.invoice_id IS NULL THEN
    NEW.invoice_id := public.backfill_sale_invoice(NEW.id);
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_sale_sold_requires_invoice ON public.container_sales;
CREATE TRIGGER trg_sale_sold_requires_invoice
  BEFORE UPDATE OF status, invoice_id ON public.container_sales
  FOR EACH ROW
  WHEN (NEW.status = 'sold')
  EXECUTE FUNCTION public.trg_sale_sold_requires_invoice();

-- ============================================================
-- D. sync_audit_findings table + gate appt logger
-- ============================================================
CREATE TABLE IF NOT EXISTS public.sync_audit_findings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  finding_code text NOT NULL,
  severity text NOT NULL DEFAULT 'warn',
  reference_type text,
  reference_id uuid,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  resolved_by uuid
);

CREATE INDEX IF NOT EXISTS idx_saf_org_open ON public.sync_audit_findings(organization_id) WHERE resolved_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_saf_code ON public.sync_audit_findings(finding_code);

ALTER TABLE public.sync_audit_findings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admins read sync findings" ON public.sync_audit_findings;
CREATE POLICY "admins read sync findings" ON public.sync_audit_findings
  FOR SELECT TO authenticated
  USING ((organization_id = current_org_id() AND has_role(auth.uid(),'admin'::app_role)) OR is_platform_admin());

DROP POLICY IF EXISTS "admins resolve sync findings" ON public.sync_audit_findings;
CREATE POLICY "admins resolve sync findings" ON public.sync_audit_findings
  FOR UPDATE TO authenticated
  USING ((organization_id = current_org_id() AND has_role(auth.uid(),'admin'::app_role)) OR is_platform_admin())
  WITH CHECK ((organization_id = current_org_id() AND has_role(auth.uid(),'admin'::app_role)) OR is_platform_admin());

CREATE OR REPLACE FUNCTION public.trg_gate_appt_completion_audit()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.status = 'completed' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM NEW.status) THEN
    IF NEW.container_id IS NULL THEN
      INSERT INTO sync_audit_findings(organization_id, finding_code, severity, reference_type, reference_id, details)
      VALUES (NEW.organization_id, 'appt_completed_no_container', 'warn', 'gate_appointments', NEW.id,
              jsonb_build_object('appointment_number', NEW.appointment_number));
    ELSIF NOT EXISTS (SELECT 1 FROM eir_records WHERE appointment_id = NEW.id) THEN
      INSERT INTO sync_audit_findings(organization_id, finding_code, severity, reference_type, reference_id, details)
      VALUES (NEW.organization_id, 'appt_completed_no_eir', 'warn', 'gate_appointments', NEW.id,
              jsonb_build_object('appointment_number', NEW.appointment_number, 'container_id', NEW.container_id));
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_gate_appt_completion_audit ON public.gate_appointments;
CREATE TRIGGER trg_gate_appt_completion_audit
  AFTER INSERT OR UPDATE OF status ON public.gate_appointments
  FOR EACH ROW EXECUTE FUNCTION public.trg_gate_appt_completion_audit();

-- ============================================================
-- E. Notification "no subscriber" audit log
-- ============================================================
CREATE OR REPLACE FUNCTION public.queue_push_notifications()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _sub RECORD;
  _customer RECORD;
  _queued int := 0;
BEGIN
  FOR _sub IN SELECT endpoint, p256dh, auth FROM public.push_subscriptions WHERE user_id = NEW.user_id LOOP
    INSERT INTO public.push_notification_queue (notification_id, channel, recipient, payload)
    VALUES (NEW.id, 'web_push', _sub.endpoint,
      jsonb_build_object('title', NEW.title, 'body', NEW.message, 'type', NEW.type,
                         'p256dh', _sub.p256dh, 'auth', _sub.auth));
    _queued := _queued + 1;
  END LOOP;

  IF NEW.reference_type IS NOT NULL THEN
    FOR _customer IN
      SELECT DISTINCT c.whatsapp_number
      FROM public.customers c
      WHERE c.whatsapp_number IS NOT NULL AND c.whatsapp_number <> ''
        AND (
          (NEW.reference_type = 'gate_appointments' AND EXISTS (
            SELECT 1 FROM public.gate_appointments ga
            WHERE ga.id = NEW.reference_id AND ga.shipping_line = c.company_name))
          OR
          (NEW.reference_type = 'containers' AND EXISTS (
            SELECT 1 FROM public.containers ct
            WHERE ct.id = NEW.reference_id AND (ct.owner = c.company_name OR ct.shipping_line = c.company_name)))
        )
      LIMIT 1
    LOOP
      INSERT INTO public.push_notification_queue (notification_id, channel, recipient, payload)
      VALUES (NEW.id, 'whatsapp', _customer.whatsapp_number,
        jsonb_build_object('title', NEW.title, 'body', NEW.message, 'type', NEW.type));
      _queued := _queued + 1;
    END LOOP;
  END IF;

  IF _queued = 0 THEN
    INSERT INTO sync_audit_findings(organization_id, finding_code, severity, reference_type, reference_id, details)
    VALUES (COALESCE(NEW.organization_id,'00000000-0000-0000-0000-000000000001'::uuid),
            'notification_no_subscriber', 'info', 'notifications', NEW.id,
            jsonb_build_object('user_id', NEW.user_id, 'type', NEW.type, 'title', NEW.title));
  END IF;
  RETURN NEW;
END $$;

-- ============================================================
-- F. Missing FKs
-- ============================================================
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='container_sales_invoice_id_fkey') THEN
    ALTER TABLE public.container_sales
      ADD CONSTRAINT container_sales_invoice_id_fkey
      FOREIGN KEY (invoice_id) REFERENCES public.invoices(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='logistics_transport_orders_invoice_id_fkey') THEN
    ALTER TABLE public.logistics_transport_orders
      ADD CONSTRAINT logistics_transport_orders_invoice_id_fkey
      FOREIGN KEY (invoice_id) REFERENCES public.invoices(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='payslips_accounting_transaction_id_fkey') THEN
    ALTER TABLE public.payslips
      ADD CONSTRAINT payslips_accounting_transaction_id_fkey
      FOREIGN KEY (accounting_transaction_id) REFERENCES public.accounting_transactions(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='lease_invoices_run_invoice_id_fkey') THEN
    ALTER TABLE public.lease_invoices_run
      ADD CONSTRAINT lease_invoices_run_invoice_id_fkey
      FOREIGN KEY (invoice_id) REFERENCES public.invoices(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='gate_appointments_container_id_fkey') THEN
    ALTER TABLE public.gate_appointments
      ADD CONSTRAINT gate_appointments_container_id_fkey
      FOREIGN KEY (container_id) REFERENCES public.containers(id) ON DELETE SET NULL;
  END IF;
END $$;
