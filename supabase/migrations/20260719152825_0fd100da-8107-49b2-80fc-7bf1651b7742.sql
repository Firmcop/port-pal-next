
CREATE OR REPLACE FUNCTION public.adjust_stock_batch(_items jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _item jsonb;
  _idx int := 0;
  _row public.stock_adjustments;
  _results jsonb := '[]'::jsonb;
BEGIN
  IF _items IS NULL OR jsonb_typeof(_items) <> 'array' THEN
    RAISE EXCEPTION 'items must be a JSON array';
  END IF;

  FOR _item IN SELECT * FROM jsonb_array_elements(_items) LOOP
    _idx := _idx + 1;
    BEGIN
      _row := public.adjust_stock(
        _item_type       := (_item->>'item_type')::public.stock_adjustment_item_type,
        _item_id         := (_item->>'item_id')::uuid,
        _adjustment_type := (_item->>'adjustment_type')::public.stock_adjustment_type,
        _reason_category := (_item->>'reason_category')::public.stock_adjustment_reason,
        _reason_text     := _item->>'reason_text',
        _new_qty         := (_item->>'new_qty')::numeric,
        _unit_cost       := NULLIF(_item->>'unit_cost','')::numeric,
        _from_depot      := NULLIF(_item->>'from_depot','')::uuid,
        _to_depot        := NULLIF(_item->>'to_depot','')::uuid
      );
      _results := _results || jsonb_build_object(
        'index', _idx,
        'reference', _row.reference,
        'id', _row.id
      );
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION 'Row % failed: %', _idx, SQLERRM;
    END;
  END LOOP;

  RETURN jsonb_build_object('count', _idx, 'results', _results);
END $$;

REVOKE ALL ON FUNCTION public.adjust_stock_batch(jsonb) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.adjust_stock_batch(jsonb) TO authenticated;
