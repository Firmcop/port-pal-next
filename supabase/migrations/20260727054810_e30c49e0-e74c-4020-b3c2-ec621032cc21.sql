-- 1. Depot bank details -------------------------------------------------
CREATE TABLE public.depot_bank_details (
  depot_id uuid PRIMARY KEY REFERENCES public.depots(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  bank_name text,
  bank_account text,
  bank_branch text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.depot_bank_details TO authenticated;
GRANT ALL ON public.depot_bank_details TO service_role;

ALTER TABLE public.depot_bank_details ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Finance roles view depot bank details"
  ON public.depot_bank_details FOR SELECT TO authenticated
  USING (
    is_platform_admin() OR (
      organization_id = current_org_id() AND (
        has_role(auth.uid(), 'admin'::app_role) OR
        has_role(auth.uid(), 'org_owner'::app_role) OR
        has_role(auth.uid(), 'accountant'::app_role)
      )
    )
  );

CREATE POLICY "Finance roles insert depot bank details"
  ON public.depot_bank_details FOR INSERT TO authenticated
  WITH CHECK (
    organization_id = current_org_id() AND (
      has_role(auth.uid(), 'admin'::app_role) OR
      has_role(auth.uid(), 'org_owner'::app_role) OR
      has_role(auth.uid(), 'accountant'::app_role)
    )
  );

CREATE POLICY "Finance roles update depot bank details"
  ON public.depot_bank_details FOR UPDATE TO authenticated
  USING (
    is_platform_admin() OR (
      organization_id = current_org_id() AND (
        has_role(auth.uid(), 'admin'::app_role) OR
        has_role(auth.uid(), 'org_owner'::app_role) OR
        has_role(auth.uid(), 'accountant'::app_role)
      )
    )
  )
  WITH CHECK (
    is_platform_admin() OR (
      organization_id = current_org_id() AND (
        has_role(auth.uid(), 'admin'::app_role) OR
        has_role(auth.uid(), 'org_owner'::app_role) OR
        has_role(auth.uid(), 'accountant'::app_role)
      )
    )
  );

CREATE POLICY "Org admins delete depot bank details"
  ON public.depot_bank_details FOR DELETE TO authenticated
  USING (
    is_platform_admin() OR (
      organization_id = current_org_id() AND (
        has_role(auth.uid(), 'admin'::app_role) OR
        has_role(auth.uid(), 'org_owner'::app_role)
      )
    )
  );

CREATE TRIGGER trg_depot_bank_details_updated
  BEFORE UPDATE ON public.depot_bank_details
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

INSERT INTO public.depot_bank_details (depot_id, organization_id, bank_name, bank_account, bank_branch)
SELECT id, organization_id, bank_name, bank_account, bank_branch
FROM public.depots
WHERE bank_name IS NOT NULL OR bank_account IS NOT NULL OR bank_branch IS NOT NULL;

-- audit trigger no longer tracks bank columns on depots
CREATE OR REPLACE FUNCTION public.trg_audit_depot_changes()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  changed jsonb := '{}'::jsonb;
  k text;
  old_v jsonb;
  new_v jsonb;
  tracked_cols text[] := ARRAY[
    'name','code','location','timezone','currency',
    'address_line1','address_line2','city','country','postal_code',
    'phone','email','website','tax_id','registration_number','logo_url','is_hq'
  ];
BEGIN
  IF TG_OP <> 'UPDATE' THEN RETURN NEW; END IF;
  FOREACH k IN ARRAY tracked_cols LOOP
    EXECUTE format('SELECT to_jsonb($1.%I), to_jsonb($2.%I)', k, k) INTO old_v, new_v USING OLD, NEW;
    IF old_v IS DISTINCT FROM new_v THEN
      changed := changed || jsonb_build_object(k, jsonb_build_object('before', old_v, 'after', new_v));
    END IF;
  END LOOP;

  FOREACH k IN ARRAY ARRAY['gate_rules','scales','equipment'] LOOP
    old_v := coalesce(OLD.config,'{}'::jsonb)->k;
    new_v := coalesce(NEW.config,'{}'::jsonb)->k;
    IF old_v IS DISTINCT FROM new_v THEN
      changed := changed || jsonb_build_object('config.'||k, jsonb_build_object('before', old_v, 'after', new_v));
    END IF;
  END LOOP;

  IF changed <> '{}'::jsonb THEN
    INSERT INTO public.depot_lifecycle_events(depot_id, organization_id, event, actor, payload)
    VALUES (NEW.id, NEW.organization_id, 'profile_updated', auth.uid(),
            jsonb_build_object('changed_fields', changed));
  END IF;
  RETURN NEW;
END $function$;

ALTER TABLE public.depots
  DROP COLUMN bank_name,
  DROP COLUMN bank_account,
  DROP COLUMN bank_branch;

-- 2. Financial account bank details --------------------------------------
CREATE TABLE public.financial_account_bank_details (
  account_id uuid PRIMARY KEY REFERENCES public.financial_accounts(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  bank_name text,
  account_number text,
  branch text,
  swift_bic text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.financial_account_bank_details TO authenticated;
GRANT ALL ON public.financial_account_bank_details TO service_role;

ALTER TABLE public.financial_account_bank_details ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Finance roles view account bank details"
  ON public.financial_account_bank_details FOR SELECT TO authenticated
  USING (
    is_platform_admin() OR (
      organization_id = current_org_id() AND (
        has_role(auth.uid(), 'admin'::app_role) OR
        has_role(auth.uid(), 'org_owner'::app_role) OR
        has_role(auth.uid(), 'accountant'::app_role)
      )
    )
  );

CREATE POLICY "Finance roles insert account bank details"
  ON public.financial_account_bank_details FOR INSERT TO authenticated
  WITH CHECK (
    organization_id = current_org_id() AND (
      has_role(auth.uid(), 'admin'::app_role) OR
      has_role(auth.uid(), 'org_owner'::app_role) OR
      has_role(auth.uid(), 'accountant'::app_role)
    )
  );

CREATE POLICY "Finance roles update account bank details"
  ON public.financial_account_bank_details FOR UPDATE TO authenticated
  USING (
    is_platform_admin() OR (
      organization_id = current_org_id() AND (
        has_role(auth.uid(), 'admin'::app_role) OR
        has_role(auth.uid(), 'org_owner'::app_role) OR
        has_role(auth.uid(), 'accountant'::app_role)
      )
    )
  )
  WITH CHECK (
    is_platform_admin() OR (
      organization_id = current_org_id() AND (
        has_role(auth.uid(), 'admin'::app_role) OR
        has_role(auth.uid(), 'org_owner'::app_role) OR
        has_role(auth.uid(), 'accountant'::app_role)
      )
    )
  );

CREATE POLICY "Org admins delete account bank details"
  ON public.financial_account_bank_details FOR DELETE TO authenticated
  USING (
    is_platform_admin() OR (
      organization_id = current_org_id() AND (
        has_role(auth.uid(), 'admin'::app_role) OR
        has_role(auth.uid(), 'org_owner'::app_role)
      )
    )
  );

CREATE TRIGGER trg_financial_account_bank_details_updated
  BEFORE UPDATE ON public.financial_account_bank_details
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

INSERT INTO public.financial_account_bank_details (account_id, organization_id, bank_name, account_number, branch, swift_bic)
SELECT id, organization_id, bank_name, account_number, branch, swift_bic
FROM public.financial_accounts
WHERE bank_name IS NOT NULL OR account_number IS NOT NULL OR branch IS NOT NULL OR swift_bic IS NOT NULL;

ALTER TABLE public.financial_accounts
  DROP COLUMN bank_name,
  DROP COLUMN account_number,
  DROP COLUMN branch,
  DROP COLUMN swift_bic;

-- 3. Restrict anon-executable SECURITY DEFINER functions -----------------
REVOKE EXECUTE ON FUNCTION public.run_recurring_expense_now(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.run_recurring_expense_now(uuid) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.ensure_fiscal_year(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ensure_fiscal_year(integer) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.opex_budget_vs_actual(integer, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.opex_budget_vs_actual(integer, uuid, uuid) TO authenticated;

REVOKE EXECUTE ON FUNCTION public._advance_recurring_expense_template(uuid) FROM PUBLIC, anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.settle_operating_expenses(uuid[], uuid, date, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.settle_operating_expenses(uuid[], uuid, date, text) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.opex_pl_reconciliation(date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.opex_pl_reconciliation(date, date) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.generate_due_recurring_expenses(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.generate_due_recurring_expenses(uuid) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.set_opex_budget(integer, integer, uuid, numeric, uuid, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_opex_budget(integer, integer, uuid, numeric, uuid, uuid, uuid) TO authenticated;

REVOKE EXECUTE ON FUNCTION public._create_expense_from_template(uuid, date) FROM PUBLIC, anon, authenticated;