
-- =========================================================
-- Quote Templates & Section Packs
-- =========================================================

CREATE TABLE IF NOT EXISTS public.quote_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL DEFAULT current_org_id() REFERENCES public.organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  category text,
  kind text NOT NULL DEFAULT 'full' CHECK (kind IN ('full','pack')),
  is_active boolean NOT NULL DEFAULT true,
  default_notes text,
  default_terms text,
  default_validity_days int,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_quote_templates_org ON public.quote_templates(organization_id);
CREATE INDEX IF NOT EXISTS idx_quote_templates_kind ON public.quote_templates(kind);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.quote_templates TO authenticated;
GRANT ALL ON public.quote_templates TO service_role;

ALTER TABLE public.quote_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org members view quote_templates" ON public.quote_templates FOR SELECT
USING (is_platform_admin() OR (organization_id = current_org_id() AND (
  has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'yard_operator'::app_role)
  OR has_role(auth.uid(),'gate_clerk'::app_role) OR has_role(auth.uid(),'viewer'::app_role))));
CREATE POLICY "Org staff insert quote_templates" ON public.quote_templates FOR INSERT
WITH CHECK (organization_id = current_org_id() AND (
  has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'yard_operator'::app_role)));
CREATE POLICY "Org staff update quote_templates" ON public.quote_templates FOR UPDATE
USING (is_platform_admin() OR (organization_id = current_org_id() AND (
  has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'yard_operator'::app_role))));
CREATE POLICY "Org admins delete quote_templates" ON public.quote_templates FOR DELETE
USING (is_platform_admin() OR (organization_id = current_org_id() AND has_role(auth.uid(),'admin'::app_role)));

-- Sections inside a template (also used as the single section of a 'pack')
CREATE TABLE IF NOT EXISTS public.quote_template_sections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id uuid NOT NULL REFERENCES public.quote_templates(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL DEFAULT current_org_id() REFERENCES public.organizations(id) ON DELETE CASCADE,
  title text NOT NULL,
  kind text NOT NULL DEFAULT 'other',
  notes text,
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_qts_template ON public.quote_template_sections(template_id);
CREATE INDEX IF NOT EXISTS idx_qts_org ON public.quote_template_sections(organization_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.quote_template_sections TO authenticated;
GRANT ALL ON public.quote_template_sections TO service_role;

ALTER TABLE public.quote_template_sections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org members view quote_template_sections" ON public.quote_template_sections FOR SELECT
USING (is_platform_admin() OR (organization_id = current_org_id() AND (
  has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'yard_operator'::app_role)
  OR has_role(auth.uid(),'gate_clerk'::app_role) OR has_role(auth.uid(),'viewer'::app_role))));
CREATE POLICY "Org staff write quote_template_sections" ON public.quote_template_sections FOR ALL
USING (is_platform_admin() OR (organization_id = current_org_id() AND (
  has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'yard_operator'::app_role))))
WITH CHECK (organization_id = current_org_id() AND (
  has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'yard_operator'::app_role)));

CREATE TABLE IF NOT EXISTS public.quote_template_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  section_id uuid NOT NULL REFERENCES public.quote_template_sections(id) ON DELETE CASCADE,
  template_id uuid NOT NULL REFERENCES public.quote_templates(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL DEFAULT current_org_id() REFERENCES public.organizations(id) ON DELETE CASCADE,
  item_type text NOT NULL DEFAULT 'product',
  item_kind text NOT NULL DEFAULT 'custom',
  ref_table text,
  ref_id uuid,
  description text NOT NULL,
  unit text,
  default_quantity numeric NOT NULL DEFAULT 1,
  default_unit_price numeric NOT NULL DEFAULT 0,
  discount_pct numeric NOT NULL DEFAULT 0,
  tax_pct numeric NOT NULL DEFAULT 0,
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_qti_section ON public.quote_template_items(section_id);
CREATE INDEX IF NOT EXISTS idx_qti_template ON public.quote_template_items(template_id);
CREATE INDEX IF NOT EXISTS idx_qti_org ON public.quote_template_items(organization_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.quote_template_items TO authenticated;
GRANT ALL ON public.quote_template_items TO service_role;

ALTER TABLE public.quote_template_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org members view quote_template_items" ON public.quote_template_items FOR SELECT
USING (is_platform_admin() OR (organization_id = current_org_id() AND (
  has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'yard_operator'::app_role)
  OR has_role(auth.uid(),'gate_clerk'::app_role) OR has_role(auth.uid(),'viewer'::app_role))));
CREATE POLICY "Org staff write quote_template_items" ON public.quote_template_items FOR ALL
USING (is_platform_admin() OR (organization_id = current_org_id() AND (
  has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'yard_operator'::app_role))))
WITH CHECK (organization_id = current_org_id() AND (
  has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'yard_operator'::app_role)));

-- updated_at trigger
CREATE OR REPLACE FUNCTION public.touch_quote_templates_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END $$;

DROP TRIGGER IF EXISTS trg_quote_templates_updated_at ON public.quote_templates;
CREATE TRIGGER trg_quote_templates_updated_at BEFORE UPDATE ON public.quote_templates
FOR EACH ROW EXECUTE FUNCTION public.touch_quote_templates_updated_at();

-- =========================================================
-- RPCs
-- =========================================================

-- Apply a full template into a quote. mode = 'replace' clears existing sections/items first.
CREATE OR REPLACE FUNCTION public.apply_quote_template(_quote_id uuid, _template_id uuid, _mode text DEFAULT 'append')
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _q record; _t record; _ts record; _ti record; _new_section_id uuid; _max_sort int; _added int := 0;
BEGIN
  SELECT * INTO _q FROM public.quotes WHERE id = _quote_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'quote_not_found'; END IF;
  IF _q.status <> 'draft' THEN RAISE EXCEPTION 'quote_not_editable'; END IF;

  SELECT * INTO _t FROM public.quote_templates WHERE id = _template_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'template_not_found'; END IF;

  IF _mode = 'replace' THEN
    DELETE FROM public.quote_items WHERE quote_id = _quote_id;
    DELETE FROM public.quote_sections WHERE quote_id = _quote_id;
  END IF;

  SELECT COALESCE(MAX(sort_order),0) INTO _max_sort FROM public.quote_sections WHERE quote_id = _quote_id;

  FOR _ts IN SELECT * FROM public.quote_template_sections WHERE template_id = _template_id ORDER BY sort_order
  LOOP
    _max_sort := _max_sort + 10;
    INSERT INTO public.quote_sections (quote_id, title, kind, notes, sort_order, organization_id)
    VALUES (_quote_id, _ts.title, _ts.kind, _ts.notes, _max_sort, _q.organization_id)
    RETURNING id INTO _new_section_id;

    FOR _ti IN SELECT * FROM public.quote_template_items WHERE section_id = _ts.id ORDER BY sort_order
    LOOP
      INSERT INTO public.quote_items (
        quote_id, section_id, item_type, item_kind, ref_table, ref_id,
        description, unit, quantity, unit_price, discount_pct, tax_pct, sort_order, organization_id
      ) VALUES (
        _quote_id, _new_section_id, _ti.item_type, _ti.item_kind, _ti.ref_table, _ti.ref_id,
        _ti.description, _ti.unit, _ti.default_quantity, _ti.default_unit_price,
        _ti.discount_pct, _ti.tax_pct, _ti.sort_order, _q.organization_id
      );
      _added := _added + 1;
    END LOOP;
  END LOOP;

  -- Pre-fill quote header defaults when empty
  UPDATE public.quotes SET
    notes = COALESCE(NULLIF(notes,''), _t.default_notes),
    terms = COALESCE(NULLIF(terms,''), _t.default_terms)
  WHERE id = _quote_id;

  RETURN _added;
END $$;

GRANT EXECUTE ON FUNCTION public.apply_quote_template(uuid, uuid, text) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.apply_quote_template(uuid, uuid, text) FROM anon;

-- Apply a section pack into an existing section (appends items)
CREATE OR REPLACE FUNCTION public.apply_section_pack(_section_id uuid, _template_id uuid)
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _sec record; _q record; _ti record; _max_sort int; _added int := 0;
BEGIN
  SELECT * INTO _sec FROM public.quote_sections WHERE id = _section_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'section_not_found'; END IF;
  SELECT * INTO _q FROM public.quotes WHERE id = _sec.quote_id;
  IF _q.status <> 'draft' THEN RAISE EXCEPTION 'quote_not_editable'; END IF;

  SELECT COALESCE(MAX(sort_order),0) INTO _max_sort FROM public.quote_items WHERE section_id = _section_id;

  FOR _ti IN SELECT * FROM public.quote_template_items WHERE template_id = _template_id ORDER BY sort_order
  LOOP
    _max_sort := _max_sort + 10;
    INSERT INTO public.quote_items (
      quote_id, section_id, item_type, item_kind, ref_table, ref_id,
      description, unit, quantity, unit_price, discount_pct, tax_pct, sort_order, organization_id
    ) VALUES (
      _q.id, _section_id, _ti.item_type, _ti.item_kind, _ti.ref_table, _ti.ref_id,
      _ti.description, _ti.unit, _ti.default_quantity, _ti.default_unit_price,
      _ti.discount_pct, _ti.tax_pct, _max_sort, _q.organization_id
    );
    _added := _added + 1;
  END LOOP;
  RETURN _added;
END $$;

GRANT EXECUTE ON FUNCTION public.apply_section_pack(uuid, uuid) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.apply_section_pack(uuid, uuid) FROM anon;

-- Snapshot a quote as a template
CREATE OR REPLACE FUNCTION public.save_quote_as_template(_quote_id uuid, _name text, _description text DEFAULT NULL, _category text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _q record; _new_t uuid; _sec record; _new_sec uuid;
BEGIN
  SELECT * INTO _q FROM public.quotes WHERE id = _quote_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'quote_not_found'; END IF;

  INSERT INTO public.quote_templates (organization_id, name, description, category, kind, default_notes, default_terms, created_by)
  VALUES (_q.organization_id, _name, _description, _category, 'full', _q.notes, _q.terms, auth.uid())
  RETURNING id INTO _new_t;

  FOR _sec IN SELECT * FROM public.quote_sections WHERE quote_id = _quote_id ORDER BY sort_order
  LOOP
    INSERT INTO public.quote_template_sections (template_id, organization_id, title, kind, notes, sort_order)
    VALUES (_new_t, _q.organization_id, _sec.title, _sec.kind, _sec.notes, _sec.sort_order)
    RETURNING id INTO _new_sec;

    INSERT INTO public.quote_template_items (
      section_id, template_id, organization_id, item_type, item_kind, ref_table, ref_id,
      description, unit, default_quantity, default_unit_price, discount_pct, tax_pct, sort_order
    )
    SELECT _new_sec, _new_t, _q.organization_id, item_type, item_kind, ref_table, ref_id,
           description, unit, quantity, unit_price, discount_pct, tax_pct, sort_order
    FROM public.quote_items WHERE section_id = _sec.id;
  END LOOP;

  RETURN _new_t;
END $$;

GRANT EXECUTE ON FUNCTION public.save_quote_as_template(uuid, text, text, text) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.save_quote_as_template(uuid, text, text, text) FROM anon;

-- Snapshot a single section as a section pack
CREATE OR REPLACE FUNCTION public.save_section_as_pack(_section_id uuid, _name text, _category text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _sec record; _q record; _new_t uuid; _new_sec uuid;
BEGIN
  SELECT * INTO _sec FROM public.quote_sections WHERE id = _section_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'section_not_found'; END IF;
  SELECT * INTO _q FROM public.quotes WHERE id = _sec.quote_id;

  INSERT INTO public.quote_templates (organization_id, name, category, kind, created_by)
  VALUES (_q.organization_id, _name, _category, 'pack', auth.uid())
  RETURNING id INTO _new_t;

  INSERT INTO public.quote_template_sections (template_id, organization_id, title, kind, notes, sort_order)
  VALUES (_new_t, _q.organization_id, _sec.title, _sec.kind, _sec.notes, 0)
  RETURNING id INTO _new_sec;

  INSERT INTO public.quote_template_items (
    section_id, template_id, organization_id, item_type, item_kind, ref_table, ref_id,
    description, unit, default_quantity, default_unit_price, discount_pct, tax_pct, sort_order
  )
  SELECT _new_sec, _new_t, _q.organization_id, item_type, item_kind, ref_table, ref_id,
         description, unit, quantity, unit_price, discount_pct, tax_pct, sort_order
  FROM public.quote_items WHERE section_id = _section_id;

  RETURN _new_t;
END $$;

GRANT EXECUTE ON FUNCTION public.save_section_as_pack(uuid, text, text) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.save_section_as_pack(uuid, text, text) FROM anon;
