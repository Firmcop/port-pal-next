
CREATE POLICY "Admins can delete materials" ON public.materials
  FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins can delete material_stock" ON public.material_stock
  FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin'::app_role));
