-- 1. Map the narrow opex_entry scope onto accounting for role-default lookups
CREATE OR REPLACE FUNCTION public.has_permission(_user_id uuid, _module text, _action app_action)
RETURNS boolean
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_org uuid;
  v_user_override boolean;
  v_role_module text := CASE
    WHEN _module = 'hrm_attendance' THEN 'hrm'
    WHEN _module = 'opex_entry' THEN 'accounting'
    ELSE _module END;
BEGIN
  IF _user_id IS NULL THEN RETURN false; END IF;
  IF public.is_platform_admin() THEN RETURN true; END IF;

  v_org := public.current_org_id();

  IF EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id
      AND role::text = 'admin'
      AND (organization_id IS NULL OR organization_id = v_org)
  ) OR EXISTS (
    SELECT 1 FROM public.organization_members
    WHERE user_id = _user_id
      AND organization_id = v_org
      AND role IN ('org_owner','admin')
  ) THEN
    RETURN true;
  END IF;

  SELECT uo.allowed INTO v_user_override
  FROM public.user_permission_overrides uo
  WHERE uo.organization_id = v_org
    AND uo.user_id = _user_id
    AND uo.module = _module
    AND uo.action = _action
  LIMIT 1;
  IF v_user_override IS NOT NULL THEN RETURN v_user_override; END IF;

  IF EXISTS (
    SELECT 1
    FROM public.user_roles ur
    JOIN public.role_permission_overrides ro
      ON ro.role = ur.role
     AND ro.organization_id = v_org
     AND ro.module = v_role_module
     AND ro.action = _action
     AND ro.allowed = true
    WHERE ur.user_id = _user_id
      AND (ur.organization_id IS NULL OR ur.organization_id = v_org)
  ) THEN
    RETURN true;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.user_roles ur
    JOIN public.role_permission_defaults rd
      ON rd.role = ur.role
     AND rd.module = v_role_module
     AND rd.action = _action
     AND rd.allowed = true
    LEFT JOIN public.role_permission_overrides ro
      ON ro.role = ur.role
     AND ro.organization_id = v_org
     AND ro.module = v_role_module
     AND ro.action = _action
    WHERE ur.user_id = _user_id
      AND (ur.organization_id IS NULL OR ur.organization_id = v_org)
      AND (ro.allowed IS NULL OR ro.allowed = true)
  ) THEN
    RETURN true;
  END IF;

  RETURN false;
END
$fn$;

-- 2. Read scoping: clerk-scope users only see their own expenses
DROP POLICY IF EXISTS opex_select_org ON public.operating_expenses;
CREATE POLICY opex_select_org ON public.operating_expenses
FOR SELECT TO authenticated
USING (
  is_platform_admin()
  OR (
    organization_id = current_org_id()
    AND (
      has_role(auth.uid(),'admin'::app_role)
      OR has_role(auth.uid(),'org_owner'::app_role)
      OR has_permission(auth.uid(),'accounting','view'::app_action)
      OR created_by = auth.uid()
    )
  )
);

DROP POLICY IF EXISTS opex_lines_select_org ON public.operating_expense_lines;
CREATE POLICY opex_lines_select_org ON public.operating_expense_lines
FOR SELECT TO authenticated
USING (
  is_platform_admin()
  OR (
    organization_id = current_org_id()
    AND EXISTS (SELECT 1 FROM public.operating_expenses e WHERE e.id = expense_id)
  )
);

-- 3. Attachments: allow the narrow scope to upload receipts
DROP POLICY IF EXISTS opex_attachments_insert ON public.operating_expense_attachments;
CREATE POLICY opex_attachments_insert ON public.operating_expense_attachments
FOR INSERT TO authenticated
WITH CHECK (
  organization_id = current_org_id()
  AND uploaded_by = auth.uid()
  AND (
    has_role(auth.uid(),'admin'::app_role)
    OR has_role(auth.uid(),'org_owner'::app_role)
    OR has_permission(auth.uid(),'accounting','create'::app_action)
    OR has_permission(auth.uid(),'accounting','edit'::app_action)
    OR has_permission(auth.uid(),'opex_entry','create'::app_action)
  )
);

-- 4. Allow the narrow scope to record expenses, always as submitted-for-approval
CREATE OR REPLACE FUNCTION public.post_operating_expense(
  _expense_date date,
  _lines jsonb,
  _payment_mode text DEFAULT 'credit',
  _supplier_id uuid DEFAULT NULL,
  _payee text DEFAULT NULL,
  _financial_account_id uuid DEFAULT NULL,
  _due_date date DEFAULT NULL,
  _currency text DEFAULT NULL,
  _fx_rate numeric DEFAULT NULL,
  _depot_id uuid DEFAULT NULL,
  _project_id uuid DEFAULT NULL,
  _reference text DEFAULT NULL,
  _notes text DEFAULT NULL,
  _attachment_url text DEFAULT NULL,
  _submit boolean DEFAULT false
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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
    v_submit := true; -- clerk entries always go for approval
  END IF;

  IF _payment_mode NOT IN ('paid','credit') THEN
    RAISE EXCEPTION 'payment_mode must be paid or credit';
  END IF;
  IF jsonb_typeof(_lines) <> 'array' OR jsonb_array_length(_lines) = 0 THEN
    RAISE EXCEPTION 'At least one expense line is required';
  END IF;

  PERFORM public._opex_assert_period_open(v_org, _expense_date);

  SELECT COALESCE(_currency, o.currency, 'USD') INTO v_currency
    FROM public.organizations o WHERE o.id = v_org;

  IF _payment_mode = 'paid' AND _financial_account_id IS NULL THEN
    RAISE EXCEPTION 'Select the bank or cash account the expense was paid from';
  END IF;

  v_number := public.next_operating_expense_number();

  INSERT INTO public.operating_expenses (
    id, organization_id, expense_number, expense_date, supplier_id, payee, payment_mode,
    financial_account_id, due_date, currency, fx_rate, depot_id, project_id, reference,
    notes, attachment_url, status, approval_status, created_by,
    submitted_by, submitted_at
  ) VALUES (
    v_id, v_org, v_number, _expense_date, _supplier_id, _payee, _payment_mode,
    CASE WHEN _payment_mode = 'paid' THEN _financial_account_id ELSE NULL END,
    CASE WHEN _payment_mode = 'credit' THEN _due_date ELSE NULL END,
    v_currency, COALESCE(_fx_rate,1), _depot_id, _project_id, _reference,
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
      tax_amount, project_id, depot_id
    ) VALUES (
      v_org, v_id, v_acct.id, NULLIF(line->>'category_id','')::uuid,
      line->>'description', (line->>'amount')::numeric,
      NULLIF(line->>'tax_code_id','')::uuid, v_line_tax,
      COALESCE(NULLIF(line->>'project_id','')::uuid, _project_id),
      COALESCE(NULLIF(line->>'depot_id','')::uuid, _depot_id)
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
          jsonb_build_object('total', v_subtotal + v_tax, 'mode', _payment_mode, 'currency', v_currency));

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

REVOKE ALL ON FUNCTION public.post_operating_expense(date,jsonb,text,uuid,text,uuid,date,text,numeric,uuid,uuid,text,text,text,boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.post_operating_expense(date,jsonb,text,uuid,text,uuid,date,text,numeric,uuid,uuid,text,text,text,boolean) TO authenticated;