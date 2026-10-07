REVOKE EXECUTE ON FUNCTION public.conversion_budget_variance(uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.conversion_budget_variance(uuid) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.conversion_material_procurement_status(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.conversion_material_procurement_status(uuid) TO authenticated;