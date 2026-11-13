-- =====================================================================
-- Container POs: height class (13 Nov 2026).
-- "Standard" height was saved as blank on the order and the receive screen
-- did not carry the height, so containers were received with no height class
-- (the gate-in screen requires HC or LC for dry containers).
--  * dry order lines: blank -> LC
--  * container_po_receive takes a height per container (height_class), else
--    the line's, else LC for dry
--  * containers already received on a PO with no height: from their line
-- Idempotent.
-- =====================================================================
UPDATE public.po_items i SET container_height = 'LC'
  FROM public.purchase_orders po
 WHERE po.id = i.po_id AND po.po_type = 'containers'
   AND i.container_height IS NULL AND COALESCE(i.container_category, 'dry') = 'dry';

DO $$
DECLARE _def text;
        _old text := '_it.container_height::container_height_class,';
        _new text := 'COALESCE(NULLIF(upper(btrim(COALESCE(_u->>''height_class'', ''''))), ''''), _it.container_height,'
                  || ' CASE WHEN COALESCE(_it.container_category, ''dry'') = ''dry'' THEN ''LC'' END)::container_height_class,';
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO _def FROM pg_proc p
   WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'container_po_receive';
  IF _def IS NULL THEN RAISE EXCEPTION 'container_po_receive not found — run 20261113170000_container_purchase_orders first'; END IF;
  IF position('_u->>''height_class''' IN _def) = 0 THEN
    IF position(_old IN _def) = 0 THEN RAISE EXCEPTION 'container_po_receive: height anchor not found'; END IF;
    EXECUTE replace(_def, _old, _new);
  END IF;
END $$;

-- containers already received with no height class
UPDATE public.containers c
   SET height_class = COALESCE(i.container_height, 'LC')::container_height_class, updated_at = now()
  FROM public.container_po_receipts r
  JOIN public.po_items i ON i.id = r.po_item_id
 WHERE r.container_id = c.id AND c.height_class IS NULL
   AND COALESCE(c.category::text, 'dry') = 'dry';
