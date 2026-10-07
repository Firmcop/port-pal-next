-- 1. Job tagging on expenses
ALTER TABLE public.operating_expenses
  ADD COLUMN IF NOT EXISTS conversion_id uuid REFERENCES public.container_conversions(id) ON DELETE SET NULL;
ALTER TABLE public.operating_expense_lines
  ADD COLUMN IF NOT EXISTS conversion_id uuid REFERENCES public.container_conversions(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_opex_conversion ON public.operating_expenses(conversion_id);
CREATE INDEX IF NOT EXISTS idx_opex_lines_conversion ON public.operating_expense_lines(conversion_id);

-- 2. EIR fx snapshot
ALTER TABLE public.eir_records ADD COLUMN IF NOT EXISTS fx_rate_snapshot numeric;

-- 3. post_operating_expense gains _conversion_id (drop old signature to keep exactly one overload)
DROP FUNCTION IF EXISTS public.post_operating_expense(date, jsonb, text, uuid, text, uuid, date, text, numeric, uuid, uuid, text, text, text, boolean);

CREATE OR REPLACE FUNCTION public.post_operating_expense(
  _expense_date date,
  _lines jsonb,
  _payment_mode text,
  _supplier_id uuid DEFAULT NULL,
  _payee text DEFAULT NULL,
  _financial_account_id uuid DEFAULT NULL,
  _due_date date DEFAULT NULL,
  _currency text DEFAULT NULL,
  _fx_rate numeric DEFAULT 1,
  _depot_id uuid DEFAULT NULL,
  _project_id uuid DEFAULT NULL,
  _reference text DEFAULT NULL,
  _notes text DEFAULT NULL,
  _attachment_url text DEFAULT NULL,
  _submit boolean DEFAULT false,
  _conversion_id uuid DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_org uuid := public.current_org_id();
  v_id uuid := gen_random_uuid();
  v_currency text;
  v_subtotal numeric := 0;
  v_tax numeric := 0;
  v_number text;
  v_seq int := 0;
  line jsonb;
  v_acct public.gl_accounts%ROWTYPE;
  v_line_tax numeric;
  v_threshold numeric;
  v_enabled boolean;
  v_can_approve boolean;
  v_full boolean;
  v_clerk boolean;
  v_submit boolean := _submit;
  v_job_project uuid;
BEGIN
  IF v_org IS NULL THEN RAISE EXCEPTION 'No organization context'; END IF;

  v_full := public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'org_owner')
            OR public.is_platform_admin()
            OR public.has_permission(auth.uid(),'accounting','create');
  v_clerk := (NOT v_full) AND public.has_permission(auth.uid(),'opex_entry','create');

  IF NOT (v_full OR v_clerk) THEN
    RAISE EXCEPTION 'Not authorized to record expenses';
  END IF;

  IF v_clerk THEN
    v_submit := true;
  END IF;

  IF _payment_mode NOT IN ('paid','credit') THEN
    RAISE EXCEPTION 'payment_mode must be paid or credit';
  END IF;
  IF jsonb_typeof(_lines) <> 'array' OR jsonb_array_length(_lines) = 0 THEN
    RAISE EXCEPTION 'At least one expense line is required';
  END IF;

  PERFORM public._opex_assert_period_open(v_org, _expense_date);

  IF _conversion_id IS NOT NULL THEN
    SELECT cc.project_id INTO v_job_project
      FROM public.container_conversions cc
     WHERE cc.id = _conversion_id AND cc.organization_id = v_org;
    IF NOT FOUND THEN RAISE EXCEPTION 'Invalid job'; END IF;
  END IF;

  SELECT COALESCE(_currency, o.currency, 'USD') INTO v_currency
    FROM public.organizations o WHERE o.id = v_org;

  IF _payment_mode = 'paid' AND _financial_account_id IS NULL THEN
    RAISE EXCEPTION 'Select the bank or cash account the expense was paid from';
  END IF;

  v_number := public.next_operating_expense_number();

  INSERT INTO public.operating_expenses (
    id, organization_id, expense_number, expense_date, supplier_id, payee, payment_mode,
    financial_account_id, due_date, currency, fx_rate, depot_id, project_id, conversion_id, reference,
    notes, attachment_url, status, approval_status, created_by,
    submitted_by, submitted_at
  ) VALUES (
    v_id, v_org, v_number, _expense_date, _supplier_id, _payee, _payment_mode,
    CASE WHEN _payment_mode = 'paid' THEN _financial_account_id ELSE NULL END,
    CASE WHEN _payment_mode = 'credit' THEN _due_date ELSE NULL END,
    v_currency, COALESCE(_fx_rate,1), _depot_id, COALESCE(_project_id, v_job_project), _conversion_id, _reference,
    _notes, _attachment_url, 'draft',
    CASE WHEN v_submit THEN 'submitted' ELSE 'draft' END, auth.uid(),
    CASE WHEN v_submit THEN auth.uid() ELSE NULL END,
    CASE WHEN v_submit THEN now() ELSE NULL END
  );

  FOR line IN SELECT * FROM jsonb_array_elements(_lines) LOOP
    v_seq := v_seq + 1;
    SELECT * INTO v_acct FROM public.gl_accounts
      WHERE id = NULLIF(line->>'gl_account_id','')::uuid AND organization_id = v_org;
    IF v_acct.id IS NULL THEN RAISE EXCEPTION 'Invalid expense account on line %', v_seq; END IF;
    IF COALESCE((line->>'amount')::numeric,0) <= 0 THEN
      RAISE EXCEPTION 'Line % amount must be greater than zero', v_seq;
    END IF;
    v_line_tax := COALESCE((line->>'tax_amount')::numeric, 0);

    INSERT INTO public.operating_expense_lines (
      organization_id, expense_id, gl_account_id, category_id, description, amount, tax_code_id,
      tax_amount, project_id, depot_id, conversion_id
    ) VALUES (
      v_org, v_id, v_acct.id, NULLIF(line->>'category_id','')::uuid,
      line->>'description', (line->>'amount')::numeric,
      NULLIF(line->>'tax_code_id','')::uuid, v_line_tax,
      COALESCE(NULLIF(line->>'project_id','')::uuid, _project_id, v_job_project),
      COALESCE(NULLIF(line->>'depot_id','')::uuid, _depot_id),
      COALESCE(NULLIF(line->>'conversion_id','')::uuid, _conversion_id)
    );

    v_subtotal := v_subtotal + (line->>'amount')::numeric;
    v_tax := v_tax + v_line_tax;
  END LOOP;

  UPDATE public.operating_expenses
     SET subtotal = v_subtotal, tax_amount = v_tax, total_amount = v_subtotal + v_tax
   WHERE id = v_id;

  INSERT INTO public.finance_audit_log (organization_id, actor_user_id, entity_type, entity_id, entity_ref, action, summary)
  VALUES (v_org, auth.uid(), 'operating_expense', v_id, v_number,
          CASE WHEN v_submit THEN 'submitted' ELSE 'created' END,
          jsonb_build_object('total', v_subtotal + v_tax, 'mode', _payment_mode, 'currency', v_currency,
                             'conversion_id', _conversion_id));

  IF v_submit AND NOT v_clerk THEN
    SELECT p.min_amount, p.enabled INTO v_threshold, v_enabled
      FROM public.approval_policies p
     WHERE p.organization_id = v_org AND p.document_type = 'operating_expense'
     LIMIT 1;

    v_can_approve := public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'org_owner')
                     OR public.is_platform_admin()
                     OR public.has_permission(auth.uid(),'accounting','approve');

    IF v_can_approve AND (COALESCE(v_enabled,false) = false
                          OR (v_subtotal + v_tax) < COALESCE(v_threshold,0)) THEN
      PERFORM public.approve_operating_expense(v_id, 'Auto-approved (below threshold)');
    END IF;
  END IF;

  RETURN v_id;
END
$fn$;

REVOKE ALL ON FUNCTION public.post_operating_expense(date, jsonb, text, uuid, text, uuid, date, text, numeric, uuid, uuid, text, text, text, boolean, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.post_operating_expense(date, jsonb, text, uuid, text, uuid, date, text, numeric, uuid, uuid, text, text, text, boolean, uuid) TO authenticated;

-- 4. Approved, posted expenses charged directly to a job
CREATE OR REPLACE FUNCTION public.conversion_direct_expenses(_conversion_id uuid)
RETURNS TABLE (
  expense_id uuid,
  line_id uuid,
  expense_number text,
  expense_date date,
  payee text,
  category text,
  description text,
  amount numeric,
  tax_amount numeric,
  currency text,
  fx_rate numeric,
  amount_base numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
  SELECT e.id, l.id, e.expense_number, e.expense_date,
         COALESCE(e.payee, s.name),
         c.name,
         l.description,
         l.amount,
         COALESCE(l.tax_amount,0),
         e.currency,
         COALESCE(e.fx_rate,1),
         ROUND((l.amount + COALESCE(l.tax_amount,0)) * COALESCE(e.fx_rate,1), 2)
    FROM public.operating_expense_lines l
    JOIN public.operating_expenses e ON e.id = l.expense_id
    LEFT JOIN public.suppliers s ON s.id = e.supplier_id
    LEFT JOIN public.expense_categories c ON c.id = l.category_id
   WHERE COALESCE(l.conversion_id, e.conversion_id) = _conversion_id
     AND e.organization_id = public.current_org_id()
     AND e.approval_status = 'approved'
     AND e.posted_at IS NOT NULL
     AND e.reversed_at IS NULL
   ORDER BY e.expense_date DESC, e.expense_number;
$fn$;

REVOKE ALL ON FUNCTION public.conversion_direct_expenses(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.conversion_direct_expenses(uuid) TO authenticated;

-- 5. Portal: EIRs awaiting the owner's approval
CREATE OR REPLACE FUNCTION public.portal_pending_eirs()
RETURNS TABLE (
  id uuid,
  eir_number text,
  eir_type text,
  created_at timestamptz,
  container_number text,
  container_size text,
  condition_grade text,
  owner_at_issue text,
  new_owner text,
  gate_fee_amount numeric,
  gate_fee_currency text,
  approval_status text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
  SELECT r.id, r.eir_number, r.eir_type::text, r.created_at,
         ct.container_number, ct.size::text, r.condition_grade::text,
         r.owner_at_issue, r.new_owner, r.gate_fee_amount, r.gate_fee_currency,
         r.approval_status::text
    FROM public.eir_records r
    JOIN public.containers ct ON ct.id = r.container_id
    JOIN public.customer_portal_users pu
      ON pu.customer_id = ct.customer_id
     AND pu.organization_id = r.organization_id
     AND pu.is_active
     AND pu.user_id = auth.uid()
   ORDER BY r.created_at DESC
   LIMIT 200;
$fn$;

REVOKE ALL ON FUNCTION public.portal_pending_eirs() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.portal_pending_eirs() TO authenticated;

CREATE OR REPLACE FUNCTION public.portal_decide_eir(_eir_id uuid, _decision text, _note text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  r public.eir_records%ROWTYPE;
  allowed boolean;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF _decision NOT IN ('approved','rejected') THEN RAISE EXCEPTION 'Invalid decision'; END IF;

  SELECT * INTO r FROM public.eir_records WHERE id = _eir_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'EIR not found'; END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.containers ct
      JOIN public.customer_portal_users pu ON pu.customer_id = ct.customer_id
     WHERE ct.id = r.container_id
       AND pu.user_id = auth.uid()
       AND pu.is_active
       AND pu.organization_id = r.organization_id
  ) INTO allowed;
  IF NOT allowed THEN RAISE EXCEPTION 'Not authorized to decide this EIR'; END IF;

  IF r.approval_status <> 'pending' THEN RAISE EXCEPTION 'This EIR has already been decided'; END IF;

  UPDATE public.eir_records
     SET approval_status = _decision::approval_doc_status,
         approved_by = CASE WHEN _decision = 'approved' THEN auth.uid() ELSE approved_by END,
         approved_at = CASE WHEN _decision = 'approved' THEN now() ELSE approved_at END,
         rejection_reason = CASE WHEN _decision = 'rejected' THEN _note ELSE rejection_reason END
   WHERE id = _eir_id;

  IF r.approval_request_id IS NOT NULL THEN
    UPDATE public.approval_requests
       SET status = _decision, decided_by = auth.uid(), decided_at = now(),
           decision_note = COALESCE(_note, decision_note), updated_at = now()
     WHERE id = r.approval_request_id AND status = 'pending';
  END IF;

  RETURN jsonb_build_object('ok', true, 'status', _decision);
END
$fn$;

REVOKE ALL ON FUNCTION public.portal_decide_eir(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.portal_decide_eir(uuid, text, text) TO authenticated;