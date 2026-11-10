-- =====================================================================
-- One discount for the whole quote, instead of line discounts (10 Nov 2026).
--
-- quotes.discount_type ('amount' | 'percent') and discount_value: taken off
-- the subtotal before tax. quote_totals() computes subtotal, discount, tax and
-- total (same rule as src/lib/quote-totals.ts); quotes.total_amount and
-- discount_amount are kept up to date from the lines and the discount.
-- The two quotes that used a line discount get the same money as a quote
-- discount, so their totals do not change.
-- generate_invoice_from_quote applied line discount and tax a second time on
-- top of total_price (which already includes them); it now bills the net
-- line amounts, a "Discount" line, and tax on the discounted amount.
-- =====================================================================
ALTER TABLE public.quotes ADD COLUMN IF NOT EXISTS discount_type text NOT NULL DEFAULT 'amount'
  CHECK (discount_type IN ('amount', 'percent'));
ALTER TABLE public.quotes ADD COLUMN IF NOT EXISTS discount_value numeric(14,2) NOT NULL DEFAULT 0 CHECK (discount_value >= 0);
ALTER TABLE public.quotes ADD COLUMN IF NOT EXISTS discount_amount numeric(14,2) NOT NULL DEFAULT 0;
COMMENT ON COLUMN public.quotes.discount_value IS 'Whole-quote discount: an amount, or a percentage when discount_type = percent. Applied before tax.';

CREATE OR REPLACE FUNCTION public.quote_totals(_quote_id uuid, _type text DEFAULT NULL, _value numeric DEFAULT NULL)
RETURNS TABLE(subtotal numeric, discount numeric, net numeric, tax numeric, total numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _sub numeric; _ltax numeric; _t text; _v numeric; _d numeric; _ratio numeric;
BEGIN
  SELECT coalesce(_type, q.discount_type), coalesce(_value, q.discount_value) INTO _t, _v FROM quotes q WHERE q.id = _quote_id;
  SELECT round(coalesce(sum(coalesce(qi.quantity,0) * coalesce(qi.unit_price,0) * (1 - coalesce(qi.discount_pct,0)/100.0)), 0), 2),
         coalesce(sum(coalesce(qi.quantity,0) * coalesce(qi.unit_price,0) * (1 - coalesce(qi.discount_pct,0)/100.0)
                      * coalesce(qi.tax_pct,0)/100.0), 0)
    INTO _sub, _ltax FROM quote_items qi WHERE qi.quote_id = _quote_id;
  _v := greatest(coalesce(_v, 0), 0);
  _d := CASE WHEN _t = 'percent' THEN _sub * least(_v, 100) / 100.0 ELSE _v END;
  _d := least(round(_d, 2), greatest(_sub, 0));
  _ratio := CASE WHEN _sub > 0 THEN _d / _sub ELSE 0 END;
  subtotal := _sub; discount := _d; net := round(_sub - _d, 2);
  tax := round(_ltax * (1 - _ratio), 2); total := round(net + tax, 2);
  RETURN NEXT;
END $$;

-- lines changed -> quote total
CREATE OR REPLACE FUNCTION public.quote_items_recalc_parent()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _qid uuid; _t record;
BEGIN
  _qid := COALESCE(NEW.quote_id, OLD.quote_id);
  SELECT * INTO _t FROM public.quote_totals(_qid);
  UPDATE public.quotes q SET total_amount = _t.total, discount_amount = _t.discount
   WHERE q.id = _qid AND (q.total_amount IS DISTINCT FROM _t.total OR q.discount_amount IS DISTINCT FROM _t.discount);
  RETURN NULL;
END $$;

-- discount changed -> quote total
CREATE OR REPLACE FUNCTION public.trg_quote_discount_recalc()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _t record;
BEGIN
  SELECT * INTO _t FROM public.quote_totals(NEW.id, NEW.discount_type, NEW.discount_value);
  NEW.total_amount := _t.total;
  NEW.discount_amount := _t.discount;
  RETURN NEW;
END $$;

CREATE OR REPLACE TRIGGER trg_quote_discount_recalc
BEFORE UPDATE OF discount_type, discount_value ON public.quotes
FOR EACH ROW EXECUTE FUNCTION public.trg_quote_discount_recalc();

-- the two line discounts in use -> the same money as a quote discount
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT qi.quote_id, round(sum(coalesce(qi.quantity,0) * coalesce(qi.unit_price,0) * coalesce(qi.discount_pct,0) / 100.0), 2) AS amt
      FROM quote_items qi WHERE coalesce(qi.discount_pct, 0) <> 0 GROUP BY qi.quote_id
  LOOP
    UPDATE quote_items SET discount_pct = 0 WHERE quote_id = r.quote_id AND coalesce(discount_pct, 0) <> 0;
    UPDATE quotes SET discount_type = 'amount', discount_value = r.amt WHERE id = r.quote_id;
  END LOOP;
END $$;

-- discount_amount for all other quotes (0 unless set)
UPDATE quotes q SET discount_amount = (SELECT t.discount FROM quote_totals(q.id) t)
 WHERE q.discount_amount IS DISTINCT FROM (SELECT t.discount FROM quote_totals(q.id) t);

-- quote -> invoice: net line amounts, a Discount line, tax on the discounted amount
CREATE OR REPLACE FUNCTION public.generate_invoice_from_quote(_quote_id uuid)
RETURNS TABLE(invoice_id uuid, invoice_number text, already_existed boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  _q RECORD; _cust RECORD; _t RECORD;
  _existing_id uuid; _existing_num text; _new_id uuid; _new_num text;
  _org_currency text; _cust_currency text; _final_currency text;
  _has_items boolean; _primary_container uuid;
BEGIN
  SELECT * INTO _q FROM quotes WHERE id = _quote_id;
  IF _q IS NULL THEN RAISE EXCEPTION 'quote_not_found'; END IF;

  SELECT i.id, i.invoice_number INTO _existing_id, _existing_num
    FROM invoices i WHERE i.organization_id = _q.organization_id AND i.customer_reference = _q.quote_number LIMIT 1;
  IF _existing_id IS NOT NULL THEN
    invoice_id := _existing_id; invoice_number := _existing_num; already_existed := true;
    RETURN NEXT; RETURN;
  END IF;

  SELECT * INTO _cust FROM customers WHERE id = _q.customer_id;
  SELECT COALESCE(currency, 'USD') INTO _org_currency FROM organizations WHERE id = _q.organization_id;
  _cust_currency := NULLIF(_cust.currency, '');
  _final_currency := COALESCE(_cust_currency, _org_currency);

  SELECT EXISTS (SELECT 1 FROM quote_items WHERE quote_id = _quote_id) INTO _has_items;
  SELECT * INTO _t FROM quote_totals(_quote_id);
  IF NOT _has_items THEN
    _t.net := COALESCE(_q.total_amount, 0); _t.tax := 0; _t.total := _t.net; _t.discount := 0;
  END IF;

  _new_num := 'INV-' || upper(to_hex(extract(epoch from clock_timestamp())::bigint))
              || '-' || substr(md5(random()::text || _quote_id::text), 1, 4);

  SELECT cc.container_id INTO _primary_container
    FROM container_conversions conv JOIN conversion_containers cc ON cc.conversion_id = conv.id
   WHERE conv.quote_id = _quote_id ORDER BY cc.created_at LIMIT 1;
  IF _primary_container IS NULL THEN
    SELECT conv.container_id INTO _primary_container FROM container_conversions conv
     WHERE conv.quote_id = _quote_id AND conv.container_id IS NOT NULL LIMIT 1;
  END IF;
  IF _primary_container IS NULL THEN
    SELECT cs.container_id INTO _primary_container FROM container_sales cs
     WHERE cs.quote_id = _quote_id AND cs.container_id IS NOT NULL LIMIT 1;
  END IF;

  INSERT INTO invoices (
    invoice_number, customer_name, customer_reference, customer_id,
    invoice_type, subtotal, tax_rate, tax_amount, total_amount, currency,
    status, issued_at, due_at, notes, created_by, organization_id, project_id, container_id
  ) VALUES (
    _new_num, COALESCE(_cust.company_name, 'Customer'), _q.quote_number, _q.customer_id,
    'other', _t.net,
    CASE WHEN _t.net > 0 THEN ROUND(_t.tax / _t.net * 100, 2) ELSE 0 END,
    _t.tax, _t.total, _final_currency, 'sent', now(), now() + interval '30 days',
    COALESCE('Auto-generated from accepted quote ' || _q.quote_number
             || CASE WHEN _q.notes IS NOT NULL THEN E'\n\n' || _q.notes ELSE '' END, NULL),
    auth.uid(), _q.organization_id, _q.project_id, _primary_container
  ) RETURNING id INTO _new_id;

  INSERT INTO invoice_containers (invoice_id, container_id, organization_id)
  SELECT DISTINCT _new_id, cc.container_id, _q.organization_id
    FROM container_conversions conv JOIN conversion_containers cc ON cc.conversion_id = conv.id
   WHERE conv.quote_id = _quote_id
  ON CONFLICT DO NOTHING;
  INSERT INTO invoice_containers (invoice_id, container_id, organization_id)
  SELECT DISTINCT _new_id, conv.container_id, _q.organization_id
    FROM container_conversions conv WHERE conv.quote_id = _quote_id AND conv.container_id IS NOT NULL
  ON CONFLICT DO NOTHING;
  INSERT INTO invoice_containers (invoice_id, container_id, organization_id)
  SELECT DISTINCT _new_id, cs.container_id, _q.organization_id
    FROM container_sales cs WHERE cs.quote_id = _quote_id AND cs.container_id IS NOT NULL
  ON CONFLICT DO NOTHING;

  -- lines before tax; the invoice carries the tax
  INSERT INTO invoice_line_items (invoice_id, description, quantity, unit_price, total_price, charge_type, organization_id)
  SELECT _new_id, qi.description, qi.quantity,
         ROUND(qi.unit_price * (1 - COALESCE(qi.discount_pct,0)/100.0), 2),
         ROUND(qi.quantity * qi.unit_price * (1 - COALESCE(qi.discount_pct,0)/100.0), 2),
         'other'::charge_type, _q.organization_id
    FROM quote_items qi WHERE qi.quote_id = _quote_id
   ORDER BY qi.sort_order, qi.created_at;

  IF _t.discount > 0 THEN
    INSERT INTO invoice_line_items (invoice_id, description, quantity, unit_price, total_price, charge_type, organization_id)
    VALUES (_new_id,
            'Discount' || CASE WHEN _q.discount_type = 'percent' THEN ' (' || trim(to_char(_q.discount_value, 'FM999990.##')) || '%)' ELSE '' END,
            1, -_t.discount, -_t.discount, 'other', _q.organization_id);
  END IF;

  IF NOT _has_items THEN
    INSERT INTO invoice_line_items (invoice_id, description, quantity, unit_price, total_price, charge_type, organization_id)
    VALUES (_new_id, 'Services per quote ' || _q.quote_number, 1, _t.total, _t.total, 'other', _q.organization_id);
  END IF;

  invoice_id := _new_id; invoice_number := _new_num; already_existed := false;
  RETURN NEXT;
END;
$function$;
