
CREATE TABLE IF NOT EXISTS public.recurring_invoice_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL DEFAULT current_org_id() REFERENCES public.organizations(id),
  name text NOT NULL,
  customer_name text NOT NULL,
  customer_reference text,
  invoice_type charge_type NOT NULL DEFAULT 'storage',
  currency text NOT NULL DEFAULT 'USD',
  subtotal numeric(12,2) NOT NULL DEFAULT 0,
  tax_rate numeric(5,2) NOT NULL DEFAULT 0,
  notes text,
  line_items jsonb NOT NULL DEFAULT '[]'::jsonb,
  frequency text NOT NULL CHECK (frequency IN ('weekly','biweekly','monthly','quarterly','yearly')),
  interval_count int NOT NULL DEFAULT 1,
  next_run_date date NOT NULL,
  end_date date,
  due_days int NOT NULL DEFAULT 30,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused','ended')),
  last_run_at timestamptz,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_rit_org ON public.recurring_invoice_templates(organization_id);
CREATE INDEX IF NOT EXISTS idx_rit_next ON public.recurring_invoice_templates(next_run_date) WHERE status = 'active';
ALTER TABLE public.recurring_invoice_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "rit org read" ON public.recurring_invoice_templates FOR SELECT
  USING (is_platform_admin() OR organization_id = current_org_id());
CREATE POLICY "rit admin write" ON public.recurring_invoice_templates FOR ALL
  USING (is_platform_admin() OR (organization_id = current_org_id() AND (has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'gate_clerk'::app_role))))
  WITH CHECK (is_platform_admin() OR (organization_id = current_org_id() AND (has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'gate_clerk'::app_role))));

CREATE TABLE IF NOT EXISTS public.recurring_invoice_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL DEFAULT current_org_id() REFERENCES public.organizations(id),
  template_id uuid NOT NULL REFERENCES public.recurring_invoice_templates(id) ON DELETE CASCADE,
  invoice_id uuid REFERENCES public.invoices(id) ON DELETE SET NULL,
  run_date date NOT NULL,
  status text NOT NULL DEFAULT 'issued',
  error text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_rir_template ON public.recurring_invoice_runs(template_id);
ALTER TABLE public.recurring_invoice_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "rir org read" ON public.recurring_invoice_runs FOR SELECT
  USING (is_platform_admin() OR organization_id = current_org_id());

CREATE TABLE IF NOT EXISTS public.dunning_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL DEFAULT current_org_id() REFERENCES public.organizations(id),
  name text NOT NULL,
  days_after_due int NOT NULL,
  channel text NOT NULL DEFAULT 'email' CHECK (channel IN ('email','whatsapp','sms')),
  template text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_dr_org ON public.dunning_rules(organization_id);
ALTER TABLE public.dunning_rules ENABLE ROW LEVEL SECURITY;
CREATE POLICY "dr org read" ON public.dunning_rules FOR SELECT
  USING (is_platform_admin() OR organization_id = current_org_id());
CREATE POLICY "dr admin write" ON public.dunning_rules FOR ALL
  USING (is_platform_admin() OR (organization_id = current_org_id() AND has_role(auth.uid(),'admin'::app_role)))
  WITH CHECK (is_platform_admin() OR (organization_id = current_org_id() AND has_role(auth.uid(),'admin'::app_role)));

CREATE TABLE IF NOT EXISTS public.dunning_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL DEFAULT current_org_id() REFERENCES public.organizations(id),
  invoice_id uuid NOT NULL REFERENCES public.invoices(id) ON DELETE CASCADE,
  rule_id uuid REFERENCES public.dunning_rules(id) ON DELETE SET NULL,
  sent_at timestamptz NOT NULL DEFAULT now(),
  channel text NOT NULL,
  status text NOT NULL DEFAULT 'sent',
  message text,
  created_by uuid
);
CREATE INDEX IF NOT EXISTS idx_dl_invoice ON public.dunning_log(invoice_id);
ALTER TABLE public.dunning_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "dl org read" ON public.dunning_log FOR SELECT
  USING (is_platform_admin() OR organization_id = current_org_id());
CREATE POLICY "dl clerk write" ON public.dunning_log FOR INSERT
  WITH CHECK (is_platform_admin() OR (organization_id = current_org_id() AND (has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'gate_clerk'::app_role))));

CREATE TABLE IF NOT EXISTS public.payment_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL DEFAULT current_org_id() REFERENCES public.organizations(id),
  payment_id uuid NOT NULL REFERENCES public.payments(id) ON DELETE CASCADE,
  invoice_id uuid NOT NULL REFERENCES public.invoices(id) ON DELETE CASCADE,
  amount numeric(12,2) NOT NULL CHECK (amount > 0),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_pa_payment ON public.payment_allocations(payment_id);
CREATE INDEX IF NOT EXISTS idx_pa_invoice ON public.payment_allocations(invoice_id);
ALTER TABLE public.payment_allocations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "pa org read" ON public.payment_allocations FOR SELECT
  USING (is_platform_admin() OR organization_id = current_org_id());
CREATE POLICY "pa clerk write" ON public.payment_allocations FOR ALL
  USING (is_platform_admin() OR (organization_id = current_org_id() AND (has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'gate_clerk'::app_role))))
  WITH CHECK (is_platform_admin() OR (organization_id = current_org_id() AND (has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'gate_clerk'::app_role))));

CREATE OR REPLACE FUNCTION public.customer_statement(_customer text, _from date, _to date)
RETURNS TABLE (
  doc_date date, doc_type text, doc_number text, description text,
  debit numeric, credit numeric, currency text
) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT i.issued_at::date, 'invoice'::text, i.invoice_number,
         i.invoice_type::text, i.total_amount, 0::numeric, i.currency
  FROM invoices i
  WHERE i.customer_name = _customer
    AND i.organization_id = current_org_id()
    AND i.issued_at::date BETWEEN _from AND _to
    AND i.status <> 'cancelled'
  UNION ALL
  SELECT p.paid_at::date, 'payment'::text, p.payment_number,
         coalesce(p.notes,'Payment'), 0::numeric, p.amount, i.currency
  FROM payments p JOIN invoices i ON i.id = p.invoice_id
  WHERE i.customer_name = _customer
    AND p.organization_id = current_org_id()
    AND p.paid_at::date BETWEEN _from AND _to
  ORDER BY 1;
$$;

CREATE OR REPLACE FUNCTION public.supplier_statement(_supplier uuid, _from date, _to date)
RETURNS TABLE (
  doc_date date, doc_type text, doc_number text, description text,
  debit numeric, credit numeric
) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT po.created_at::date, 'po'::text, po.po_number,
         coalesce(po.status,'Purchase order'), 0::numeric, po.total_cost
  FROM purchase_orders po
  WHERE po.supplier_id = _supplier
    AND po.organization_id = current_org_id()
    AND po.created_at::date BETWEEN _from AND _to
  UNION ALL
  SELECT vp.paid_at::date, 'payment'::text, vp.payment_number,
         coalesce(vp.notes,'Vendor payment'), vp.amount, 0::numeric
  FROM vendor_payments vp
  WHERE vp.supplier_id = _supplier
    AND vp.organization_id = current_org_id()
    AND vp.paid_at::date BETWEEN _from AND _to
  ORDER BY 1;
$$;

CREATE OR REPLACE FUNCTION public.issue_recurring_invoices()
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  tpl record; new_inv_id uuid; inv_no text; next_dt date; count_issued int := 0;
BEGIN
  FOR tpl IN
    SELECT * FROM recurring_invoice_templates
    WHERE status = 'active' AND next_run_date <= current_date
      AND (end_date IS NULL OR next_run_date <= end_date)
  LOOP
    inv_no := 'REC-' || to_char(now(),'YYYYMM') || '-' || substr(replace(gen_random_uuid()::text,'-',''),1,6);
    INSERT INTO invoices (
      invoice_number, customer_name, customer_reference, invoice_type,
      subtotal, tax_rate, tax_amount, total_amount, currency,
      status, issued_at, due_at, notes, organization_id
    ) VALUES (
      inv_no, tpl.customer_name, tpl.customer_reference, tpl.invoice_type,
      tpl.subtotal, tpl.tax_rate, round(tpl.subtotal * tpl.tax_rate/100, 2),
      tpl.subtotal + round(tpl.subtotal * tpl.tax_rate/100, 2),
      tpl.currency, 'sent', now(), now() + (tpl.due_days || ' days')::interval,
      tpl.notes, tpl.organization_id
    ) RETURNING id INTO new_inv_id;

    IF jsonb_array_length(tpl.line_items) > 0 THEN
      INSERT INTO invoice_line_items (invoice_id, description, quantity, unit_price, line_total, organization_id)
      SELECT new_inv_id, (li->>'description'),
             coalesce((li->>'quantity')::numeric, 1),
             coalesce((li->>'unit_price')::numeric, 0),
             coalesce((li->>'quantity')::numeric,1) * coalesce((li->>'unit_price')::numeric,0),
             tpl.organization_id
      FROM jsonb_array_elements(tpl.line_items) li;
    END IF;

    next_dt := CASE tpl.frequency
      WHEN 'weekly'    THEN tpl.next_run_date + (tpl.interval_count * 7) * interval '1 day'
      WHEN 'biweekly'  THEN tpl.next_run_date + (tpl.interval_count * 14) * interval '1 day'
      WHEN 'monthly'   THEN tpl.next_run_date + (tpl.interval_count || ' months')::interval
      WHEN 'quarterly' THEN tpl.next_run_date + (tpl.interval_count * 3 || ' months')::interval
      WHEN 'yearly'    THEN tpl.next_run_date + (tpl.interval_count || ' years')::interval
    END::date;

    UPDATE recurring_invoice_templates
       SET next_run_date = next_dt, last_run_at = now(),
           status = CASE WHEN end_date IS NOT NULL AND next_dt > end_date THEN 'ended' ELSE status END,
           updated_at = now()
     WHERE id = tpl.id;

    INSERT INTO recurring_invoice_runs (organization_id, template_id, invoice_id, run_date, status)
    VALUES (tpl.organization_id, tpl.id, new_inv_id, current_date, 'issued');

    count_issued := count_issued + 1;
  END LOOP;
  RETURN count_issued;
END;
$$;

CREATE TRIGGER trg_rit_updated BEFORE UPDATE ON public.recurring_invoice_templates
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
