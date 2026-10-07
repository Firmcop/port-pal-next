
-- 1. Status history table
CREATE TABLE IF NOT EXISTS public.po_status_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  purchase_order_id uuid NOT NULL REFERENCES public.purchase_orders(id) ON DELETE CASCADE,
  from_status text,
  to_status text NOT NULL,
  reason text,
  is_admin_reset boolean NOT NULL DEFAULT false,
  changed_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.po_status_events TO authenticated;
GRANT ALL ON public.po_status_events TO service_role;

ALTER TABLE public.po_status_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "po_status_events_select" ON public.po_status_events;
CREATE POLICY "po_status_events_select" ON public.po_status_events
FOR SELECT TO authenticated
USING (
  organization_id = public.current_org_id()
  OR public.is_platform_admin()
);

CREATE INDEX IF NOT EXISTS idx_po_status_events_po ON public.po_status_events(purchase_order_id, created_at DESC);

-- 2. Transition guard
CREATE OR REPLACE FUNCTION public.enforce_po_status_transition()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
  END IF;

  INSERT INTO public.po_status_events (organization_id, purchase_order_id, from_status, to_status, reason, is_admin_reset, changed_by)
  VALUES (NEW.organization_id, NEW.id, OLD.status, NEW.status, reset_reason, is_reset, auth.uid());

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_po_status_transition ON public.purchase_orders;
CREATE TRIGGER trg_enforce_po_status_transition
BEFORE UPDATE OF status ON public.purchase_orders
FOR EACH ROW EXECUTE FUNCTION public.enforce_po_status_transition();

-- 3. Admin-only reset
CREATE OR REPLACE FUNCTION public.admin_reset_po_status(_po_id uuid, _new_status text, _reason text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org uuid;
BEGIN
  IF NOT (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'org_owner') OR public.is_platform_admin()) THEN
    RAISE EXCEPTION 'Only administrators can reset a purchase order status';
  END IF;

  IF coalesce(btrim(_reason), '') = '' THEN
    RAISE EXCEPTION 'A reason is required to reset a purchase order status';
  END IF;

  IF _new_status NOT IN ('draft','sent','confirmed','partially_received','received','paid','cancelled') THEN
    RAISE EXCEPTION 'Unknown status: %', _new_status;
  END IF;

  SELECT organization_id INTO v_org FROM public.purchase_orders WHERE id = _po_id;
  IF v_org IS NULL THEN
    RAISE EXCEPTION 'Purchase order not found';
  END IF;
  IF NOT public.is_platform_admin() AND v_org IS DISTINCT FROM public.current_org_id() THEN
    RAISE EXCEPTION 'Purchase order not found';
  END IF;

  PERFORM set_config('app.po_status_admin_reset', 'on', true);
  PERFORM set_config('app.po_status_reset_reason', _reason, true);

  UPDATE public.purchase_orders SET status = _new_status WHERE id = _po_id;

  PERFORM set_config('app.po_status_admin_reset', 'off', true);
  PERFORM set_config('app.po_status_reset_reason', '', true);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_reset_po_status(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_reset_po_status(uuid, text, text) TO authenticated;
