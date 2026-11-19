-- =====================================================================
-- Sub-assembly stock: admin edit, delete and lock (19 Nov 2026).
--  * Lock (admin / company owner only): the SKU's details and its BOM are
--    frozen — no edits, no BOM changes, no deleting. Stock keeps moving
--    (build, adjust, sell, use on jobs). Unlock to change it again.
--  * Delete (admin / company owner only): a SKU with no stock history is
--    removed with its BOM; one that has been built, moved, sold or used on a
--    job is archived instead (hidden, no new activity), so its history and
--    the books stay intact.
--  * Edit details (name, type, unit, reorder point, sale price, project, notes).
-- =====================================================================
ALTER TABLE public.sub_assembly_stock ADD COLUMN IF NOT EXISTS is_locked boolean NOT NULL DEFAULT false;
ALTER TABLE public.sub_assembly_stock ADD COLUMN IF NOT EXISTS locked_at timestamptz;
ALTER TABLE public.sub_assembly_stock ADD COLUMN IF NOT EXISTS locked_by uuid;
ALTER TABLE public.sub_assembly_stock ADD COLUMN IF NOT EXISTS lock_reason text;
ALTER TABLE public.sub_assembly_stock ADD COLUMN IF NOT EXISTS archived_at timestamptz;

CREATE OR REPLACE FUNCTION public.is_org_admin()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT public.is_platform_admin() OR public.has_role(auth.uid(), 'admin')
      OR public.is_org_owner(auth.uid(), public.current_org_id());
$$;
GRANT EXECUTE ON FUNCTION public.is_org_admin() TO authenticated;

-- details and BOM frozen while locked; lock fields only through set_sub_assembly_lock
CREATE OR REPLACE FUNCTION public.trg_sub_assembly_stock_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF current_setting('portpal.sa_lock_change', true) = 'on' THEN RETURN NEW; END IF;
  IF NEW.is_locked IS DISTINCT FROM OLD.is_locked OR NEW.locked_at IS DISTINCT FROM OLD.locked_at
     OR NEW.locked_by IS DISTINCT FROM OLD.locked_by OR NEW.lock_reason IS DISTINCT FROM OLD.lock_reason THEN
    RAISE EXCEPTION 'Use Lock / Unlock to change the lock';
  END IF;
  IF OLD.is_locked AND (NEW.name, NEW.assembly_type, NEW.uom, NEW.reorder_point, NEW.default_sale_price, NEW.project_id, NEW.notes, NEW.archived_at)
                       IS DISTINCT FROM
                       (OLD.name, OLD.assembly_type, OLD.uom, OLD.reorder_point, OLD.default_sale_price, OLD.project_id, OLD.notes, OLD.archived_at) THEN
    RAISE EXCEPTION '"%" is locked — an admin must unlock it before it can be changed', OLD.name;
  END IF;
  RETURN NEW;
END $$;
CREATE OR REPLACE TRIGGER trg_sub_assembly_stock_guard BEFORE UPDATE ON public.sub_assembly_stock
  FOR EACH ROW EXECUTE FUNCTION public.trg_sub_assembly_stock_guard();

CREATE OR REPLACE FUNCTION public.trg_sub_assembly_bom_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _id uuid := COALESCE(NEW.assembly_stock_id, OLD.assembly_stock_id); _name text; _locked boolean;
BEGIN
  IF current_setting('portpal.sa_lock_change', true) = 'on' THEN RETURN COALESCE(NEW, OLD); END IF;
  SELECT name, is_locked INTO _name, _locked FROM sub_assembly_stock WHERE id = _id;
  IF COALESCE(_locked, false) THEN
    RAISE EXCEPTION 'The BOM of "%" is locked — an admin must unlock it first', _name;
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;
CREATE OR REPLACE TRIGGER trg_sub_assembly_bom_materials_guard BEFORE INSERT OR UPDATE OR DELETE ON public.sub_assembly_bom_materials
  FOR EACH ROW EXECUTE FUNCTION public.trg_sub_assembly_bom_guard();
CREATE OR REPLACE TRIGGER trg_sub_assembly_bom_labor_guard BEFORE INSERT OR UPDATE OR DELETE ON public.sub_assembly_bom_labor
  FOR EACH ROW EXECUTE FUNCTION public.trg_sub_assembly_bom_guard();
CREATE OR REPLACE TRIGGER trg_sub_assembly_bom_overheads_guard BEFORE INSERT OR UPDATE OR DELETE ON public.sub_assembly_bom_overheads
  FOR EACH ROW EXECUTE FUNCTION public.trg_sub_assembly_bom_guard();

CREATE OR REPLACE FUNCTION public.set_sub_assembly_lock(_id uuid, _locked boolean, _reason text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE s sub_assembly_stock%ROWTYPE;
BEGIN
  IF NOT public.is_org_admin() THEN RAISE EXCEPTION 'Only an admin can lock or unlock a sub-assembly'; END IF;
  SELECT * INTO s FROM sub_assembly_stock WHERE id = _id FOR UPDATE;
  IF NOT FOUND OR (s.organization_id <> public.current_org_id() AND NOT public.is_platform_admin()) THEN
    RAISE EXCEPTION 'Sub-assembly not found';
  END IF;
  PERFORM set_config('portpal.sa_lock_change', 'on', true);
  UPDATE sub_assembly_stock
     SET is_locked = _locked,
         locked_at = CASE WHEN _locked THEN now() END,
         locked_by = CASE WHEN _locked THEN auth.uid() END,
         lock_reason = CASE WHEN _locked THEN NULLIF(btrim(COALESCE(_reason, '')), '') END,
         updated_at = now()
   WHERE id = _id;
  PERFORM set_config('portpal.sa_lock_change', 'off', true);
END $$;

-- edit details (admin, or anyone who may write manufacturing, while unlocked)
CREATE OR REPLACE FUNCTION public.update_sub_assembly(_id uuid, _name text, _assembly_type text, _uom text,
                                                      _reorder_point numeric, _default_sale_price numeric,
                                                      _project_id uuid, _notes text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE s sub_assembly_stock%ROWTYPE;
BEGIN
  SELECT * INTO s FROM sub_assembly_stock WHERE id = _id;
  IF NOT FOUND OR (s.organization_id <> public.current_org_id() AND NOT public.is_platform_admin()) THEN
    RAISE EXCEPTION 'Sub-assembly not found';
  END IF;
  IF NOT (public.is_org_admin() OR public.can_write_module(auth.uid(), 'manufacturing')) THEN
    RAISE EXCEPTION 'You do not have permission to edit sub-assemblies';
  END IF;
  IF NULLIF(btrim(COALESCE(_name, '')), '') IS NULL THEN RAISE EXCEPTION 'Enter a name'; END IF;
  UPDATE sub_assembly_stock
     SET name = btrim(_name),
         assembly_type = COALESCE(NULLIF(_assembly_type, ''), assembly_type::text)::assembly_type,
         uom = COALESCE(NULLIF(btrim(COALESCE(_uom, '')), ''), uom),
         reorder_point = COALESCE(_reorder_point, 0),
         default_sale_price = _default_sale_price,
         project_id = _project_id,
         notes = NULLIF(btrim(COALESCE(_notes, '')), ''),
         updated_at = now()
   WHERE id = _id;
END $$;

-- delete, or archive when it has history
CREATE OR REPLACE FUNCTION public.delete_sub_assembly(_id uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE s sub_assembly_stock%ROWTYPE; _used boolean;
BEGIN
  IF NOT public.is_org_admin() THEN RAISE EXCEPTION 'Only an admin can delete a sub-assembly'; END IF;
  SELECT * INTO s FROM sub_assembly_stock WHERE id = _id FOR UPDATE;
  IF NOT FOUND OR (s.organization_id <> public.current_org_id() AND NOT public.is_platform_admin()) THEN
    RAISE EXCEPTION 'Sub-assembly not found';
  END IF;
  IF s.is_locked THEN RAISE EXCEPTION '"%" is locked — unlock it before deleting', s.name; END IF;
  IF COALESCE(s.on_hand_qty, 0) <> 0 THEN
    RAISE EXCEPTION '"%" still has % % in stock — adjust the stock to zero first', s.name, s.on_hand_qty, s.uom;
  END IF;
  _used := EXISTS (SELECT 1 FROM sub_assembly_movements WHERE assembly_stock_id = _id)
        OR EXISTS (SELECT 1 FROM sub_assembly_lots WHERE assembly_stock_id = _id)
        OR EXISTS (SELECT 1 FROM sub_assembly_sales WHERE assembly_stock_id = _id)
        OR EXISTS (SELECT 1 FROM conversion_sub_assemblies WHERE assembly_stock_id = _id);
  IF _used THEN
    UPDATE sub_assembly_stock SET archived_at = now(), updated_at = now() WHERE id = _id;
    RETURN 'archived';
  END IF;
  DELETE FROM sub_assembly_stock WHERE id = _id;   -- its BOM lines go with it
  RETURN 'deleted';
END $$;

CREATE OR REPLACE FUNCTION public.restore_sub_assembly(_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NOT public.is_org_admin() THEN RAISE EXCEPTION 'Only an admin can restore a sub-assembly'; END IF;
  UPDATE sub_assembly_stock SET archived_at = NULL, updated_at = now()
   WHERE id = _id AND (organization_id = public.current_org_id() OR public.is_platform_admin());
END $$;

-- no new builds, sales or adjustments on an archived SKU
CREATE OR REPLACE FUNCTION public.trg_sub_assembly_archived_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM sub_assembly_stock WHERE id = NEW.assembly_stock_id AND archived_at IS NOT NULL) THEN
    RAISE EXCEPTION 'This sub-assembly has been archived — restore it first';
  END IF;
  RETURN NEW;
END $$;
CREATE OR REPLACE TRIGGER trg_sub_assembly_movements_archived BEFORE INSERT ON public.sub_assembly_movements
  FOR EACH ROW EXECUTE FUNCTION public.trg_sub_assembly_archived_guard();
CREATE OR REPLACE TRIGGER trg_sub_assembly_sales_archived BEFORE INSERT ON public.sub_assembly_sales
  FOR EACH ROW EXECUTE FUNCTION public.trg_sub_assembly_archived_guard();

REVOKE ALL ON FUNCTION public.set_sub_assembly_lock(uuid, boolean, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.update_sub_assembly(uuid, text, text, text, numeric, numeric, uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.delete_sub_assembly(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.restore_sub_assembly(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_sub_assembly_lock(uuid, boolean, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_sub_assembly(uuid, text, text, text, numeric, numeric, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_sub_assembly(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.restore_sub_assembly(uuid) TO authenticated;
