
ALTER TABLE public.depots ADD COLUMN IF NOT EXISTS is_hq boolean NOT NULL DEFAULT false;

WITH ranked AS (
  SELECT id, row_number() OVER (PARTITION BY organization_id ORDER BY created_at ASC, id ASC) AS rn
  FROM public.depots
)
UPDATE public.depots d SET is_hq = true FROM ranked r WHERE r.id = d.id AND r.rn = 1;

CREATE UNIQUE INDEX IF NOT EXISTS depots_one_hq_per_org
  ON public.depots (organization_id) WHERE is_hq;

CREATE OR REPLACE FUNCTION public.set_depot_hq_default()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.is_hq IS NOT TRUE THEN
    IF NOT EXISTS (SELECT 1 FROM public.depots WHERE organization_id = NEW.organization_id AND is_hq) THEN
      NEW.is_hq := true;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.set_depot_hq_default() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_set_depot_hq_default ON public.depots;
CREATE TRIGGER trg_set_depot_hq_default
  BEFORE INSERT ON public.depots
  FOR EACH ROW EXECUTE FUNCTION public.set_depot_hq_default();

CREATE OR REPLACE FUNCTION public.can_admin_depot(_depot_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.depots d
    WHERE d.id = _depot_id
      AND (
        public.is_platform_admin()
        OR EXISTS (
          SELECT 1 FROM public.organization_members m
          WHERE m.organization_id = d.organization_id
            AND m.user_id = auth.uid()
            AND m.status = 'active'
            AND m.role::text IN ('org_owner','admin')
        )
      )
  );
$$;
REVOKE ALL ON FUNCTION public.can_admin_depot(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_admin_depot(uuid) TO authenticated;

DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename='depots' AND cmd IN ('UPDATE','DELETE','INSERT','ALL')
  LOOP EXECUTE format('DROP POLICY IF EXISTS %I ON public.depots', r.policyname); END LOOP;
END $$;

CREATE POLICY "depots_admin_insert" ON public.depots FOR INSERT TO authenticated
  WITH CHECK (
    public.is_platform_admin() OR EXISTS (
      SELECT 1 FROM public.organization_members m
      WHERE m.organization_id = depots.organization_id
        AND m.user_id = auth.uid() AND m.status='active' AND m.role::text IN ('org_owner','admin')
    )
  );

CREATE POLICY "depots_admin_update" ON public.depots FOR UPDATE TO authenticated
  USING (public.can_admin_depot(id)) WITH CHECK (public.can_admin_depot(id));

CREATE POLICY "depots_admin_delete" ON public.depots FOR DELETE TO authenticated
  USING (public.can_admin_depot(id) AND is_hq = false);

DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename='yard_blocks' AND cmd IN ('UPDATE','DELETE','INSERT','ALL')
  LOOP EXECUTE format('DROP POLICY IF EXISTS %I ON public.yard_blocks', r.policyname); END LOOP;
END $$;

CREATE POLICY "yard_blocks_admin_write" ON public.yard_blocks FOR ALL TO authenticated
  USING (public.can_admin_depot(depot_id)) WITH CHECK (public.can_admin_depot(depot_id));

CREATE TABLE IF NOT EXISTS public.depot_lifecycle_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  depot_id uuid NOT NULL,
  organization_id uuid NOT NULL,
  event text NOT NULL,
  actor uuid,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.depot_lifecycle_events TO authenticated;
GRANT ALL ON public.depot_lifecycle_events TO service_role;
ALTER TABLE public.depot_lifecycle_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "depot_lifecycle_events_read" ON public.depot_lifecycle_events;
CREATE POLICY "depot_lifecycle_events_read" ON public.depot_lifecycle_events FOR SELECT TO authenticated
  USING (
    public.is_platform_admin() OR EXISTS (
      SELECT 1 FROM public.organization_members m
      WHERE m.organization_id = depot_lifecycle_events.organization_id
        AND m.user_id = auth.uid() AND m.status='active' AND m.role::text IN ('org_owner','admin')
    )
  );
DROP POLICY IF EXISTS "depot_lifecycle_events_insert" ON public.depot_lifecycle_events;
CREATE POLICY "depot_lifecycle_events_insert" ON public.depot_lifecycle_events FOR INSERT TO authenticated
  WITH CHECK (true);

CREATE OR REPLACE FUNCTION public.set_depot_as_hq(_depot_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _org uuid;
BEGIN
  IF NOT public.can_admin_depot(_depot_id) THEN RAISE EXCEPTION 'Not permitted'; END IF;
  SELECT organization_id INTO _org FROM public.depots WHERE id = _depot_id;
  IF _org IS NULL THEN RAISE EXCEPTION 'Depot not found'; END IF;
  UPDATE public.depots SET is_hq = false WHERE organization_id = _org AND is_hq AND id <> _depot_id;
  UPDATE public.depots SET is_hq = true WHERE id = _depot_id;
  INSERT INTO public.depot_lifecycle_events(depot_id, organization_id, event, actor, payload)
  VALUES (_depot_id, _org, 'promoted_to_hq', auth.uid(), '{}'::jsonb);
END;
$$;
REVOKE ALL ON FUNCTION public.set_depot_as_hq(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_depot_as_hq(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.retire_depot(
  _depot_id uuid, _target_hq_id uuid, _confirm_reconciled boolean DEFAULT false
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _org uuid; _hq_org uuid; _is_hq boolean;
  _active_containers int; _yard_blocks int;
  _blockers jsonb;
BEGIN
  IF NOT public.can_admin_depot(_depot_id) THEN RAISE EXCEPTION 'Not permitted'; END IF;
  SELECT organization_id, is_hq INTO _org, _is_hq FROM public.depots WHERE id = _depot_id;
  IF _org IS NULL THEN RAISE EXCEPTION 'Depot not found'; END IF;
  IF _is_hq THEN RAISE EXCEPTION 'Headquarters cannot be retired. Promote another depot to HQ first.'; END IF;

  SELECT organization_id INTO _hq_org FROM public.depots WHERE id = _target_hq_id AND is_hq;
  IF _hq_org IS NULL OR _hq_org <> _org THEN
    RAISE EXCEPTION 'Target must be the HQ depot of the same organization';
  END IF;

  SELECT count(*) INTO _active_containers FROM public.containers
    WHERE depot_id = _depot_id AND status::text NOT IN ('sold','converted','off_hired','disposed');
  SELECT count(*) INTO _yard_blocks FROM public.yard_blocks WHERE depot_id = _depot_id;

  _blockers := jsonb_build_object('active_containers', _active_containers, 'yard_blocks', _yard_blocks);

  IF _active_containers > 0 OR _yard_blocks > 0 THEN
    RETURN jsonb_build_object('ok', false, 'blockers', _blockers);
  END IF;

  IF NOT _confirm_reconciled THEN
    RETURN jsonb_build_object('ok', true, 'blockers', _blockers, 'ready', true);
  END IF;

  UPDATE public.containers SET depot_id = _target_hq_id WHERE depot_id = _depot_id;

  INSERT INTO public.depot_lifecycle_events(depot_id, organization_id, event, actor, payload)
  VALUES (_depot_id, _org, 'retired', auth.uid(), jsonb_build_object('transferred_to', _target_hq_id));

  DELETE FROM public.depots WHERE id = _depot_id;

  RETURN jsonb_build_object('ok', true, 'deleted', true);
END;
$$;
REVOKE ALL ON FUNCTION public.retire_depot(uuid, uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.retire_depot(uuid, uuid, boolean) TO authenticated;
