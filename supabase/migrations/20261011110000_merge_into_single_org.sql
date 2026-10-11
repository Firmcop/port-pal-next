-- =====================================================================
-- One-off: run the system as a single organisation, "Firmcop".
--
-- frd (6b29b65b-…) holds almost all data and keeps its id, so stored file
-- paths (which start with the organisation id) keep working. The records
-- of "Default Organization", "Test Depot" and "edr" are moved into it, then
-- those three organisations are removed.
--
-- Why records ended up in "Default Organization": current_org_id() picks a
-- user's earliest membership, so a user who was also a member there wrote
-- into it (this is how the two KCB loans got there).
--
-- Clashes on per-organisation unique keys are resolved in frd's favour:
--   * memberships, subscriptions, modules, AI job state, approval policies,
--     duplicate FX rates: the frd row is kept, the duplicate is dropped
--   * tax codes with the same code: references are pointed at frd's code
--   * HQ depot: frd's HQ stays HQ; the moved depots become normal depots
--   * truck KDQ971K/ZH5198 exists in both: frd's record is kept
-- Users keep their frd role; roles held in the other organisations are not
-- carried over (no one gains access through the merge).
-- Idempotent: does nothing once the source organisations are gone.
-- =====================================================================

DO $$
DECLARE
  _target constant uuid := '6b29b65b-fa63-4dcf-9854-ede5c9a8320b';
  _sources uuid[];
  r record;
  _n bigint;
BEGIN
  SELECT array_agg(id) INTO _sources FROM public.organizations
   WHERE id IN ('00000000-0000-0000-0000-000000000001',
                'a84ae115-631b-4f64-a67b-d2db26413753',
                '80515b94-d945-4068-937a-8e62bd1e8bef');
  IF _sources IS NULL OR NOT EXISTS (SELECT 1 FROM public.organizations WHERE id = _target) THEN
    RAISE NOTICE 'merge already done or target missing — nothing to do';
    RETURN;
  END IF;

  -- Guard triggers (ledger locks, approval and period guards) would block
  -- re-tagging rows; switch off user triggers for the tables we touch.
  -- Foreign-key checks stay on.
  FOR r IN
    SELECT DISTINCT c.relname FROM pg_attribute a
      JOIN pg_class c ON c.oid = a.attrelid JOIN pg_namespace ns ON ns.oid = c.relnamespace
     WHERE ns.nspname = 'public' AND c.relkind = 'r' AND a.attname = 'organization_id' AND NOT a.attisdropped
  LOOP
    EXECUTE format('ALTER TABLE public.%I DISABLE TRIGGER USER', r.relname);
  END LOOP;
  ALTER TABLE public.organizations DISABLE TRIGGER USER;

  -- 1. Tax codes with a code frd already has: repoint references, drop duplicates.
  CREATE TEMP TABLE _tax_map ON COMMIT DROP AS
    SELECT s.id AS old_id, t.id AS new_id
      FROM public.tax_codes s JOIN public.tax_codes t ON t.organization_id = _target AND t.code = s.code
     WHERE s.organization_id = ANY(_sources);
  FOR r IN
    SELECT c.conrelid::regclass::text AS tbl, a.attname AS col
      FROM pg_constraint c JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY(c.conkey)
     WHERE c.contype = 'f' AND c.confrelid = 'public.tax_codes'::regclass
  LOOP
    EXECUTE format('UPDATE %s x SET %I = m.new_id FROM _tax_map m WHERE x.%I = m.old_id', r.tbl, r.col, r.col);
  END LOOP;
  DELETE FROM public.tax_codes WHERE id IN (SELECT old_id FROM _tax_map);

  -- 2. Per-organisation settings that frd already has: keep frd's.
  DELETE FROM public.organization_members s WHERE s.organization_id = ANY(_sources)
     AND EXISTS (SELECT 1 FROM public.organization_members t WHERE t.organization_id = _target AND t.user_id = s.user_id);
  DELETE FROM public.subscriptions        WHERE organization_id = ANY(_sources);
  DELETE FROM public.subscription_modules WHERE organization_id = ANY(_sources);
  DELETE FROM public.ai_job_state s WHERE s.organization_id = ANY(_sources)
     AND EXISTS (SELECT 1 FROM public.ai_job_state t WHERE t.organization_id = _target AND t.job = s.job);
  DELETE FROM public.approval_policies s WHERE s.organization_id = ANY(_sources)
     AND EXISTS (SELECT 1 FROM public.approval_policies t WHERE t.organization_id = _target AND t.document_type = s.document_type);
  DELETE FROM public.fx_rates s WHERE s.organization_id = ANY(_sources)
     AND EXISTS (SELECT 1 FROM public.fx_rates t WHERE t.organization_id = _target AND t.currency_from = s.currency_from
                    AND t.currency_to = s.currency_to AND t.as_of_date = s.as_of_date);
  DELETE FROM public.trucks_drivers s WHERE s.organization_id = ANY(_sources)
     AND EXISTS (SELECT 1 FROM public.trucks_drivers t WHERE t.organization_id = _target AND t.truck_plate = s.truck_plate);
  UPDATE public.depots SET is_hq = false WHERE organization_id = ANY(_sources) AND is_hq;
  -- Roles and permission overrides are not carried over (none exist today).
  DELETE FROM public.user_roles                WHERE organization_id = ANY(_sources);
  DELETE FROM public.user_permission_overrides WHERE organization_id = ANY(_sources);
  DELETE FROM public.staff_invitations         WHERE organization_id = ANY(_sources);

  -- 3. Move every remaining record.
  FOR r IN
    SELECT DISTINCT c.relname FROM pg_attribute a
      JOIN pg_class c ON c.oid = a.attrelid JOIN pg_namespace ns ON ns.oid = c.relnamespace
     WHERE ns.nspname = 'public' AND c.relkind = 'r' AND a.attname = 'organization_id' AND NOT a.attisdropped
       AND c.relname <> 'organizations'
  LOOP
    EXECUTE format('UPDATE public.%I SET organization_id = $1 WHERE organization_id = ANY($2)', r.relname)
      USING _target, _sources;
    GET DIAGNOSTICS _n = ROW_COUNT;
    IF _n > 0 THEN RAISE NOTICE 'moved % rows in %', _n, r.relname; END IF;
  END LOOP;

  -- 4. Remove the emptied organisations and rename the one that remains.
  DELETE FROM public.organizations WHERE id = ANY(_sources);
  UPDATE public.organizations SET name = 'Firmcop', updated_at = now() WHERE id = _target;

  FOR r IN
    SELECT DISTINCT c.relname FROM pg_attribute a
      JOIN pg_class c ON c.oid = a.attrelid JOIN pg_namespace ns ON ns.oid = c.relnamespace
     WHERE ns.nspname = 'public' AND c.relkind = 'r' AND a.attname = 'organization_id' AND NOT a.attisdropped
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE TRIGGER USER', r.relname);
  END LOOP;
  ALTER TABLE public.organizations ENABLE TRIGGER USER;
END $$;
