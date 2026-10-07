
-- 1. Statement vs ledger reconciliation
CREATE OR REPLACE FUNCTION public.loan_statement_reconciliation(_loan_id uuid)
RETURNS TABLE(
  txn_id uuid,
  txn_date date,
  txn_type text,
  description text,
  source text,
  amount numeric,
  posts_to_ledger boolean,
  posted_amount numeric,
  posting_count integer,
  difference numeric,
  match_status text
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  WITH lo AS (
    SELECT l.* FROM public.loan_facilities l
    WHERE l.id = _loan_id
      AND (l.organization_id = public.current_org_id() OR public.is_platform_admin())
  ),
  tx AS (
    SELECT x.*, l.id AS lid FROM public.loan_transactions x JOIN lo l ON l.id = x.loan_id
  ),
  post AS (
    SELECT a.reference_id AS txn_id,
           COALESCE(sum(a.debit_amount),0) AS dr,
           COALESCE(sum(a.credit_amount),0) AS cr,
           count(*)::int AS n
    FROM public.accounting_transactions a
    WHERE a.reference_type = 'loan_transaction'
      AND a.reference_id IN (SELECT id FROM tx)
    GROUP BY a.reference_id
  )
  SELECT t.id, t.txn_date, t.txn_type::text, t.description, COALESCE(t.source,'manual'),
         t.amount, COALESCE(t.posts_to_ledger,true),
         GREATEST(COALESCE(p.dr,0), COALESCE(p.cr,0)) AS posted_amount,
         COALESCE(p.n,0),
         ROUND(GREATEST(COALESCE(p.dr,0), COALESCE(p.cr,0)) - t.amount, 2) AS difference,
         CASE
           WHEN COALESCE(p.n,0) = 0 AND COALESCE(t.posts_to_ledger,true) = false THEN 'not_applicable'
           WHEN COALESCE(p.n,0) = 0 THEN 'missing_in_ledger'
           WHEN abs(GREATEST(COALESCE(p.dr,0), COALESCE(p.cr,0)) - t.amount) > 0.01 THEN 'amount_mismatch'
           WHEN abs(COALESCE(p.dr,0) - COALESCE(p.cr,0)) > 0.01 THEN 'unbalanced'
           ELSE 'matched'
         END AS match_status
  FROM tx t
  LEFT JOIN post p ON p.txn_id = t.id
  ORDER BY t.txn_date, t.created_at;
$$;

REVOKE ALL ON FUNCTION public.loan_statement_reconciliation(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.loan_statement_reconciliation(uuid) TO authenticated;

-- ledger-only postings (journal rows without a matching loan transaction)
CREATE OR REPLACE FUNCTION public.loan_orphan_postings(_loan_id uuid)
RETURNS TABLE(
  posting_id uuid,
  transaction_date date,
  description text,
  category text,
  debit_amount numeric,
  credit_amount numeric,
  reference_id uuid
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT a.id, a.transaction_date::date, a.description, a.category,
         a.debit_amount, a.credit_amount, a.reference_id
  FROM public.accounting_transactions a
  JOIN public.loan_facilities l
    ON l.id = _loan_id
   AND (l.organization_id = public.current_org_id() OR public.is_platform_admin())
  WHERE a.organization_id = l.organization_id
    AND a.reference_type = 'loan_transaction'
    AND NOT EXISTS (
      SELECT 1 FROM public.loan_transactions x
      WHERE x.id = a.reference_id AND x.loan_id = l.id
    )
    AND EXISTS (
      SELECT 1 FROM public.loan_transactions x2
      WHERE x2.id = a.reference_id
    ) IS NOT TRUE
  ORDER BY a.transaction_date;
$$;

REVOKE ALL ON FUNCTION public.loan_orphan_postings(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.loan_orphan_postings(uuid) TO authenticated;

-- 2. Interest / penalty / fee breakdown
CREATE OR REPLACE FUNCTION public.loan_interest_breakdown(_loan_id uuid)
RETURNS TABLE(
  currency text,
  interest_charged numeric,
  interest_paid numeric,
  interest_outstanding numeric,
  penalty_charged numeric,
  penalty_paid numeric,
  penalty_outstanding numeric,
  fees_charged numeric,
  fees_stamp_duty numeric,
  fees_insurance numeric,
  fees_other numeric,
  accrued_interest numeric,
  stmt_accrued_interest numeric,
  accrual_variance numeric
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  WITH lo AS (
    SELECT l.* FROM public.loan_facilities l
    WHERE l.id = _loan_id
      AND (l.organization_id = public.current_org_id() OR public.is_platform_admin())
  ), t AS (
    SELECT
      COALESCE(sum(x.amount) FILTER (WHERE x.txn_type = 'interest_due'),0) AS int_chg,
      COALESCE(sum(x.amount) FILTER (WHERE x.txn_type = 'interest_payment'),0) AS int_paid,
      COALESCE(sum(x.amount) FILTER (WHERE x.txn_type = 'penalty_interest_due'),0) AS pen_chg,
      COALESCE(sum(x.amount) FILTER (WHERE x.txn_type = 'penalty_payment'),0) AS pen_paid,
      COALESCE(sum(x.amount) FILTER (WHERE x.txn_type = 'stamp_duty'),0) AS stamp,
      COALESCE(sum(x.amount) FILTER (WHERE x.txn_type = 'insurance'),0) AS ins,
      COALESCE(sum(x.amount) FILTER (WHERE x.txn_type = 'charges'),0) AS chg
    FROM public.loan_transactions x JOIN lo l ON l.id = x.loan_id
  )
  SELECT COALESCE(lo.currency,'USD'),
         t.int_chg, t.int_paid, GREATEST(t.int_chg - t.int_paid, 0),
         t.pen_chg, t.pen_paid, GREATEST(t.pen_chg - t.pen_paid, 0),
         (t.stamp + t.ins + t.chg), t.stamp, t.ins, t.chg,
         GREATEST((t.int_chg + t.pen_chg) - (t.int_paid + t.pen_paid), 0),
         lo.stmt_accrued_interest,
         CASE WHEN lo.stmt_accrued_interest IS NULL THEN NULL
              ELSE ROUND(GREATEST((t.int_chg + t.pen_chg) - (t.int_paid + t.pen_paid), 0) - lo.stmt_accrued_interest, 2)
         END
  FROM lo, t;
$$;

REVOKE ALL ON FUNCTION public.loan_interest_breakdown(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.loan_interest_breakdown(uuid) TO authenticated;

-- 3. Daily commitment reminders -> notifications (deduped per item per day)
CREATE OR REPLACE FUNCTION public.run_commitment_reminders(_days integer DEFAULT 7)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  inserted int := 0;
BEGIN
  WITH due AS (
    SELECT 'loan'::text AS kind, s.loan_id AS source_id,
           l.organization_id,
           l.lender_name || COALESCE(' — '||l.reference,'') AS title,
           s.due_date, (s.total_due - s.paid_amount) AS amount,
           COALESCE(l.currency,'USD') AS currency,
           (s.due_date - CURRENT_DATE)::int AS days_until
    FROM public.loan_schedule_lines s
    JOIN public.loan_facilities l ON l.id = s.loan_id
    WHERE s.status NOT IN ('paid','cancelled')
      AND s.due_date <= CURRENT_DATE + COALESCE(_days,7)
    UNION ALL
    SELECT 'recurring_expense', r.id, r.organization_id, r.name,
           r.next_run_date, NULL::numeric, COALESCE(r.currency,'USD'),
           (r.next_run_date - CURRENT_DATE)::int
    FROM public.recurring_expense_templates r
    WHERE r.is_active AND r.next_run_date IS NOT NULL
      AND r.next_run_date <= CURRENT_DATE + COALESCE(_days,7)
  ), targets AS (
    SELECT d.*, ur.user_id
    FROM due d
    JOIN public.organization_members om
      ON om.organization_id = d.organization_id AND om.status = 'active'
    JOIN public.user_roles ur
      ON ur.user_id = om.user_id
     AND ur.role IN ('org_owner','admin','accountant')
    GROUP BY d.kind, d.source_id, d.organization_id, d.title, d.due_date, d.amount, d.currency, d.days_until, ur.user_id
  ), ins AS (
    INSERT INTO public.notifications (user_id, organization_id, title, message, type, reference_id, reference_type)
    SELECT t.user_id, t.organization_id,
           CASE WHEN t.days_until < 0 THEN 'Overdue: ' ELSE 'Due soon: ' END || t.title,
           CASE WHEN t.days_until < 0
                THEN 'Overdue by ' || abs(t.days_until) || ' day(s) (due ' || t.due_date || ')'
                ELSE 'Due in ' || t.days_until || ' day(s) on ' || t.due_date END
           || COALESCE(' — ' || t.currency || ' ' || to_char(t.amount, 'FM999,999,999,990.00'), ''),
           CASE WHEN t.days_until < 0 THEN 'error' ELSE 'warning' END,
           t.source_id,
           CASE WHEN t.kind = 'loan' THEN 'loan_facility' ELSE 'recurring_expense_template' END
    FROM targets t
    WHERE NOT EXISTS (
      SELECT 1 FROM public.notifications n
      WHERE n.user_id = t.user_id
        AND n.reference_id = t.source_id
        AND n.reference_type = CASE WHEN t.kind = 'loan' THEN 'loan_facility' ELSE 'recurring_expense_template' END
        AND n.created_at >= date_trunc('day', now())
    )
    RETURNING 1
  )
  SELECT count(*)::int INTO inserted FROM ins;
  RETURN inserted;
END;
$$;

REVOKE ALL ON FUNCTION public.run_commitment_reminders(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.run_commitment_reminders(integer) TO authenticated, service_role;
