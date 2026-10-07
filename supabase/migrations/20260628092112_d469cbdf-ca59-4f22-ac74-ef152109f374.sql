CREATE OR REPLACE FUNCTION public.apply_quote_template(_quote_id uuid, _template_id uuid, _mode text DEFAULT 'append'::text)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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

  UPDATE public.quotes SET
    notes = COALESCE(
      NULLIF(notes, ''),
      NULLIF(concat_ws(E'\n\n', NULLIF(_t.default_notes,''), NULLIF(_t.default_terms,'')), '')
    )
  WHERE id = _quote_id;

  RETURN _added;
END $function$;