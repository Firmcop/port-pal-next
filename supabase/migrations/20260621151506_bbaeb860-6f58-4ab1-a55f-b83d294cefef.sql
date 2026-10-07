CREATE OR REPLACE FUNCTION public.trg_fal_payments()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE _act text;
BEGIN
  _act := CASE TG_OP WHEN 'INSERT' THEN 'record' WHEN 'UPDATE' THEN 'update' ELSE 'delete' END;
  PERFORM fal_write(COALESCE(NEW.organization_id, OLD.organization_id),
    'payment', COALESCE(NEW.id, OLD.id),
    COALESCE(NEW.payment_number, OLD.payment_number),
    _act,
    jsonb_build_object(
      'amount', COALESCE(NEW.amount, OLD.amount),
      'method', COALESCE(NEW.payment_method, OLD.payment_method),
      'date', COALESCE(NEW.paid_at, OLD.paid_at)),
    CASE WHEN TG_OP <> 'INSERT' THEN to_jsonb(OLD) ELSE NULL END,
    CASE WHEN TG_OP <> 'DELETE' THEN to_jsonb(NEW) ELSE NULL END,
    '/billing/payments?payment=' || COALESCE(NEW.id, OLD.id)::text);
  RETURN COALESCE(NEW, OLD);
END $function$;

CREATE OR REPLACE FUNCTION public.trg_fal_vendor_payments()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE _act text;
BEGIN
  _act := CASE TG_OP WHEN 'INSERT' THEN 'record' WHEN 'UPDATE' THEN 'update' ELSE 'delete' END;
  PERFORM fal_write(COALESCE(NEW.organization_id, OLD.organization_id),
    'vendor_payment', COALESCE(NEW.id, OLD.id),
    COALESCE(NEW.payment_number, OLD.payment_number),
    _act,
    jsonb_build_object(
      'amount', COALESCE(NEW.amount, OLD.amount),
      'method', COALESCE(NEW.payment_method, OLD.payment_method),
      'date', COALESCE(NEW.paid_at, OLD.paid_at)),
    CASE WHEN TG_OP <> 'INSERT' THEN to_jsonb(OLD) ELSE NULL END,
    CASE WHEN TG_OP <> 'DELETE' THEN to_jsonb(NEW) ELSE NULL END,
    '/billing/payments?vendor_payment=' || COALESCE(NEW.id, OLD.id)::text);
  RETURN COALESCE(NEW, OLD);
END $function$;