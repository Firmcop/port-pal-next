
CREATE TABLE public.products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL DEFAULT current_org_id(),
  name text NOT NULL,
  slug text NOT NULL,
  category text,
  short_description text,
  long_description text,
  base_price numeric(14,2),
  currency text,
  cover_image_url text,
  gallery jsonb NOT NULL DEFAULT '[]'::jsonb,
  specs jsonb NOT NULL DEFAULT '{}'::jsonb,
  source_template_id uuid REFERENCES public.quote_templates(id) ON DELETE SET NULL,
  is_published boolean NOT NULL DEFAULT false,
  sort_order integer NOT NULL DEFAULT 0,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, slug)
);

GRANT SELECT ON public.products TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.products TO authenticated;
GRANT ALL ON public.products TO service_role;

ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public can view published products"
  ON public.products FOR SELECT TO anon
  USING (is_published = true);

CREATE POLICY "Org members can view own products"
  ON public.products FOR SELECT TO authenticated
  USING (organization_id = current_org_id() OR is_platform_admin());

CREATE POLICY "Org members can manage own products"
  ON public.products FOR ALL TO authenticated
  USING (organization_id = current_org_id() OR is_platform_admin())
  WITH CHECK (organization_id = current_org_id() OR is_platform_admin());

CREATE TRIGGER products_set_updated_at
  BEFORE UPDATE ON public.products
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER products_set_currency
  BEFORE INSERT ON public.products
  FOR EACH ROW EXECUTE FUNCTION public.set_currency_from_org();

CREATE INDEX products_org_published_idx ON public.products (organization_id, is_published, sort_order);
CREATE INDEX products_slug_idx ON public.products (slug);
