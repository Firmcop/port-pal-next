-- Optional image per sub-assembly (an actual photo or a design drawing).
ALTER TABLE public.sub_assembly_stock ADD COLUMN IF NOT EXISTS image_path text;
ALTER TABLE public.sub_assembly_stock ADD COLUMN IF NOT EXISTS image_kind text;
DO $$ BEGIN
  ALTER TABLE public.sub_assembly_stock ADD CONSTRAINT sub_assembly_stock_image_kind_chk
    CHECK (image_kind IS NULL OR image_kind IN ('actual', 'design'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Private bucket, images only, 5 MB. Files live under <org_id>/<sku_id>/...
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('sub-assembly-images', 'sub-assembly-images', false, 5242880,
        ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic', 'image/heif'])
ON CONFLICT (id) DO UPDATE SET public = false, file_size_limit = EXCLUDED.file_size_limit,
                               allowed_mime_types = EXCLUDED.allowed_mime_types;

CREATE OR REPLACE FUNCTION public.can_edit_sub_assemblies()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT public.is_org_admin() OR public.can_write_module(auth.uid(), 'manufacturing');
$$;
GRANT EXECUTE ON FUNCTION public.can_edit_sub_assemblies() TO authenticated;

DO $$ BEGIN
  CREATE POLICY sub_assembly_images_select ON storage.objects FOR SELECT TO authenticated
    USING (bucket_id = 'sub-assembly-images' AND (storage.foldername(name))[1] = public.current_org_id()::text);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY sub_assembly_images_insert ON storage.objects FOR INSERT TO authenticated
    WITH CHECK (bucket_id = 'sub-assembly-images' AND (storage.foldername(name))[1] = public.current_org_id()::text
                AND public.can_edit_sub_assemblies());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY sub_assembly_images_delete ON storage.objects FOR DELETE TO authenticated
    USING (bucket_id = 'sub-assembly-images' AND (storage.foldername(name))[1] = public.current_org_id()::text
           AND public.can_edit_sub_assemblies());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- The image is part of the locked details.
CREATE OR REPLACE FUNCTION public.trg_sub_assembly_stock_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF current_setting('portpal.sa_lock_change', true) = 'on' THEN RETURN NEW; END IF;
  IF NEW.is_locked IS DISTINCT FROM OLD.is_locked OR NEW.locked_at IS DISTINCT FROM OLD.locked_at
     OR NEW.locked_by IS DISTINCT FROM OLD.locked_by OR NEW.lock_reason IS DISTINCT FROM OLD.lock_reason THEN
    RAISE EXCEPTION 'Use Lock / Unlock to change the lock';
  END IF;
  IF OLD.is_locked AND (NEW.name, NEW.assembly_type, NEW.uom, NEW.reorder_point, NEW.default_sale_price, NEW.project_id,
                        NEW.notes, NEW.archived_at, NEW.image_path, NEW.image_kind)
                       IS DISTINCT FROM
                       (OLD.name, OLD.assembly_type, OLD.uom, OLD.reorder_point, OLD.default_sale_price, OLD.project_id,
                        OLD.notes, OLD.archived_at, OLD.image_path, OLD.image_kind) THEN
    RAISE EXCEPTION '"%" is locked — an admin must unlock it before it can be changed', OLD.name;
  END IF;
  RETURN NEW;
END $$;

-- Set or clear the image. Returns the previous path so the app can remove the old file.
CREATE OR REPLACE FUNCTION public.set_sub_assembly_image(_id uuid, _path text, _kind text DEFAULT NULL)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE s sub_assembly_stock%ROWTYPE;
BEGIN
  SELECT * INTO s FROM sub_assembly_stock WHERE id = _id;
  IF NOT FOUND OR (s.organization_id <> public.current_org_id() AND NOT public.is_platform_admin()) THEN
    RAISE EXCEPTION 'Sub-assembly not found';
  END IF;
  IF NOT public.can_edit_sub_assemblies() THEN
    RAISE EXCEPTION 'You do not have permission to change sub-assembly images';
  END IF;
  IF _path IS NOT NULL AND split_part(_path, '/', 1) <> s.organization_id::text THEN
    RAISE EXCEPTION 'Invalid image path';
  END IF;
  UPDATE sub_assembly_stock
     SET image_path = NULLIF(_path, ''),
         image_kind = CASE WHEN NULLIF(_path, '') IS NULL THEN NULL ELSE COALESCE(NULLIF(_kind, ''), 'actual') END,
         updated_at = now()
   WHERE id = _id;
  RETURN s.image_path;
END $$;
REVOKE ALL ON FUNCTION public.set_sub_assembly_image(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_sub_assembly_image(uuid, text, text) TO authenticated;
