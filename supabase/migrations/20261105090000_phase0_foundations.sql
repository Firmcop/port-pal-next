-- =====================================================================
-- Phase 0 — foundations for selling Port Pal to many depots.
--
-- 1. Active company: the company a person works in is saved on their
--    profile (set_active_organization) and current_org_id() uses it, so
--    what the switcher shows is also what the database reads and writes.
--    Before, the database always used the oldest membership.
-- 2. Roles per company: a staff role belongs to one company. Adding a
--    person to a second company no longer moves or wipes their roles in
--    the first, and a role only grants rights in its own company.
-- 3. Country pack at signup: provision_tenant() sets up a new company's
--    chart of accounts, taxes for its country, fiscal year, cash/bank
--    accounts, expense categories, dunning rules and FX rates. Runs at
--    signup and for every existing company (only what is missing).
-- 4. The placeholder 'Default Organization' is retired from the code.
-- =====================================================================

-- ---------------------------------------------------------------- 1. active company
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS active_organization_id uuid REFERENCES public.organizations(id) ON DELETE SET NULL;

CREATE OR REPLACE FUNCTION public.current_org_id()
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT COALESCE(
    -- the company the person chose, while they still belong to it (platform admins may pick any)
    (SELECT p.active_organization_id
       FROM public.profiles p
      WHERE p.user_id = auth.uid()
        AND p.active_organization_id IS NOT NULL
        AND (EXISTS (SELECT 1 FROM public.organization_members m
                      WHERE m.user_id = p.user_id AND m.organization_id = p.active_organization_id
                        AND m.status = 'active')
             OR EXISTS (SELECT 1 FROM public.platform_admins pa WHERE pa.user_id = p.user_id))
      LIMIT 1),
    -- otherwise their first company
    (SELECT organization_id FROM public.organization_members
      WHERE user_id = auth.uid() AND status = 'active'
      ORDER BY created_at ASC
      LIMIT 1))
$function$;

CREATE OR REPLACE FUNCTION public.set_active_organization(_org uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF _org IS NOT NULL AND NOT (
       EXISTS (SELECT 1 FROM public.organization_members
                WHERE user_id = auth.uid() AND organization_id = _org AND status = 'active')
       OR public.is_platform_admin()) THEN
    RAISE EXCEPTION 'You are not a member of that company' USING ERRCODE = '42501';
  END IF;
  INSERT INTO public.profiles (user_id, active_organization_id)
  VALUES (auth.uid(), _org)
  ON CONFLICT (user_id) DO UPDATE SET active_organization_id = EXCLUDED.active_organization_id, updated_at = now();
  RETURN public.current_org_id();
END $function$;
REVOKE ALL ON FUNCTION public.set_active_organization(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_active_organization(uuid) TO authenticated;

-- ---------------------------------------------------------------- 2. roles per company
-- Staff roles without a company are moved to the person's first company.
UPDATE public.user_roles ur SET organization_id = m.organization_id
  FROM (SELECT DISTINCT ON (user_id) user_id, organization_id FROM public.organization_members
         WHERE status = 'active' ORDER BY user_id, created_at) m
 WHERE ur.organization_id IS NULL AND ur.role <> 'customer'::app_role AND m.user_id = ur.user_id;

ALTER TABLE public.user_roles DROP CONSTRAINT IF EXISTS user_roles_user_id_role_key;
DO $$ BEGIN
  ALTER TABLE public.user_roles ADD CONSTRAINT user_roles_user_org_role_key
    UNIQUE NULLS NOT DISTINCT (user_id, organization_id, role);
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;

-- A staff role only counts in its own company.
CREATE OR REPLACE FUNCTION public.has_permission(_user_id uuid, _module text, _action app_action)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
      AND organization_id = v_org
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
      AND ur.organization_id = v_org
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
      AND ur.organization_id = v_org
      AND (ro.allowed IS NULL OR ro.allowed = true)
  ) THEN
    RETURN true;
  END IF;

  RETURN false;
END
$function$;

CREATE OR REPLACE FUNCTION public.change_user_staff_role(_target_user_id uuid, _new_role app_role)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _caller uuid := auth.uid();
  _is_platform_admin boolean;
  _can_manage boolean;
  _org_id uuid;
  _admin_count int;
  _was_admin boolean;
BEGIN
  IF _caller IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  _is_platform_admin := public.is_platform_admin();
  _can_manage := public.is_org_admin(public.current_org_id())
                 OR public.has_role(_caller, 'admin'::app_role);

  IF NOT (_is_platform_admin OR _can_manage) THEN
    RAISE EXCEPTION 'You are not allowed to change this user''s role';
  END IF;

  IF _new_role NOT IN ('admin'::app_role, 'yard_operator'::app_role, 'gate_clerk'::app_role, 'viewer'::app_role) THEN
    RAISE EXCEPTION 'Invalid staff role: %', _new_role;
  END IF;

  -- Roles are set in the caller's active company, and the target must belong to it.
  _org_id := public.current_org_id();
  IF _org_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.organization_members
     WHERE user_id = _target_user_id AND organization_id = _org_id AND status = 'active') THEN
    RAISE EXCEPTION 'This person is not an active member of your company';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _target_user_id AND role = 'admin'::app_role
      AND organization_id = _org_id
  ) INTO _was_admin;

  IF _was_admin AND _new_role <> 'admin'::app_role AND _org_id IS NOT NULL THEN
    SELECT COUNT(*) INTO _admin_count
    FROM public.user_roles ur
    WHERE ur.role = 'admin'::app_role
      AND ur.organization_id = _org_id;
    IF _admin_count <= 1 THEN
      RAISE EXCEPTION 'Cannot remove the last admin in this organization';
    END IF;
  END IF;

  DELETE FROM public.user_roles
  WHERE user_id = _target_user_id
    AND role IN ('admin'::app_role, 'yard_operator'::app_role, 'gate_clerk'::app_role, 'viewer'::app_role)
    AND organization_id = _org_id;

  INSERT INTO public.user_roles (user_id, role, organization_id)
  VALUES (_target_user_id, _new_role, _org_id)
  ON CONFLICT (user_id, organization_id, role) DO NOTHING;
END;
$function$;

CREATE OR REPLACE FUNCTION public.set_user_staff_roles(_target_user_id uuid, _roles app_role[])
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _caller uuid := auth.uid();
  _is_platform_admin boolean;
  _can_manage boolean;
  _org_id uuid;
  _admin_count int;
  _was_admin boolean;
  _will_be_admin boolean;
  _r public.app_role;
  _valid public.app_role[] := ARRAY[
    'admin','yard_operator','gate_clerk','viewer',
    'accountant','hr_manager','production_manager','procurement_officer',
    'supply_chain_manager','sales_manager','leasing_manager','mr_supervisor'
  ]::public.app_role[];
BEGIN
  IF _caller IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF _roles IS NULL OR array_length(_roles, 1) IS NULL THEN
    RAISE EXCEPTION 'At least one role is required';
  END IF;

  _is_platform_admin := public.is_platform_admin();
  _can_manage := public.is_org_admin(public.current_org_id())
                 OR public.has_role(_caller, 'admin'::app_role);
  IF NOT (_is_platform_admin OR _can_manage) THEN
    RAISE EXCEPTION 'You are not allowed to change this user''s roles';
  END IF;

  FOREACH _r IN ARRAY _roles LOOP
    IF NOT (_r = ANY(_valid)) THEN
      RAISE EXCEPTION 'Invalid staff role: %', _r;
    END IF;
  END LOOP;

  -- Roles are set in the caller's active company, and the target must belong to it.
  _org_id := public.current_org_id();
  IF _org_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.organization_members
     WHERE user_id = _target_user_id AND organization_id = _org_id AND status = 'active') THEN
    RAISE EXCEPTION 'This person is not an active member of your company';
  END IF;

  IF _org_id IS NULL THEN
    RAISE EXCEPTION 'Target user has no active organization membership';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _target_user_id AND role = 'admin'::public.app_role
      AND organization_id = _org_id
  ) INTO _was_admin;

  _will_be_admin := 'admin'::public.app_role = ANY(_roles);

  IF _was_admin AND NOT _will_be_admin THEN
    SELECT COUNT(*) INTO _admin_count
    FROM public.user_roles ur
    WHERE ur.role = 'admin'::public.app_role
      AND ur.organization_id = _org_id;
    IF _admin_count <= 1 THEN
      RAISE EXCEPTION 'Cannot remove the last admin in this organization';
    END IF;
  END IF;

  DELETE FROM public.user_roles
  WHERE user_id = _target_user_id
    AND role = ANY(_valid)
    AND organization_id = _org_id;

  INSERT INTO public.user_roles (user_id, role, organization_id)
  SELECT _target_user_id, unnest(_roles), _org_id
  ON CONFLICT (user_id, organization_id, role) DO NOTHING;
END;
$function$;

CREATE OR REPLACE FUNCTION public.upsert_user_staff_role(_target_user_id uuid, _new_role app_role)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _caller uuid := auth.uid();
  _can_manage boolean;
  _is_platform_admin boolean;
  _org_id uuid;
  _was_admin boolean;
  _admin_count int;
BEGIN
  IF _caller IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  _is_platform_admin := public.is_platform_admin();
  _can_manage := public.is_org_admin(public.current_org_id())
                 OR public.has_role(_caller, 'admin'::app_role);
  IF NOT (_is_platform_admin OR _can_manage) THEN
    RAISE EXCEPTION 'You are not allowed to change this user''s role';
  END IF;

  IF _new_role NOT IN ('admin'::app_role, 'yard_operator'::app_role, 'gate_clerk'::app_role, 'viewer'::app_role) THEN
    RAISE EXCEPTION 'Invalid staff role: %', _new_role;
  END IF;

  -- Roles are set in the caller's active company, and the target must belong to it.
  _org_id := public.current_org_id();
  IF _org_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.organization_members
     WHERE user_id = _target_user_id AND organization_id = _org_id AND status = 'active') THEN
    RAISE EXCEPTION 'This person is not an active member of your company';
  END IF;

  IF _org_id IS NULL THEN
    RAISE EXCEPTION 'Target user has no active organization membership';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _target_user_id AND role = 'admin'::app_role
      AND organization_id = _org_id
  ) INTO _was_admin;

  IF _was_admin AND _new_role <> 'admin'::app_role THEN
    SELECT COUNT(*) INTO _admin_count
    FROM public.user_roles ur
    WHERE ur.role = 'admin'::app_role
      AND ur.organization_id = _org_id;
    IF _admin_count <= 1 THEN
      RAISE EXCEPTION 'Cannot remove the last admin in this organization';
    END IF;
  END IF;

  DELETE FROM public.user_roles
  WHERE user_id = _target_user_id
    AND role IN ('admin'::app_role, 'yard_operator'::app_role, 'gate_clerk'::app_role, 'viewer'::app_role)
    AND organization_id = _org_id;

  INSERT INTO public.user_roles (user_id, role, organization_id)
  VALUES (_target_user_id, _new_role, _org_id)
  ON CONFLICT (user_id, organization_id, role) DO NOTHING;
END;
$function$;

-- Portal customers keep a company-less 'customer' role.
CREATE OR REPLACE FUNCTION public.handle_portal_user_role()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.user_id, 'customer')
  ON CONFLICT (user_id, organization_id, role) DO NOTHING;
  RETURN NEW;
END;
$function$;


-- ---------------------------------------------------------------- 3. country pack at signup
CREATE OR REPLACE FUNCTION public.ensure_default_coa(_org_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_currency text;
  existing int;
BEGIN
  -- Callable by the system (signup), platform admins and members of the company.
  IF auth.uid() IS NOT NULL AND NOT (public.is_platform_admin() OR EXISTS (
       SELECT 1 FROM public.organization_members
        WHERE organization_id = _org_id AND user_id = auth.uid() AND status = 'active')) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  -- Adds any missing standard account; existing accounts are left as they are.

  SELECT COALESCE(currency, 'USD') INTO v_currency FROM public.organizations WHERE id = _org_id;
  IF v_currency IS NULL THEN v_currency := 'USD'; END IF;

  INSERT INTO public.gl_accounts (organization_id, code, name, account_type, currency, is_system, system_code) VALUES
    (_org_id, '1000', 'Cash on Hand', 'asset', v_currency, true, 'cash'),
    (_org_id, '1010', 'Bank Accounts', 'asset', v_currency, true, 'bank'),
    (_org_id, '1100', 'Accounts Receivable', 'asset', v_currency, true, 'ar'),
    (_org_id, '1200', 'Inventory - Containers', 'asset', v_currency, true, 'inventory_containers'),
    (_org_id, '1210', 'Inventory - Materials', 'asset', v_currency, true, 'inventory_materials'),
    (_org_id, '1220', 'Work in Progress', 'asset', v_currency, true, 'wip'),
    (_org_id, '1500', 'Fixed Assets', 'asset', v_currency, true, 'fixed_assets'),
    (_org_id, '1510', 'Accumulated Depreciation', 'asset', v_currency, true, 'accumulated_depreciation'),
    (_org_id, '2000', 'Accounts Payable', 'liability', v_currency, true, 'ap'),
    (_org_id, '2010', 'Container Acquisition Payable', 'liability', v_currency, true, 'container_acquisition_payable'),
    (_org_id, '2100', 'Accrued Expenses', 'liability', v_currency, true, 'accrued_expenses'),
    (_org_id, '2200', 'VAT Payable (Output)', 'liability', v_currency, true, 'vat_output'),
    (_org_id, '2210', 'VAT Recoverable (Input)', 'liability', v_currency, true, 'vat_input'),
    (_org_id, '2300', 'Payroll Liabilities', 'liability', v_currency, true, 'payroll_liabilities'),
    (_org_id, '2400', 'Customer Deposits', 'liability', v_currency, true, 'customer_deposits'),
    (_org_id, '3000', 'Share Capital', 'equity', v_currency, true, 'share_capital'),
    (_org_id, '3100', 'Retained Earnings', 'equity', v_currency, true, 'retained_earnings'),
    (_org_id, '3200', 'Current Year Earnings', 'equity', v_currency, true, 'current_year_earnings'),
    (_org_id, '4000', 'Storage Revenue', 'revenue', v_currency, true, 'revenue_storage'),
    (_org_id, '4010', 'Handling Revenue', 'revenue', v_currency, true, 'revenue_handling'),
    (_org_id, '4020', 'Repair Revenue', 'revenue', v_currency, true, 'revenue_repair'),
    (_org_id, '4030', 'Container Sales Revenue', 'revenue', v_currency, true, 'revenue_container_sale'),
    (_org_id, '4040', 'Conversion Revenue', 'revenue', v_currency, true, 'revenue_conversion'),
    (_org_id, '4050', 'Lease Revenue', 'revenue', v_currency, true, 'revenue_lease'),
    (_org_id, '4060', 'Logistics Revenue', 'revenue', v_currency, true, 'revenue_logistics'),
    (_org_id, '4900', 'Other Income', 'revenue', v_currency, true, 'other_income'),
    (_org_id, '5000', 'Cost of Goods Sold', 'cost_of_goods', v_currency, true, 'cogs'),
    (_org_id, '5010', 'Container Acquisition Cost', 'cost_of_goods', v_currency, true, 'cogs_container_acquisition'),
    (_org_id, '5020', 'Conversion Materials', 'cost_of_goods', v_currency, true, 'cogs_conversion_materials'),
    (_org_id, '5030', 'Conversion Labour', 'cost_of_goods', v_currency, true, 'cogs_conversion_labour'),
    (_org_id, '6000', 'Salaries & Wages', 'expense', v_currency, true, 'expense_payroll'),
    (_org_id, '6100', 'Rent', 'expense', v_currency, true, 'expense_rent'),
    (_org_id, '6200', 'Utilities', 'expense', v_currency, true, 'expense_utilities'),
    (_org_id, '6300', 'Office Expenses', 'expense', v_currency, true, 'expense_office'),
    (_org_id, '6400', 'Logistics & Transport', 'expense', v_currency, true, 'expense_logistics'),
    (_org_id, '6500', 'Maintenance & Repairs', 'expense', v_currency, true, 'expense_maintenance'),
    (_org_id, '6600', 'Depreciation Expense', 'expense', v_currency, true, 'expense_depreciation'),
    (_org_id, '6700', 'Bank Charges', 'expense', v_currency, true, 'expense_bank_charges'),
    (_org_id, '6800', 'FX Gain/Loss', 'expense', v_currency, true, 'fx_gain_loss'),
    (_org_id, '6900', 'Other Expenses', 'expense', v_currency, true, 'other_expense')
  ON CONFLICT (organization_id, code) DO NOTHING;
END $function$;


-- Taxes by country. Countries are stored as names ('Kenya') or ISO codes ('KE').
-- Kenya keeps its full set (VAT, fuel, zero-rated, exempt, withholding). Other
-- countries get their standard VAT rate plus zero-rated and exempt; an unknown
-- country gets a 0% standard rate to be set in Taxes. Rates as of Nov 2026.
CREATE OR REPLACE FUNCTION public.seed_default_tax_codes(_org uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE n int := 0; _country text; _iso text; _rate numeric; _label text;
BEGIN
  IF EXISTS (SELECT 1 FROM public.tax_codes WHERE organization_id = _org) THEN RETURN 0; END IF;
  SELECT upper(btrim(coalesce(country, ''))) INTO _country FROM public.organizations WHERE id = _org;

  _iso := CASE
    WHEN _country IN ('KE','KENYA') THEN 'KE'
    WHEN _country IN ('UG','UGANDA') THEN 'UG'
    WHEN _country IN ('TZ','TANZANIA','UNITED REPUBLIC OF TANZANIA') THEN 'TZ'
    WHEN _country IN ('RW','RWANDA') THEN 'RW'
    WHEN _country IN ('ET','ETHIOPIA') THEN 'ET'
    WHEN _country IN ('ZA','SOUTH AFRICA') THEN 'ZA'
    WHEN _country IN ('NG','NIGERIA') THEN 'NG'
    WHEN _country IN ('GH','GHANA') THEN 'GH'
    WHEN _country IN ('ZM','ZAMBIA') THEN 'ZM'
    WHEN _country IN ('AE','UNITED ARAB EMIRATES','UAE') THEN 'AE'
    WHEN _country IN ('GB','UK','UNITED KINGDOM') THEN 'GB'
    WHEN _country IN ('US','USA','UNITED STATES','UNITED STATES OF AMERICA') THEN 'US'
    ELSE NULLIF(left(_country, 2), '') END;

  IF _iso = 'KE' THEN
    INSERT INTO public.tax_codes(organization_id,code,name,rate,kind,jurisdiction,is_active) VALUES
      (_org,'VAT16','VAT Standard 16%',16,'output','KE',true),
      (_org,'VAT8','VAT Fuel 8%',8,'output','KE',true),
      (_org,'VAT0','Zero Rated',0,'output','KE',true),
      (_org,'EXEMPT','Exempt',0,'output','KE',true),
      (_org,'WHT5','Withholding 5%',5,'withholding','KE',true),
      (_org,'WHT3','Withholding 3% Services',3,'withholding','KE',true);
  ELSIF _iso = 'US' THEN
    INSERT INTO public.tax_codes(organization_id,code,name,rate,kind,jurisdiction,is_active) VALUES
      (_org,'NONE','No Sales Tax',0,'output','US',true);
  ELSE
    _rate := CASE _iso
      WHEN 'UG' THEN 18 WHEN 'TZ' THEN 18 WHEN 'RW' THEN 18 WHEN 'ET' THEN 15 WHEN 'ZA' THEN 15
      WHEN 'NG' THEN 7.5 WHEN 'GH' THEN 15 WHEN 'ZM' THEN 16 WHEN 'AE' THEN 5 WHEN 'GB' THEN 20
      ELSE NULL END;
    _label := CASE WHEN _rate IS NULL THEN 'VAT Standard (set your rate)'
                   ELSE 'VAT Standard ' || trim(trailing '.' from trim(trailing '0' from _rate::text)) || '%' END;
    INSERT INTO public.tax_codes(organization_id,code,name,rate,kind,jurisdiction,is_active) VALUES
      (_org,'VAT_STD',_label,coalesce(_rate,0),'output',coalesce(_iso,''),true),
      (_org,'VAT0','Zero Rated',0,'output',coalesce(_iso,''),true),
      (_org,'EXEMPT','Exempt',0,'output',coalesce(_iso,''),true);
  END IF;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $function$;

-- One call sets up a company. Safe to repeat: each part only adds what is missing,
-- and FX rates, expense categories and dunning rules are seeded only when the
-- company has none (so a company's own rates are never overwritten).
CREATE OR REPLACE FUNCTION public.provision_tenant(_org uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _y int := extract(year FROM now())::int;
  _last_y int := CASE WHEN extract(month FROM now()) >= 10 THEN _y + 1 ELSE _y END;
  _yr int; _m int;
  _accounts int; _taxes int; _periods int := 0; _categories int := 0; _fx int := 0; _dunning int;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.organizations WHERE id = _org) THEN
    RAISE EXCEPTION 'Unknown company';
  END IF;
  -- The system (signup, migrations), platform admins and the company's own admins.
  IF auth.uid() IS NOT NULL AND NOT (public.is_platform_admin() OR public.is_org_admin(_org)) THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;

  SELECT count(*) INTO _accounts FROM public.gl_accounts WHERE organization_id = _org;
  PERFORM public.ensure_default_coa(_org);
  _accounts := (SELECT count(*) FROM public.gl_accounts WHERE organization_id = _org) - _accounts;

  _taxes := public.seed_default_tax_codes(_org);
  PERFORM public.ensure_default_financial_accounts(_org);
  _dunning := public.seed_default_dunning_rules(_org);

  IF NOT EXISTS (SELECT 1 FROM public.fx_rates WHERE organization_id = _org) THEN
    _fx := public.seed_default_fx_rates(_org);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.expense_categories WHERE organization_id = _org) THEN
    INSERT INTO public.expense_categories (organization_id, code, name, gl_account_id, sort_order)
    SELECT _org, a.code, a.name, a.id, 100
      FROM public.gl_accounts a
     WHERE a.organization_id = _org AND a.is_active
       AND a.account_type::text IN ('expense','cost_of_goods');
    GET DIAGNOSTICS _categories = ROW_COUNT;
  END IF;

  -- Fiscal periods: this year, and next year from October on.
  FOR _yr IN _y.._last_y LOOP
    FOR _m IN 1..12 LOOP
      IF NOT EXISTS (SELECT 1 FROM public.fiscal_periods
                      WHERE organization_id = _org AND year = _yr AND month = _m) THEN
        INSERT INTO public.fiscal_periods (organization_id, year, month, start_date, end_date, status)
        VALUES (_org, _yr, _m, make_date(_yr, _m, 1),
                (make_date(_yr, _m, 1) + interval '1 month - 1 day')::date, 'open');
        _periods := _periods + 1;
      END IF;
    END LOOP;
  END LOOP;

  RETURN jsonb_build_object('accounts_added', _accounts, 'tax_codes_added', _taxes,
    'fiscal_periods_added', _periods, 'expense_categories_added', _categories,
    'fx_rates_added', _fx, 'dunning_rules_added', _dunning);
END $function$;

-- The single seeders are internal now; the app calls provision_tenant (or ensure_default_coa).
REVOKE ALL ON FUNCTION public.seed_default_tax_codes(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ensure_default_financial_accounts(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.seed_default_dunning_rules(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.seed_default_fx_rates(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ensure_default_coa(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ensure_default_coa(uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.provision_tenant(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.provision_tenant(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.seed_default_tax_codes(uuid), public.ensure_default_financial_accounts(uuid),
  public.seed_default_dunning_rules(uuid), public.seed_default_fx_rates(uuid) TO service_role;

-- Every existing company gets whatever it is missing.
SELECT public.provision_tenant(id) FROM public.organizations;

-- ---------------------------------------------------------------- 4. no placeholder company
-- Records without a company are no longer parked in 'Default Organization'.
DROP TRIGGER IF EXISTS trg_no_legacy_org_conversions ON public.container_conversions;
DROP TRIGGER IF EXISTS trg_no_legacy_org_projects ON public.projects;
DROP FUNCTION IF EXISTS public.prevent_legacy_org_assignment();
DROP FUNCTION IF EXISTS public.adopt_legacy_org_data(uuid, boolean);

CREATE OR REPLACE FUNCTION public.next_conversion_number(_org uuid, _customer uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _slug text;
  _seq int;
  _max int;
  _org_id uuid := COALESCE(_org, public.current_org_id());
  _candidate text;
  _i int := 0;
BEGIN
  _slug := public.customer_slug_for_conversion(_customer);

  -- Highest number already used for this slug anywhere (the unique index is global)
  SELECT COALESCE(MAX(NULLIF(regexp_replace(conversion_number, '^.*-', ''), '')::int), 0)
    INTO _max
  FROM public.container_conversions
  WHERE conversion_number ~ ('^CNV-' || _slug || '-[0-9]+$');

  INSERT INTO public.conversion_number_sequences AS s
    (organization_id, slug, last_seq, updated_at)
  VALUES (_org_id, _slug, GREATEST(_max, 0) + 1, now())
  ON CONFLICT (organization_id, slug) DO UPDATE
    SET last_seq = GREATEST(s.last_seq, _max) + 1, updated_at = now()
  RETURNING last_seq INTO _seq;

  LOOP
    _i := _i + 1;
    _candidate := 'CNV-' || _slug || '-' || lpad(_seq::text, 4, '0');
    EXIT WHEN NOT EXISTS (
      SELECT 1 FROM public.container_conversions WHERE conversion_number = _candidate
    ) OR _i > 50;
    _seq := _seq + 1;
    UPDATE public.conversion_number_sequences
       SET last_seq = _seq, updated_at = now()
     WHERE organization_id = _org_id AND slug = _slug;
  END LOOP;

  RETURN _candidate;
END;
$function$;

CREATE OR REPLACE FUNCTION public.queue_push_notifications()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _sub RECORD;
  _customer RECORD;
  _queued int := 0;
BEGIN
  FOR _sub IN SELECT endpoint, p256dh, auth FROM public.push_subscriptions WHERE user_id = NEW.user_id LOOP
    INSERT INTO public.push_notification_queue (notification_id, channel, recipient, payload)
    VALUES (NEW.id, 'web_push', _sub.endpoint,
      jsonb_build_object('title', NEW.title, 'body', NEW.message, 'type', NEW.type,
                         'p256dh', _sub.p256dh, 'auth', _sub.auth));
    _queued := _queued + 1;
  END LOOP;

  IF NEW.reference_type IS NOT NULL THEN
    FOR _customer IN
      SELECT DISTINCT c.whatsapp_number
      FROM public.customers c
      WHERE c.whatsapp_number IS NOT NULL AND c.whatsapp_number <> ''
        AND (
          (NEW.reference_type = 'gate_appointments' AND EXISTS (
            SELECT 1 FROM public.gate_appointments ga
            WHERE ga.id = NEW.reference_id AND ga.shipping_line = c.company_name))
          OR
          (NEW.reference_type = 'containers' AND EXISTS (
            SELECT 1 FROM public.containers ct
            WHERE ct.id = NEW.reference_id AND (ct.owner = c.company_name OR ct.shipping_line = c.company_name)))
        )
      LIMIT 1
    LOOP
      INSERT INTO public.push_notification_queue (notification_id, channel, recipient, payload)
      VALUES (NEW.id, 'whatsapp', _customer.whatsapp_number,
        jsonb_build_object('title', NEW.title, 'body', NEW.message, 'type', NEW.type));
      _queued := _queued + 1;
    END LOOP;
  END IF;

  IF _queued = 0 AND NEW.organization_id IS NOT NULL THEN
    INSERT INTO sync_audit_findings(organization_id, finding_code, severity, reference_type, reference_id, details)
    VALUES (NEW.organization_id,
            'notification_no_subscriber', 'info', 'notifications', NEW.id,
            jsonb_build_object('user_id', NEW.user_id, 'type', NEW.type, 'title', NEW.title));
  END IF;
  RETURN NEW;
END $function$;
