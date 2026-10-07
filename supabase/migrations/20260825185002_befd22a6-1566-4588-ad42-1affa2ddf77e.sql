CREATE OR REPLACE FUNCTION public.generate_repatriation_transfer_invoice(_repatriation_ids uuid[] DEFAULT NULL::uuid[], _customer_name text DEFAULT 'JJ MES DMCC'::text, _amount numeric DEFAULT NULL, _currency text DEFAULT 'USD'::text, _amounts numeric[] DEFAULT NULL)
RETURNS TABLE(invoice_id uuid, invoice_number text, line_count integer, total_amount numeric)
LANGUAGE plpgsql SET search_path TO 'public'
AS $$
DECLARE
  _org uuid := public.current_org_id();
  _invoice_id uuid;
  _invoice_number text;
  _count integer;
  _total numeric;
  _customer_id uuid;
BEGIN
  IF NOT (public.is_platform_admin() OR public.has_role(auth.uid(),'admin'::app_role) OR public.has_role(auth.uid(),'yard_operator'::app_role)) THEN
    RAISE EXCEPTION 'forbidden_role';
  END IF;
  IF _org IS NULL OR upper(btrim(_currency)) <> 'USD' THEN
    RAISE EXCEPTION 'transfer_invoice_requires_usd';
  END IF;
  IF _amounts IS NOT NULL AND (_repatriation_ids IS NULL OR array_length(_amounts,1) IS DISTINCT FROM array_length(_repatriation_ids,1)) THEN
    RAISE EXCEPTION 'transfer_amounts_must_match_repatriations';
  END IF;

  CREATE TEMP TABLE _eligible_transfers ON COMMIT DROP AS
  SELECT r.id AS repatriation_id, r.repatriation_number, r.container_id, c.container_number,
    coalesce(
      (SELECT a.amt FROM unnest(_repatriation_ids, _amounts) AS a(rid, amt) WHERE _amounts IS NOT NULL AND a.rid = r.id),
      _amount, r.transfer_fee_applied,
      (SELECT f.transfer_fee FROM public.lookup_repat_transfer_fee('Mombasa','Nairobi', c.size::text, current_date) f), 320)::numeric AS amount,
    (SELECT f.rate_card_id FROM public.lookup_repat_transfer_fee('Mombasa','Nairobi', c.size::text, current_date) f) AS rate_card_id
  FROM public.repatriations r
  JOIN public.containers c ON c.id = r.container_id
  WHERE r.organization_id = _org
    AND r.status <> 'cancelled'
    AND (_repatriation_ids IS NULL OR r.id = ANY(_repatriation_ids))
    AND (upper(btrim(coalesce(r.shipping_line,''))) IN (upper(btrim(_customer_name)),'JJ MES')
         OR upper(btrim(coalesce(c.owner,''))) = upper(btrim(_customer_name)))
    AND NOT EXISTS (SELECT 1 FROM public.repatriation_transfer_invoice_lines t WHERE t.repatriation_id = r.id);

  SELECT count(*)::int, coalesce(sum(e.amount),0) INTO _count, _total FROM _eligible_transfers e;
  IF _count = 0 THEN RAISE EXCEPTION 'no_unbilled_repatriation_transfers'; END IF;
  IF EXISTS (SELECT 1 FROM _eligible_transfers e WHERE e.amount <= 0) THEN
    RAISE EXCEPTION 'transfer_fee_must_be_positive';
  END IF;

  _customer_id := public.find_or_create_customer_by_name(_org, btrim(_customer_name));
  _invoice_number := 'RPT-'||to_char(current_date,'YYYYMMDD')||'-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,6));

  INSERT INTO public.invoices(invoice_number,customer_name,customer_reference,invoice_type,subtotal,tax_rate,tax_amount,total_amount,currency,status,created_by,organization_id,customer_id,notes,due_at)
  VALUES(_invoice_number, btrim(_customer_name), 'Repatriation transfer (Mombasa - Nairobi)', 'other', _total, 0, 0, _total, 'USD', 'draft', auth.uid(), _org, _customer_id,
    'Mombasa - Nairobi transfer fee per repatriated container; handling and transport billed separately', now() + interval '30 days')
  RETURNING id INTO _invoice_id;

  INSERT INTO public.invoice_line_items(invoice_id,description,quantity,unit_price,total_price,charge_type,organization_id)
  SELECT _invoice_id, e.container_number||' — '||e.repatriation_number||' — Mombasa-Nairobi transfer', 1, e.amount, e.amount, 'other', _org
  FROM _eligible_transfers e ORDER BY e.container_number;

  INSERT INTO public.invoice_containers(invoice_id, container_id, organization_id)
  SELECT DISTINCT _invoice_id, e.container_id, _org FROM _eligible_transfers e
  ON CONFLICT DO NOTHING;

  INSERT INTO public.repatriation_transfer_invoice_lines(organization_id,repatriation_id,invoice_id,amount,currency,repatriation_number,container_number,rate_card_id,created_by)
  SELECT _org, e.repatriation_id, _invoice_id, e.amount, 'USD', e.repatriation_number, e.container_number, e.rate_card_id, auth.uid()
  FROM _eligible_transfers e;

  UPDATE public.repatriations r
  SET transfer_invoice_id = _invoice_id, transfer_fee_applied = e.amount, transfer_fee_currency = 'USD',
      transfer_fee_applied_at = now(), updated_at = now()
  FROM _eligible_transfers e WHERE r.id = e.repatriation_id;

  PERFORM public.log_org_event(_org,'repatriation_transfer_invoiced',jsonb_build_object('invoice_id',_invoice_id,'invoice_number',_invoice_number,'customer',btrim(_customer_name),'line_count',_count,'amount',_total,'currency','USD'));
  RETURN QUERY SELECT _invoice_id,_invoice_number,_count,_total;
END $$;

REVOKE ALL ON FUNCTION public.generate_repatriation_transfer_invoice(uuid[],text,numeric,text,numeric[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.generate_repatriation_transfer_invoice(uuid[],text,numeric,text,numeric[]) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.set_repatriation_transfer_line_amounts(_invoice_id uuid, _repatriation_ids uuid[], _amounts numeric[], _reason text)
RETURNS TABLE(invoice_id uuid, line_count integer, total_amount numeric)
LANGUAGE plpgsql SET search_path TO 'public'
AS $$
DECLARE
  _org uuid := public.current_org_id();
  _inv record;
  _total numeric;
  _count integer;
  _paid numeric;
BEGIN
  IF NOT (public.is_platform_admin() OR public.has_role(auth.uid(),'admin'::app_role)) THEN
    RAISE EXCEPTION 'forbidden_role';
  END IF;
  IF _org IS NULL THEN RAISE EXCEPTION 'no_org'; END IF;
  IF coalesce(btrim(_reason),'') = '' THEN RAISE EXCEPTION 'reason_required'; END IF;
  IF _repatriation_ids IS NULL OR _amounts IS NULL OR array_length(_amounts,1) IS DISTINCT FROM array_length(_repatriation_ids,1) THEN
    RAISE EXCEPTION 'transfer_amounts_must_match_repatriations';
  END IF;
  IF EXISTS (SELECT 1 FROM unnest(_amounts) a WHERE a IS NULL OR a <= 0) THEN
    RAISE EXCEPTION 'transfer_fee_must_be_positive';
  END IF;

  SELECT * INTO _inv FROM public.invoices WHERE id = _invoice_id AND organization_id = _org;
  IF _inv IS NULL THEN RAISE EXCEPTION 'invoice_not_found'; END IF;
  IF _inv.status IN ('paid','cancelled') THEN RAISE EXCEPTION 'invoice_locked'; END IF;

  CREATE TEMP TABLE _new_amounts ON COMMIT DROP AS
  SELECT a.rid AS repatriation_id, a.amt::numeric AS amount
  FROM unnest(_repatriation_ids, _amounts) AS a(rid, amt);

  IF EXISTS (
    SELECT 1 FROM _new_amounts n
    WHERE NOT EXISTS (SELECT 1 FROM public.repatriation_transfer_invoice_lines t
                      WHERE t.invoice_id = _invoice_id AND t.repatriation_id = n.repatriation_id)
  ) THEN
    RAISE EXCEPTION 'repatriation_not_on_invoice';
  END IF;

  UPDATE public.repatriation_transfer_invoice_lines t
  SET amount = n.amount
  FROM _new_amounts n
  WHERE t.invoice_id = _invoice_id AND t.repatriation_id = n.repatriation_id;

  UPDATE public.invoice_line_items li
  SET unit_price = t.amount, total_price = t.amount * coalesce(li.quantity,1)
  FROM public.repatriation_transfer_invoice_lines t
  WHERE t.invoice_id = _invoice_id
    AND li.invoice_id = _invoice_id
    AND li.description LIKE t.container_number||' — '||t.repatriation_number||'%';

  SELECT count(*)::int, coalesce(sum(t.amount),0) INTO _count, _total
  FROM public.repatriation_transfer_invoice_lines t WHERE t.invoice_id = _invoice_id;

  SELECT coalesce(sum(p.amount),0) INTO _paid FROM public.payments p WHERE p.invoice_id = _invoice_id AND coalesce(p.status,'completed') <> 'cancelled';
  IF _paid > _total THEN RAISE EXCEPTION 'total_below_payments_received'; END IF;

  UPDATE public.invoices
  SET subtotal = _total,
      tax_amount = round(_total * coalesce(tax_rate,0) / 100.0, 2),
      total_amount = _total + round(_total * coalesce(tax_rate,0) / 100.0, 2),
      notes = coalesce(notes,'')||E'\n['||to_char(now(),'YYYY-MM-DD HH24:MI')||'] Transfer fees revised: '||btrim(_reason),
      updated_at = now()
  WHERE id = _invoice_id;

  UPDATE public.repatriations r
  SET transfer_fee_applied = n.amount, transfer_fee_applied_at = now(), updated_at = now()
  FROM _new_amounts n WHERE r.id = n.repatriation_id AND r.organization_id = _org;

  PERFORM public.log_org_event(_org,'repatriation_transfer_fees_revised',
    jsonb_build_object('invoice_id',_invoice_id,'line_count',_count,'total',_total,'reason',btrim(_reason)));

  RETURN QUERY SELECT _invoice_id, _count, _total;
END $$;

REVOKE ALL ON FUNCTION public.set_repatriation_transfer_line_amounts(uuid,uuid[],numeric[],text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_repatriation_transfer_line_amounts(uuid,uuid[],numeric[],text) TO authenticated, service_role;