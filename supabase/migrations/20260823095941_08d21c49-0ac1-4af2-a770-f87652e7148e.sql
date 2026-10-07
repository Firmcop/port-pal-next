
DROP FUNCTION IF EXISTS public.post_contra_settlement(uuid, text, numeric, text, date);
DROP FUNCTION IF EXISTS public.record_supplier_onaccount_payment(uuid, numeric, uuid, payment_method, text, timestamptz, text, text, numeric, jsonb);
DROP FUNCTION IF EXISTS public.record_vendor_payment(uuid, numeric, uuid, payment_method, text, timestamptz, text, text, numeric);
