
CREATE EXTENSION IF NOT EXISTS pg_trgm;

ALTER TABLE public.materials
  ADD COLUMN IF NOT EXISTS name_norm text
    GENERATED ALWAYS AS (
      regexp_replace(regexp_replace(lower(btrim(name)), '[^a-z0-9]+', ' ', 'g'), '\s+', ' ', 'g')
    ) STORED,
  ADD COLUMN IF NOT EXISTS merged_into_id uuid REFERENCES public.materials(id);

CREATE OR REPLACE FUNCTION public.merge_materials(_from uuid, _into uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_from_org uuid;
  v_into_org uuid;
  v_from_avail numeric;
  v_from_res numeric;
  v_into_exists boolean;
BEGIN
  IF _from = _into THEN
    RAISE EXCEPTION 'Cannot merge a material into itself';
  END IF;

  SELECT organization_id INTO v_from_org FROM public.materials WHERE id = _from;
  SELECT organization_id INTO v_into_org FROM public.materials WHERE id = _into;
  IF v_from_org IS NULL OR v_into_org IS NULL THEN
    RAISE EXCEPTION 'Material not found';
  END IF;
  IF v_from_org <> v_into_org THEN
    RAISE EXCEPTION 'Materials belong to different organizations';
  END IF;

  IF auth.uid() IS NOT NULL
     AND NOT (public.is_platform_admin()
              OR (v_from_org = public.current_org_id()
                  AND public.has_role(auth.uid(), 'admin'::app_role))) THEN
    RAISE EXCEPTION 'Not authorized to merge materials';
  END IF;

  UPDATE public.conversion_materials       SET material_id = _into WHERE material_id = _from;
  UPDATE public.material_movements         SET material_id = _into WHERE material_id = _from;
  UPDATE public.po_items                   SET material_id = _into WHERE material_id = _from;
  UPDATE public.store_issues               SET material_id = _into WHERE material_id = _from;
  UPDATE public.store_returns              SET material_id = _into WHERE material_id = _from;
  UPDATE public.sub_assembly_bom_materials SET material_id = _into WHERE material_id = _from;

  SELECT COALESCE(qty_available,0), COALESCE(qty_reserved,0)
    INTO v_from_avail, v_from_res
    FROM public.material_stock WHERE material_id = _from;

  IF v_from_avail IS NOT NULL THEN
    SELECT true INTO v_into_exists FROM public.material_stock WHERE material_id = _into;
    IF v_into_exists THEN
      UPDATE public.material_stock
         SET qty_available = COALESCE(qty_available,0) + v_from_avail,
             qty_reserved  = COALESCE(qty_reserved,0)  + v_from_res
       WHERE material_id = _into;
    ELSE
      INSERT INTO public.material_stock (material_id, organization_id, qty_available, qty_reserved)
      VALUES (_into, v_into_org, v_from_avail, v_from_res);
    END IF;
    DELETE FROM public.material_stock WHERE material_id = _from;
  END IF;

  UPDATE public.materials
     SET is_active = false, merged_into_id = _into
   WHERE id = _from;

  RETURN _into;
END;
$$;

REVOKE ALL ON FUNCTION public.merge_materials(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.merge_materials(uuid, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.merge_materials(uuid, uuid) TO authenticated;

DO $$
DECLARE
  r record;
  dup record;
BEGIN
  FOR r IN
    SELECT organization_id, name_norm,
           (array_agg(id ORDER BY created_at, id))[1] AS keep_id
      FROM public.materials
     WHERE is_active
     GROUP BY organization_id, name_norm
    HAVING count(*) > 1
  LOOP
    FOR dup IN
      SELECT id FROM public.materials
       WHERE is_active
         AND organization_id = r.organization_id
         AND name_norm = r.name_norm
         AND id <> r.keep_id
    LOOP
      PERFORM public.merge_materials(dup.id, r.keep_id);
    END LOOP;
  END LOOP;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS materials_org_name_norm_active_uidx
  ON public.materials(organization_id, name_norm)
  WHERE is_active = true;

CREATE INDEX IF NOT EXISTS materials_name_norm_trgm_idx
  ON public.materials USING gin (name_norm gin_trgm_ops);
