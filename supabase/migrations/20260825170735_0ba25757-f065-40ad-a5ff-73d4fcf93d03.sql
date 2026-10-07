ALTER TABLE public.supplier_invoices
  ADD COLUMN IF NOT EXISTS acquisition_component text,
  ADD COLUMN IF NOT EXISTS pricing_basis text,
  ADD COLUMN IF NOT EXISTS pricing_note text;

COMMENT ON COLUMN public.supplier_invoices.acquisition_component IS 'purchase_price, transport, offloading, or other';
COMMENT ON COLUMN public.supplier_invoices.pricing_basis IS 'standard, supplier_discount, inherited_split_cost, or other';
COMMENT ON COLUMN public.supplier_invoices.pricing_note IS 'Required explanation for non-standard acquisition pricing';

UPDATE public.supplier_invoices
SET acquisition_component = CASE
      WHEN reason = 'acquisition_transport' THEN 'transport'
      WHEN reason = 'acquisition_crane_offloading' THEN 'offloading'
      WHEN reason IN ('purchase','sale','gate_out_sale','conversion','acquisition_cost_edit') THEN 'purchase_price'
      ELSE 'other'
    END,
    pricing_basis = CASE
      WHEN reason IN ('purchase','sale','gate_out_sale','conversion','acquisition_cost_edit') THEN 'standard'
      ELSE 'other'
    END
WHERE acquisition_component IS NULL OR pricing_basis IS NULL;

UPDATE public.supplier_invoices si
SET pricing_basis = 'supplier_discount',
    pricing_note = COALESCE(NULLIF(si.pricing_note,''), 'JJ MES DMCC discount for latest 40ft gate-in')
FROM public.suppliers s, public.containers c
WHERE si.supplier_id = s.id
  AND si.container_id = c.id
  AND upper(btrim(s.name)) = 'JJ MES DMCC'
  AND c.size::text LIKE '40%'
  AND si.currency = 'USD'
  AND si.total_amount = 1650
  AND si.reason = 'purchase';

CREATE OR REPLACE FUNCTION public.validate_container_acquisition_invoice()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _size text;
  _parent uuid;
  _supplier text;
  _existing text;
BEGIN
  NEW.acquisition_component := COALESCE(NULLIF(NEW.acquisition_component,''), CASE
    WHEN NEW.reason = 'acquisition_transport' THEN 'transport'
    WHEN NEW.reason = 'acquisition_crane_offloading' THEN 'offloading'
    WHEN NEW.reason IN ('purchase','sale','gate_out_sale','conversion','acquisition_cost_edit') THEN 'purchase_price'
    ELSE 'other' END);
  NEW.pricing_basis := COALESCE(NULLIF(NEW.pricing_basis,''), CASE WHEN NEW.acquisition_component = 'purchase_price' THEN 'standard' ELSE 'other' END);

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
      AND si.status <> 'cancelled'
      AND si.reason = 'purchase'
      AND COALESCE(si.acquisition_component,'purchase_price') = 'purchase_price'
    ORDER BY si.created_at LIMIT 1;
    IF _existing IS NOT NULL THEN
      RAISE EXCEPTION 'Container already has canonical purchase invoice %', _existing;
    END IF;
  END IF;

  SELECT upper(btrim(s.name)) INTO _supplier FROM public.suppliers s WHERE s.id = NEW.supplier_id;
  IF _supplier = 'JJ MES DMCC' AND NEW.reason = 'purchase' THEN
    IF upper(NEW.currency) <> 'USD' THEN
      RAISE EXCEPTION 'JJ MES DMCC container purchase invoices must be in USD';
    END IF;
    IF _size LIKE '20%' AND NEW.total_amount <> 700 THEN
      RAISE EXCEPTION 'JJ MES DMCC 20ft purchase price must be USD 700';
    END IF;
    IF _size LIKE '40%' AND NEW.total_amount <> 1700 THEN
      IF NOT (NEW.total_amount > 0 AND NEW.total_amount < 1700 AND NEW.pricing_basis = 'supplier_discount' AND btrim(COALESCE(NEW.pricing_note,'')) <> '') THEN
        RAISE EXCEPTION 'JJ MES DMCC 40ft purchase price must be USD 1,700 unless an explicit supplier discount and reason are recorded';
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS validate_container_acquisition_invoice_trg ON public.supplier_invoices;
CREATE TRIGGER validate_container_acquisition_invoice_trg
BEFORE INSERT ON public.supplier_invoices
FOR EACH ROW EXECUTE FUNCTION public.validate_container_acquisition_invoice();

DROP FUNCTION IF EXISTS public.container_invoice_reconciliation();

CREATE OR REPLACE FUNCTION public.container_invoice_reconciliation()
RETURNS TABLE (
  container_id uuid,
  container_number text,
  container_size text,
  container_status text,
  acquisition_count integer,
  duplicate_acquisition_count integer,
  sale_invoice_count integer,
  duplicate_sale_count integer,
  severity text,
  acquisition_invoices jsonb,
  sale_invoices jsonb
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH scoped AS (
    SELECT si.id, si.container_id, si.purchase_order_id, si.invoice_number, si.reason, si.reference,
           si.total_amount, si.currency, si.status, si.paid_amount, si.created_at,
           COALESCE(si.acquisition_component, CASE
             WHEN si.reason='acquisition_transport' THEN 'transport'
             WHEN si.reason='acquisition_crane_offloading' THEN 'offloading'
             WHEN si.reason IN ('purchase','sale','gate_out_sale','conversion','acquisition_cost_edit') THEN 'purchase_price'
             ELSE 'other' END) AS acquisition_component,
           COALESCE(si.pricing_basis,'standard') AS pricing_basis,
           si.pricing_note,
           c.container_number, c.size::text AS container_size, c.status::text AS container_status,
           c.parent_container_id, s.name AS supplier_name,
           CASE WHEN upper(btrim(COALESCE(s.name,'')))='JJ MES DMCC' AND c.size::text LIKE '20%' THEN 700::numeric
                WHEN upper(btrim(COALESCE(s.name,'')))='JJ MES DMCC' AND c.size::text LIKE '40%' THEN
                  CASE WHEN si.pricing_basis='supplier_discount' THEN si.total_amount ELSE 1700::numeric END
                ELSE NULL::numeric END AS expected_amount
      FROM public.supplier_invoices si
      JOIN public.containers c ON c.id = si.container_id
      LEFT JOIN public.suppliers s ON s.id = si.supplier_id
     WHERE si.organization_id = current_org_id()
       AND si.status <> 'cancelled'
       AND COALESCE(si.acquisition_component, CASE WHEN si.reason IN ('purchase','sale','gate_out_sale','conversion','acquisition_cost_edit') THEN 'purchase_price' ELSE 'other' END) = 'purchase_price'
  ), purchases AS (
    SELECT container_id, (array_agg(invoice_number ORDER BY created_at))[1] AS keep_inv
    FROM scoped WHERE reason='purchase' GROUP BY container_id
  ), repeats AS (
    SELECT id, row_number() OVER (PARTITION BY container_id ORDER BY CASE WHEN reason='purchase' THEN 0 ELSE 1 END, created_at) rn,
           (array_agg(invoice_number) OVER (PARTITION BY container_id ORDER BY CASE WHEN reason='purchase' THEN 0 ELSE 1 END, created_at))[1] first_inv
    FROM scoped
  ), enriched AS (
    SELECT sc.*, r.rn,
      CASE
        WHEN sc.parent_container_id IS NOT NULL THEN 'split_child_invoiced'
        WHEN upper(btrim(COALESCE(sc.supplier_name,'')))='JJ MES DMCC' AND upper(sc.currency)<>'USD' THEN 'wrong_currency'
        WHEN sc.expected_amount IS NOT NULL AND sc.total_amount<>sc.expected_amount THEN 'wrong_rate'
        WHEN r.rn>1 THEN 'repeat_invoice'
        WHEN sc.reason IN ('sale','gate_out_sale','conversion','acquisition_cost_edit') AND p.container_id IS NOT NULL THEN 'already_purchased'
        ELSE 'ok' END issue,
      CASE WHEN r.rn>1 THEN r.first_inv ELSE p.keep_inv END keeps_invoice,
      cs.id sale_id, cs.sale_number, eir.id eir_id, eir.eir_number, cv.id conversion_id, cv.conversion_number
    FROM scoped sc JOIN repeats r ON r.id=sc.id LEFT JOIN purchases p ON p.container_id=sc.container_id
    LEFT JOIN LATERAL (SELECT x.id,x.sale_number FROM public.container_sales x WHERE x.organization_id=current_org_id() AND (x.supplier_invoice_id=sc.id OR x.purchase_invoice_id=sc.purchase_order_id OR (sc.reference IS NOT NULL AND x.sale_number=sc.reference)) ORDER BY x.created_at LIMIT 1) cs ON true
    LEFT JOIN LATERAL (SELECT x.id,x.eir_number FROM public.eir_records x WHERE x.organization_id=current_org_id() AND (x.supplier_invoice_id=sc.id OR (sc.reference IS NOT NULL AND x.eir_number=sc.reference)) ORDER BY x.created_at LIMIT 1) eir ON true
    LEFT JOIN LATERAL (SELECT x.id,x.conversion_number FROM public.container_conversions x WHERE x.organization_id=current_org_id() AND (x.supplier_invoice_id=sc.id OR (sc.reference IS NOT NULL AND (x.conversion_number=sc.reference OR x.id::text=sc.reference))) ORDER BY x.created_at LIMIT 1) cv ON true
  ), pathed AS (
    SELECT e.*,
      CASE WHEN e.sale_id IS NOT NULL THEN 'sale' WHEN e.eir_id IS NOT NULL THEN 'eir' WHEN e.conversion_id IS NOT NULL THEN 'conversion' WHEN e.reason='purchase' THEN 'inventory_intake' ELSE 'unknown' END origin,
      CASE WHEN e.sale_id IS NOT NULL THEN COALESCE(e.sale_number,'Container sale') WHEN e.eir_id IS NOT NULL THEN COALESCE(e.eir_number,'Gate EIR') WHEN e.conversion_id IS NOT NULL THEN COALESCE(e.conversion_number,'Conversion job') WHEN e.reason='purchase' THEN 'Inventory intake / backfill' ELSE COALESCE(e.reference,'—') END origin_label,
      CASE WHEN e.sale_id IS NOT NULL THEN '/sales' WHEN e.eir_id IS NOT NULL THEN '/gate/eir' WHEN e.conversion_id IS NOT NULL THEN '/conversions/'||e.conversion_id::text ELSE '/inventory' END origin_path
    FROM enriched e
  ), cust AS (
    SELECT ic.container_id,i.id,i.invoice_number,i.status::text status,i.total_amount,i.currency,i.created_at,row_number() OVER(PARTITION BY ic.container_id ORDER BY i.created_at) rn
    FROM public.invoice_containers ic JOIN public.invoices i ON i.id=ic.invoice_id
    WHERE ic.organization_id=current_org_id() AND i.status<>'cancelled'
  ), agg_acq AS (
    SELECT p.container_id,p.container_number,p.container_size,p.container_status,count(*)::int acquisition_count,count(*) FILTER(WHERE p.issue<>'ok')::int duplicate_acquisition_count,
      jsonb_agg(jsonb_build_object('invoice_id',p.id,'invoice_number',p.invoice_number,'reason',p.reason,'reference',p.reference,'supplier_name',p.supplier_name,'total_amount',p.total_amount,'currency',p.currency,'status',p.status,'paid_amount',p.paid_amount,'created_at',p.created_at,'issue',p.issue,'keeps_invoice',p.keeps_invoice,'origin',p.origin,'origin_label',p.origin_label,'origin_path',p.origin_path,'acquisition_component',p.acquisition_component,'pricing_basis',p.pricing_basis,'pricing_note',p.pricing_note,'expected_amount',p.expected_amount) ORDER BY p.created_at) acquisition_invoices
    FROM pathed p GROUP BY 1,2,3,4
  ), agg_sale AS (
    SELECT c.container_id,count(*)::int sale_invoice_count,count(*) FILTER(WHERE c.rn>1)::int duplicate_sale_count,jsonb_agg(jsonb_build_object('invoice_id',c.id,'invoice_number',c.invoice_number,'status',c.status,'total_amount',c.total_amount,'currency',c.currency,'created_at',c.created_at,'duplicate',c.rn>1) ORDER BY c.created_at) sale_invoices FROM cust c GROUP BY 1
  )
  SELECT a.container_id,a.container_number,a.container_size,a.container_status,a.acquisition_count,a.duplicate_acquisition_count,COALESCE(s.sale_invoice_count,0),COALESCE(s.duplicate_sale_count,0),CASE WHEN a.duplicate_acquisition_count>0 THEN 'critical' WHEN COALESCE(s.duplicate_sale_count,0)>0 THEN 'warning' ELSE 'ok' END,a.acquisition_invoices,COALESCE(s.sale_invoices,'[]'::jsonb)
  FROM agg_acq a LEFT JOIN agg_sale s ON s.container_id=a.container_id
  WHERE a.duplicate_acquisition_count>0 OR COALESCE(s.duplicate_sale_count,0)>0 OR a.acquisition_count>1
  ORDER BY (a.duplicate_acquisition_count>0) DESC,a.container_number;
$$;

REVOKE ALL ON FUNCTION public.validate_container_acquisition_invoice() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.validate_container_acquisition_invoice() TO service_role;
REVOKE ALL ON FUNCTION public.container_invoice_reconciliation() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.container_invoice_reconciliation() TO authenticated;