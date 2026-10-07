
CREATE OR REPLACE FUNCTION public.insert_section_pack_into_template(
  _target_template_id uuid,
  _pack_template_id uuid,
  _title_prefix text DEFAULT NULL,
  _qty_multiplier numeric DEFAULT 1
)
RETURNS TABLE(new_section_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org uuid := current_org_id();
  v_target_org uuid;
  v_pack_org uuid;
  v_pack_kind text;
  v_base_sort int;
  r_sec record;
  v_new_section_id uuid;
  v_idx int := 0;
BEGIN
  IF _target_template_id IS NULL OR _pack_template_id IS NULL THEN
    RAISE EXCEPTION 'Target and pack template ids are required';
  END IF;
  IF _target_template_id = _pack_template_id THEN
    RAISE EXCEPTION 'Cannot insert a template into itself';
  END IF;
  IF coalesce(_qty_multiplier, 1) <= 0 THEN
    RAISE EXCEPTION 'Quantity multiplier must be greater than zero';
  END IF;

  SELECT organization_id INTO v_target_org FROM public.quote_templates WHERE id = _target_template_id;
  SELECT organization_id, kind INTO v_pack_org, v_pack_kind FROM public.quote_templates WHERE id = _pack_template_id;

  IF v_target_org IS NULL OR v_pack_org IS NULL THEN
    RAISE EXCEPTION 'Template not found';
  END IF;
  IF v_target_org <> v_org OR v_pack_org <> v_org THEN
    RAISE EXCEPTION 'Templates must belong to your organization';
  END IF;
  IF v_pack_kind <> 'pack' THEN
    RAISE EXCEPTION 'Source template must be a section pack';
  END IF;

  SELECT coalesce(max(sort_order), -1) + 1 INTO v_base_sort
  FROM public.quote_template_sections
  WHERE template_id = _target_template_id;

  FOR r_sec IN
    SELECT * FROM public.quote_template_sections
    WHERE template_id = _pack_template_id
    ORDER BY sort_order, created_at
  LOOP
    INSERT INTO public.quote_template_sections (template_id, title, kind, sort_order)
    VALUES (
      _target_template_id,
      CASE WHEN nullif(trim(coalesce(_title_prefix,'')),'') IS NOT NULL
           THEN _title_prefix || ' — ' || r_sec.title
           ELSE r_sec.title END,
      r_sec.kind,
      v_base_sort + v_idx
    )
    RETURNING id INTO v_new_section_id;

    INSERT INTO public.quote_template_items (
      template_id, section_id, description, unit,
      default_quantity, default_unit_price, discount_pct, tax_pct,
      item_kind, sort_order
    )
    SELECT
      _target_template_id, v_new_section_id, description, unit,
      coalesce(default_quantity,0) * _qty_multiplier,
      default_unit_price, discount_pct, tax_pct,
      item_kind, sort_order
    FROM public.quote_template_items
    WHERE template_id = _pack_template_id AND section_id = r_sec.id;

    new_section_id := v_new_section_id;
    RETURN NEXT;
    v_idx := v_idx + 1;
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION public.insert_section_pack_into_template(uuid, uuid, text, numeric) TO authenticated;
