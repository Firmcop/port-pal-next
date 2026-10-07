
-- 1) Tighten depot_lifecycle_events INSERT policy
DROP POLICY IF EXISTS depot_lifecycle_events_insert ON public.depot_lifecycle_events;
CREATE POLICY depot_lifecycle_events_insert ON public.depot_lifecycle_events
  FOR INSERT TO authenticated
  WITH CHECK (is_platform_admin() OR organization_id = current_org_id());

-- 2) Fix mutable search_path on non-extension functions
ALTER FUNCTION public.next_stock_adj_reference(uuid) SET search_path = public;
ALTER FUNCTION public.split_letter_suffix(integer) SET search_path = public;
ALTER FUNCTION public.trg_stock_adj_immutable() SET search_path = public;

-- 3) Revoke EXECUTE from anon/public on SECURITY DEFINER functions
REVOKE EXECUTE ON FUNCTION public.ensure_stock_adj_gl_account(uuid, text, text, account_type) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.gate_out_finished_product(uuid, jsonb, text, text, text, text, text, text) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.insert_section_pack_into_template(uuid, uuid, text, numeric) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.stamp_project_from_conversion() FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.trg_recalc_po_from_header() FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.trg_recalc_po_from_items() FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.trg_set_conversion_number() FROM anon, PUBLIC;

-- Ensure authenticated + service_role retain access for the RPC-callable ones
GRANT EXECUTE ON FUNCTION public.ensure_stock_adj_gl_account(uuid, text, text, account_type) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.gate_out_finished_product(uuid, jsonb, text, text, text, text, text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.insert_section_pack_into_template(uuid, uuid, text, numeric) TO authenticated, service_role;
