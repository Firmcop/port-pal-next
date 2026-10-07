REVOKE EXECUTE ON FUNCTION public.bill_repatriation_to_owner(uuid) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.currency_digits(text) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.find_or_create_customer_by_name(uuid, text) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.mark_repatriation_invoice_paid(uuid, uuid, payment_method, text, timestamp with time zone, text) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.preview_repatriation_bill(uuid) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.trg_audit_containers() FROM anon, PUBLIC;