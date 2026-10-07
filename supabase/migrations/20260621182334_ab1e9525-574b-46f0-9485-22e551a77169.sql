
REVOKE EXECUTE ON FUNCTION public.seed_default_fx_rates(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.seed_default_dunning_rules(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.seed_default_tax_codes(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.seed_default_fx_rates(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.seed_default_dunning_rules(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.seed_default_tax_codes(uuid) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.adopt_legacy_org_data(uuid,boolean) FROM anon;
REVOKE EXECUTE ON FUNCTION public.stamp_eir_gate_fee() FROM PUBLIC, anon;
