DROP FUNCTION IF EXISTS public.conversion_project_expenses(uuid);
CREATE OR REPLACE FUNCTION public.conversion_project_expenses(_conversion_id uuid)
 RETURNS TABLE(expense_id uuid, line_id uuid, expense_number text, expense_date date, payee text, category text, description text, amount numeric, tax_amount numeric, currency text, fx_rate numeric, amount_base numeric, approval_status text, posted boolean, reversed boolean, project_job_count integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH j AS (
    SELECT id, project_id, organization_id
      FROM public.container_conversions
     WHERE id = _conversion_id
       AND organization_id = public.current_org_id()
  ), jc AS (
    SELECT COALESCE((SELECT COUNT(*)::int FROM public.container_conversions cv, j
                      WHERE cv.project_id = j.project_id
                        AND cv.organization_id = j.organization_id
                        AND cv.status <> 'cancelled'), 0) AS n
  )
  SELECT e.id, l.id, e.expense_number, e.expense_date,
         COALESCE(e.payee, s.name),
         c.name,
         l.description,
         l.amount,
         COALESCE(l.tax_amount, 0),
         e.currency,
         COALESCE(e.fx_rate, 1),
         ROUND((l.amount + COALESCE(l.tax_amount, 0)) * COALESCE(e.fx_rate, 1), 2),
         e.approval_status::text,
         e.posted_at IS NOT NULL,
         e.reversed_at IS NOT NULL,
         jc.n
    FROM public.operating_expense_lines l
    JOIN public.operating_expenses e ON e.id = l.expense_id
    JOIN j ON j.organization_id = e.organization_id
    CROSS JOIN jc
    LEFT JOIN public.suppliers s ON s.id = e.supplier_id
    LEFT JOIN public.expense_categories c ON c.id = l.category_id
   WHERE j.project_id IS NOT NULL
     AND COALESCE(l.project_id, e.project_id) = j.project_id
     AND COALESCE(l.conversion_id, e.conversion_id) IS DISTINCT FROM _conversion_id
   ORDER BY e.expense_date DESC, e.expense_number;
$function$;

REVOKE ALL ON FUNCTION public.conversion_project_expenses(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.conversion_project_expenses(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.conversion_posting_status(_conversion_id uuid)
 RETURNS TABLE(job_status text, job_cost_total numeric, posted_amount numeric, posted_entries integer, last_posted_at timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH j AS (
    SELECT id, status, project_id, organization_id
      FROM public.container_conversions
     WHERE id = _conversion_id
       AND organization_id = public.current_org_id()
  )
  SELECT j.status::text,
         COALESCE((SELECT SUM(COALESCE(m.total_cost,0)) FROM public.conversion_materials m WHERE m.conversion_id = j.id), 0)
       + COALESCE((SELECT SUM(COALESCE(l.total_cost,0)) FROM public.conversion_labour l WHERE l.conversion_id = j.id), 0)
       + COALESCE((SELECT SUM(COALESCE(sv.cost,0)) FROM public.conversion_services sv WHERE sv.conversion_id = j.id), 0)
       + COALESCE((SELECT SUM(COALESCE(cc.container_cost,0) + COALESCE(cc.transport_offloading_cost,0)) FROM public.conversion_containers cc WHERE cc.conversion_id = j.id), 0)
       + COALESCE((SELECT SUM(ROUND((el.amount + COALESCE(el.tax_amount,0)) * COALESCE(ex.fx_rate,1), 2))
                     FROM public.operating_expense_lines el
                     JOIN public.operating_expenses ex ON ex.id = el.expense_id
                    WHERE ex.organization_id = j.organization_id
                      AND ex.posted_at IS NOT NULL
                      AND ex.reversed_at IS NULL
                      AND ex.approval_status::text = 'approved'
                      AND (
                            COALESCE(el.conversion_id, ex.conversion_id) = j.id
                         OR (j.project_id IS NOT NULL
                             AND COALESCE(el.project_id, ex.project_id) = j.project_id
                             AND COALESCE(el.conversion_id, ex.conversion_id) IS NULL
                             AND (SELECT COUNT(*) FROM public.container_conversions cv
                                   WHERE cv.project_id = j.project_id
                                     AND cv.organization_id = j.organization_id
                                     AND cv.status <> 'cancelled') = 1)
                          )), 0),
         COALESCE((SELECT SUM(t.debit_amount) FROM public.accounting_transactions t
                    WHERE t.reference_id = j.id AND t.reference_type = 'container_conversions'), 0),
         COALESCE((SELECT COUNT(*)::int FROM public.accounting_transactions t
                    WHERE t.reference_id = j.id AND t.reference_type = 'container_conversions'), 0),
         (SELECT MAX(t.transaction_date) FROM public.accounting_transactions t
           WHERE t.reference_id = j.id AND t.reference_type = 'container_conversions')
    FROM j;
$function$;

REVOKE ALL ON FUNCTION public.conversion_posting_status(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.conversion_posting_status(uuid) TO authenticated;