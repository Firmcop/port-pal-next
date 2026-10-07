
-- 1. Flag on fixed_assets
ALTER TABLE public.fixed_assets
  ADD COLUMN IF NOT EXISTS is_issuable boolean NOT NULL DEFAULT false;

-- 2. Enums
DO $$ BEGIN
  CREATE TYPE public.asset_issue_condition AS ENUM ('new','good','fair','poor');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.asset_issue_status AS ENUM ('open','returned','damaged','lost','written_off');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 3. Table
CREATE TABLE IF NOT EXISTS public.asset_issues (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL DEFAULT public.current_org_id(),
  asset_id uuid NOT NULL REFERENCES public.fixed_assets(id) ON DELETE CASCADE,
  depot_id uuid REFERENCES public.depots(id),

  issued_to_employee_id uuid REFERENCES public.employees(id),
  issued_to_name text,
  issued_to_customer_id uuid REFERENCES public.customers(id),

  issued_by_employee_id uuid REFERENCES public.employees(id),
  issued_at timestamptz NOT NULL DEFAULT now(),
  expected_return_at timestamptz,
  purpose text,
  work_order_id uuid REFERENCES public.work_orders(id),

  condition_out public.asset_issue_condition NOT NULL DEFAULT 'good',
  condition_out_notes text,
  photos_out jsonb NOT NULL DEFAULT '[]'::jsonb,

  returned_at timestamptz,
  received_by_employee_id uuid REFERENCES public.employees(id),
  condition_in public.asset_issue_condition,
  condition_in_notes text,
  photos_in jsonb NOT NULL DEFAULT '[]'::jsonb,

  status public.asset_issue_status NOT NULL DEFAULT 'open',
  damage_charge_amount numeric(18,2),
  currency text,
  charge_invoice_id uuid REFERENCES public.invoices(id),
  charge_transaction_id uuid REFERENCES public.accounting_transactions(id),

  notes text,
  created_by uuid REFERENCES auth.users(id) DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- GRANTs
GRANT SELECT, INSERT, UPDATE, DELETE ON public.asset_issues TO authenticated;
GRANT ALL ON public.asset_issues TO service_role;

-- RLS
ALTER TABLE public.asset_issues ENABLE ROW LEVEL SECURITY;

CREATE POLICY "asset_issues_org_read"
  ON public.asset_issues FOR SELECT TO authenticated
  USING (organization_id = public.current_org_id() OR public.is_platform_admin());

CREATE POLICY "asset_issues_org_write"
  ON public.asset_issues FOR ALL TO authenticated
  USING (
    organization_id = public.current_org_id()
    AND (
      public.has_role(auth.uid(), 'admin')
      OR public.has_role(auth.uid(), 'asset_manager')
      OR public.has_role(auth.uid(), 'mr_supervisor')
      OR public.has_role(auth.uid(), 'org_owner')
    )
  )
  WITH CHECK (
    organization_id = public.current_org_id()
    AND (
      public.has_role(auth.uid(), 'admin')
      OR public.has_role(auth.uid(), 'asset_manager')
      OR public.has_role(auth.uid(), 'mr_supervisor')
      OR public.has_role(auth.uid(), 'org_owner')
    )
  );

-- Enforce one open issue per asset
CREATE UNIQUE INDEX IF NOT EXISTS asset_issues_one_open_per_asset
  ON public.asset_issues(asset_id) WHERE status = 'open';

CREATE INDEX IF NOT EXISTS asset_issues_org_status_idx
  ON public.asset_issues(organization_id, status);
CREATE INDEX IF NOT EXISTS asset_issues_employee_idx
  ON public.asset_issues(issued_to_employee_id);

-- Currency auto-fill + updated_at
DROP TRIGGER IF EXISTS trg_asset_issues_currency ON public.asset_issues;
CREATE TRIGGER trg_asset_issues_currency
  BEFORE INSERT ON public.asset_issues
  FOR EACH ROW EXECUTE FUNCTION public.set_currency_from_org();

DROP TRIGGER IF EXISTS trg_asset_issues_updated_at ON public.asset_issues;
CREATE TRIGGER trg_asset_issues_updated_at
  BEFORE UPDATE ON public.asset_issues
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 4. RPCs
CREATE OR REPLACE FUNCTION public.issue_asset(
  p_asset_id uuid,
  p_issued_to_employee_id uuid DEFAULT NULL,
  p_issued_to_name text DEFAULT NULL,
  p_issued_to_customer_id uuid DEFAULT NULL,
  p_expected_return_at timestamptz DEFAULT NULL,
  p_purpose text DEFAULT NULL,
  p_work_order_id uuid DEFAULT NULL,
  p_condition_out public.asset_issue_condition DEFAULT 'good',
  p_condition_out_notes text DEFAULT NULL,
  p_photos_out jsonb DEFAULT '[]'::jsonb
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org uuid := public.current_org_id();
  v_depot uuid;
  v_issuable boolean;
  v_id uuid;
BEGIN
  SELECT depot_id, COALESCE(is_issuable,false) INTO v_depot, v_issuable
  FROM public.fixed_assets
  WHERE id = p_asset_id AND organization_id = v_org;

  IF NOT FOUND THEN RAISE EXCEPTION 'Asset not found in current organization'; END IF;
  IF NOT v_issuable THEN RAISE EXCEPTION 'Asset is not marked as issuable'; END IF;

  IF p_issued_to_employee_id IS NULL AND COALESCE(trim(p_issued_to_name),'') = '' AND p_issued_to_customer_id IS NULL THEN
    RAISE EXCEPTION 'Recipient required';
  END IF;

  INSERT INTO public.asset_issues(
    organization_id, asset_id, depot_id,
    issued_to_employee_id, issued_to_name, issued_to_customer_id,
    expected_return_at, purpose, work_order_id,
    condition_out, condition_out_notes, photos_out
  ) VALUES (
    v_org, p_asset_id, v_depot,
    p_issued_to_employee_id, p_issued_to_name, p_issued_to_customer_id,
    p_expected_return_at, p_purpose, p_work_order_id,
    p_condition_out, p_condition_out_notes, COALESCE(p_photos_out,'[]'::jsonb)
  ) RETURNING id INTO v_id;

  RETURN v_id;
END $$;

REVOKE ALL ON FUNCTION public.issue_asset(uuid,uuid,text,uuid,timestamptz,text,uuid,public.asset_issue_condition,text,jsonb) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.issue_asset(uuid,uuid,text,uuid,timestamptz,text,uuid,public.asset_issue_condition,text,jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.return_asset(
  p_issue_id uuid,
  p_condition_in public.asset_issue_condition,
  p_condition_in_notes text DEFAULT NULL,
  p_photos_in jsonb DEFAULT '[]'::jsonb,
  p_received_by_employee_id uuid DEFAULT NULL,
  p_mark_lost boolean DEFAULT false,
  p_damage_charge numeric DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org uuid := public.current_org_id();
  v_issue public.asset_issues%ROWTYPE;
  v_status public.asset_issue_status;
  v_worse boolean;
  v_order int;
BEGIN
  SELECT * INTO v_issue FROM public.asset_issues
    WHERE id = p_issue_id AND organization_id = v_org FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Issue not found'; END IF;
  IF v_issue.status <> 'open' THEN RAISE EXCEPTION 'Issue already closed'; END IF;

  IF p_mark_lost THEN
    v_status := 'lost';
    UPDATE public.fixed_assets SET condition = 'out_of_service' WHERE id = v_issue.asset_id;
  ELSE
    -- rank conditions
    v_worse := (
      CASE p_condition_in WHEN 'new' THEN 4 WHEN 'good' THEN 3 WHEN 'fair' THEN 2 WHEN 'poor' THEN 1 END
    ) < (
      CASE v_issue.condition_out WHEN 'new' THEN 4 WHEN 'good' THEN 3 WHEN 'fair' THEN 2 WHEN 'poor' THEN 1 END
    );
    v_status := CASE WHEN v_worse AND COALESCE(p_damage_charge,0) > 0 THEN 'damaged'
                     WHEN v_worse THEN 'damaged'
                     ELSE 'returned' END;
  END IF;

  UPDATE public.asset_issues SET
    returned_at = now(),
    received_by_employee_id = p_received_by_employee_id,
    condition_in = p_condition_in,
    condition_in_notes = p_condition_in_notes,
    photos_in = COALESCE(p_photos_in, '[]'::jsonb),
    damage_charge_amount = p_damage_charge,
    status = v_status
  WHERE id = p_issue_id;
END $$;

REVOKE ALL ON FUNCTION public.return_asset(uuid,public.asset_issue_condition,text,jsonb,uuid,boolean,numeric) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.return_asset(uuid,public.asset_issue_condition,text,jsonb,uuid,boolean,numeric) TO authenticated;
