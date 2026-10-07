
-- 1. Approval status enum
DO $$ BEGIN
  CREATE TYPE public.approval_doc_status AS ENUM ('not_required','pending','approved','rejected');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 2. Profiles: assigned manager + per-doc-type limits
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS manager_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS approval_limits jsonb NOT NULL DEFAULT '{}'::jsonb;

-- 3. Approval policies table
CREATE TABLE IF NOT EXISTS public.approval_policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  document_type text NOT NULL,
  min_amount numeric NOT NULL DEFAULT 0,
  required_role text NOT NULL DEFAULT 'admin',
  limited_roles text[] NOT NULL DEFAULT ARRAY['viewer','gate_clerk','yard_operator']::text[],
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, document_type)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.approval_policies TO authenticated;
GRANT ALL ON public.approval_policies TO service_role;
ALTER TABLE public.approval_policies ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Org members read approval policies" ON public.approval_policies
  FOR SELECT TO authenticated USING (organization_id = current_org_id() OR is_platform_admin());
CREATE POLICY "Admins manage approval policies" ON public.approval_policies
  FOR ALL TO authenticated
  USING ((organization_id = current_org_id() AND has_role(auth.uid(),'admin'::app_role)) OR is_platform_admin())
  WITH CHECK ((organization_id = current_org_id() AND has_role(auth.uid(),'admin'::app_role)) OR is_platform_admin());

CREATE TRIGGER trg_approval_policies_updated_at BEFORE UPDATE ON public.approval_policies
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 4. Extend approval_requests with assignee for routing to managers
ALTER TABLE public.approval_requests
  ADD COLUMN IF NOT EXISTS assigned_to uuid REFERENCES auth.users(id) ON DELETE SET NULL;

-- 5. Add approval columns to target tables
ALTER TABLE public.quotes
  ADD COLUMN IF NOT EXISTS approval_status approval_doc_status NOT NULL DEFAULT 'not_required',
  ADD COLUMN IF NOT EXISTS approval_request_id uuid REFERENCES public.approval_requests(id) ON DELETE SET NULL;

ALTER TABLE public.purchase_orders
  ADD COLUMN IF NOT EXISTS approval_status approval_doc_status NOT NULL DEFAULT 'not_required',
  ADD COLUMN IF NOT EXISTS approval_request_id uuid REFERENCES public.approval_requests(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS approved_by uuid,
  ADD COLUMN IF NOT EXISTS approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS rejection_reason text;

ALTER TABLE public.eir_records
  ADD COLUMN IF NOT EXISTS approval_status approval_doc_status NOT NULL DEFAULT 'not_required',
  ADD COLUMN IF NOT EXISTS approval_request_id uuid REFERENCES public.approval_requests(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS approved_by uuid,
  ADD COLUMN IF NOT EXISTS approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS rejection_reason text,
  ADD COLUMN IF NOT EXISTS created_by uuid;

ALTER TABLE public.repatriations
  ADD COLUMN IF NOT EXISTS approval_status approval_doc_status NOT NULL DEFAULT 'not_required',
  ADD COLUMN IF NOT EXISTS approval_request_id uuid REFERENCES public.approval_requests(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS rejection_reason text;

ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS approval_status approval_doc_status NOT NULL DEFAULT 'not_required',
  ADD COLUMN IF NOT EXISTS approval_request_id uuid REFERENCES public.approval_requests(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS approved_by uuid,
  ADD COLUMN IF NOT EXISTS approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS rejection_reason text,
  ADD COLUMN IF NOT EXISTS created_by uuid;

ALTER TABLE public.vendor_payments
  ADD COLUMN IF NOT EXISTS approval_status approval_doc_status NOT NULL DEFAULT 'not_required',
  ADD COLUMN IF NOT EXISTS approval_request_id uuid REFERENCES public.approval_requests(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS approved_by uuid,
  ADD COLUMN IF NOT EXISTS approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS rejection_reason text,
  ADD COLUMN IF NOT EXISTS created_by uuid;

-- 6. Helper: evaluate whether approval is required + who approves
CREATE OR REPLACE FUNCTION public.evaluate_approval_required(
  _doc_type text,
  _org_id uuid,
  _amount numeric,
  _created_by uuid
) RETURNS TABLE(required boolean, assignee uuid)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  pol public.approval_policies%ROWTYPE;
  creator_roles text[];
  is_limited boolean := false;
  mgr uuid;
BEGIN
  IF _created_by IS NULL THEN
    RETURN QUERY SELECT false, NULL::uuid; RETURN;
  END IF;

  -- Admins always bypass
  IF has_role(_created_by,'admin'::app_role) THEN
    RETURN QUERY SELECT false, NULL::uuid; RETURN;
  END IF;

  SELECT * INTO pol FROM public.approval_policies
    WHERE organization_id = _org_id AND document_type = _doc_type AND enabled = true;
  IF NOT FOUND THEN
    RETURN QUERY SELECT false, NULL::uuid; RETURN;
  END IF;

  SELECT array_agg(role::text) INTO creator_roles FROM public.user_roles WHERE user_id = _created_by;
  IF creator_roles IS NOT NULL AND creator_roles && pol.limited_roles THEN
    is_limited := true;
  END IF;

  IF NOT is_limited AND COALESCE(_amount,0) < COALESCE(pol.min_amount,0) THEN
    RETURN QUERY SELECT false, NULL::uuid; RETURN;
  END IF;

  -- Routing: assigned manager first
  SELECT manager_id INTO mgr FROM public.profiles WHERE id = _created_by;
  RETURN QUERY SELECT true, mgr;
END $$;
GRANT EXECUTE ON FUNCTION public.evaluate_approval_required(text,uuid,numeric,uuid) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.evaluate_approval_required(text,uuid,numeric,uuid) FROM anon;

-- 7. Generic trigger that flags pending + creates approval_requests row
CREATE OR REPLACE FUNCTION public.flag_document_for_approval()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  doc_type text := TG_ARGV[0];
  amount_col text := TG_ARGV[1];
  amt numeric;
  creator uuid;
  org uuid;
  eval RECORD;
  req_id uuid;
BEGIN
  EXECUTE format('SELECT ($1).%I, ($1).%I, ($1).%I', 'created_by','organization_id', amount_col)
    INTO creator, org, amt USING NEW;

  SELECT * INTO eval FROM evaluate_approval_required(doc_type, org, amt, creator);
  IF NOT eval.required THEN
    NEW.approval_status := 'not_required';
    RETURN NEW;
  END IF;

  INSERT INTO public.approval_requests(organization_id, doc_type, doc_id, status, requested_by, assigned_to, amount)
    VALUES (org, doc_type, NEW.id, 'pending', creator, eval.assignee, amt)
    RETURNING id INTO req_id;

  NEW.approval_status := 'pending';
  NEW.approval_request_id := req_id;
  RETURN NEW;
END $$;

-- Attach triggers
DROP TRIGGER IF EXISTS trg_quotes_approval ON public.quotes;
CREATE TRIGGER trg_quotes_approval BEFORE INSERT ON public.quotes
  FOR EACH ROW EXECUTE FUNCTION public.flag_document_for_approval('quote','total_amount');

DROP TRIGGER IF EXISTS trg_po_approval ON public.purchase_orders;
CREATE TRIGGER trg_po_approval BEFORE INSERT ON public.purchase_orders
  FOR EACH ROW EXECUTE FUNCTION public.flag_document_for_approval('purchase_order','total_cost');

DROP TRIGGER IF EXISTS trg_payments_approval ON public.payments;
CREATE TRIGGER trg_payments_approval BEFORE INSERT ON public.payments
  FOR EACH ROW EXECUTE FUNCTION public.flag_document_for_approval('payment','amount');

DROP TRIGGER IF EXISTS trg_vendor_payments_approval ON public.vendor_payments;
CREATE TRIGGER trg_vendor_payments_approval BEFORE INSERT ON public.vendor_payments
  FOR EACH ROW EXECUTE FUNCTION public.flag_document_for_approval('vendor_payment','amount');

DROP TRIGGER IF EXISTS trg_repat_approval ON public.repatriations;
CREATE TRIGGER trg_repat_approval BEFORE INSERT ON public.repatriations
  FOR EACH ROW EXECUTE FUNCTION public.flag_document_for_approval('repatriation','charge_amount');

DROP TRIGGER IF EXISTS trg_eir_approval ON public.eir_records;
CREATE TRIGGER trg_eir_approval BEFORE INSERT ON public.eir_records
  FOR EACH ROW EXECUTE FUNCTION public.flag_document_for_approval('eir','gate_fee_amount');

-- 8. Decision RPC
CREATE OR REPLACE FUNCTION public.decide_approval_request(
  _request_id uuid,
  _decision text,
  _notes text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  req public.approval_requests%ROWTYPE;
  uid uuid := auth.uid();
  new_status approval_doc_status;
  sql text;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF _decision NOT IN ('approved','rejected') THEN
    RAISE EXCEPTION 'Invalid decision'; END IF;

  SELECT * INTO req FROM public.approval_requests WHERE id = _request_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Approval request not found'; END IF;
  IF req.status <> 'pending' THEN RAISE EXCEPTION 'Already decided'; END IF;

  IF NOT (has_role(uid,'admin'::app_role) OR req.assigned_to = uid) THEN
    RAISE EXCEPTION 'Not authorized to decide this request';
  END IF;

  new_status := CASE WHEN _decision='approved' THEN 'approved'::approval_doc_status
                     ELSE 'rejected'::approval_doc_status END;

  UPDATE public.approval_requests
     SET status = _decision, decided_by = uid, decided_at = now(), decision_note = _notes,
         updated_at = now()
   WHERE id = _request_id;

  -- Update source document by doc_type
  sql := CASE req.doc_type
    WHEN 'quote'           THEN 'UPDATE public.quotes SET approval_status=$1, approved_by=CASE WHEN $1=''approved'' THEN $2 ELSE approved_by END, approved_at=CASE WHEN $1=''approved'' THEN now() ELSE approved_at END, rejection_reason=CASE WHEN $1=''rejected'' THEN $3 ELSE rejection_reason END WHERE id=$4'
    WHEN 'purchase_order'  THEN 'UPDATE public.purchase_orders SET approval_status=$1, approved_by=CASE WHEN $1=''approved'' THEN $2 ELSE approved_by END, approved_at=CASE WHEN $1=''approved'' THEN now() ELSE approved_at END, rejection_reason=CASE WHEN $1=''rejected'' THEN $3 ELSE rejection_reason END WHERE id=$4'
    WHEN 'payment'         THEN 'UPDATE public.payments SET approval_status=$1, approved_by=CASE WHEN $1=''approved'' THEN $2 ELSE approved_by END, approved_at=CASE WHEN $1=''approved'' THEN now() ELSE approved_at END, rejection_reason=CASE WHEN $1=''rejected'' THEN $3 ELSE rejection_reason END WHERE id=$4'
    WHEN 'vendor_payment'  THEN 'UPDATE public.vendor_payments SET approval_status=$1, approved_by=CASE WHEN $1=''approved'' THEN $2 ELSE approved_by END, approved_at=CASE WHEN $1=''approved'' THEN now() ELSE approved_at END, rejection_reason=CASE WHEN $1=''rejected'' THEN $3 ELSE rejection_reason END WHERE id=$4'
    WHEN 'repatriation'    THEN 'UPDATE public.repatriations SET approval_status=$1, approved_at=CASE WHEN $1=''approved'' THEN now() ELSE approved_at END, approved_by=CASE WHEN $1=''approved'' THEN $2 ELSE approved_by END, rejection_reason=CASE WHEN $1=''rejected'' THEN $3 ELSE rejection_reason END WHERE id=$4'
    WHEN 'eir'             THEN 'UPDATE public.eir_records SET approval_status=$1, approved_by=CASE WHEN $1=''approved'' THEN $2 ELSE approved_by END, approved_at=CASE WHEN $1=''approved'' THEN now() ELSE approved_at END, rejection_reason=CASE WHEN $1=''rejected'' THEN $3 ELSE rejection_reason END WHERE id=$4'
    ELSE NULL END;

  IF sql IS NOT NULL THEN
    EXECUTE sql USING new_status::text, uid, _notes, req.doc_id;
  END IF;

  RETURN jsonb_build_object('ok',true,'status',new_status);
END $$;
GRANT EXECUTE ON FUNCTION public.decide_approval_request(uuid,text,text) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.decide_approval_request(uuid,text,text) FROM anon;

-- 9. Seed default policies for all organizations
INSERT INTO public.approval_policies(organization_id, document_type, min_amount, required_role, limited_roles)
SELECT o.id, dt.doc_type, dt.min_amount, 'admin', ARRAY['viewer','gate_clerk','yard_operator']::text[]
FROM public.organizations o
CROSS JOIN (VALUES
  ('quote', 500000),
  ('purchase_order', 200000),
  ('payment', 100000),
  ('vendor_payment', 100000),
  ('repatriation', 0),
  ('eir', 0)
) AS dt(doc_type, min_amount)
ON CONFLICT (organization_id, document_type) DO NOTHING;
