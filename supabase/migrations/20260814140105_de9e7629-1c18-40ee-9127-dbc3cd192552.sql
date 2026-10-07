CREATE TABLE public.invoice_containers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id uuid NOT NULL REFERENCES public.invoices(id) ON DELETE CASCADE,
  container_id uuid NOT NULL REFERENCES public.containers(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL DEFAULT current_org_id(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (invoice_id, container_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.invoice_containers TO authenticated;
GRANT ALL ON public.invoice_containers TO service_role;

ALTER TABLE public.invoice_containers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org members read invoice containers"
  ON public.invoice_containers FOR SELECT TO authenticated
  USING (organization_id = current_org_id() OR is_platform_admin());

CREATE POLICY "org staff write invoice containers"
  ON public.invoice_containers FOR ALL TO authenticated
  USING (organization_id = current_org_id() OR is_platform_admin())
  WITH CHECK (organization_id = current_org_id() OR is_platform_admin());

CREATE INDEX idx_invoice_containers_invoice ON public.invoice_containers(invoice_id);
CREATE INDEX idx_invoice_containers_container ON public.invoice_containers(container_id);

-- Update quote -> invoice generation to capture containers
CREATE OR REPLACE FUNCTION public.generate_invoice_from_quote(_quote_id uuid)
 RETURNS TABLE(invoice_id uuid, invoice_number text, already_existed boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _q RECORD;
  _cust RECORD;
  _existing_id uuid;
  _existing_num text;
  _new_id uuid;
  _new_num text;
  _org_currency text;
  _cust_currency text;
  _final_currency text;
  _subtotal numeric(14,2) := 0;
  _tax_amt  numeric(14,2) := 0;
  _total    numeric(14,2) := 0;
  _has_items boolean;
  _primary_container uuid;
BEGIN
  SELECT * INTO _q FROM quotes WHERE id = _quote_id;
  IF _q IS NULL THEN
    RAISE EXCEPTION 'quote_not_found';
  END IF;

  SELECT i.id, i.invoice_number INTO _existing_id, _existing_num
    FROM invoices i
   WHERE i.organization_id = _q.organization_id
     AND i.customer_reference = _q.quote_number
   LIMIT 1;

  IF _existing_id IS NOT NULL THEN
    invoice_id := _existing_id;
    invoice_number := _existing_num;
    already_existed := true;
    RETURN NEXT;
    RETURN;
  END IF;

  SELECT * INTO _cust FROM customers WHERE id = _q.customer_id;

  SELECT COALESCE(currency, 'USD') INTO _org_currency
    FROM organizations WHERE id = _q.organization_id;
  _cust_currency := NULLIF(_cust.currency, '');
  _final_currency := COALESCE(_cust_currency, _org_currency);

  SELECT
    COALESCE(SUM(qi.total_price * (1 - COALESCE(qi.discount_pct,0)/100.0)), 0),
    COALESCE(SUM(qi.total_price * (1 - COALESCE(qi.discount_pct,0)/100.0) * COALESCE(qi.tax_pct,0)/100.0), 0),
    COUNT(*) > 0
  INTO _subtotal, _tax_amt, _has_items
  FROM quote_items qi WHERE qi.quote_id = _quote_id;

  IF NOT _has_items THEN
    _subtotal := COALESCE(_q.total_amount, 0);
    _tax_amt  := 0;
  END IF;

  _total := ROUND(_subtotal + _tax_amt, 2);
  _subtotal := ROUND(_subtotal, 2);
  _tax_amt := ROUND(_tax_amt, 2);

  _new_num := 'INV-' || upper(to_hex(extract(epoch from clock_timestamp())::bigint))
              || '-' || substr(md5(random()::text || _quote_id::text), 1, 4);

  -- Resolve primary container from linked conversion job or container sale
  SELECT cc.container_id INTO _primary_container
    FROM container_conversions conv
    JOIN conversion_containers cc ON cc.conversion_id = conv.id
   WHERE conv.quote_id = _quote_id
   ORDER BY cc.created_at
   LIMIT 1;

  IF _primary_container IS NULL THEN
    SELECT cs.container_id INTO _primary_container
      FROM container_sales cs
     WHERE cs.quote_id = _quote_id
     LIMIT 1;
  END IF;

  INSERT INTO invoices (
    invoice_number, customer_name, customer_reference, customer_id,
    invoice_type, subtotal, tax_rate, tax_amount, total_amount, currency,
    status, issued_at, due_at, notes, created_by, organization_id, project_id,
    container_id
  ) VALUES (
    _new_num,
    COALESCE(_cust.company_name, 'Customer'),
    _q.quote_number,
    _q.customer_id,
    'other',
    _subtotal,
    CASE WHEN _subtotal > 0 THEN ROUND(_tax_amt / _subtotal * 100, 2) ELSE 0 END,
    _tax_amt,
    _total,
    _final_currency,
    'sent',
    now(),
    now() + interval '30 days',
    COALESCE('Auto-generated from accepted quote ' || _q.quote_number
             || CASE WHEN _q.notes IS NOT NULL THEN E'\n\n' || _q.notes ELSE '' END, NULL),
    auth.uid(),
    _q.organization_id,
    _q.project_id,
    _primary_container
  )
  RETURNING id INTO _new_id;

  INSERT INTO invoice_containers (invoice_id, container_id, organization_id)
  SELECT DISTINCT _new_id, cc.container_id, _q.organization_id
    FROM container_conversions conv
    JOIN conversion_containers cc ON cc.conversion_id = conv.id
   WHERE conv.quote_id = _quote_id
  ON CONFLICT DO NOTHING;

  INSERT INTO invoice_containers (invoice_id, container_id, organization_id)
  SELECT DISTINCT _new_id, cs.container_id, _q.organization_id
    FROM container_sales cs
   WHERE cs.quote_id = _quote_id AND cs.container_id IS NOT NULL
  ON CONFLICT DO NOTHING;

  INSERT INTO invoice_line_items (invoice_id, description, quantity, unit_price, total_price, charge_type, organization_id)
  SELECT
    _new_id,
    qi.description,
    qi.quantity,
    qi.unit_price,
    ROUND(qi.total_price * (1 - COALESCE(qi.discount_pct,0)/100.0) * (1 + COALESCE(qi.tax_pct,0)/100.0), 2),
    'other'::charge_type,
    _q.organization_id
  FROM quote_items qi
  WHERE qi.quote_id = _quote_id
  ORDER BY qi.sort_order, qi.created_at;

  IF NOT _has_items THEN
    INSERT INTO invoice_line_items (invoice_id, description, quantity, unit_price, total_price, charge_type, organization_id)
    VALUES (_new_id, 'Services per quote ' || _q.quote_number, 1, _total, _total, 'other', _q.organization_id);
  END IF;

  invoice_id := _new_id;
  invoice_number := _new_num;
  already_existed := false;
  RETURN NEXT;
END;
$function$;

-- Keep invoice_containers in sync whenever an invoice has a direct container_id
CREATE OR REPLACE FUNCTION public.sync_invoice_container_link()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.container_id IS NOT NULL THEN
    INSERT INTO invoice_containers (invoice_id, container_id, organization_id)
    VALUES (NEW.id, NEW.container_id, NEW.organization_id)
    ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_invoice_container_link ON public.invoices;
CREATE TRIGGER trg_sync_invoice_container_link
AFTER INSERT OR UPDATE OF container_id ON public.invoices
FOR EACH ROW EXECUTE FUNCTION public.sync_invoice_container_link();

-- Backfill: existing direct container links
INSERT INTO public.invoice_containers (invoice_id, container_id, organization_id)
SELECT i.id, i.container_id, i.organization_id
  FROM public.invoices i
 WHERE i.container_id IS NOT NULL
ON CONFLICT DO NOTHING;

-- Backfill: quote-generated invoices tied to conversion jobs
INSERT INTO public.invoice_containers (invoice_id, container_id, organization_id)
SELECT DISTINCT i.id, cc.container_id, i.organization_id
  FROM public.invoices i
  JOIN public.quotes q
    ON q.quote_number = i.customer_reference
   AND q.organization_id = i.organization_id
  JOIN public.container_conversions conv ON conv.quote_id = q.id
  JOIN public.conversion_containers cc ON cc.conversion_id = conv.id
ON CONFLICT DO NOTHING;

-- Backfill: quote-generated invoices tied to container sales
INSERT INTO public.invoice_containers (invoice_id, container_id, organization_id)
SELECT DISTINCT i.id, cs.container_id, i.organization_id
  FROM public.invoices i
  JOIN public.quotes q
    ON q.quote_number = i.customer_reference
   AND q.organization_id = i.organization_id
  JOIN public.container_sales cs ON cs.quote_id = q.id
 WHERE cs.container_id IS NOT NULL
ON CONFLICT DO NOTHING;

-- Set primary container_id on invoices that now have links but no direct container
UPDATE public.invoices i
   SET container_id = sub.container_id
  FROM (
    SELECT ic.invoice_id, MIN(ic.container_id::text)::uuid AS container_id
      FROM public.invoice_containers ic
     GROUP BY ic.invoice_id
  ) sub
 WHERE sub.invoice_id = i.id
   AND i.container_id IS NULL;