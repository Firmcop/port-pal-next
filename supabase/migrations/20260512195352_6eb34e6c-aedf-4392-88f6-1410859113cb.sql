-- Wave 2: Logistics cost sync — backfill unposted costs
CREATE OR REPLACE FUNCTION public.logistics_backfill_unposted_costs()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _r logistics_trip_costs%ROWTYPE;
  _count integer := 0;
BEGIN
  IF current_org_id() IS NULL AND NOT is_platform_admin() THEN
    RAISE EXCEPTION 'no_org_context';
  END IF;
  FOR _r IN
    SELECT * FROM logistics_trip_costs
    WHERE expense_txn_id IS NULL
      AND (is_platform_admin() OR organization_id = current_org_id())
    ORDER BY created_at
  LOOP
    PERFORM logistics_post_trip_cost(_r.id);
    _count := _count + 1;
  END LOOP;
  RETURN _count;
END $$;

REVOKE EXECUTE ON FUNCTION public.logistics_backfill_unposted_costs() FROM anon;
GRANT EXECUTE ON FUNCTION public.logistics_backfill_unposted_costs() TO authenticated;