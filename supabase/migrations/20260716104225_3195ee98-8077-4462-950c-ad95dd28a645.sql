
-- Drop legacy redundant recompute trigger + function
DROP TRIGGER IF EXISTS trg_po_recompute_totals ON public.po_items;
DROP FUNCTION IF EXISTS public.po_recompute_totals();

-- Guard items trigger against recursion (recalc_po_totals updates po_items itself)
CREATE OR REPLACE FUNCTION public.trg_recalc_po_from_items()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF pg_trigger_depth() > 1 THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  PERFORM public.recalc_po_totals(COALESCE(NEW.po_id, OLD.po_id));
  RETURN COALESCE(NEW, OLD);
END; $function$;

-- Guard header trigger against recursion (recalc_po_totals updates purchase_orders itself)
CREATE OR REPLACE FUNCTION public.trg_recalc_po_from_header()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF pg_trigger_depth() > 1 THEN
    RETURN NEW;
  END IF;
  IF NEW.prices_include_tax IS DISTINCT FROM OLD.prices_include_tax
     OR NEW.freight_amount IS DISTINCT FROM OLD.freight_amount
     OR NEW.other_charges_amount IS DISTINCT FROM OLD.other_charges_amount THEN
    PERFORM public.recalc_po_totals(NEW.id);
  END IF;
  RETURN NEW;
END; $function$;
