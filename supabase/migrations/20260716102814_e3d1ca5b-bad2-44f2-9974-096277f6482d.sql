
-- PO: VAT-inclusive pricing + freight/other charges allocation

ALTER TABLE public.purchase_orders
  ADD COLUMN IF NOT EXISTS prices_include_tax boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS freight_amount numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS other_charges_amount numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS landed_total numeric NOT NULL DEFAULT 0;

ALTER TABLE public.po_items
  ADD COLUMN IF NOT EXISTS allocated_freight numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS net_amount numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS landed_unit_cost numeric NOT NULL DEFAULT 0;

-- Recalculate PO totals with inclusive/exclusive VAT handling and pro-rata freight allocation
CREATE OR REPLACE FUNCTION public.recalc_po_totals(_po_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  po_row RECORD;
  total_net numeric := 0;
  total_tax numeric := 0;
  extra numeric := 0;
  item RECORD;
  line_net numeric;
  line_tax numeric;
  line_gross numeric;
  rate numeric;
  alloc numeric;
BEGIN
  SELECT id, prices_include_tax, COALESCE(freight_amount,0) AS freight, COALESCE(other_charges_amount,0) AS other
    INTO po_row FROM public.purchase_orders WHERE id = _po_id;
  IF NOT FOUND THEN RETURN; END IF;
  extra := po_row.freight + po_row.other;

  -- Pass 1: compute net/tax per line
  FOR item IN SELECT id, quantity, unit_price, COALESCE(tax_rate,0) AS tax_rate, COALESCE(is_vatable,false) AS is_vatable FROM public.po_items WHERE po_id = _po_id LOOP
    rate := CASE WHEN item.is_vatable THEN item.tax_rate ELSE 0 END;
    -- tax_rate may be stored as percent (e.g. 16) or fraction (0.16); normalize
    IF rate > 1 THEN rate := rate / 100.0; END IF;
    line_gross := item.quantity * item.unit_price;
    IF po_row.prices_include_tax THEN
      line_net := line_gross / (1 + rate);
      line_tax := line_gross - line_net;
    ELSE
      line_net := line_gross;
      line_tax := line_gross * rate;
    END IF;
    UPDATE public.po_items SET net_amount = line_net, tax_amount = line_tax WHERE id = item.id;
    total_net := total_net + line_net;
    total_tax := total_tax + line_tax;
  END LOOP;

  -- Pass 2: allocate freight pro-rata to net
  FOR item IN SELECT id, quantity, net_amount FROM public.po_items WHERE po_id = _po_id LOOP
    IF total_net > 0 AND extra > 0 THEN
      alloc := extra * (item.net_amount / total_net);
    ELSE
      alloc := 0;
    END IF;
    UPDATE public.po_items
       SET allocated_freight = alloc,
           landed_unit_cost = CASE WHEN item.quantity > 0
             THEN (item.net_amount + alloc) / item.quantity ELSE 0 END,
           total_cost = item.net_amount + alloc
     WHERE id = item.id;
  END LOOP;

  UPDATE public.purchase_orders
     SET subtotal = total_net,
         tax_total = total_tax,
         total_cost = total_net + total_tax + extra,
         landed_total = total_net + extra
   WHERE id = _po_id;
END;
$$;

REVOKE ALL ON FUNCTION public.recalc_po_totals(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.recalc_po_totals(uuid) TO authenticated, service_role;

-- Auto-recalc triggers
CREATE OR REPLACE FUNCTION public.trg_recalc_po_from_items()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.recalc_po_totals(COALESCE(NEW.po_id, OLD.po_id));
  RETURN COALESCE(NEW, OLD);
END; $$;

CREATE OR REPLACE FUNCTION public.trg_recalc_po_from_header()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.prices_include_tax IS DISTINCT FROM OLD.prices_include_tax
     OR NEW.freight_amount IS DISTINCT FROM OLD.freight_amount
     OR NEW.other_charges_amount IS DISTINCT FROM OLD.other_charges_amount THEN
    PERFORM public.recalc_po_totals(NEW.id);
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_po_items_recalc ON public.po_items;
CREATE TRIGGER trg_po_items_recalc
AFTER INSERT OR UPDATE OR DELETE ON public.po_items
FOR EACH ROW EXECUTE FUNCTION public.trg_recalc_po_from_items();

DROP TRIGGER IF EXISTS trg_po_header_recalc ON public.purchase_orders;
CREATE TRIGGER trg_po_header_recalc
AFTER UPDATE ON public.purchase_orders
FOR EACH ROW EXECUTE FUNCTION public.trg_recalc_po_from_header();
