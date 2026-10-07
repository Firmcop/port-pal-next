CREATE OR REPLACE FUNCTION public.post_conversion_material_consumption()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _mat uuid; _delta numeric; _cost numeric; _org uuid; _conv uuid;
BEGIN
  IF COALESCE(current_setting('app.skip_cm_sync', true), '') = 'on' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF TG_OP = 'INSERT' THEN
    _mat := NEW.material_id; _delta := COALESCE(NEW.qty_used,0);
    _cost := COALESCE(NEW.unit_cost,0); _org := NEW.organization_id; _conv := NEW.conversion_id;
  ELSIF TG_OP = 'UPDATE' THEN
    _mat := COALESCE(NEW.material_id, OLD.material_id);
    _delta := COALESCE(NEW.qty_used,0) - CASE WHEN OLD.material_id IS DISTINCT FROM NEW.material_id
                                              THEN 0 ELSE COALESCE(OLD.qty_used,0) END;
    _cost := COALESCE(NEW.unit_cost,0); _org := NEW.organization_id; _conv := NEW.conversion_id;
    IF OLD.material_id IS NOT NULL AND OLD.material_id IS DISTINCT FROM NEW.material_id
       AND COALESCE(OLD.qty_used,0) <> 0 THEN
      PERFORM set_config('app.skip_cm_sync','on', true);
      INSERT INTO public.material_movements (material_id, movement_type, qty, unit_cost, conversion_id, reason, organization_id, created_by)
      VALUES (OLD.material_id, 'return'::material_movement_type, COALESCE(OLD.qty_used,0), COALESCE(OLD.unit_cost,0), OLD.conversion_id,
              'Conversion BOM line re-pointed to another material', OLD.organization_id, auth.uid());
      PERFORM set_config('app.skip_cm_sync','off', true);
    END IF;
  ELSE
    _mat := OLD.material_id; _delta := -COALESCE(OLD.qty_used,0);
    _cost := COALESCE(OLD.unit_cost,0); _org := OLD.organization_id; _conv := OLD.conversion_id;
  END IF;

  IF _mat IS NULL OR COALESCE(_delta,0) = 0 THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  PERFORM set_config('app.skip_cm_sync','on', true);
  INSERT INTO public.material_movements (material_id, movement_type, qty, unit_cost, conversion_id, reason, organization_id, created_by)
  VALUES (_mat,
          (CASE WHEN _delta > 0 THEN 'issue' ELSE 'return' END)::material_movement_type,
          -_delta, _cost, _conv,
          CASE WHEN _delta > 0 THEN 'Consumed by conversion job' ELSE 'Consumption reduced / line removed' END,
          _org, auth.uid());
  PERFORM set_config('app.skip_cm_sync','off', true);

  RETURN COALESCE(NEW, OLD);
END $$;

REVOKE ALL ON FUNCTION public.post_conversion_material_consumption() FROM PUBLIC, anon, authenticated;
