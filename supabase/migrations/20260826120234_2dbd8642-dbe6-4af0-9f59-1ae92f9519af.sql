DO $migration$
DECLARE
  _definition text;
BEGIN
  SELECT pg_get_functiondef(p.oid)
    INTO _definition
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname = 'apply_split_output_allocation'
     AND pg_get_function_identity_arguments(p.oid) = '_conversion_id uuid, _reason text';

  IF _definition IS NULL THEN
    RAISE EXCEPTION 'apply_split_output_allocation(uuid, text) not found';
  END IF;

  IF position('DELETE FROM _split_kids;' IN _definition) = 0 THEN
    RAISE EXCEPTION 'Expected temporary-table cleanup statement not found';
  END IF;

  _definition := replace(
    _definition,
    'DELETE FROM _split_kids;',
    'TRUNCATE TABLE _split_kids;'
  );

  EXECUTE _definition;
END
$migration$;