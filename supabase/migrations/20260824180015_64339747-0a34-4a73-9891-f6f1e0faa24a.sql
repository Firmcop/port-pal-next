CREATE OR REPLACE FUNCTION public.loan_balances()
 RETURNS TABLE(loan_id uuid, lender_name text, reference text, loan_type loan_type, currency text, status loan_status, principal_amount numeric, maturity_date date, principal_repaid numeric, principal_outstanding numeric, interest_charged numeric, interest_paid numeric, accrued_interest numeric, fees_charged numeric, arrears_amount numeric, next_due_date date, next_due_amount numeric, stmt_as_of date, stmt_principal_outstanding numeric, stmt_accrued_interest numeric, stmt_arrears numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH t AS (
    SELECT l.id,
      COALESCE(sum(x.amount) FILTER (WHERE x.txn_type='disbursement'),0) AS disbursed,
      COALESCE(sum(x.amount) FILTER (WHERE x.txn_type='adjustment'),0) AS adj,
      COALESCE(sum(x.amount) FILTER (WHERE x.txn_type='principal_payment'),0) AS prin_paid,
      COALESCE(sum(x.amount) FILTER (WHERE x.txn_type IN ('interest_due','penalty_interest_due')),0) AS int_chg,
      COALESCE(sum(x.amount) FILTER (WHERE x.txn_type IN ('interest_payment','penalty_payment')),0) AS int_paid,
      COALESCE(sum(x.amount) FILTER (WHERE x.txn_type IN ('charges','stamp_duty','insurance')),0) AS fees
    FROM public.loan_facilities l
    LEFT JOIN public.loan_transactions x ON x.loan_id = l.id
    GROUP BY l.id
  ), a AS (
    SELECT s.loan_id, COALESCE(sum(s.total_due - s.paid_amount),0) AS arrears
    FROM public.loan_schedule_lines s WHERE s.due_date < CURRENT_DATE AND s.status <> 'paid'
    GROUP BY s.loan_id
  ), n AS (
    SELECT DISTINCT ON (s.loan_id) s.loan_id, s.due_date, s.total_due
    FROM public.loan_schedule_lines s WHERE s.status <> 'paid' AND s.due_date >= CURRENT_DATE
    ORDER BY s.loan_id, s.due_date
  )
  SELECT l.id, l.lender_name, l.reference, l.loan_type, l.currency, l.status,
         GREATEST(l.principal_amount, t.disbursed), l.maturity_date,
         t.prin_paid,
         GREATEST(GREATEST(l.principal_amount, t.disbursed) - t.prin_paid - t.adj, 0),
         t.int_chg, t.int_paid, GREATEST(t.int_chg - t.int_paid, 0), t.fees,
         COALESCE(a.arrears,0), n.due_date, n.total_due,
         l.stmt_as_of, l.stmt_principal_outstanding, l.stmt_accrued_interest, l.stmt_arrears
  FROM public.loan_facilities l
  JOIN t ON t.id = l.id
  LEFT JOIN a ON a.loan_id = l.id
  LEFT JOIN n ON n.loan_id = l.id
  WHERE (l.organization_id = public.current_org_id() OR public.is_platform_admin())
  ORDER BY l.lender_name;
$function$;