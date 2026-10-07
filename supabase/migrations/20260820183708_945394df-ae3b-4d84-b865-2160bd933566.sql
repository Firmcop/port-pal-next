-- D2. Vendor payments automatically allocated to purchase invoices (FIFO) with a trail
CREATE TABLE IF NOT EXISTS public.vendor_payment_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  payment_id uuid NOT NULL REFERENCES public.vendor_payments(id) ON DELETE CASCADE,
  supplier_invoice_id uuid NOT NULL REFERENCES public.supplier_invoices(id) ON DELETE CASCADE,
  amount numeric NOT NULL CHECK (amount > 0),
  method text NOT NULL DEFAULT 'auto_fifo',
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_vpa_payment ON public.vendor_payment_allocations(payment_id);
CREATE INDEX IF NOT EXISTS idx_vpa_invoice ON public.vendor_payment_allocations(supplier_invoice_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.vendor_payment_allocations TO authenticated;
GRANT ALL ON public.vendor_payment_allocations TO service_role;
ALTER TABLE public.vendor_payment_allocations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "finance roles read vendor allocations" ON public.vendor_payment_allocations;
CREATE POLICY "finance roles read vendor allocations" ON public.vendor_payment_allocations
FOR SELECT TO authenticated
USING (organization_id = current_org_id() AND (
  has_role(auth.uid(),'admin') OR has_role(auth.uid(),'org_owner') OR has_role(auth.uid(),'accountant')
  OR has_role(auth.uid(),'procurement_officer') OR has_role(auth.uid(),'supply_chain_manager')));

DROP POLICY IF EXISTS "finance roles write vendor allocations" ON public.vendor_payment_allocations;
CREATE POLICY "finance roles write vendor allocations" ON public.vendor_payment_allocations
FOR ALL TO authenticated
USING (organization_id = current_org_id() AND (
  has_role(auth.uid(),'admin') OR has_role(auth.uid(),'org_owner') OR has_role(auth.uid(),'accountant')))
WITH CHECK (organization_id = current_org_id() AND (
  has_role(auth.uid(),'admin') OR has_role(auth.uid(),'org_owner') OR has_role(auth.uid(),'accountant')));

-- Recompute paid_amount / status on a purchase invoice from its allocations
CREATE OR REPLACE FUNCTION public.refresh_supplier_invoice_paid(_invoice_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _paid numeric; _total numeric;
BEGIN
  SELECT COALESCE(sum(amount),0) INTO _paid FROM public.vendor_payment_allocations WHERE supplier_invoice_id = _invoice_id;
  SELECT total_amount INTO _total FROM public.supplier_invoices WHERE id = _invoice_id;
  UPDATE public.supplier_invoices
     SET paid_amount = _paid,
         status = CASE WHEN _paid >= COALESCE(_total,0) AND COALESCE(_total,0) > 0 THEN 'paid'
                       WHEN _paid > 0 THEN 'partially_paid'
                       ELSE CASE WHEN status IN ('paid','partially_paid') THEN 'issued' ELSE status END END,
         updated_at = now()
   WHERE id = _invoice_id;
END $$;
REVOKE ALL ON FUNCTION public.refresh_supplier_invoice_paid(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.trg_refresh_supplier_invoice_paid()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.refresh_supplier_invoice_paid(COALESCE(NEW.supplier_invoice_id, OLD.supplier_invoice_id));
  RETURN COALESCE(NEW, OLD);
END $$;
DROP TRIGGER IF EXISTS trg_vpa_refresh ON public.vendor_payment_allocations;
CREATE TRIGGER trg_vpa_refresh AFTER INSERT OR UPDATE OR DELETE ON public.vendor_payment_allocations
FOR EACH ROW EXECUTE FUNCTION public.trg_refresh_supplier_invoice_paid();
REVOKE ALL ON FUNCTION public.trg_refresh_supplier_invoice_paid() FROM PUBLIC, anon, authenticated;

-- Allocate a vendor payment: PO-linked invoices first, then oldest outstanding invoices of the same supplier
CREATE OR REPLACE FUNCTION public.allocate_vendor_payment(_payment_id uuid)
RETURNS numeric LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _p public.vendor_payments%ROWTYPE;
  _left numeric; _allocated numeric := 0; _take numeric; _inv record;
BEGIN
  SELECT * INTO _p FROM public.vendor_payments WHERE id = _payment_id;
  IF NOT FOUND OR COALESCE(_p.amount,0) <= 0 THEN RETURN 0; END IF;

  SELECT _p.amount - COALESCE(sum(amount),0) INTO _left
    FROM public.vendor_payment_allocations WHERE payment_id = _payment_id;
  IF _left <= 0 THEN RETURN 0; END IF;

  FOR _inv IN
    SELECT si.id, GREATEST(si.total_amount - COALESCE(si.paid_amount,0), 0) AS due
      FROM public.supplier_invoices si
     WHERE si.organization_id = _p.organization_id
       AND si.supplier_id = _p.supplier_id
       AND COALESCE(si.status,'') <> 'void'
       AND si.total_amount > COALESCE(si.paid_amount,0)
     ORDER BY (si.purchase_order_id IS DISTINCT FROM _p.po_id), si.issue_date, si.created_at
  LOOP
    EXIT WHEN _left <= 0;
    _take := LEAST(_left, _inv.due);
    IF _take > 0 THEN
      INSERT INTO public.vendor_payment_allocations (organization_id, payment_id, supplier_invoice_id, amount, method, created_by)
      VALUES (_p.organization_id, _payment_id, _inv.id, _take, 'auto_fifo', auth.uid());
      _left := _left - _take;
      _allocated := _allocated + _take;
    END IF;
  END LOOP;

  RETURN _allocated;
END $$;
REVOKE ALL ON FUNCTION public.allocate_vendor_payment(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.allocate_vendor_payment(uuid) TO authenticated;

-- Manual re-allocation (admin/accountant): replaces auto allocations for one payment
CREATE OR REPLACE FUNCTION public.set_vendor_payment_allocations(_payment_id uuid, _lines jsonb)
RETURNS numeric LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _p public.vendor_payments%ROWTYPE; _sum numeric := 0; _l jsonb;
BEGIN
  IF NOT (has_role(auth.uid(),'admin') OR has_role(auth.uid(),'org_owner') OR has_role(auth.uid(),'accountant')) THEN
    RAISE EXCEPTION 'Not authorized to allocate vendor payments';
  END IF;
  SELECT * INTO _p FROM public.vendor_payments WHERE id = _payment_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Payment not found'; END IF;

  FOR _l IN SELECT jsonb_array_elements(_lines) LOOP
    _sum := _sum + COALESCE((_l->>'amount')::numeric,0);
  END LOOP;
  IF _sum > COALESCE(_p.amount,0) + 0.005 THEN
    RAISE EXCEPTION 'Allocations (%) exceed the payment amount (%)', _sum, _p.amount;
  END IF;

  DELETE FROM public.vendor_payment_allocations WHERE payment_id = _payment_id;

  FOR _l IN SELECT jsonb_array_elements(_lines) LOOP
    IF COALESCE((_l->>'amount')::numeric,0) > 0 THEN
      INSERT INTO public.vendor_payment_allocations (organization_id, payment_id, supplier_invoice_id, amount, method, created_by)
      VALUES (_p.organization_id, _payment_id, (_l->>'supplier_invoice_id')::uuid, (_l->>'amount')::numeric, 'manual', auth.uid());
    END IF;
  END LOOP;

  RETURN _sum;
END $$;
REVOKE ALL ON FUNCTION public.set_vendor_payment_allocations(uuid,jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_vendor_payment_allocations(uuid,jsonb) TO authenticated;

-- Auto-allocate every new vendor payment
CREATE OR REPLACE FUNCTION public.trg_auto_allocate_vendor_payment()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.allocate_vendor_payment(NEW.id);
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_vendor_payment_auto_allocate ON public.vendor_payments;
CREATE TRIGGER trg_vendor_payment_auto_allocate AFTER INSERT ON public.vendor_payments
FOR EACH ROW EXECUTE FUNCTION public.trg_auto_allocate_vendor_payment();
REVOKE ALL ON FUNCTION public.trg_auto_allocate_vendor_payment() FROM PUBLIC, anon, authenticated;

-- Backfill: allocate all historical vendor payments
DO $$ DECLARE r record; BEGIN
  FOR r IN SELECT id FROM public.vendor_payments ORDER BY paid_at NULLS LAST, created_at LOOP
    PERFORM public.allocate_vendor_payment(r.id);
  END LOOP;
END $$;
