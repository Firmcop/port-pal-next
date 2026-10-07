
-- 1) Balance helper
CREATE OR REPLACE FUNCTION public.invoice_balance(_invoice_id uuid)
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT GREATEST(
    COALESCE((SELECT total_amount FROM invoices WHERE id = _invoice_id), 0)
      - COALESCE((SELECT SUM(amount) FROM payments WHERE invoice_id = _invoice_id), 0),
    0
  )::numeric(14,2);
$$;
REVOKE ALL ON FUNCTION public.invoice_balance(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.invoice_balance(uuid) TO authenticated, service_role;

-- 2) Overpayment guard
CREATE OR REPLACE FUNCTION public.prevent_invoice_overpayment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _total numeric(14,2);
  _paid  numeric(14,2);
  _delta numeric(14,2);
BEGIN
  IF NEW.invoice_id IS NULL THEN RETURN NEW; END IF;

  SELECT total_amount INTO _total FROM invoices WHERE id = NEW.invoice_id;
  IF _total IS NULL OR _total <= 0 THEN RETURN NEW; END IF;

  SELECT COALESCE(SUM(amount), 0) INTO _paid
    FROM payments
   WHERE invoice_id = NEW.invoice_id
     AND (TG_OP = 'INSERT' OR id <> NEW.id);

  _delta := _total - (_paid + NEW.amount);
  IF _delta < -0.01 THEN
    RAISE EXCEPTION 'overpayment_not_allowed: invoice total %, already paid %, attempted %',
      _total, _paid, NEW.amount
      USING ERRCODE = '22023';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_invoice_overpayment ON public.payments;
CREATE TRIGGER trg_prevent_invoice_overpayment
BEFORE INSERT OR UPDATE OF amount, invoice_id ON public.payments
FOR EACH ROW EXECUTE FUNCTION public.prevent_invoice_overpayment();

-- 3) Generate invoice from an accepted quote (idempotent)
CREATE OR REPLACE FUNCTION public.generate_invoice_from_quote(_quote_id uuid)
RETURNS TABLE(invoice_id uuid, invoice_number text, already_existed boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
BEGIN
  SELECT * INTO _q FROM quotes WHERE id = _quote_id;
  IF _q IS NULL THEN
    RAISE EXCEPTION 'quote_not_found';
  END IF;

  -- idempotent by customer_reference = quote_number within same org
  SELECT id, invoice_number INTO _existing_id, _existing_num
    FROM invoices
   WHERE organization_id = _q.organization_id
     AND customer_reference = _q.quote_number
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

  -- Aggregate items for totals
  SELECT
    COALESCE(SUM(total_price * (1 - COALESCE(discount_pct,0)/100.0)), 0),
    COALESCE(SUM(total_price * (1 - COALESCE(discount_pct,0)/100.0) * COALESCE(tax_pct,0)/100.0), 0),
    COUNT(*) > 0
  INTO _subtotal, _tax_amt, _has_items
  FROM quote_items WHERE quote_id = _quote_id;

  IF NOT _has_items THEN
    _subtotal := COALESCE(_q.total_amount, 0);
    _tax_amt  := 0;
  END IF;

  _total := ROUND(_subtotal + _tax_amt, 2);
  _subtotal := ROUND(_subtotal, 2);
  _tax_amt := ROUND(_tax_amt, 2);

  _new_num := 'INV-' || upper(to_hex(extract(epoch from clock_timestamp())::bigint))
              || '-' || substr(md5(random()::text || _quote_id::text), 1, 4);

  INSERT INTO invoices (
    invoice_number, customer_name, customer_reference, customer_id,
    invoice_type, subtotal, tax_rate, tax_amount, total_amount, currency,
    status, issued_at, due_at, notes, created_by, organization_id, project_id
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
    _q.project_id
  )
  RETURNING id INTO _new_id;

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
$$;

REVOKE ALL ON FUNCTION public.generate_invoice_from_quote(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.generate_invoice_from_quote(uuid) TO authenticated, service_role;
