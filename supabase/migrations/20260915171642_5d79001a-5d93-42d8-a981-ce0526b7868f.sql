
-- 1. Category breakdown for a conversion job
CREATE OR REPLACE FUNCTION public.conversion_expense_breakdown(_conversion_id uuid)
RETURNS TABLE(
  line_id uuid, expense_id uuid, expense_number text, expense_date date, payee text,
  category text, description text, amount_base numeric, currency text, amount numeric,
  source text, approval_status text, posted boolean, reversed boolean, counted boolean
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  WITH j AS (
    SELECT id, project_id, organization_id
      FROM public.container_conversions
     WHERE id = _conversion_id AND organization_id = public.current_org_id()
  ), jc AS (
    SELECT COALESCE((SELECT COUNT(*)::int FROM public.container_conversions cv, j
                      WHERE cv.project_id = j.project_id
                        AND cv.organization_id = j.organization_id
                        AND cv.status <> 'cancelled'), 0) AS n
  )
  SELECT l.id, e.id, e.expense_number, e.expense_date,
         COALESCE(e.payee, s.name),
         COALESCE(c.name, 'Uncategorised'),
         l.description,
         ROUND((l.amount + COALESCE(l.tax_amount,0)) * COALESCE(e.fx_rate,1), 2),
         e.currency,
         l.amount + COALESCE(l.tax_amount,0),
         CASE WHEN COALESCE(l.conversion_id, e.conversion_id) = j.id THEN 'job' ELSE 'project' END,
         e.approval_status::text,
         e.posted_at IS NOT NULL,
         e.reversed_at IS NOT NULL,
         (e.approval_status::text = 'approved' AND e.posted_at IS NOT NULL AND e.reversed_at IS NULL
          AND (COALESCE(l.conversion_id, e.conversion_id) = j.id OR jc.n = 1))
    FROM public.operating_expense_lines l
    JOIN public.operating_expenses e ON e.id = l.expense_id
    JOIN j ON j.organization_id = e.organization_id
    CROSS JOIN jc
    LEFT JOIN public.suppliers s ON s.id = e.supplier_id
    LEFT JOIN public.expense_categories c ON c.id = l.category_id
   WHERE COALESCE(l.conversion_id, e.conversion_id) = j.id
      OR (j.project_id IS NOT NULL
          AND COALESCE(l.project_id, e.project_id) = j.project_id
          AND COALESCE(l.conversion_id, e.conversion_id) IS NULL)
   ORDER BY 6, 4 DESC, 3;
$function$;

REVOKE ALL ON FUNCTION public.conversion_expense_breakdown(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.conversion_expense_breakdown(uuid) TO authenticated;

-- 2. One-off backfill: link project-tagged expense lines to the project's single job
DO $do$
DECLARE r RECORD; v_count int := 0;
BEGIN
  FOR r IN
    SELECT l.id AS line_id, l.expense_id, e.expense_number, e.organization_id,
           COALESCE(l.project_id, e.project_id) AS project_id,
           (SELECT cv.id FROM public.container_conversions cv
             WHERE cv.project_id = COALESCE(l.project_id, e.project_id)
               AND cv.organization_id = e.organization_id
               AND cv.status <> 'cancelled'
             LIMIT 1) AS conversion_id
      FROM public.operating_expense_lines l
      JOIN public.operating_expenses e ON e.id = l.expense_id
     WHERE COALESCE(l.conversion_id, e.conversion_id) IS NULL
       AND COALESCE(l.project_id, e.project_id) IS NOT NULL
       AND (SELECT COUNT(*) FROM public.container_conversions cv
             WHERE cv.project_id = COALESCE(l.project_id, e.project_id)
               AND cv.organization_id = e.organization_id
               AND cv.status <> 'cancelled') = 1
  LOOP
    UPDATE public.operating_expense_lines
       SET conversion_id = r.conversion_id,
           project_id = COALESCE(project_id, r.project_id)
     WHERE id = r.line_id;

    INSERT INTO public.finance_audit_log (
      organization_id, entity_type, entity_id, entity_ref, action, summary, before_data, after_data
    ) VALUES (
      r.organization_id, 'operating_expense_line', r.line_id, r.expense_number, 'job_autolinked',
      jsonb_build_object('reason', 'project has exactly one active conversion job',
                         'project_id', r.project_id, 'conversion_id', r.conversion_id),
      jsonb_build_object('conversion_id', NULL),
      jsonb_build_object('conversion_id', r.conversion_id)
    );
    v_count := v_count + 1;
  END LOOP;
  RAISE NOTICE 'auto-linked % expense lines', v_count;
END
$do$;
