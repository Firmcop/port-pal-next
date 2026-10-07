
-- ============ quote_template_visuals ============
CREATE TABLE IF NOT EXISTS public.quote_template_visuals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL DEFAULT current_org_id() REFERENCES public.organizations(id) ON DELETE CASCADE,
  template_id uuid NOT NULL REFERENCES public.quote_templates(id) ON DELETE CASCADE,
  section_id uuid REFERENCES public.quote_template_sections(id) ON DELETE CASCADE,
  kind text NOT NULL DEFAULT 'render' CHECK (kind IN ('render','floor_plan','section_design','material_sample','cover')),
  image_url text NOT NULL,
  caption text,
  sort_order int NOT NULL DEFAULT 0,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_qtv_template ON public.quote_template_visuals(template_id);
CREATE INDEX IF NOT EXISTS idx_qtv_section ON public.quote_template_visuals(section_id);
CREATE INDEX IF NOT EXISTS idx_qtv_org ON public.quote_template_visuals(organization_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.quote_template_visuals TO authenticated;
GRANT ALL ON public.quote_template_visuals TO service_role;
ALTER TABLE public.quote_template_visuals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org members view quote_template_visuals" ON public.quote_template_visuals
FOR SELECT USING (is_platform_admin() OR organization_id = current_org_id());
CREATE POLICY "Org staff write quote_template_visuals" ON public.quote_template_visuals
FOR ALL USING (is_platform_admin() OR (organization_id = current_org_id() AND (has_role(auth.uid(),'admin') OR has_role(auth.uid(),'yard_operator'))))
WITH CHECK (organization_id = current_org_id() AND (has_role(auth.uid(),'admin') OR has_role(auth.uid(),'yard_operator')));

-- ============ quote_visuals ============
CREATE TABLE IF NOT EXISTS public.quote_visuals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL DEFAULT current_org_id() REFERENCES public.organizations(id) ON DELETE CASCADE,
  quote_id uuid NOT NULL REFERENCES public.quotes(id) ON DELETE CASCADE,
  section_id uuid REFERENCES public.quote_sections(id) ON DELETE CASCADE,
  kind text NOT NULL DEFAULT 'render' CHECK (kind IN ('render','floor_plan','section_design','material_sample','cover')),
  image_url text NOT NULL,
  caption text,
  sort_order int NOT NULL DEFAULT 0,
  source text NOT NULL DEFAULT 'upload' CHECK (source IN ('upload','library','ai','template')),
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_qv_quote ON public.quote_visuals(quote_id);
CREATE INDEX IF NOT EXISTS idx_qv_section ON public.quote_visuals(section_id);
CREATE INDEX IF NOT EXISTS idx_qv_org ON public.quote_visuals(organization_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.quote_visuals TO authenticated;
GRANT ALL ON public.quote_visuals TO service_role;
ALTER TABLE public.quote_visuals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org members view quote_visuals" ON public.quote_visuals
FOR SELECT USING (is_platform_admin() OR organization_id = current_org_id());
CREATE POLICY "Org staff write quote_visuals" ON public.quote_visuals
FOR ALL USING (is_platform_admin() OR (organization_id = current_org_id() AND (has_role(auth.uid(),'admin') OR has_role(auth.uid(),'yard_operator'))))
WITH CHECK (organization_id = current_org_id() AND (has_role(auth.uid(),'admin') OR has_role(auth.uid(),'yard_operator')));

-- ============ quote_visual_library ============
CREATE TABLE IF NOT EXISTS public.quote_visual_library (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL DEFAULT current_org_id() REFERENCES public.organizations(id) ON DELETE CASCADE,
  category text,
  tags text[] DEFAULT '{}'::text[],
  kind text NOT NULL DEFAULT 'render' CHECK (kind IN ('render','floor_plan','section_design','material_sample','cover')),
  title text NOT NULL,
  image_url text NOT NULL,
  caption text,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_qvl_org ON public.quote_visual_library(organization_id);
CREATE INDEX IF NOT EXISTS idx_qvl_kind ON public.quote_visual_library(kind);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.quote_visual_library TO authenticated;
GRANT ALL ON public.quote_visual_library TO service_role;
ALTER TABLE public.quote_visual_library ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org members view quote_visual_library" ON public.quote_visual_library
FOR SELECT USING (is_platform_admin() OR organization_id = current_org_id());
CREATE POLICY "Org staff write quote_visual_library" ON public.quote_visual_library
FOR ALL USING (is_platform_admin() OR (organization_id = current_org_id() AND (has_role(auth.uid(),'admin') OR has_role(auth.uid(),'yard_operator'))))
WITH CHECK (organization_id = current_org_id() AND (has_role(auth.uid(),'admin') OR has_role(auth.uid(),'yard_operator')));

-- ============ quote_template_versions (snapshot history) ============
CREATE TABLE IF NOT EXISTS public.quote_template_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL DEFAULT current_org_id() REFERENCES public.organizations(id) ON DELETE CASCADE,
  template_id uuid NOT NULL REFERENCES public.quote_templates(id) ON DELETE CASCADE,
  version_no int NOT NULL,
  note text,
  payload jsonb NOT NULL,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(template_id, version_no)
);
CREATE INDEX IF NOT EXISTS idx_qtver_template ON public.quote_template_versions(template_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.quote_template_versions TO authenticated;
GRANT ALL ON public.quote_template_versions TO service_role;
ALTER TABLE public.quote_template_versions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org members view quote_template_versions" ON public.quote_template_versions
FOR SELECT USING (is_platform_admin() OR organization_id = current_org_id());
CREATE POLICY "Org staff write quote_template_versions" ON public.quote_template_versions
FOR ALL USING (is_platform_admin() OR (organization_id = current_org_id() AND (has_role(auth.uid(),'admin') OR has_role(auth.uid(),'yard_operator'))))
WITH CHECK (organization_id = current_org_id() AND (has_role(auth.uid(),'admin') OR has_role(auth.uid(),'yard_operator')));

-- ============ clone_quote_template ============
CREATE OR REPLACE FUNCTION public.clone_quote_template(_template_id uuid, _new_name text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _t record; _new_id uuid; _sec record; _new_sec uuid; _section_map jsonb := '{}'::jsonb;
BEGIN
  SELECT * INTO _t FROM public.quote_templates WHERE id = _template_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'template_not_found'; END IF;

  INSERT INTO public.quote_templates (organization_id, name, description, category, kind, is_active, default_notes, default_terms, default_validity_days, created_by)
  VALUES (_t.organization_id, COALESCE(_new_name, _t.name || ' (copy)'), _t.description, _t.category, _t.kind, true, _t.default_notes, _t.default_terms, _t.default_validity_days, auth.uid())
  RETURNING id INTO _new_id;

  FOR _sec IN SELECT * FROM public.quote_template_sections WHERE template_id = _template_id ORDER BY sort_order LOOP
    INSERT INTO public.quote_template_sections (template_id, organization_id, title, kind, notes, sort_order)
    VALUES (_new_id, _t.organization_id, _sec.title, _sec.kind, _sec.notes, _sec.sort_order)
    RETURNING id INTO _new_sec;
    _section_map := _section_map || jsonb_build_object(_sec.id::text, _new_sec::text);

    INSERT INTO public.quote_template_items (
      section_id, template_id, organization_id, item_type, item_kind, ref_table, ref_id,
      description, unit, default_quantity, default_unit_price, discount_pct, tax_pct, sort_order
    )
    SELECT _new_sec, _new_id, _t.organization_id, item_type, item_kind, ref_table, ref_id,
           description, unit, default_quantity, default_unit_price, discount_pct, tax_pct, sort_order
    FROM public.quote_template_items WHERE section_id = _sec.id;
  END LOOP;

  -- clone visuals (remap section ids)
  INSERT INTO public.quote_template_visuals (organization_id, template_id, section_id, kind, image_url, caption, sort_order, created_by)
  SELECT _t.organization_id, _new_id,
         CASE WHEN section_id IS NULL THEN NULL ELSE (_section_map->>section_id::text)::uuid END,
         kind, image_url, caption, sort_order, auth.uid()
  FROM public.quote_template_visuals WHERE template_id = _template_id;

  RETURN _new_id;
END $$;
GRANT EXECUTE ON FUNCTION public.clone_quote_template(uuid, text) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.clone_quote_template(uuid, text) FROM anon;

-- ============ snapshot helper + restore ============
CREATE OR REPLACE FUNCTION public.snapshot_quote_template(_template_id uuid, _note text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _t record; _next int; _id uuid; _payload jsonb;
BEGIN
  SELECT * INTO _t FROM public.quote_templates WHERE id = _template_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'template_not_found'; END IF;
  SELECT COALESCE(MAX(version_no),0) + 1 INTO _next FROM public.quote_template_versions WHERE template_id = _template_id;

  _payload := jsonb_build_object(
    'template', to_jsonb(_t),
    'sections', COALESCE((SELECT jsonb_agg(to_jsonb(s) ORDER BY s.sort_order) FROM public.quote_template_sections s WHERE s.template_id=_template_id), '[]'::jsonb),
    'items', COALESCE((SELECT jsonb_agg(to_jsonb(i) ORDER BY i.sort_order) FROM public.quote_template_items i WHERE i.template_id=_template_id), '[]'::jsonb),
    'visuals', COALESCE((SELECT jsonb_agg(to_jsonb(v) ORDER BY v.sort_order) FROM public.quote_template_visuals v WHERE v.template_id=_template_id), '[]'::jsonb)
  );

  INSERT INTO public.quote_template_versions (organization_id, template_id, version_no, note, payload, created_by)
  VALUES (_t.organization_id, _template_id, _next, _note, _payload, auth.uid())
  RETURNING id INTO _id;
  RETURN _id;
END $$;
GRANT EXECUTE ON FUNCTION public.snapshot_quote_template(uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.restore_quote_template_version(_version_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _v record; _t record; _sec_payload jsonb; _itm_payload jsonb; _vis_payload jsonb;
        _sec_obj jsonb; _itm_obj jsonb; _vis_obj jsonb;
        _old_to_new jsonb := '{}'::jsonb; _new_sec uuid;
BEGIN
  SELECT * INTO _v FROM public.quote_template_versions WHERE id = _version_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'version_not_found'; END IF;
  SELECT * INTO _t FROM public.quote_templates WHERE id = _v.template_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'template_not_found'; END IF;

  -- snapshot the current state first for safety
  PERFORM public.snapshot_quote_template(_v.template_id, 'auto-before-restore');

  DELETE FROM public.quote_template_visuals WHERE template_id = _v.template_id;
  DELETE FROM public.quote_template_items WHERE template_id = _v.template_id;
  DELETE FROM public.quote_template_sections WHERE template_id = _v.template_id;

  UPDATE public.quote_templates SET
    name = COALESCE(_v.payload->'template'->>'name', name),
    description = _v.payload->'template'->>'description',
    category = _v.payload->'template'->>'category',
    default_notes = _v.payload->'template'->>'default_notes',
    default_terms = _v.payload->'template'->>'default_terms'
  WHERE id = _v.template_id;

  _sec_payload := COALESCE(_v.payload->'sections','[]'::jsonb);
  FOR _sec_obj IN SELECT * FROM jsonb_array_elements(_sec_payload) LOOP
    INSERT INTO public.quote_template_sections (template_id, organization_id, title, kind, notes, sort_order)
    VALUES (_v.template_id, _t.organization_id, _sec_obj->>'title', COALESCE(_sec_obj->>'kind','other'), _sec_obj->>'notes', COALESCE((_sec_obj->>'sort_order')::int,0))
    RETURNING id INTO _new_sec;
    _old_to_new := _old_to_new || jsonb_build_object(_sec_obj->>'id', _new_sec::text);
  END LOOP;

  _itm_payload := COALESCE(_v.payload->'items','[]'::jsonb);
  FOR _itm_obj IN SELECT * FROM jsonb_array_elements(_itm_payload) LOOP
    INSERT INTO public.quote_template_items (
      section_id, template_id, organization_id, item_type, item_kind, ref_table, ref_id,
      description, unit, default_quantity, default_unit_price, discount_pct, tax_pct, sort_order
    ) VALUES (
      (_old_to_new->>(_itm_obj->>'section_id'))::uuid, _v.template_id, _t.organization_id,
      COALESCE(_itm_obj->>'item_type','product'), COALESCE(_itm_obj->>'item_kind','custom'),
      _itm_obj->>'ref_table', NULLIF(_itm_obj->>'ref_id','')::uuid,
      _itm_obj->>'description', _itm_obj->>'unit',
      COALESCE((_itm_obj->>'default_quantity')::numeric,1),
      COALESCE((_itm_obj->>'default_unit_price')::numeric,0),
      COALESCE((_itm_obj->>'discount_pct')::numeric,0),
      COALESCE((_itm_obj->>'tax_pct')::numeric,0),
      COALESCE((_itm_obj->>'sort_order')::int,0)
    );
  END LOOP;

  _vis_payload := COALESCE(_v.payload->'visuals','[]'::jsonb);
  FOR _vis_obj IN SELECT * FROM jsonb_array_elements(_vis_payload) LOOP
    INSERT INTO public.quote_template_visuals (organization_id, template_id, section_id, kind, image_url, caption, sort_order)
    VALUES (_t.organization_id, _v.template_id,
      CASE WHEN _vis_obj->>'section_id' IS NULL THEN NULL ELSE (_old_to_new->>(_vis_obj->>'section_id'))::uuid END,
      COALESCE(_vis_obj->>'kind','render'), _vis_obj->>'image_url', _vis_obj->>'caption',
      COALESCE((_vis_obj->>'sort_order')::int,0));
  END LOOP;

  RETURN _v.template_id;
END $$;
GRANT EXECUTE ON FUNCTION public.restore_quote_template_version(uuid) TO authenticated;

-- ============ update apply_quote_template to also copy visuals ============
CREATE OR REPLACE FUNCTION public.apply_quote_template(_quote_id uuid, _template_id uuid, _mode text DEFAULT 'append'::text)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = 'public' AS $function$
DECLARE _q record; _t record; _ts record; _ti record; _new_section_id uuid; _max_sort int; _added int := 0;
        _section_map jsonb := '{}'::jsonb;
BEGIN
  SELECT * INTO _q FROM public.quotes WHERE id = _quote_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'quote_not_found'; END IF;
  IF _q.status <> 'draft' THEN RAISE EXCEPTION 'quote_not_editable'; END IF;

  SELECT * INTO _t FROM public.quote_templates WHERE id = _template_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'template_not_found'; END IF;

  IF _mode = 'replace' THEN
    DELETE FROM public.quote_items WHERE quote_id = _quote_id;
    DELETE FROM public.quote_sections WHERE quote_id = _quote_id;
    DELETE FROM public.quote_visuals WHERE quote_id = _quote_id AND source = 'template';
  END IF;

  SELECT COALESCE(MAX(sort_order),0) INTO _max_sort FROM public.quote_sections WHERE quote_id = _quote_id;

  FOR _ts IN SELECT * FROM public.quote_template_sections WHERE template_id = _template_id ORDER BY sort_order LOOP
    _max_sort := _max_sort + 10;
    INSERT INTO public.quote_sections (quote_id, title, kind, notes, sort_order, organization_id)
    VALUES (_quote_id, _ts.title, _ts.kind, _ts.notes, _max_sort, _q.organization_id)
    RETURNING id INTO _new_section_id;
    _section_map := _section_map || jsonb_build_object(_ts.id::text, _new_section_id::text);

    FOR _ti IN SELECT * FROM public.quote_template_items WHERE section_id = _ts.id ORDER BY sort_order LOOP
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

  -- copy visuals
  INSERT INTO public.quote_visuals (organization_id, quote_id, section_id, kind, image_url, caption, sort_order, source, created_by)
  SELECT _q.organization_id, _quote_id,
         CASE WHEN section_id IS NULL THEN NULL ELSE (_section_map->>section_id::text)::uuid END,
         kind, image_url, caption, sort_order, 'template', auth.uid()
  FROM public.quote_template_visuals WHERE template_id = _template_id;

  UPDATE public.quotes SET
    notes = COALESCE(
      NULLIF(notes, ''),
      NULLIF(concat_ws(E'\n\n', NULLIF(_t.default_notes,''), NULLIF(_t.default_terms,'')), '')
    )
  WHERE id = _quote_id;

  RETURN _added;
END $function$;
