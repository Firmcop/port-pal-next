-- ============ 1. EXPENSE CATEGORIES ============
CREATE TABLE IF NOT EXISTS public.expense_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  code text,
  name text NOT NULL,
  gl_account_id uuid NOT NULL REFERENCES public.gl_accounts(id) ON DELETE RESTRICT,
  tax_code_id uuid REFERENCES public.tax_codes(id) ON DELETE SET NULL,
  depot_id uuid REFERENCES public.depots(id) ON DELETE SET NULL,
  project_id uuid REFERENCES public.projects(id) ON DELETE SET NULL,
  is_capitalisable boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 100,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS expense_categories_org_name_key
  ON public.expense_categories (organization_id, lower(name));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.expense_categories TO authenticated;
GRANT ALL ON public.expense_categories TO service_role;
ALTER TABLE public.expense_categories ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS expense_categories_select ON public.expense_categories;
CREATE POLICY expense_categories_select ON public.expense_categories
  FOR SELECT TO authenticated
  USING (organization_id = public.current_org_id() OR public.is_platform_admin());

DROP POLICY IF EXISTS expense_categories_write ON public.expense_categories;
CREATE POLICY expense_categories_write ON public.expense_categories
  FOR ALL TO authenticated
  USING (
    (organization_id = public.current_org_id()
      AND (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'org_owner')
           OR public.has_permission(auth.uid(),'accounting','edit')))
    OR public.is_platform_admin()
  )
  WITH CHECK (
    (organization_id = public.current_org_id()
      AND (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'org_owner')
           OR public.has_permission(auth.uid(),'accounting','edit')))
    OR public.is_platform_admin()
  );

DROP TRIGGER IF EXISTS trg_expense_categories_updated ON public.expense_categories;
CREATE TRIGGER trg_expense_categories_updated BEFORE UPDATE ON public.expense_categories
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE OR REPLACE FUNCTION public.ensure_default_expense_categories(_org_id uuid)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_count integer := 0;
BEGIN
  IF _org_id IS NULL THEN RETURN 0; END IF;
  IF NOT (public.is_platform_admin() OR _org_id = public.current_org_id()) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  INSERT INTO public.expense_categories (organization_id, code, name, gl_account_id, sort_order)
  SELECT _org_id, a.code, a.name, a.id, 100
    FROM public.gl_accounts a
   WHERE a.organization_id = _org_id
     AND a.is_active
     AND a.account_type::text IN ('expense','cost_of_goods')
     AND NOT EXISTS (
       SELECT 1 FROM public.expense_categories c
        WHERE c.organization_id = _org_id AND lower(c.name) = lower(a.name)
     );
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;
REVOKE ALL ON FUNCTION public.ensure_default_expense_categories(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ensure_default_expense_categories(uuid) TO authenticated;

ALTER TABLE public.operating_expense_lines
  ADD COLUMN IF NOT EXISTS category_id uuid REFERENCES public.expense_categories(id) ON DELETE SET NULL;

-- ============ 2. APPROVAL WORKFLOW COLUMNS ============
ALTER TABLE public.operating_expenses
  ADD COLUMN IF NOT EXISTS approval_status text NOT NULL DEFAULT 'draft',
  ADD COLUMN IF NOT EXISTS submitted_by uuid,
  ADD COLUMN IF NOT EXISTS submitted_at timestamptz,
  ADD COLUMN IF NOT EXISTS approved_by uuid,
  ADD COLUMN IF NOT EXISTS approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS rejected_by uuid,
  ADD COLUMN IF NOT EXISTS rejected_at timestamptz,
  ADD COLUMN IF NOT EXISTS rejection_reason text,
  ADD COLUMN IF NOT EXISTS posted_at timestamptz;

UPDATE public.operating_expenses
   SET approval_status = 'approved',
       approved_at = COALESCE(approved_at, created_at),
       posted_at = COALESCE(posted_at, created_at)
 WHERE journal_id IS NOT NULL AND approval_status = 'draft';

DO $$ BEGIN
  ALTER TABLE public.operating_expenses
    ADD CONSTRAINT operating_expenses_approval_status_chk
    CHECK (approval_status IN ('draft','submitted','approved','rejected'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============ 3. ATTACHMENTS ============
CREATE TABLE IF NOT EXISTS public.operating_expense_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  expense_id uuid NOT NULL REFERENCES public.operating_expenses(id) ON DELETE CASCADE,
  storage_path text NOT NULL,
  file_name text NOT NULL,
  file_size bigint,
  mime_type text,
  label text NOT NULL DEFAULT 'receipt',
  uploaded_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS opex_attachments_expense_idx ON public.operating_expense_attachments (expense_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.operating_expense_attachments TO authenticated;
GRANT ALL ON public.operating_expense_attachments TO service_role;
ALTER TABLE public.operating_expense_attachments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS opex_attachments_select ON public.operating_expense_attachments;
CREATE POLICY opex_attachments_select ON public.operating_expense_attachments
  FOR SELECT TO authenticated
  USING (organization_id = public.current_org_id() OR public.is_platform_admin());

DROP POLICY IF EXISTS opex_attachments_insert ON public.operating_expense_attachments;
CREATE POLICY opex_attachments_insert ON public.operating_expense_attachments
  FOR INSERT TO authenticated
  WITH CHECK (
    organization_id = public.current_org_id()
    AND uploaded_by = auth.uid()
    AND (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'org_owner')
         OR public.has_permission(auth.uid(),'accounting','create')
         OR public.has_permission(auth.uid(),'accounting','edit'))
  );

DROP POLICY IF EXISTS opex_attachments_delete ON public.operating_expense_attachments;
CREATE POLICY opex_attachments_delete ON public.operating_expense_attachments
  FOR DELETE TO authenticated
  USING (
    organization_id = public.current_org_id()
    AND (uploaded_by = auth.uid()
         OR public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'org_owner'))
  );

INSERT INTO public.operating_expense_attachments (organization_id, expense_id, storage_path, file_name, label, uploaded_by, created_at)
SELECT e.organization_id, e.id, e.attachment_url,
       regexp_replace(e.attachment_url, '^.*/', ''), 'receipt', e.created_by, e.created_at
  FROM public.operating_expenses e
 WHERE e.attachment_url IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM public.operating_expense_attachments a WHERE a.expense_id = e.id);

-- ============ 4. POSTING / APPROVAL FUNCTIONS ============
CREATE OR REPLACE FUNCTION public._opex_post_journal(_expense_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  e public.operating_expenses%ROWTYPE;
  v_journal uuid := gen_random_uuid();
  v_seq int := 0;
  v_tax numeric := 0;
  v_total numeric := 0;
  v_credit public.gl_accounts%ROWTYPE;
  v_vat public.gl_accounts%ROWTYPE;
  ln record;
BEGIN
  SELECT * INTO e FROM public.operating_expenses WHERE id = _expense_id;
  IF e.id IS NULL THEN RAISE EXCEPTION 'Expense not found'; END IF;
  IF e.journal_id IS NOT NULL THEN RETURN; END IF;

  PERFORM public._opex_assert_period_open(e.organization_id, e.expense_date);

  IF e.payment_mode = 'paid' THEN
    SELECT * INTO v_credit FROM public.gl_accounts
      WHERE organization_id = e.organization_id AND system_code IN ('bank','cash') AND is_active
      ORDER BY CASE system_code WHEN 'bank' THEN 0 ELSE 1 END LIMIT 1;
    IF v_credit.id IS NULL THEN RAISE EXCEPTION 'No bank/cash GL account configured'; END IF;
  ELSE
    SELECT * INTO v_credit FROM public.gl_accounts
      WHERE organization_id = e.organization_id AND system_code = 'ap' AND is_active LIMIT 1;
    IF v_credit.id IS NULL THEN RAISE EXCEPTION 'No accounts payable GL account configured'; END IF;
  END IF;

  SELECT * INTO v_vat FROM public.gl_accounts
    WHERE organization_id = e.organization_id AND system_code = 'vat_input' AND is_active LIMIT 1;

  FOR ln IN
    SELECT l.*, a.account_type, a.system_code
      FROM public.operating_expense_lines l
      JOIN public.gl_accounts a ON a.id = l.gl_account_id
     WHERE l.expense_id = e.id
     ORDER BY l.created_at
  LOOP
    v_seq := v_seq + 1;
    INSERT INTO public.accounting_transactions (
      transaction_number, transaction_date, account_type, category, description,
      debit_amount, credit_amount, reference_type, reference_id, organization_id,
      financial_account_id, project_id, depot_id, gl_account_id, journal_id, currency, fx_rate
    ) VALUES (
      e.expense_number || '-' || v_seq, e.expense_date, ln.account_type,
      COALESCE(ln.system_code,'operating_expense'),
      COALESCE(ln.description, 'Operating expense ' || e.expense_number),
      ln.amount, 0, 'operating_expense', e.id, e.organization_id,
      e.financial_account_id, COALESCE(ln.project_id, e.project_id),
      COALESCE(ln.depot_id, e.depot_id), ln.gl_account_id, v_journal,
      e.currency, COALESCE(e.fx_rate,1)
    );
    v_tax := v_tax + COALESCE(ln.tax_amount,0);
  END LOOP;

  IF v_seq = 0 THEN RAISE EXCEPTION 'Expense has no lines'; END IF;

  IF v_tax > 0 THEN
    IF v_vat.id IS NULL THEN RAISE EXCEPTION 'No VAT input GL account configured'; END IF;
    v_seq := v_seq + 1;
    INSERT INTO public.accounting_transactions (
      transaction_number, transaction_date, account_type, category, description,
      debit_amount, credit_amount, reference_type, reference_id, organization_id,
      financial_account_id, project_id, depot_id, gl_account_id, journal_id, currency, fx_rate
    ) VALUES (
      e.expense_number || '-' || v_seq, e.expense_date, v_vat.account_type,
      'vat_input', 'Input VAT on ' || e.expense_number, v_tax, 0, 'operating_expense', e.id,
      e.organization_id, e.financial_account_id, e.project_id, e.depot_id, v_vat.id, v_journal,
      e.currency, COALESCE(e.fx_rate,1)
    );
  END IF;

  v_total := COALESCE(e.subtotal,0) + v_tax;
  v_seq := v_seq + 1;
  INSERT INTO public.accounting_transactions (
    transaction_number, transaction_date, account_type, category, description,
    debit_amount, credit_amount, reference_type, reference_id, organization_id,
    financial_account_id, project_id, depot_id, gl_account_id, journal_id, currency, fx_rate
  ) VALUES (
    e.expense_number || '-' || v_seq, e.expense_date, v_credit.account_type,
    CASE WHEN e.payment_mode = 'paid' THEN 'cash_out' ELSE 'ap' END,
    'Operating expense ' || e.expense_number || COALESCE(' - ' || e.payee, ''),
    0, v_total, 'operating_expense', e.id, e.organization_id, e.financial_account_id,
    e.project_id, e.depot_id, v_credit.id, v_journal, e.currency, COALESCE(e.fx_rate,1)
  );

  UPDATE public.operating_expenses
     SET journal_id = v_journal,
         tax_amount = v_tax,
         total_amount = v_total,
         amount_paid = CASE WHEN payment_mode = 'paid' THEN v_total ELSE 0 END,
         status = CASE WHEN payment_mode = 'paid' THEN 'paid' ELSE 'unpaid' END,
         posted_at = now()
   WHERE id = e.id;
END;
$$;
REVOKE ALL ON FUNCTION public._opex_post_journal(uuid) FROM PUBLIC, anon;

DROP FUNCTION IF EXISTS public.post_operating_expense(date,text,jsonb,uuid,text,uuid,date,text,numeric,uuid,uuid,text,text,text);

CREATE OR REPLACE FUNCTION public.post_operating_expense(
  _expense_date date,
  _payment_mode text,
  _lines jsonb,
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
  _submit boolean DEFAULT true
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
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
BEGIN
  IF v_org IS NULL THEN RAISE EXCEPTION 'No organization context'; END IF;
  IF NOT (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'org_owner')
          OR public.is_platform_admin()
          OR public.has_permission(auth.uid(),'accounting','create')) THEN
    RAISE EXCEPTION 'Not authorized to record expenses';
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
    CASE WHEN _submit THEN 'submitted' ELSE 'draft' END, auth.uid(),
    CASE WHEN _submit THEN auth.uid() ELSE NULL END,
    CASE WHEN _submit THEN now() ELSE NULL END
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
          CASE WHEN _submit THEN 'submitted' ELSE 'created' END,
          jsonb_build_object('total', v_subtotal + v_tax, 'mode', _payment_mode, 'currency', v_currency));

  IF _submit THEN
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
END;
$$;
REVOKE ALL ON FUNCTION public.post_operating_expense(date,text,jsonb,uuid,text,uuid,date,text,numeric,uuid,uuid,text,text,text,boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.post_operating_expense(date,text,jsonb,uuid,text,uuid,date,text,numeric,uuid,uuid,text,text,text,boolean) TO authenticated;

CREATE OR REPLACE FUNCTION public.submit_operating_expense(_expense_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE e public.operating_expenses%ROWTYPE;
BEGIN
  SELECT * INTO e FROM public.operating_expenses WHERE id = _expense_id;
  IF e.id IS NULL OR e.organization_id <> public.current_org_id() THEN
    RAISE EXCEPTION 'Expense not found';
  END IF;
  IF e.approval_status NOT IN ('draft','rejected') THEN
    RAISE EXCEPTION 'Only draft or rejected expenses can be submitted';
  END IF;
  IF NOT (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'org_owner')
          OR public.is_platform_admin()
          OR public.has_permission(auth.uid(),'accounting','create')) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  UPDATE public.operating_expenses
     SET approval_status = 'submitted', submitted_by = auth.uid(), submitted_at = now(),
         rejected_by = NULL, rejected_at = NULL, rejection_reason = NULL
   WHERE id = _expense_id;

  INSERT INTO public.finance_audit_log (organization_id, actor_user_id, entity_type, entity_id, entity_ref, action, summary)
  VALUES (e.organization_id, auth.uid(), 'operating_expense', e.id, e.expense_number, 'submitted',
          jsonb_build_object('total', e.total_amount));
END;
$$;
REVOKE ALL ON FUNCTION public.submit_operating_expense(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_operating_expense(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.approve_operating_expense(_expense_id uuid, _note text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE e public.operating_expenses%ROWTYPE;
BEGIN
  SELECT * INTO e FROM public.operating_expenses WHERE id = _expense_id;
  IF e.id IS NULL OR e.organization_id <> public.current_org_id() THEN
    RAISE EXCEPTION 'Expense not found';
  END IF;
  IF e.approval_status = 'approved' THEN RETURN; END IF;
  IF e.approval_status <> 'submitted' THEN
    RAISE EXCEPTION 'Only submitted expenses can be approved';
  END IF;
  IF NOT (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'org_owner')
          OR public.is_platform_admin()
          OR public.has_permission(auth.uid(),'accounting','approve')) THEN
    RAISE EXCEPTION 'Not authorized to approve expenses';
  END IF;

  UPDATE public.operating_expenses
     SET approval_status = 'approved', approved_by = auth.uid(), approved_at = now()
   WHERE id = _expense_id;

  PERFORM public._opex_post_journal(_expense_id);

  INSERT INTO public.finance_audit_log (organization_id, actor_user_id, entity_type, entity_id, entity_ref, action, summary)
  VALUES (e.organization_id, auth.uid(), 'operating_expense', e.id, e.expense_number, 'approved',
          jsonb_build_object('total', e.total_amount, 'note', _note));
END;
$$;
REVOKE ALL ON FUNCTION public.approve_operating_expense(uuid,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.approve_operating_expense(uuid,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.reject_operating_expense(_expense_id uuid, _reason text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE e public.operating_expenses%ROWTYPE;
BEGIN
  IF COALESCE(btrim(_reason),'') = '' THEN RAISE EXCEPTION 'A rejection reason is required'; END IF;
  SELECT * INTO e FROM public.operating_expenses WHERE id = _expense_id;
  IF e.id IS NULL OR e.organization_id <> public.current_org_id() THEN
    RAISE EXCEPTION 'Expense not found';
  END IF;
  IF e.approval_status <> 'submitted' THEN
    RAISE EXCEPTION 'Only submitted expenses can be rejected';
  END IF;
  IF NOT (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'org_owner')
          OR public.is_platform_admin()
          OR public.has_permission(auth.uid(),'accounting','approve')) THEN
    RAISE EXCEPTION 'Not authorized to reject expenses';
  END IF;

  UPDATE public.operating_expenses
     SET approval_status = 'rejected', rejected_by = auth.uid(), rejected_at = now(),
         rejection_reason = _reason
   WHERE id = _expense_id;

  INSERT INTO public.finance_audit_log (organization_id, actor_user_id, entity_type, entity_id, entity_ref, action, summary)
  VALUES (e.organization_id, auth.uid(), 'operating_expense', e.id, e.expense_number, 'rejected',
          jsonb_build_object('reason', _reason));
END;
$$;
REVOKE ALL ON FUNCTION public.reject_operating_expense(uuid,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reject_operating_expense(uuid,text) TO authenticated;

-- default approval policy row for operating expenses
INSERT INTO public.approval_policies (organization_id, document_type, min_amount, required_role, enabled)
SELECT o.id, 'operating_expense', 0, 'admin', true
  FROM public.organizations o
 WHERE NOT EXISTS (
   SELECT 1 FROM public.approval_policies p
    WHERE p.organization_id = o.id AND p.document_type = 'operating_expense'
 );

-- ============ 5. DRILL-DOWN VIEW ============
CREATE OR REPLACE VIEW public.v_expense_journal_lines
WITH (security_invoker = true) AS
SELECT
  t.id,
  t.organization_id,
  t.transaction_date,
  t.transaction_number,
  t.description,
  t.debit_amount,
  t.credit_amount,
  t.currency,
  t.gl_account_id,
  a.code   AS account_code,
  a.name   AS account_name,
  a.account_type,
  t.reference_type,
  t.reference_id,
  t.journal_id,
  t.depot_id,
  t.project_id,
  e.expense_number,
  e.payee,
  e.approval_status,
  s.name   AS supplier_name
FROM public.accounting_transactions t
JOIN public.gl_accounts a ON a.id = t.gl_account_id
LEFT JOIN public.operating_expenses e
       ON t.reference_type = 'operating_expense' AND e.id = t.reference_id
LEFT JOIN public.suppliers s ON s.id = e.supplier_id;

GRANT SELECT ON public.v_expense_journal_lines TO authenticated;