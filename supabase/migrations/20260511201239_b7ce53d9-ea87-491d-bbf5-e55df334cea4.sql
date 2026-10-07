CREATE TABLE IF NOT EXISTS public.recurring_transfers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL DEFAULT current_org_id() REFERENCES organizations(id),
  name text NOT NULL,
  from_account_id uuid NOT NULL REFERENCES financial_accounts(id) ON DELETE RESTRICT,
  to_account_id uuid NOT NULL REFERENCES financial_accounts(id) ON DELETE RESTRICT,
  amount numeric(14,2) NOT NULL CHECK (amount > 0),
  fx_rate numeric(14,6) NOT NULL DEFAULT 1,
  fees numeric(14,2) NOT NULL DEFAULT 0,
  description text, reference text,
  frequency text NOT NULL CHECK (frequency IN ('daily','weekly','monthly','quarterly')),
  interval_count integer NOT NULL DEFAULT 1 CHECK (interval_count > 0),
  start_date date NOT NULL, end_date date,
  next_run_at timestamptz NOT NULL, last_run_at timestamptz,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused','ended')),
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (from_account_id <> to_account_id)
);
CREATE INDEX IF NOT EXISTS idx_recurring_transfers_org ON public.recurring_transfers(organization_id);
CREATE INDEX IF NOT EXISTS idx_recurring_transfers_due ON public.recurring_transfers(status, next_run_at);
ALTER TABLE public.recurring_transfers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org members view recurring_transfers" ON public.recurring_transfers FOR SELECT
USING (is_platform_admin() OR (organization_id = current_org_id() AND (
  has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'yard_operator'::app_role)
  OR has_role(auth.uid(),'gate_clerk'::app_role) OR has_role(auth.uid(),'viewer'::app_role))));
CREATE POLICY "Org admins insert recurring_transfers" ON public.recurring_transfers FOR INSERT
WITH CHECK (organization_id = current_org_id() AND has_role(auth.uid(),'admin'::app_role));
CREATE POLICY "Org admins update recurring_transfers" ON public.recurring_transfers FOR UPDATE
USING (is_platform_admin() OR (organization_id = current_org_id() AND has_role(auth.uid(),'admin'::app_role)));
CREATE POLICY "Org admins delete recurring_transfers" ON public.recurring_transfers FOR DELETE
USING (is_platform_admin() OR (organization_id = current_org_id() AND has_role(auth.uid(),'admin'::app_role)));

CREATE TRIGGER trg_recurring_transfers_updated BEFORE UPDATE ON public.recurring_transfers
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE IF NOT EXISTS public.recurring_transfer_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL DEFAULT current_org_id() REFERENCES organizations(id),
  recurring_transfer_id uuid NOT NULL REFERENCES recurring_transfers(id) ON DELETE CASCADE,
  scheduled_for timestamptz NOT NULL,
  ran_at timestamptz NOT NULL DEFAULT now(),
  transfer_id uuid REFERENCES inter_account_transfers(id) ON DELETE SET NULL,
  status text NOT NULL CHECK (status IN ('posted','skipped','failed')),
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_recurring_transfer_runs_rule ON public.recurring_transfer_runs(recurring_transfer_id, ran_at DESC);
CREATE INDEX IF NOT EXISTS idx_recurring_transfer_runs_org ON public.recurring_transfer_runs(organization_id);
ALTER TABLE public.recurring_transfer_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org members view recurring_transfer_runs" ON public.recurring_transfer_runs FOR SELECT
USING (is_platform_admin() OR (organization_id = current_org_id() AND (
  has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'yard_operator'::app_role)
  OR has_role(auth.uid(),'gate_clerk'::app_role) OR has_role(auth.uid(),'viewer'::app_role))));
CREATE POLICY "System inserts recurring_transfer_runs" ON public.recurring_transfer_runs FOR INSERT
WITH CHECK (organization_id = current_org_id());

CREATE OR REPLACE FUNCTION public.generate_due_recurring_transfers()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r record; v_transfer_id uuid; v_num text; v_count integer := 0; v_next timestamptz;
BEGIN
  FOR r IN SELECT * FROM public.recurring_transfers
    WHERE status = 'active' AND next_run_at <= now() AND (end_date IS NULL OR next_run_at::date <= end_date)
    ORDER BY next_run_at LIMIT 500
  LOOP
    BEGIN
      v_num := 'TRF-' || to_char(now(),'YYMMDDHH24MISS') || '-' || substr(replace(r.id::text,'-',''),1,4);
      INSERT INTO public.inter_account_transfers (organization_id, transfer_number, transfer_date,
        from_account_id, to_account_id, amount, fx_rate, fees, description, reference, created_by)
      VALUES (r.organization_id, v_num, r.next_run_at, r.from_account_id, r.to_account_id, r.amount,
        r.fx_rate, r.fees, COALESCE(r.description,'') || ' (auto: ' || r.name || ')', r.reference, r.created_by)
      RETURNING id INTO v_transfer_id;
      INSERT INTO public.recurring_transfer_runs (organization_id, recurring_transfer_id, scheduled_for, transfer_id, status)
      VALUES (r.organization_id, r.id, r.next_run_at, v_transfer_id, 'posted');
      v_next := CASE r.frequency
        WHEN 'daily' THEN r.next_run_at + (r.interval_count || ' days')::interval
        WHEN 'weekly' THEN r.next_run_at + (r.interval_count || ' weeks')::interval
        WHEN 'monthly' THEN r.next_run_at + (r.interval_count || ' months')::interval
        WHEN 'quarterly' THEN r.next_run_at + (r.interval_count * 3 || ' months')::interval
      END;
      UPDATE public.recurring_transfers
      SET last_run_at = now(), next_run_at = v_next,
          status = CASE WHEN r.end_date IS NOT NULL AND v_next::date > r.end_date THEN 'ended' ELSE 'active' END
      WHERE id = r.id;
      v_count := v_count + 1;
    EXCEPTION WHEN OTHERS THEN
      INSERT INTO public.recurring_transfer_runs (organization_id, recurring_transfer_id, scheduled_for, status, error_message)
      VALUES (r.organization_id, r.id, r.next_run_at, 'failed', SQLERRM);
    END;
  END LOOP;
  RETURN v_count;
END; $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname='pg_cron') THEN
    BEGIN PERFORM cron.unschedule('generate-due-recurring-transfers'); EXCEPTION WHEN OTHERS THEN NULL; END;
    PERFORM cron.schedule('generate-due-recurring-transfers','5 * * * *',
      $cron$ SELECT public.generate_due_recurring_transfers(); $cron$);
  END IF;
END $$;

CREATE OR REPLACE VIEW public.finance_dashboard_metrics
WITH (security_invoker = true) AS
WITH cash AS (
  SELECT fa.organization_id, fa.currency, COALESCE(SUM(fa.opening_balance),0) +
    COALESCE(SUM(at.debit_amount - at.credit_amount) FILTER (WHERE at.id IS NOT NULL), 0) AS amount
  FROM public.financial_accounts fa
  LEFT JOIN public.accounting_transactions at ON at.financial_account_id = fa.id
  WHERE fa.is_active AND fa.account_type IN ('bank','cash','mobile_money')
  GROUP BY fa.organization_id, fa.currency
),
ar AS (
  SELECT i.organization_id, i.currency,
    COALESCE(SUM(i.total_amount - COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.invoice_id = i.id),0)),0) AS amount
  FROM public.invoices i
  WHERE i.status IN ('draft','sent','overdue') AND i.voided_at IS NULL
  GROUP BY i.organization_id, i.currency
),
mtd AS (
  SELECT organization_id,
    COALESCE(SUM(credit_amount) FILTER (WHERE account_type='revenue'),0) AS revenue,
    COALESCE(SUM(debit_amount) FILTER (WHERE account_type='expense'),0) AS expense,
    COALESCE(SUM(debit_amount) FILTER (WHERE account_type='cost_of_goods'),0) AS cogs
  FROM public.accounting_transactions
  WHERE transaction_date >= date_trunc('month', now())
  GROUP BY organization_id
),
recon AS (
  SELECT organization_id,
    COUNT(*) FILTER (WHERE status='in_progress') AS in_progress_count,
    COUNT(*) FILTER (WHERE status='completed') AS completed_count,
    COUNT(*) FILTER (WHERE status='completed' AND completed_at >= now() - interval '30 days') AS recent_completed
  FROM public.bank_reconciliations
  GROUP BY organization_id
)
SELECT o.id AS organization_id,
  COALESCE((SELECT json_agg(json_build_object('currency', currency, 'amount', amount)) FROM cash WHERE organization_id=o.id), '[]'::json) AS cash_on_hand,
  COALESCE((SELECT json_agg(json_build_object('currency', currency, 'amount', amount)) FROM ar WHERE organization_id=o.id), '[]'::json) AS receivables,
  COALESCE((SELECT SUM(amount) FROM cash WHERE organization_id=o.id),0) AS cash_total,
  COALESCE((SELECT SUM(amount) FROM ar WHERE organization_id=o.id),0) AS receivables_total,
  COALESCE((SELECT revenue FROM mtd WHERE organization_id=o.id),0) AS mtd_revenue,
  COALESCE((SELECT expense FROM mtd WHERE organization_id=o.id),0) AS mtd_expense,
  COALESCE((SELECT cogs FROM mtd WHERE organization_id=o.id),0) AS mtd_cogs,
  COALESCE((SELECT revenue - expense - cogs FROM mtd WHERE organization_id=o.id),0) AS mtd_net,
  COALESCE((SELECT in_progress_count FROM recon WHERE organization_id=o.id),0) AS recon_in_progress,
  COALESCE((SELECT completed_count FROM recon WHERE organization_id=o.id),0) AS recon_completed,
  COALESCE((SELECT recent_completed FROM recon WHERE organization_id=o.id),0) AS recon_recent
FROM public.organizations o;

CREATE OR REPLACE VIEW public.unified_ledger_entries
WITH (security_invoker = true) AS
SELECT at.id::text AS entry_id, 'journal'::text AS source_type, at.id AS source_id,
  at.transaction_date AS entry_date, at.transaction_number AS reference_number,
  at.description, at.debit_amount AS debit, at.credit_amount AS credit,
  NULL::text AS currency, at.financial_account_id, at.project_id, at.cleared_at, at.organization_id
FROM public.accounting_transactions at
UNION ALL
SELECT 'trf-'||t.id::text, 'transfer', t.id, t.transfer_date, t.transfer_number,
  COALESCE(t.description,'Inter-account transfer'), t.amount, 0, fa.currency,
  t.from_account_id, NULL::uuid, NULL::timestamptz, t.organization_id
FROM public.inter_account_transfers t
LEFT JOIN public.financial_accounts fa ON fa.id = t.from_account_id
WHERE t.voided_at IS NULL
UNION ALL
SELECT 'inv-'||i.id::text, 'invoice', i.id, COALESCE(i.issued_at, i.created_at), i.invoice_number,
  i.customer_name || COALESCE(' — ' || i.notes, ''), i.total_amount, 0, i.currency,
  NULL::uuid, i.project_id, i.paid_at, i.organization_id
FROM public.invoices i WHERE i.voided_at IS NULL
UNION ALL
SELECT 'pay-'||p.id::text, 'payment', p.id, p.paid_at, p.payment_number,
  COALESCE(p.notes,'Payment'), 0, p.amount, NULL::text,
  p.financial_account_id, p.project_id, p.paid_at, p.organization_id
FROM public.payments p
UNION ALL
SELECT 'vp-'||vp.id::text, 'vendor_payment', vp.id, vp.paid_at, vp.payment_number,
  COALESCE(vp.notes,'Vendor payment'), vp.amount, 0, NULL::text,
  vp.financial_account_id, vp.project_id, vp.paid_at, vp.organization_id
FROM public.vendor_payments vp;

CREATE OR REPLACE FUNCTION public.suggest_reconciliation_matches(_reconciliation_id uuid)
RETURNS TABLE (candidate_transaction_id uuid, transaction_number text, transaction_date timestamptz,
  description text, debit_amount numeric, credit_amount numeric, score integer, conflicts text[])
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_account uuid; v_start date; v_end date; v_org uuid;
BEGIN
  SELECT account_id, statement_start, statement_end, organization_id
    INTO v_account, v_start, v_end, v_org
  FROM public.bank_reconciliations WHERE id = _reconciliation_id;
  IF v_account IS NULL THEN RETURN; END IF;
  RETURN QUERY
  SELECT at.id, at.transaction_number, at.transaction_date, at.description,
    at.debit_amount, at.credit_amount,
    (CASE WHEN at.transaction_date::date BETWEEN v_start AND v_end THEN 50 ELSE 20 END
      + CASE WHEN at.cleared_at IS NULL THEN 30 ELSE 0 END
      + CASE WHEN at.reconciliation_id IS NULL THEN 20 ELSE 0 END)::integer AS score,
    ARRAY(SELECT x FROM unnest(ARRAY[
      CASE WHEN at.cleared_at IS NOT NULL THEN 'already_cleared' END,
      CASE WHEN at.reconciliation_id IS NOT NULL AND at.reconciliation_id <> _reconciliation_id THEN 'linked_other_recon' END,
      CASE WHEN at.transaction_date::date NOT BETWEEN v_start AND v_end THEN 'date_out_of_window' END
    ]) AS x WHERE x IS NOT NULL)::text[] AS conflicts
  FROM public.accounting_transactions at
  WHERE at.organization_id = v_org AND at.financial_account_id = v_account
    AND at.transaction_date::date BETWEEN (v_start - 7) AND (v_end + 7)
  ORDER BY score DESC, at.transaction_date DESC LIMIT 200;
END; $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='bank_reconciliation_lines_recon_txn_unique') THEN
    ALTER TABLE public.bank_reconciliation_lines
      ADD CONSTRAINT bank_reconciliation_lines_recon_txn_unique UNIQUE (reconciliation_id, transaction_id);
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.bulk_clear_reconciliation_lines(_reconciliation_id uuid, _transaction_ids uuid[])
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_count integer := 0; v_org uuid;
BEGIN
  SELECT organization_id INTO v_org FROM public.bank_reconciliations WHERE id = _reconciliation_id;
  IF v_org IS NULL THEN RAISE EXCEPTION 'Reconciliation not found'; END IF;
  IF v_org <> current_org_id() AND NOT is_platform_admin() THEN RAISE EXCEPTION 'Not allowed'; END IF;
  INSERT INTO public.bank_reconciliation_lines (reconciliation_id, transaction_id, cleared, organization_id)
  SELECT _reconciliation_id, t_id, true, v_org FROM unnest(_transaction_ids) AS t_id
  ON CONFLICT (reconciliation_id, transaction_id) DO UPDATE SET cleared = true;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END; $$;
