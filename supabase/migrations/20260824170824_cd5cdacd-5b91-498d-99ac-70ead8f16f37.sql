-- ============ AI job state (single flight + pause) ============
CREATE TABLE public.ai_job_state (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  job text NOT NULL,
  lease_until timestamptz,
  locked_by text,
  paused boolean NOT NULL DEFAULT false,
  pause_reason text,
  paused_at timestamptz,
  last_run_at timestamptz,
  last_run_findings integer NOT NULL DEFAULT 0,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, job)
);

GRANT SELECT ON public.ai_job_state TO authenticated;
GRANT ALL ON public.ai_job_state TO service_role;
ALTER TABLE public.ai_job_state ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org members read ai job state" ON public.ai_job_state
FOR SELECT TO authenticated
USING (organization_id = public.current_org_id() OR public.is_platform_admin());

CREATE POLICY "finance admins manage ai job state" ON public.ai_job_state
FOR ALL TO authenticated
USING (organization_id = public.current_org_id() AND (
  public.has_role(auth.uid(),'admin'::app_role) OR public.has_role(auth.uid(),'org_owner'::app_role)
  OR public.has_role(auth.uid(),'accountant'::app_role) OR public.is_platform_admin()))
WITH CHECK (organization_id = public.current_org_id() AND (
  public.has_role(auth.uid(),'admin'::app_role) OR public.has_role(auth.uid(),'org_owner'::app_role)
  OR public.has_role(auth.uid(),'accountant'::app_role) OR public.is_platform_admin()));

-- ============ AI findings ============
CREATE TABLE public.ai_findings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  job text NOT NULL DEFAULT 'finance_watchdog',
  finding_type text NOT NULL,
  severity text NOT NULL DEFAULT 'warning',
  entity_table text,
  entity_id uuid,
  entity_label text,
  title text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  amount numeric,
  currency text,
  explanation text,
  suggested_action text,
  ai_generated boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'open',
  dedupe_key text NOT NULL,
  occurrences integer NOT NULL DEFAULT 1,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  cleared_at timestamptz,
  reviewed_by uuid,
  reviewed_at timestamptz,
  review_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, dedupe_key)
);

CREATE INDEX ai_findings_org_status_idx ON public.ai_findings (organization_id, status, severity);
CREATE INDEX ai_findings_type_idx ON public.ai_findings (organization_id, finding_type);

GRANT SELECT, UPDATE ON public.ai_findings TO authenticated;
GRANT ALL ON public.ai_findings TO service_role;
ALTER TABLE public.ai_findings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org finance members read ai findings" ON public.ai_findings
FOR SELECT TO authenticated
USING (public.is_platform_admin() OR (organization_id = public.current_org_id()
  AND public.can_view_module(auth.uid(),'accounting'::text)));

CREATE POLICY "finance admins update ai findings" ON public.ai_findings
FOR UPDATE TO authenticated
USING (organization_id = public.current_org_id() AND (
  public.has_role(auth.uid(),'admin'::app_role) OR public.has_role(auth.uid(),'org_owner'::app_role)
  OR public.has_role(auth.uid(),'accountant'::app_role) OR public.is_platform_admin()))
WITH CHECK (organization_id = public.current_org_id() AND (
  public.has_role(auth.uid(),'admin'::app_role) OR public.has_role(auth.uid(),'org_owner'::app_role)
  OR public.has_role(auth.uid(),'accountant'::app_role) OR public.is_platform_admin()));

CREATE TRIGGER trg_ai_findings_updated_at BEFORE UPDATE ON public.ai_findings
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER trg_ai_job_state_updated_at BEFORE UPDATE ON public.ai_job_state
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============ Detection: returns findings without writing ============
CREATE OR REPLACE FUNCTION public.finance_watchdog_detect(_org uuid)
RETURNS TABLE (
  finding_type text, severity text, entity_table text, entity_id uuid,
  entity_label text, title text, details jsonb, amount numeric, currency text, dedupe_key text
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  base_ccy text;
BEGIN
  SELECT COALESCE(o.currency,'USD') INTO base_ccy FROM organizations o WHERE o.id = _org;

  -- 1. Containers missing one of the three acquisition invoices
  RETURN QUERY
  SELECT 'missing_acquisition_invoice'::text,
         'critical'::text,
         'containers'::text,
         c.id,
         c.container_number,
         'Container ' || c.container_number || ' is missing acquisition invoices'::text,
         jsonb_build_object('missing', m.missing, 'owner', c.owner, 'ownership_type', c.ownership_type, 'size', c.size),
         NULL::numeric,
         NULL::text,
         'missing_acquisition_invoice:' || c.id::text
  FROM containers c
  CROSS JOIN LATERAL (
    SELECT ARRAY(
      SELECT r FROM unnest(ARRAY['purchase','acquisition_transport','acquisition_crane_offloading']) r
      WHERE NOT EXISTS (
        SELECT 1 FROM supplier_invoices si
        WHERE si.container_id = c.id AND si.reason = r AND si.status <> 'cancelled')
    ) AS missing
  ) m
  WHERE c.organization_id = _org
    AND c.parent_container_id IS NULL
    AND c.status <> 'booked_for_repatriation'
    AND array_length(m.missing,1) > 0;

  -- 2. Foreign-currency supplier invoices with no usable FX rate
  RETURN QUERY
  SELECT 'fx_rate_missing'::text,
         'warning'::text,
         'supplier_invoices'::text,
         si.id,
         si.invoice_number,
         'Supplier invoice ' || si.invoice_number || ' has no exchange rate'::text,
         jsonb_build_object('reason', si.reason, 'base_currency', base_ccy, 'fx_rate', si.fx_rate, 'base_amount', si.base_amount),
         si.total_amount,
         si.currency,
         'fx_rate_missing:' || si.id::text
  FROM supplier_invoices si
  WHERE si.organization_id = _org
    AND si.status <> 'cancelled'
    AND UPPER(COALESCE(si.currency, base_ccy)) <> UPPER(base_ccy)
    AND (si.fx_rate IS NULL OR si.fx_rate <= 0 OR si.base_amount IS NULL OR si.base_amount = 0);

  -- 3. Conversion job container cost drift vs live acquisition split
  RETURN QUERY
  SELECT 'conversion_cost_drift'::text,
         'warning'::text,
         'container_conversions'::text,
         cv.id,
         cv.conversion_number,
         'Conversion ' || cv.conversion_number || ' container cost differs from acquisition cost'::text,
         jsonb_build_object('container_number', ct.container_number,
                            'job_cost', cc.container_cost,
                            'live_cost', s.purchase,
                            'job_transport', cc.transport_offloading_cost,
                            'live_transport', s.services),
         ABS(COALESCE(cc.container_cost,0) - COALESCE(s.purchase,0)),
         COALESCE(cv.currency, base_ccy),
         'conversion_cost_drift:' || cc.id::text
  FROM conversion_containers cc
  JOIN container_conversions cv ON cv.id = cc.conversion_id
  JOIN containers ct ON ct.id = cc.container_id
  CROSS JOIN LATERAL container_acquisition_split(cc.container_id, COALESCE(cv.currency, base_ccy)) s
  WHERE cc.organization_id = _org
    AND cv.status <> 'cancelled'
    AND ct.parent_container_id IS NULL
    AND (ABS(COALESCE(cc.container_cost,0) - COALESCE(s.purchase,0)) > 1
      OR ABS(COALESCE(cc.transport_offloading_cost,0) - COALESCE(s.services,0)) > 1);

  -- 4. Likely duplicate supplier invoices
  RETURN QUERY
  SELECT 'duplicate_supplier_invoice'::text,
         'critical'::text,
         'supplier_invoices'::text,
         d.keep_id,
         d.numbers,
         'Possible duplicate supplier invoices: ' || d.numbers,
         jsonb_build_object('invoice_ids', d.ids, 'invoice_numbers', d.numbers, 'count', d.n, 'reason', d.reason),
         d.total_amount,
         d.currency,
         'duplicate_supplier_invoice:' || d.keep_id::text
  FROM (
    SELECT MIN(si.id::text)::uuid AS keep_id,
           string_agg(si.invoice_number, ', ' ORDER BY si.invoice_number) AS numbers,
           array_agg(si.id) AS ids,
           COUNT(*) AS n,
           si.total_amount, si.currency, si.reason
    FROM supplier_invoices si
    WHERE si.organization_id = _org AND si.status <> 'cancelled' AND si.total_amount > 0
    GROUP BY si.supplier_id, si.total_amount, si.currency, si.reason, si.issue_date, si.container_id
    HAVING COUNT(*) > 1
  ) d;

  -- 5. Container sales priced below acquisition cost
  RETURN QUERY
  SELECT 'sale_below_cost'::text,
         'critical'::text,
         'container_sales'::text,
         cs.id,
         cs.sale_number,
         'Sale ' || cs.sale_number || ' is priced at or below cost'::text,
         jsonb_build_object('entry_price', cs.entry_price, 'selling_price', cs.selling_price,
                            'markup_pct', cs.markup_percentage, 'buyer', cs.buyer_name),
         COALESCE(cs.entry_price,0) - COALESCE(cs.selling_price,0),
         COALESCE(cs.currency, base_ccy),
         'sale_below_cost:' || cs.id::text
  FROM container_sales cs
  WHERE cs.organization_id = _org
    AND cs.status <> 'cancelled'
    AND COALESCE(cs.selling_price,0) <= COALESCE(cs.entry_price,0)
    AND COALESCE(cs.entry_price,0) > 0;

  -- 6. Sold containers with no customer invoice
  RETURN QUERY
  SELECT 'sale_not_invoiced'::text,
         'critical'::text,
         'container_sales'::text,
         cs.id,
         cs.sale_number,
         'Sale ' || cs.sale_number || ' is marked sold but has no invoice'::text,
         jsonb_build_object('buyer', cs.buyer_name, 'sold_at', cs.sold_at),
         cs.selling_price,
         COALESCE(cs.currency, base_ccy),
         'sale_not_invoiced:' || cs.id::text
  FROM container_sales cs
  WHERE cs.organization_id = _org AND cs.status = 'sold' AND cs.invoice_id IS NULL;

  -- 7. Delivered transport orders never invoiced (older than 7 days)
  RETURN QUERY
  SELECT 'transport_order_uninvoiced'::text,
         'warning'::text,
         'logistics_transport_orders'::text,
         t.id,
         t.ref,
         'Transport order ' || t.ref || ' was delivered but never invoiced'::text,
         jsonb_build_object('customer', t.customer_name, 'service_date', t.service_date, 'billing_mode', t.billing_mode),
         t.quoted_price,
         COALESCE(t.currency, base_ccy),
         'transport_order_uninvoiced:' || t.id::text
  FROM logistics_transport_orders t
  WHERE t.organization_id = _org
    AND t.status = 'delivered'
    AND t.invoice_id IS NULL
    AND t.service_date < CURRENT_DATE - 7;

  -- 8. Approved payroll weeks whose ledger does not balance
  RETURN QUERY
  SELECT 'payroll_week_unbalanced'::text,
         'critical'::text,
         'attendance_weeks'::text,
         w.id,
         to_char(w.week_start,'YYYY-MM-DD') || ' – ' || to_char(w.week_end,'YYYY-MM-DD'),
         'Payroll week ' || to_char(w.week_start,'YYYY-MM-DD') || ' does not balance in the ledger'::text,
         jsonb_build_object('debits', l.dr, 'credits', l.cr, 'week_gross', w.gross_amount, 'status', w.status),
         ABS(COALESCE(l.dr,0) - COALESCE(l.cr,0)),
         COALESCE(w.currency, base_ccy),
         'payroll_week_unbalanced:' || w.id::text
  FROM attendance_weeks w
  CROSS JOIN LATERAL (
    SELECT COALESCE(SUM(at.debit_amount),0) dr, COALESCE(SUM(at.credit_amount),0) cr
    FROM accounting_transactions at
    WHERE at.organization_id = _org
      AND at.reference_type IN ('attendance_week','attendance_week_payment','attendance_week_reclass','attendance_correction')
      AND at.reference_id = w.id
  ) l
  WHERE w.organization_id = _org
    AND w.status IN ('approved','paid')
    AND ABS(COALESCE(l.dr,0) - COALESCE(l.cr,0)) > 0.5;
END;
$$;

REVOKE ALL ON FUNCTION public.finance_watchdog_detect(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.finance_watchdog_detect(uuid) TO authenticated, service_role;

-- ============ Scan: upsert findings, auto-clear resolved ones ============
CREATE OR REPLACE FUNCTION public.finance_watchdog_scan(_org uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  org uuid := COALESCE(_org, current_org_id());
  new_count int := 0;
  total int := 0;
  cleared int := 0;
BEGIN
  IF org IS NULL THEN RAISE EXCEPTION 'organization not resolved'; END IF;

  CREATE TEMP TABLE _wd ON COMMIT DROP AS
  SELECT * FROM finance_watchdog_detect(org);

  SELECT COUNT(*) INTO total FROM _wd;

  WITH ins AS (
    INSERT INTO ai_findings (organization_id, job, finding_type, severity, entity_table, entity_id,
                             entity_label, title, details, amount, currency, dedupe_key)
    SELECT org, 'finance_watchdog', d.finding_type, d.severity, d.entity_table, d.entity_id,
           d.entity_label, d.title, d.details, d.amount, d.currency, d.dedupe_key
    FROM _wd d
    ON CONFLICT (organization_id, dedupe_key) DO UPDATE
      SET last_seen_at = now(),
          occurrences = ai_findings.occurrences + 1,
          details = EXCLUDED.details,
          amount = EXCLUDED.amount,
          currency = EXCLUDED.currency,
          title = EXCLUDED.title,
          severity = EXCLUDED.severity,
          cleared_at = NULL,
          status = CASE WHEN ai_findings.status = 'resolved' THEN 'open' ELSE ai_findings.status END
    RETURNING (xmax = 0) AS inserted
  )
  SELECT COUNT(*) FILTER (WHERE inserted) INTO new_count FROM ins;

  WITH cl AS (
    UPDATE ai_findings f
       SET status = 'resolved', cleared_at = now(), review_note = COALESCE(f.review_note,'Auto-cleared: no longer detected')
     WHERE f.organization_id = org
       AND f.job = 'finance_watchdog'
       AND f.status IN ('open','acknowledged')
       AND NOT EXISTS (SELECT 1 FROM _wd d WHERE d.dedupe_key = f.dedupe_key)
    RETURNING 1
  )
  SELECT COUNT(*) INTO cleared FROM cl;

  INSERT INTO ai_job_state (organization_id, job, last_run_at, last_run_findings, last_error)
  VALUES (org, 'finance_watchdog', now(), total, NULL)
  ON CONFLICT (organization_id, job) DO UPDATE
    SET last_run_at = now(), last_run_findings = EXCLUDED.last_run_findings, last_error = NULL;

  RETURN jsonb_build_object('organization_id', org, 'detected', total, 'new', new_count, 'cleared', cleared);
END;
$$;

REVOKE ALL ON FUNCTION public.finance_watchdog_scan(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.finance_watchdog_scan(uuid) TO authenticated, service_role;

-- ============ Review action ============
CREATE OR REPLACE FUNCTION public.review_ai_finding(_finding_id uuid, _status text, _note text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF _status NOT IN ('open','acknowledged','resolved','ignored') THEN
    RAISE EXCEPTION 'invalid status %', _status;
  END IF;
  UPDATE ai_findings
     SET status = _status, review_note = COALESCE(_note, review_note),
         reviewed_by = auth.uid(), reviewed_at = now()
   WHERE id = _finding_id
     AND organization_id = current_org_id()
     AND (has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'org_owner'::app_role)
          OR has_role(auth.uid(),'accountant'::app_role));
  IF NOT FOUND THEN RAISE EXCEPTION 'finding not found or not permitted'; END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.review_ai_finding(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.review_ai_finding(uuid, text, text) TO authenticated;

-- ============ Single-flight lease for scheduled runs ============
CREATE OR REPLACE FUNCTION public.ai_job_acquire(_org uuid, _job text, _lease_seconds int DEFAULT 600, _worker text DEFAULT 'edge')
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE ok boolean := false;
BEGIN
  INSERT INTO ai_job_state (organization_id, job, lease_until, locked_by)
  VALUES (_org, _job, now() + make_interval(secs => _lease_seconds), _worker)
  ON CONFLICT (organization_id, job) DO UPDATE
    SET lease_until = now() + make_interval(secs => _lease_seconds), locked_by = _worker
    WHERE ai_job_state.paused = false
      AND (ai_job_state.lease_until IS NULL OR ai_job_state.lease_until < now())
  RETURNING true INTO ok;
  RETURN COALESCE(ok, false);
END;
$$;

CREATE OR REPLACE FUNCTION public.ai_job_release(_org uuid, _job text, _error text DEFAULT NULL, _pause boolean DEFAULT false, _pause_reason text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE ai_job_state
     SET lease_until = NULL, locked_by = NULL, last_error = _error,
         paused = CASE WHEN _pause THEN true ELSE paused END,
         pause_reason = CASE WHEN _pause THEN _pause_reason ELSE pause_reason END,
         paused_at = CASE WHEN _pause THEN now() ELSE paused_at END
   WHERE organization_id = _org AND job = _job;
END;
$$;

REVOKE ALL ON FUNCTION public.ai_job_acquire(uuid, text, int, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ai_job_release(uuid, text, text, boolean, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ai_job_acquire(uuid, text, int, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.ai_job_release(uuid, text, text, boolean, text) TO service_role;

CREATE OR REPLACE FUNCTION public.ai_job_resume(_job text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE ai_job_state
     SET paused = false, pause_reason = NULL, paused_at = NULL, last_error = NULL
   WHERE organization_id = current_org_id() AND job = _job
     AND (has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'org_owner'::app_role)
          OR has_role(auth.uid(),'accountant'::app_role));
END;
$$;

REVOKE ALL ON FUNCTION public.ai_job_resume(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ai_job_resume(text) TO authenticated;