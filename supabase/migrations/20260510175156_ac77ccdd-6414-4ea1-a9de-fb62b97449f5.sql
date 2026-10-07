CREATE OR REPLACE FUNCTION public.validate_repatriation_release_link()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _ri RECORD;
BEGIN
  IF NEW.release_instruction_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT id, instruction_number, organization_id, container_id, status
    INTO _ri
    FROM public.release_instructions
    WHERE id = NEW.release_instruction_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'release_instruction_not_found';
  END IF;

  IF _ri.organization_id IS DISTINCT FROM NEW.organization_id THEN
    RAISE EXCEPTION 'release_instruction_org_mismatch';
  END IF;

  IF _ri.container_id IS NOT NULL
     AND NEW.container_id IS NOT NULL
     AND _ri.container_id <> NEW.container_id THEN
    RAISE EXCEPTION 'release_instruction_container_mismatch';
  END IF;

  -- Auto-align: if RO no is blank or differs, force it to match the instruction number
  IF NEW.release_order_no IS DISTINCT FROM _ri.instruction_number THEN
    IF TG_OP = 'UPDATE'
       AND OLD.release_instruction_id IS NOT DISTINCT FROM NEW.release_instruction_id
       AND OLD.release_order_no IS DISTINCT FROM NEW.release_order_no THEN
      RAISE EXCEPTION 'release_order_locked_to_instruction:%', _ri.instruction_number;
    END IF;
    NEW.release_order_no := _ri.instruction_number;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_repatriation_release_link ON public.repatriations;
CREATE TRIGGER trg_validate_repatriation_release_link
BEFORE INSERT OR UPDATE ON public.repatriations
FOR EACH ROW EXECUTE FUNCTION public.validate_repatriation_release_link();