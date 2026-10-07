CREATE OR REPLACE FUNCTION public.enforce_po_status_transition()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  allowed text[];
  is_reset boolean := coalesce(current_setting('app.po_status_admin_reset', true) = 'on', false);
  reset_reason text := nullif(current_setting('app.po_status_reset_reason', true), '');
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  IF NOT is_reset THEN
    allowed := CASE OLD.status
      WHEN 'draft' THEN ARRAY['sent','cancelled']
      WHEN 'sent' THEN ARRAY['confirmed','cancelled']
      WHEN 'confirmed' THEN ARRAY['partially_received','received','cancelled']
      WHEN 'partially_received' THEN ARRAY['partially_received','received']
      WHEN 'received' THEN ARRAY['paid']
      WHEN 'paid' THEN ARRAY[]::text[]
      WHEN 'cancelled' THEN ARRAY[]::text[]
      ELSE ARRAY['draft','sent','confirmed','partially_received','received','paid','cancelled']
    END;

    IF NOT (NEW.status = ANY(allowed)) THEN
      RAISE EXCEPTION 'Invalid purchase order status transition: % -> %', OLD.status, NEW.status
        USING HINT = 'Purchase order statuses move forward only. Use the admin reset action with a reason to correct a mistake.';
    END IF;

    IF NEW.status = 'paid' AND NOT EXISTS (
      SELECT 1 FROM public.vendor_payments vp WHERE vp.po_id = NEW.id
    ) THEN
      RAISE EXCEPTION 'A purchase order can only be marked paid by recording the payment'
        USING HINT = 'Use Pay supplier to record the paying account, amount, date and reference.';
    END IF;
  END IF;

  INSERT INTO public.po_status_events (organization_id, purchase_order_id, from_status, to_status, reason, is_admin_reset, changed_by)
  VALUES (NEW.organization_id, NEW.id, OLD.status, NEW.status, reset_reason, is_reset, auth.uid());

  RETURN NEW;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.enforce_po_status_transition() FROM PUBLIC, anon, authenticated;