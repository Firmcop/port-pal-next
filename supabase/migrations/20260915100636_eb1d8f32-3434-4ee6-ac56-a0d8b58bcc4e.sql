CREATE OR REPLACE FUNCTION public.set_expense_conversion(_expense_id uuid, _conversion_id uuid DEFAULT NULL, _project_id uuid DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_org uuid := public.current_org_id();
  v_exp public.operating_expenses%ROWTYPE;
  v_job_project uuid;
  v_project uuid;
BEGIN
  IF v_org IS NULL THEN RAISE EXCEPTION 'No organization context'; END IF;

  IF NOT (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'org_owner')
          OR public.is_platform_admin() OR public.has_permission(auth.uid(),'accounting','edit')) THEN
    RAISE EXCEPTION 'Not authorized to re-tag expenses';
  END IF;

  SELECT * INTO v_exp FROM public.operating_expenses
   WHERE id = _expense_id AND organization_id = v_org;
  IF NOT FOUND THEN RAISE EXCEPTION 'Expense not found'; END IF;

  IF _conversion_id IS NOT NULL THEN
    SELECT cc.project_id INTO v_job_project FROM public.container_conversions cc
     WHERE cc.id = _conversion_id AND cc.organization_id = v_org;
    IF NOT FOUND THEN RAISE EXCEPTION 'Invalid job'; END IF;
  END IF;

  IF _project_id IS NOT NULL THEN
    PERFORM 1 FROM public.projects p WHERE p.id = _project_id AND p.organization_id = v_org;
    IF NOT FOUND THEN RAISE EXCEPTION 'Invalid project'; END IF;
  END IF;

  v_project := COALESCE(_project_id, v_job_project, v_exp.project_id);

  UPDATE public.operating_expenses
     SET conversion_id = _conversion_id,
         project_id = v_project,
         updated_at = now()
   WHERE id = _expense_id;

  UPDATE public.operating_expense_lines l
     SET conversion_id = _conversion_id,
         project_id = COALESCE(l.project_id, v_project)
   WHERE l.expense_id = _expense_id
     AND l.organization_id = v_org
     AND (l.conversion_id IS NOT DISTINCT FROM v_exp.conversion_id);

  INSERT INTO public.finance_audit_log (
    organization_id, actor_user_id, entity_type, entity_id, entity_ref, action, summary, before_data, after_data
  ) VALUES (
    v_org, auth.uid(), 'operating_expense', _expense_id, v_exp.expense_number, 'job_reassigned',
    jsonb_build_object('conversion_id', _conversion_id, 'project_id', v_project),
    jsonb_build_object('conversion_id', v_exp.conversion_id, 'project_id', v_exp.project_id),
    jsonb_build_object('conversion_id', _conversion_id, 'project_id', v_project)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.set_expense_conversion(uuid, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_expense_conversion(uuid, uuid, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.conversion_pending_expenses(_conversion_id uuid)
RETURNS TABLE (
  expense_id uuid,
  expense_number text,
  expense_date date,
  payee text,
  approval_status text,
  posted boolean,
  reversed boolean,
  amount numeric,
  currency text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT e.id, e.expense_number, e.expense_date,
         COALESCE(e.payee, s.name),
         e.approval_status::text,
         e.posted_at IS NOT NULL,
         e.reversed_at IS NOT NULL,
         COALESCE(e.total_amount, 0),
         e.currency
    FROM public.operating_expenses e
    LEFT JOIN public.suppliers s ON s.id = e.supplier_id
   WHERE e.conversion_id = _conversion_id
     AND e.organization_id = public.current_org_id()
     AND (e.approval_status <> 'approved' OR e.posted_at IS NULL OR e.reversed_at IS NOT NULL)
   ORDER BY e.expense_date DESC, e.expense_number;
$$;

REVOKE ALL ON FUNCTION public.conversion_pending_expenses(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.conversion_pending_expenses(uuid) TO authenticated;