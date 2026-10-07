ALTER TABLE public.supplier_invoices DROP CONSTRAINT IF EXISTS supplier_invoices_reason_check;
ALTER TABLE public.supplier_invoices ADD CONSTRAINT supplier_invoices_reason_check CHECK (reason = ANY (ARRAY['sale','conversion','gate_out_sale','manual','purchase','acquisition_transport','acquisition_crane_offloading','acquisition_cost_edit','repatriation']));

CREATE OR REPLACE FUNCTION public.validate_container_acquisition_invoice()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _size text;
  _parent uuid;
  _supplier text;
  _existing text;
  _expected numeric;
BEGIN
  NEW.acquisition_component := COALESCE(NULLIF(NEW.acquisition_component,''), CASE
    WHEN NEW.reason = 'acquisition_transport' THEN 'transport'
    WHEN NEW.reason = 'acquisition_crane_offloading' THEN 'offloading'
    WHEN NEW.reason IN ('purchase','sale','gate_out_sale','conversion','acquisition_cost_edit') THEN 'purchase_price'
    ELSE 'other' END);
  NEW.pricing_basis := COALESCE(NULLIF(NEW.pricing_basis,''), CASE WHEN NEW.acquisition_component = 'purchase_price' THEN 'standard' ELSE 'other' END);
  NEW.pricing_note := NULLIF(btrim(COALESCE(NEW.pricing_note, NEW.notes, '')), '');

  IF NEW.acquisition_component <> 'purchase_price' THEN RETURN NEW; END IF;

  IF NEW.total_amount <= 0 THEN
    RAISE EXCEPTION 'Acquisition purchase-price invoices must be positive. Use a controlled reversal or credit record for corrections.';
  END IF;

  SELECT c.size::text, c.parent_container_id INTO _size, _parent
  FROM public.containers c
  WHERE c.id = NEW.container_id AND c.organization_id = NEW.organization_id;

  IF _parent IS NOT NULL THEN
    RAISE EXCEPTION 'Split-child containers inherit apportioned acquisition cost from the mother container and cannot receive a supplier purchase invoice.';
  END IF;

  IF NEW.reason IN ('sale','gate_out_sale','conversion','acquisition_cost_edit') THEN
    SELECT si.invoice_number INTO _existing
    FROM public.supplier_invoices si
    WHERE si.organization_id = NEW.organization_id
      AND si.container_id = NEW.container_id
      AND si.id IS DISTINCT FROM NEW.id
      AND si.status <> 'cancelled'
      AND COALESCE(si.acquisition_component, CASE WHEN si.reason IN ('purchase','sale','gate_out_sale','conversion','acquisition_cost_edit') THEN 'purchase_price' ELSE 'other' END) = 'purchase_price'
    ORDER BY CASE WHEN si.reason='purchase' THEN 0 ELSE 1 END, si.created_at
    LIMIT 1;
    IF _existing IS NOT NULL THEN
      RAISE EXCEPTION 'Container already has active purchase-price invoice %; no second liability may be raised from %', _existing, NEW.reason;
    END IF;
  ELSIF NEW.reason = 'purchase' THEN
    SELECT si.invoice_number INTO _existing
    FROM public.supplier_invoices si
    WHERE si.organization_id = NEW.organization_id
      AND si.container_id = NEW.container_id
      AND si.id IS DISTINCT FROM NEW.id
      AND si.status <> 'cancelled'
      AND si.reason = 'purchase'
      AND COALESCE(si.acquisition_component,'purchase_price') = 'purchase_price'
    ORDER BY si.created_at LIMIT 1;
    IF _existing IS NOT NULL THEN
      RAISE EXCEPTION 'Container already has canonical purchase invoice %', _existing;
    END IF;
  END IF;

  SELECT upper(btrim(s.name)) INTO _supplier FROM public.suppliers s WHERE s.id = NEW.supplier_id;
  IF _supplier = 'JJ MES DMCC' AND NEW.reason IN ('purchase','acquisition_cost_edit') THEN
    IF upper(NEW.currency) <> 'USD' THEN
      RAISE EXCEPTION 'JJ MES DMCC container purchase invoices must be in USD';
    END IF;
    _expected := CASE WHEN _size LIKE '20%' THEN 700
                      WHEN _size LIKE '40%' THEN 1700
                      ELSE NULL END;
    -- The standard rate is a reference, not a rule: classify off-standard prices
    -- instead of rejecting them, so genuine discounts / higher prices can be booked.
    IF _expected IS NOT NULL THEN
      NEW.pricing_basis := CASE
        WHEN NEW.total_amount = _expected THEN 'standard'
        WHEN NEW.total_amount < _expected THEN 'supplier_discount'
        ELSE 'price_variance' END;
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;