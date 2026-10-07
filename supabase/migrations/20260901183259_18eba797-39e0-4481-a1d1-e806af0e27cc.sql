ALTER TABLE public.supplier_invoices ADD COLUMN IF NOT EXISTS supplier_ref text;
ALTER TABLE public.purchase_orders ADD COLUMN IF NOT EXISTS supplier_ref text;
CREATE INDEX IF NOT EXISTS idx_supplier_invoices_supplier_ref
  ON public.supplier_invoices (organization_id, supplier_id, supplier_ref);

-- allow supplier_ref through the audited edit path
CREATE OR REPLACE FUNCTION public.admin_update_supplier_invoice(_invoice_id uuid, _patch jsonb, _reason text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _org uuid := current_org_id();
  _before public.supplier_invoices%ROWTYPE;
  _changes jsonb := '{}'::jsonb;
  _k text;
BEGIN
  IF NOT (has_role(_uid,'admin') OR has_role(_uid,'org_owner') OR has_role(_uid,'accountant')) THEN
    RAISE EXCEPTION 'Not authorized to edit purchase invoices';
  END IF;
  IF _reason IS NULL OR length(btrim(_reason)) < 5 THEN
    RAISE EXCEPTION 'A reason of at least 5 characters is required';
  END IF;

  SELECT * INTO _before FROM public.supplier_invoices WHERE id = _invoice_id AND organization_id = _org;
  IF NOT FOUND THEN RAISE EXCEPTION 'Purchase invoice not found'; END IF;

  FOR _k IN SELECT jsonb_object_keys(_patch) LOOP
    IF _k NOT IN ('issue_date','due_date','subtotal','tax_amount','total_amount','currency','reference','notes','status','reason','supplier_ref') THEN
      RAISE EXCEPTION 'Field % cannot be edited', _k;
    END IF;
  END LOOP;

  UPDATE public.supplier_invoices SET
    issue_date   = COALESCE((_patch->>'issue_date')::date, issue_date),
    due_date     = COALESCE((_patch->>'due_date')::date, due_date),
    subtotal     = COALESCE((_patch->>'subtotal')::numeric, subtotal),
    tax_amount   = COALESCE((_patch->>'tax_amount')::numeric, tax_amount),
    total_amount = COALESCE((_patch->>'total_amount')::numeric, total_amount),
    currency     = COALESCE(NULLIF(_patch->>'currency',''), currency),
    reference    = COALESCE(_patch->>'reference', reference),
    notes        = COALESCE(_patch->>'notes', notes),
    status       = COALESCE(NULLIF(_patch->>'status',''), status),
    reason       = COALESCE(_patch->>'reason', reason),
    supplier_ref = COALESCE(NULLIF(btrim(_patch->>'supplier_ref'),''), supplier_ref),
    updated_at   = now()
  WHERE id = _invoice_id;

  SELECT jsonb_object_agg(k, jsonb_build_object('from', b.v, 'to', a.v)) INTO _changes
    FROM jsonb_each_text(to_jsonb(_before)) b(k,v)
    JOIN jsonb_each_text((SELECT to_jsonb(si) FROM public.supplier_invoices si WHERE si.id = _invoice_id)) a(k,v) USING (k)
   WHERE b.v IS DISTINCT FROM a.v AND k <> 'updated_at';

  INSERT INTO public.supplier_invoice_audit (organization_id, invoice_id, actor_id, action, reason, changes)
  VALUES (_org, _invoice_id, _uid, 'edit', btrim(_reason), COALESCE(_changes,'{}'::jsonb));

  UPDATE public.accounting_transactions t
     SET credit_amount = (SELECT total_amount FROM public.supplier_invoices WHERE id = _invoice_id),
         currency      = (SELECT currency FROM public.supplier_invoices WHERE id = _invoice_id)
   WHERE t.reference_type IN ('supplier_invoices','supplier_invoice')
     AND t.reference_id = _invoice_id AND t.credit_amount > 0;

  RETURN _invoice_id;
END $function$;

-- bulk assign the supplier's own invoice number
CREATE OR REPLACE FUNCTION public.set_supplier_invoice_refs(_invoice_ids uuid[], _supplier_ref text, _reason text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _org uuid := current_org_id();
  _ref text := btrim(COALESCE(_supplier_ref,''));
  _n integer := 0;
  _r record;
BEGIN
  IF NOT (has_role(_uid,'admin') OR has_role(_uid,'org_owner') OR has_role(_uid,'accountant')) THEN
    RAISE EXCEPTION 'Not authorized to edit purchase invoices';
  END IF;
  IF _ref = '' THEN RAISE EXCEPTION 'Supplier invoice number is required'; END IF;
  IF _reason IS NULL OR length(btrim(_reason)) < 5 THEN
    RAISE EXCEPTION 'A reason of at least 5 characters is required';
  END IF;

  FOR _r IN
    SELECT id, supplier_ref, purchase_order_id
      FROM public.supplier_invoices
     WHERE organization_id = _org AND id = ANY(_invoice_ids)
  LOOP
    IF _r.supplier_ref IS DISTINCT FROM _ref THEN
      UPDATE public.supplier_invoices SET supplier_ref = _ref, updated_at = now() WHERE id = _r.id;
      IF _r.purchase_order_id IS NOT NULL THEN
        UPDATE public.purchase_orders SET supplier_ref = _ref WHERE id = _r.purchase_order_id;
      END IF;
      INSERT INTO public.supplier_invoice_audit (organization_id, invoice_id, actor_id, action, reason, changes)
      VALUES (_org, _r.id, _uid, 'set_supplier_ref', btrim(_reason),
        jsonb_build_object('supplier_ref', jsonb_build_object('from', _r.supplier_ref, 'to', _ref)));
      _n := _n + 1;
    END IF;
  END LOOP;

  RETURN _n;
END $function$;

-- one bundled historical purchase invoice per supplier invoice number
CREATE OR REPLACE FUNCTION public.create_bundled_supplier_invoice(
  _supplier_id uuid,
  _supplier_ref text,
  _currency text,
  _lines jsonb,
  _issue_date date,
  _reason text
)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _org uuid := current_org_id();
  _ref text := btrim(COALESCE(_supplier_ref,''));
  _cur text := upper(COALESCE(NULLIF(_currency,''),'USD'));
  _issue date := COALESCE(_issue_date, current_date);
  _supplier_name text;
  _total numeric := 0;
  _po_id uuid; _po_num text; _inv_id uuid; _inv_num text;
  _l jsonb; _amt numeric; _cn text; _label text;
BEGIN
  IF NOT (has_role(_uid,'admin') OR has_role(_uid,'org_owner') OR has_role(_uid,'accountant')) THEN
    RAISE EXCEPTION 'Not authorized to create purchase invoices';
  END IF;
  IF _ref = '' THEN RAISE EXCEPTION 'Supplier invoice number is required'; END IF;
  IF _reason IS NULL OR length(btrim(_reason)) < 5 THEN
    RAISE EXCEPTION 'A reason of at least 5 characters is required';
  END IF;
  IF _lines IS NULL OR jsonb_typeof(_lines) <> 'array' OR jsonb_array_length(_lines) = 0 THEN
    RAISE EXCEPTION 'At least one container line is required';
  END IF;

  SELECT name INTO _supplier_name FROM public.suppliers
   WHERE id = _supplier_id AND organization_id = _org;
  IF _supplier_name IS NULL THEN RAISE EXCEPTION 'Supplier not found'; END IF;

  IF EXISTS (
    SELECT 1 FROM public.supplier_invoices
     WHERE organization_id = _org AND supplier_id = _supplier_id
       AND supplier_ref = _ref AND status <> 'cancelled'
  ) THEN
    RAISE EXCEPTION 'A purchase invoice for supplier invoice % already exists', _ref;
  END IF;

  FOR _l IN SELECT * FROM jsonb_array_elements(_lines) LOOP
    _amt := COALESCE((_l->>'amount')::numeric, 0);
    IF _amt <= 0 THEN RAISE EXCEPTION 'Every container line needs an amount greater than zero'; END IF;
    _total := _total + _amt;
  END LOOP;

  _po_num := 'PO-ACQ-HIST-' || regexp_replace(upper(_ref), '[^A-Z0-9]', '', 'g');

  INSERT INTO public.purchase_orders (
    po_number, supplier_id, status, total_cost, subtotal, organization_id, currency,
    order_date, recipient_source, recipient_resolution_note, supplier_ref
  ) VALUES (
    _po_num, _supplier_id, 'approved', _total, _total, _org, _cur, _issue,
    'historical_statement',
    'Historical bundle from supplier invoice ' || _ref || ' — containers acquired before the system went live',
    _ref
  ) RETURNING id INTO _po_id;

  _inv_num := 'PINV-HIST-' || to_char(_issue,'YYYYMMDD') || '-' || substr(replace(gen_random_uuid()::text,'-',''),1,6);

  INSERT INTO public.supplier_invoices (
    organization_id, invoice_number, supplier_id, purchase_order_id, container_id,
    reason, reference, supplier_ref, issue_date, due_date,
    subtotal, tax_amount, total_amount, currency, status, acquisition_component, notes
  ) VALUES (
    _org, _inv_num, _supplier_id, _po_id, NULL,
    'purchase', _ref, _ref, _issue, _issue + INTERVAL '30 days',
    _total, 0, _total, _cur, 'issued', 'purchase_price',
    btrim(_reason)
  ) RETURNING id INTO _inv_id;

  FOR _l IN SELECT * FROM jsonb_array_elements(_lines) LOOP
    _cn := btrim(COALESCE(_l->>'container_number',''));
    _amt := (_l->>'amount')::numeric;
    _label := 'Container purchase — ' || COALESCE(NULLIF(_cn,''),'(unspecified)');
    INSERT INTO public.supplier_invoice_lines (organization_id, invoice_id, description, quantity, unit_price, line_total)
    VALUES (_org, _inv_id, _label, 1, _amt, _amt);
    INSERT INTO public.po_items (po_id, description, quantity, unit_price, total_cost, organization_id)
    VALUES (_po_id, _label, 1, _amt, _amt, _org);
  END LOOP;

  INSERT INTO public.accounting_transactions (
    transaction_number, account_type, category, description,
    debit_amount, credit_amount, reference_type, reference_id, organization_id, currency, transaction_date
  ) VALUES (
    'TXN-APAY-' || substr(replace(gen_random_uuid()::text,'-',''),1,10),
    'liability', 'container_acquisition_payable',
    'Historical container purchases — ' || _supplier_name || ' invoice ' || _ref || ' (' || _inv_num || ')',
    0, _total, 'supplier_invoices', _inv_id, _org, _cur, _issue
  );

  INSERT INTO public.supplier_invoice_audit (organization_id, invoice_id, actor_id, action, reason, changes)
  VALUES (_org, _inv_id, _uid, 'create_bundled_historical', btrim(_reason),
    jsonb_build_object('supplier_ref', _ref, 'currency', _cur, 'total', _total, 'lines', _lines));

  RETURN _inv_id;
END $function$;

-- correct a container number and carry it through to its purchase invoices
CREATE OR REPLACE FUNCTION public.correct_container_number(_container_id uuid, _new_number text, _reason text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _org uuid := current_org_id();
  _new text := btrim(COALESCE(_new_number,''));
  _old text;
  _touched integer := 0;
  _r record;
BEGIN
  IF NOT (has_role(_uid,'admin') OR has_role(_uid,'org_owner') OR is_platform_admin()) THEN
    RAISE EXCEPTION 'Not authorized to correct container numbers';
  END IF;
  IF _new = '' THEN RAISE EXCEPTION 'A new container number is required'; END IF;
  IF _reason IS NULL OR length(btrim(_reason)) < 5 THEN
    RAISE EXCEPTION 'A reason of at least 5 characters is required';
  END IF;

  SELECT container_number INTO _old FROM public.containers
   WHERE id = _container_id AND organization_id = _org;
  IF _old IS NULL THEN RAISE EXCEPTION 'Container not found'; END IF;
  IF _old = _new THEN RETURN 0; END IF;

  IF EXISTS (
    SELECT 1 FROM public.containers
     WHERE organization_id = _org AND id <> _container_id
       AND regexp_replace(upper(container_number),'[^A-Z0-9]','','g') = regexp_replace(upper(_new),'[^A-Z0-9]','','g')
  ) THEN
    RAISE EXCEPTION 'Another container already uses number %', _new;
  END IF;

  PERFORM set_config('app.edit_reason', btrim(_reason), true);
  UPDATE public.containers SET container_number = _new, updated_at = now() WHERE id = _container_id;

  FOR _r IN
    SELECT id, reference FROM public.supplier_invoices
     WHERE organization_id = _org AND container_id = _container_id
  LOOP
    IF _r.reference IS NULL OR regexp_replace(upper(_r.reference),'[^A-Z0-9]','','g')
         = regexp_replace(upper(_old),'[^A-Z0-9]','','g') THEN
      UPDATE public.supplier_invoices SET reference = _new, updated_at = now() WHERE id = _r.id;
      INSERT INTO public.supplier_invoice_audit (organization_id, invoice_id, actor_id, action, reason, changes)
      VALUES (_org, _r.id, _uid, 'container_number_corrected', btrim(_reason),
        jsonb_build_object('reference', jsonb_build_object('from', _r.reference, 'to', _new)));
      _touched := _touched + 1;
    END IF;
  END LOOP;

  INSERT INTO public.finance_audit_log (organization_id, entity_type, entity_id, action, summary)
  VALUES (_org, 'containers', _container_id, 'container_number_corrected',
    jsonb_build_object('from', _old, 'to', _new, 'reason', btrim(_reason), 'invoices_updated', _touched));

  RETURN _touched;
END $function$;

REVOKE ALL ON FUNCTION public.set_supplier_invoice_refs(uuid[], text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.create_bundled_supplier_invoice(uuid, text, text, jsonb, date, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.correct_container_number(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_supplier_invoice_refs(uuid[], text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_bundled_supplier_invoice(uuid, text, text, jsonb, date, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.correct_container_number(uuid, text, text) TO authenticated;