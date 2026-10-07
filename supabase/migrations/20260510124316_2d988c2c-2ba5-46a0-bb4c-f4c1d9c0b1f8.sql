
ALTER TABLE public.conversion_materials
  ADD COLUMN IF NOT EXISTS material_id uuid REFERENCES public.materials(id);
CREATE INDEX IF NOT EXISTS idx_cm_material ON public.conversion_materials(conversion_id, material_id);
