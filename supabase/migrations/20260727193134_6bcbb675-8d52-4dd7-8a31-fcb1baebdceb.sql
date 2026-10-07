DO $$
DECLARE
  affected uuid[];
BEGIN
  SELECT array_agg(DISTINCT conversion_id) INTO affected
  FROM public.conversion_materials WHERE source = 'quote';

  DELETE FROM public.conversion_materials WHERE source = 'quote';

  IF affected IS NOT NULL THEN
    UPDATE public.container_conversions cc
    SET actual_cost =
      COALESCE((SELECT SUM(total_cost) FROM public.conversion_materials m WHERE m.conversion_id = cc.id), 0)
      + COALESCE((SELECT SUM(total_cost) FROM public.conversion_labour l WHERE l.conversion_id = cc.id), 0)
      + COALESCE((SELECT SUM(cost) FROM public.conversion_services s WHERE s.conversion_id = cc.id), 0)
      + COALESCE(cc.container_cost, 0)
      + COALESCE(cc.transport_offloading_cost, 0),
      updated_at = now()
    WHERE cc.id = ANY(affected);
  END IF;
END $$;