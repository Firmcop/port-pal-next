
CREATE OR REPLACE FUNCTION public.container_acquisition_total(_container_id uuid, _currency text)
RETURNS numeric
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _org uuid := current_org_id();
  _cnum text;
  _target text := upper(coalesce(nullif(trim(_currency), ''), 'USD'));
  _total numeric := 0;
  _r record;
  _rate numeric;
BEGIN
  IF _container_id IS NULL THEN RETURN 0; END IF;
  SELECT container_number INTO _cnum FROM containers WHERE id = _container_id;

  FOR _r IN
    SELECT si.total_amount, upper(coalesce(si.currency, _target)) AS ccy,
           coalesce(si.issue_date, current_date) AS on_date
      FROM supplier_invoices si
     WHERE si.reason IN ('purchase','acquisition_transport','acquisition_crane_offloading')
       AND lower(coalesce(si.status,'')) NOT IN ('cancelled','void','credited','draft_void')
       AND (si.container_id = _container_id OR (_cnum IS NOT NULL AND si.reference = _cnum))
  LOOP
    IF _r.ccy = _target THEN
      _total := _total + coalesce(_r.total_amount, 0);
    ELSE
      _rate := get_fx_rate(_org, _r.ccy, _target, _r.on_date::date);
      IF _rate IS NULL OR _rate <= 0 THEN
        RAISE EXCEPTION 'missing_fx_rate: no rate % -> % on %. Add it under Finance → FX Rates.', _r.ccy, _target, _r.on_date;
      END IF;
      _total := _total + round(coalesce(_r.total_amount, 0) * _rate, 2);
    END IF;
  END LOOP;

  RETURN round(_total, 2);
END $$;

REVOKE ALL ON FUNCTION public.container_acquisition_total(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.container_acquisition_total(uuid, text) TO authenticated, service_role;


CREATE OR REPLACE FUNCTION public.set_sale_pricing(_id uuid, _selling_price numeric, _reason text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _org uuid := current_org_id();
  _s container_sales%ROWTYPE;
  _ccy text;
  _new_entry numeric;
  _old_cogs numeric;
  _delta_cogs numeric;
  _delta_rev numeric;
  _markup numeric := 0;
  _inv invoices%ROWTYPE;
  _paid numeric := 0;
  _tax numeric := 0;
  _cnum text;
  _invoice_updated boolean := false;
  _ledger_posted boolean := false;
BEGIN
  IF _org IS NULL THEN RAISE EXCEPTION 'no_organization'; END IF;
  IF NOT (is_org_admin(_org) OR has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'org_owner')) THEN
    RAISE EXCEPTION 'not_authorized: only an admin or owner can change sale pricing';
  END IF;
  IF coalesce(trim(_reason), '') = '' THEN RAISE EXCEPTION 'reason_required'; END IF;
  IF _selling_price IS NULL OR _selling_price < 0 THEN RAISE EXCEPTION 'invalid_selling_price'; END IF;

  SELECT * INTO _s FROM container_sales WHERE id = _id AND organization_id = _org;
  IF NOT FOUND THEN RAISE EXCEPTION 'sale_not_found'; END IF;

  _ccy := upper(coalesce(nullif(trim(_s.currency), ''),
                         (SELECT currency FROM organizations WHERE id = _org), 'USD'));
  SELECT container_number INTO _cnum FROM containers WHERE id = _s.container_id;

  -- Entry price is ALWAYS the container's live acquisition cost (seller + transport + crane).
  _new_entry := coalesce(container_acquisition_total(_s.container_id, _ccy), 0);

  _old_cogs := coalesce(_s.entry_price, 0) + coalesce(_s.transport_offloading_cost, 0);
  _delta_cogs := _new_entry - _old_cogs;
  _delta_rev := _selling_price - coalesce(_s.selling_price, 0);
  IF _new_entry > 0 THEN
    _markup := round(((_selling_price / _new_entry) - 1) * 100, 2);
  END IF;

  UPDATE container_sales
     SET entry_price = _new_entry,
         transport_offloading_cost = 0,   -- folded into entry price, never double-counted
         markup_percentage = _markup,
         selling_price = _selling_price,
         currency = _ccy,
         updated_at = now()
   WHERE id = _id;

  IF _s.status::text = 'sold' THEN
    IF _delta_cogs <> 0 THEN
      INSERT INTO accounting_transactions (
        transaction_number, account_type, category, description,
        debit_amount, credit_amount, reference_type, reference_id, organization_id, currency
      ) VALUES (
        'TXN-SALE-COGS-ADJ-' || substr(replace(gen_random_uuid()::text,'-',''),1,10),
        'expense', 'cost_adjustment',
        'Sale COGS restated — ' || coalesce(_s.sale_number, _id::text)
          || ' (' || _old_cogs || ' → ' || _new_entry || ')',
        CASE WHEN _delta_cogs > 0 THEN _delta_cogs ELSE 0 END,
        CASE WHEN _delta_cogs < 0 THEN -_delta_cogs ELSE 0 END,
        'container_sales', _id, _org, _ccy
      );
      _ledger_posted := true;
    END IF;

    IF _delta_rev <> 0 THEN
      INSERT INTO accounting_transactions (
        transaction_number, account_type, category, description,
        debit_amount, credit_amount, reference_type, reference_id, organization_id, currency
      ) VALUES (
        'TXN-SALE-REV-ADJ-' || substr(replace(gen_random_uuid()::text,'-',''),1,10),
        'revenue', 'container_sale',
        'Sale revenue restated — ' || coalesce(_s.sale_number, _id::text)
          || ' (' || coalesce(_s.selling_price,0) || ' → ' || _selling_price || ')',
        CASE WHEN _delta_rev < 0 THEN -_delta_rev ELSE 0 END,
        CASE WHEN _delta_rev > 0 THEN _delta_rev ELSE 0 END,
        'container_sales', _id, _org, _ccy
      );
      _ledger_posted := true;
    END IF;
  END IF;

  -- Customer invoice always follows the selling price.
  IF _s.invoice_id IS NOT NULL THEN
    SELECT * INTO _inv FROM invoices WHERE id = _s.invoice_id;
    IF FOUND AND _inv.voided_at IS NULL THEN
      _tax := round(_selling_price * coalesce(_inv.tax_rate, 0) / 100.0, 2);
      SELECT coalesce(sum(amount), 0) INTO _paid FROM payment_allocations WHERE invoice_id = _inv.id;

      UPDATE invoice_line_items
         SET quantity = 1,
             unit_price = _selling_price,
             total_price = _selling_price,
             description = 'Container sale — ' || coalesce(_cnum, '—') || ' to ' || coalesce(_s.buyer_name, '—')
       WHERE invoice_id = _inv.id
         AND id = (SELECT id FROM invoice_line_items WHERE invoice_id = _inv.id ORDER BY created_at LIMIT 1);

      DELETE FROM invoice_line_items
       WHERE invoice_id = _inv.id
         AND id <> (SELECT id FROM invoice_line_items WHERE invoice_id = _inv.id ORDER BY created_at LIMIT 1);

      IF NOT EXISTS (SELECT 1 FROM invoice_line_items WHERE invoice_id = _inv.id) THEN
        INSERT INTO invoice_line_items(invoice_id, description, quantity, unit_price, total_price, organization_id)
        VALUES (_inv.id, 'Container sale — ' || coalesce(_cnum,'—') || ' to ' || coalesce(_s.buyer_name,'—'),
                1, _selling_price, _selling_price, _org);
      END IF;

      UPDATE invoices
         SET subtotal = _selling_price,
             tax_amount = _tax,
             total_amount = _selling_price + _tax,
             currency = _ccy,
             partially_paid = (_paid > 0 AND _paid < _selling_price + _tax),
             status = CASE
                        WHEN _paid >= _selling_price + _tax AND _selling_price + _tax > 0 THEN 'paid'::invoice_status
                        WHEN status = 'paid'::invoice_status THEN 'sent'::invoice_status
                        ELSE status
                      END,
             paid_at = CASE WHEN _paid >= _selling_price + _tax AND _selling_price + _tax > 0 THEN coalesce(paid_at, now()) ELSE NULL END,
             updated_at = now()
       WHERE id = _inv.id;
      _invoice_updated := true;
    END IF;
  END IF;

  INSERT INTO finance_audit_log(organization_id, actor_user_id, entity_type, entity_id, entity_ref, action, summary, before_data, after_data)
  VALUES (
    _org, auth.uid(), 'container_sales', _id, _s.sale_number, 'pricing_update',
    jsonb_build_object('reason', _reason, 'currency', _ccy,
                       'delta_cogs', _delta_cogs, 'delta_revenue', _delta_rev,
                       'invoice_updated', _invoice_updated),
    jsonb_build_object('entry_price', _s.entry_price, 'transport_offloading_cost', _s.transport_offloading_cost,
                       'selling_price', _s.selling_price, 'markup_percentage', _s.markup_percentage),
    jsonb_build_object('entry_price', _new_entry, 'transport_offloading_cost', 0,
                       'selling_price', _selling_price, 'markup_percentage', _markup)
  );

  RETURN jsonb_build_object(
    'entry_price', _new_entry,
    'selling_price', _selling_price,
    'markup_percentage', _markup,
    'currency', _ccy,
    'delta_cogs', _delta_cogs,
    'delta_revenue', _delta_rev,
    'ledger_posted', _ledger_posted,
    'invoice_updated', _invoice_updated
  );
END $$;

REVOKE ALL ON FUNCTION public.set_sale_pricing(uuid, numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_sale_pricing(uuid, numeric, text) TO authenticated, service_role;
