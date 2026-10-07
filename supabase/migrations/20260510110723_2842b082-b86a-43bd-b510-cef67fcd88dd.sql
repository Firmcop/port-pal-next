
REVOKE EXECUTE ON FUNCTION public.org_usage_metrics(uuid, int) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.org_audit_feed(uuid, int, timestamptz) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.depot_kpis(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.org_usage_metrics(uuid, int) TO authenticated;
GRANT EXECUTE ON FUNCTION public.org_audit_feed(uuid, int, timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.depot_kpis(uuid) TO authenticated;
