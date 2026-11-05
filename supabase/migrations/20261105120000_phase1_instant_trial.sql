-- =====================================================================
-- Phase 1 — instant trial.
--
-- 1. Signup answers are kept on the company (size, business type, the
--    modules picked) so the vendor console can follow the funnel.
-- 2. create_company(): creates a company with its owner, roles, picked
--    modules, first depot and country pack in ONE transaction, so a failed
--    signup leaves nothing half-made. Used by start-trial and
--    provision-organization (service role only).
-- 3. Email verification: people get in straight away and have 7 days to
--    confirm their address. Tokens are stored hashed and can be used once.
-- =====================================================================

-- ---------------------------------------------------------------- 1. signup answers
ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS company_size text,
  ADD COLUMN IF NOT EXISTS business_type text,
  ADD COLUMN IF NOT EXISTS signup_modules text[];

-- ---------------------------------------------------------------- 3. email verification (columns first)
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS email_verified_at timestamptz;

-- Everyone who signed up before this counts as verified.
UPDATE public.profiles p
   SET email_verified_at = COALESCE(u.email_confirmed_at, u.created_at, now())
  FROM auth.users u
 WHERE u.id = p.user_id AND p.email_verified_at IS NULL;

CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  INSERT INTO public.profiles (user_id, display_name, email_verified_at)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'display_name', NEW.email), NEW.email_confirmed_at)
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END;
$function$;

CREATE TABLE IF NOT EXISTS public.email_verification_tokens (
  token_hash text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  email text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT now() + interval '7 days',
  used_at timestamptz
);
CREATE INDEX IF NOT EXISTS email_verification_tokens_user_idx ON public.email_verification_tokens(user_id);
ALTER TABLE public.email_verification_tokens ENABLE ROW LEVEL SECURITY;  -- no policies: functions only
REVOKE ALL ON public.email_verification_tokens FROM anon, authenticated;

-- Issues a new link for a person (older unused links stop working). Returns the raw token
-- for the email; only its hash is stored. Called by edge functions (service role).
CREATE OR REPLACE FUNCTION public.issue_email_verification(_user uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _token text := encode(extensions.gen_random_bytes(32), 'hex'); _email text;
BEGIN
  SELECT email INTO _email FROM auth.users WHERE id = _user;
  IF _email IS NULL THEN RAISE EXCEPTION 'Unknown user'; END IF;
  UPDATE public.email_verification_tokens SET used_at = now()
   WHERE user_id = _user AND used_at IS NULL;
  INSERT INTO public.email_verification_tokens (token_hash, user_id, email)
  VALUES (encode(extensions.digest(_token, 'sha256'), 'hex'), _user, lower(_email));
  RETURN _token;
END $function$;
REVOKE ALL ON FUNCTION public.issue_email_verification(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_email_verification(uuid) TO service_role;

-- The link in the email: anyone holding a valid token confirms that address.
CREATE OR REPLACE FUNCTION public.confirm_email_verification(_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _t public.email_verification_tokens%ROWTYPE;
BEGIN
  IF _token IS NULL OR length(_token) <> 64 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid');
  END IF;
  SELECT * INTO _t FROM public.email_verification_tokens
   WHERE token_hash = encode(extensions.digest(_token, 'sha256'), 'hex')
   FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'invalid'); END IF;
  IF _t.used_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok', EXISTS (SELECT 1 FROM public.profiles WHERE user_id = _t.user_id AND email_verified_at IS NOT NULL),
                              'reason', 'used');
  END IF;
  IF _t.expires_at < now() THEN RETURN jsonb_build_object('ok', false, 'reason', 'expired'); END IF;
  -- the address must still be the account's address
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = _t.user_id AND lower(email) = _t.email) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'email_changed');
  END IF;
  UPDATE public.email_verification_tokens SET used_at = now() WHERE token_hash = _t.token_hash;
  UPDATE public.profiles SET email_verified_at = now(), updated_at = now() WHERE user_id = _t.user_id;
  RETURN jsonb_build_object('ok', true, 'email', _t.email);
END $function$;
REVOKE ALL ON FUNCTION public.confirm_email_verification(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.confirm_email_verification(text) TO anon, authenticated, service_role;

-- ---------------------------------------------------------------- 2. create_company
CREATE OR REPLACE FUNCTION public.create_company(
  _owner uuid,
  _name text,
  _country text DEFAULT NULL,
  _currency text DEFAULT 'USD',
  _timezone text DEFAULT 'UTC',
  _depot_name text DEFAULT NULL,
  _depot_code text DEFAULT NULL,
  _company_size text DEFAULT NULL,
  _business_type text DEFAULT NULL,
  _modules text[] DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _org public.organizations%ROWTYPE;
  _email text;
  _slug text;
  _setup jsonb;
  _picked text[];
BEGIN
  SELECT email INTO _email FROM auth.users WHERE id = _owner;
  IF _email IS NULL THEN RAISE EXCEPTION 'Unknown user'; END IF;
  _name := btrim(coalesce(_name, ''));
  IF length(_name) < 2 OR length(_name) > 120 THEN RAISE EXCEPTION 'Company name must be 2 to 120 characters'; END IF;
  IF EXISTS (SELECT 1 FROM public.organization_members WHERE user_id = _owner AND status = 'active') THEN
    RAISE EXCEPTION 'already_member' USING ERRCODE = '23505';
  END IF;

  -- modules: the picked ones plus core; none picked = everything (old signup screen)
  IF _modules IS NULL OR cardinality(_modules) = 0 THEN
    SELECT array_agg(code) INTO _picked FROM public.modules_catalog;
  ELSE
    SELECT array_agg(code) INTO _picked FROM public.modules_catalog WHERE code = ANY(_modules) OR is_core;
  END IF;

  _slug := left(trim(both '-' from regexp_replace(lower(_name), '[^a-z0-9]+', '-', 'g')), 40)
           || '-' || substr(md5(random()::text), 1, 4);

  INSERT INTO public.organizations (name, slug, country, currency, timezone, owner_user_id, billing_email,
                                    status, trial_ends_at, company_size, business_type, signup_modules)
  VALUES (_name, _slug, NULLIF(btrim(_country), ''), coalesce(NULLIF(_currency, ''), 'USD'),
          coalesce(NULLIF(_timezone, ''), 'UTC'), _owner, _email, 'trial', now() + interval '30 days',
          _company_size, _business_type, _modules)
  RETURNING * INTO _org;

  INSERT INTO public.organization_members (organization_id, user_id, role, status)
  VALUES (_org.id, _owner, 'org_owner', 'active');
  INSERT INTO public.user_roles (user_id, role, organization_id)
  VALUES (_owner, 'admin', _org.id)
  ON CONFLICT (user_id, organization_id, role) DO NOTHING;

  INSERT INTO public.subscription_modules (organization_id, module_code, price_snapshot, enabled)
  SELECT _org.id, m.code, m.monthly_price, m.code = ANY(_picked)
    FROM public.modules_catalog m
  ON CONFLICT (organization_id, module_code) DO NOTHING;

  IF NULLIF(btrim(_depot_name), '') IS NOT NULL THEN
    INSERT INTO public.depots (organization_id, name, code, currency, timezone)
    VALUES (_org.id, btrim(_depot_name),
            coalesce(NULLIF(upper(regexp_replace(_depot_code, '[^A-Za-z0-9]', '', 'g')), ''), 'MAIN'),
            _org.currency, _org.timezone);
  END IF;

  _setup := public.provision_tenant(_org.id);

  INSERT INTO public.profiles (user_id, active_organization_id) VALUES (_owner, _org.id)
  ON CONFLICT (user_id) DO UPDATE SET active_organization_id = EXCLUDED.active_organization_id;

  PERFORM public.log_org_event(_org.id, 'org_created',
    jsonb_build_object('country', _org.country, 'currency', _org.currency, 'timezone', _org.timezone,
                       'depot', _depot_name, 'company_size', _company_size, 'business_type', _business_type,
                       'modules', _picked), _owner);
  PERFORM public.log_org_event(_org.id, 'trial_started',
    jsonb_build_object('trial_ends_at', _org.trial_ends_at, 'days', 30), _owner);

  RETURN jsonb_build_object('organization_id', _org.id, 'slug', _org.slug, 'trial_ends_at', _org.trial_ends_at,
                            'modules', _picked, 'setup', _setup);
END $function$;
REVOKE ALL ON FUNCTION public.create_company(uuid, text, text, text, text, text, text, text, text, text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_company(uuid, text, text, text, text, text, text, text, text, text[]) TO service_role;

-- ---------------------------------------------------------------- 4. numbers unique per company
-- Depot codes, container numbers and document numbers were unique across ALL
-- companies: a second depot could not use code MAIN, record a container another
-- depot had ever handled, or number its EIRs from 1. They are now unique within
-- each company. (Existing values were unique everywhere, so nothing clashes.)
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT * FROM (VALUES
      ('depots','code'), ('containers','container_number'), ('accounting_transactions','transaction_number'),
      ('container_conversions','conversion_number'), ('container_sales','sale_number'),
      ('damage_estimates','estimate_number'), ('eir_records','eir_number'), ('finished_products','product_number'),
      ('gate_appointments','appointment_number'), ('inspections','inspection_number'),
      ('lease_agreements','lease_number'), ('lease_quotations','quote_number'), ('payments','payment_number'),
      ('release_instructions','instruction_number'), ('repatriations','repatriation_number'),
      ('store_issues','issue_number'), ('store_returns','return_number'), ('work_orders','wo_number')
    ) AS t(tbl, col)
  LOOP
    EXECUTE format('ALTER TABLE public.%I DROP CONSTRAINT IF EXISTS %I', r.tbl, r.tbl || '_' || r.col || '_key');
    EXECUTE format('DROP INDEX IF EXISTS public.%I', r.tbl || '_' || r.col || '_key');
    EXECUTE format('CREATE UNIQUE INDEX IF NOT EXISTS %I ON public.%I (organization_id, %I)',
                   r.tbl || '_org_' || r.col || '_key', r.tbl, r.col);
  END LOOP;
END $$;

-- Container numbers repeat across companies now: match by number only inside the same company.
CREATE OR REPLACE FUNCTION public.supplier_purchase_price_variance(_from date DEFAULT NULL::date, _to date DEFAULT NULL::date)
 RETURNS TABLE(supplier_id uuid, supplier_name text, container_id uuid, container_number text, size text, category text, invoice_id uuid, invoice_number text, supplier_ref text, issue_date date, currency text, amount numeric, reference_rate numeric, reference_rate_converted numeric, variance numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _org uuid := current_org_id();
BEGIN
  RETURN QUERY
  WITH base AS (
    SELECT si.id AS inv_id, si.invoice_number, si.supplier_ref, si.issue_date,
           upper(coalesce(si.currency,'USD')) AS ccy, coalesce(si.total_amount,0) AS amt,
           si.supplier_id AS sup_id, s.name AS sup_name,
           c.id AS cid, c.container_number AS cnum, c.size::text AS csize, c.category::text AS ccat,
           container_reference_rate(c.size::text) AS refrate
      FROM supplier_invoices si
      LEFT JOIN suppliers s ON s.id = si.supplier_id
      LEFT JOIN containers c ON c.id = si.container_id
                         OR (si.container_id IS NULL AND c.container_number = si.reference AND c.organization_id = si.organization_id)
     WHERE si.reason = 'purchase'
       AND lower(coalesce(si.status,'')) NOT IN ('cancelled','void','credited','draft_void')
       AND (si.organization_id = _org OR is_platform_admin())
       AND (_from IS NULL OR si.issue_date >= _from)
       AND (_to IS NULL OR si.issue_date <= _to)
  )
  SELECT b.sup_id, coalesce(b.sup_name, 'Unknown supplier'), b.cid, b.cnum, b.csize, b.ccat,
         b.inv_id, b.invoice_number, b.supplier_ref, b.issue_date, b.ccy, b.amt, b.refrate,
         conv.rr,
         CASE WHEN conv.rr IS NULL THEN NULL ELSE round(b.amt - conv.rr, 2) END
    FROM base b
    CROSS JOIN LATERAL (
      SELECT CASE
               WHEN b.refrate IS NULL THEN NULL
               WHEN b.ccy = 'USD' THEN b.refrate
               ELSE (SELECT round(b.refrate * r, 2) FROM (SELECT get_fx_rate(_org, 'USD', b.ccy, coalesce(b.issue_date, current_date)) AS r) x WHERE x.r IS NOT NULL AND x.r > 0)
             END AS rr
    ) conv
   ORDER BY coalesce(b.sup_name,''), b.csize, b.issue_date DESC NULLS LAST;
END;
$function$;
