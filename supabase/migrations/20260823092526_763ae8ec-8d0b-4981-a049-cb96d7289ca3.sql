REVOKE ALL ON FUNCTION public.set_sale_ownership_fields() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.acquire_container_from_owner(uuid, numeric, text, text, text, text, numeric) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.record_container_service_invoice(uuid, text, numeric, text, text, text, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.acquire_container_from_owner(uuid, numeric, text, text, text, text, numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_container_service_invoice(uuid, text, numeric, text, text, text, numeric) TO authenticated;