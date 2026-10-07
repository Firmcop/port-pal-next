REVOKE EXECUTE ON FUNCTION public.can_view_customer_records(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.is_active_org_member(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_view_customer_records(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_active_org_member(uuid) TO authenticated;