ALTER TABLE public.repat_rate_cards ADD COLUMN IF NOT EXISTS transfer_fee numeric NOT NULL DEFAULT 0;

ALTER TABLE public.repatriations
  ADD COLUMN IF NOT EXISTS transfer_invoice_id uuid REFERENCES public.invoices(id),
  ADD COLUMN IF NOT EXISTS transfer_fee_applied numeric,
  ADD COLUMN IF NOT EXISTS transfer_fee_currency text,
  ADD COLUMN IF NOT EXISTS transfer_fee_applied_at timestamptz;

CREATE TABLE IF NOT EXISTS public.repatriation_transfer_invoice_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  repatriation_id uuid NOT NULL REFERENCES public.repatriations(id) ON DELETE CASCADE,
  invoice_id uuid NOT NULL REFERENCES public.invoices(id) ON DELETE CASCADE,
  amount numeric NOT NULL,
  currency text NOT NULL DEFAULT 'USD',
  repatriation_number text,
  container_number text,
  rate_card_id uuid,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (repatriation_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.repatriation_transfer_invoice_lines TO authenticated;
GRANT ALL ON public.repatriation_transfer_invoice_lines TO service_role;

ALTER TABLE public.repatriation_transfer_invoice_lines ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org members read transfer lines"
  ON public.repatriation_transfer_invoice_lines FOR SELECT TO authenticated
  USING (organization_id = public.current_org_id() OR public.is_platform_admin());

CREATE POLICY "admins manage transfer lines"
  ON public.repatriation_transfer_invoice_lines FOR ALL TO authenticated
  USING (organization_id = public.current_org_id() AND (public.is_platform_admin() OR public.has_role(auth.uid(),'admin'::app_role) OR public.has_role(auth.uid(),'yard_operator'::app_role)))
  WITH CHECK (organization_id = public.current_org_id() AND (public.is_platform_admin() OR public.has_role(auth.uid(),'admin'::app_role) OR public.has_role(auth.uid(),'yard_operator'::app_role)));

CREATE TRIGGER trg_repat_transfer_lines_updated_at
  BEFORE UPDATE ON public.repatriation_transfer_invoice_lines
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Resolve the applicable transfer fee for a repatriation (effective-dated rate card)
CREATE OR REPLACE FUNCTION public.lookup_repat_transfer_fee(_origin text, _destination text, _container_size text, _as_of date DEFAULT current_date)
RETURNS TABLE(rate_card_id uuid, transfer_fee numeric, currency text)
LANGUAGE sql STABLE SET search_path TO 'public'
AS $$
  SELECT rc.id, rc.transfer_fee, rc.currency
  FROM public.repat_rate_cards rc
  WHERE rc.organization_id = public.current_org_id()
    AND rc.is_active
    AND rc.transfer_fee > 0
    AND (rc.origin IS NULL OR upper(btrim(rc.origin)) = upper(btrim(coalesce(_origin,''))))
    AND (rc.destination IS NULL OR upper(btrim(rc.destination)) = upper(btrim(coalesce(_destination,''))))
    AND (rc.container_size IS NULL OR _container_size IS NULL OR rc.container_size = _container_size)
    AND rc.effective_from <= _as_of
    AND (rc.effective_to IS NULL OR rc.effective_to >= _as_of)
  ORDER BY rc.effective_from DESC
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.lookup_repat_transfer_fee(text,text,text,date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.lookup_repat_transfer_fee(text,text,text,date) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.preview_repatriation_transfer_invoice(_repatriation_ids uuid[] DEFAULT NULL::uuid[], _customer_name text DEFAULT 'JJ MES DMCC'::text, _amount numeric DEFAULT NULL)
RETURNS TABLE(repatriation_id uuid, repatriation_number text, container_number text, status text, eligible boolean, exclusion_reason text, amount numeric, currency text)
LANGUAGE sql STABLE SET search_path TO 'public'
AS $$
  SELECT r.id, r.repatriation_number, c.container_number, r.status::text,
    (r.status <> 'cancelled' AND t.id IS NULL
      AND (upper(btrim(coalesce(r.shipping_line,''))) IN (upper(btrim(_customer_name)),'JJ MES')
           OR upper(btrim(coalesce(c.owner,''))) = upper(btrim(_customer_name)))) AS eligible,
    CASE
      WHEN r.status = 'cancelled' THEN 'Cancelled repatriation'
      WHEN t.id IS NOT NULL THEN 'Already billed on '||i.invoice_number
      WHEN NOT (upper(btrim(coalesce(r.shipping_line,''))) IN (upper(btrim(_customer_name)),'JJ MES')
                OR upper(btrim(coalesce(c.owner,''))) = upper(btrim(_customer_name))) THEN 'Different owner'
      ELSE NULL END,
    coalesce(_amount, r.transfer_fee_applied,
      (SELECT f.transfer_fee FROM public.lookup_repat_transfer_fee('Mombasa','Nairobi', c.size::text, current_date) f), 320)::numeric,
    'USD'::text
  FROM public.repatriations r
  JOIN public.containers c ON c.id = r.container_id
  LEFT JOIN public.repatriation_transfer_invoice_lines t ON t.repatriation_id = r.id
  LEFT JOIN public.invoices i ON i.id = t.invoice_id
  WHERE r.organization_id = public.current_org_id()
    AND (_repatriation_ids IS NULL OR r.id = ANY(_repatriation_ids))
  ORDER BY r.repatriation_number;
$$;

REVOKE ALL ON FUNCTION public.preview_repatriation_transfer_invoice(uuid[],text,numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.preview_repatriation_transfer_invoice(uuid[],text,numeric) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.generate_repatriation_transfer_invoice(_repatriation_ids uuid[] DEFAULT NULL::uuid[], _customer_name text DEFAULT 'JJ MES DMCC'::text, _amount numeric DEFAULT NULL, _currency text DEFAULT 'USD'::text)
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

  CREATE TEMP TABLE _eligible_transfers ON COMMIT DROP AS
  SELECT r.id AS repatriation_id, r.repatriation_number, c.container_number,
    coalesce(_amount, r.transfer_fee_applied,
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

  INSERT INTO public.invoice_containers(invoice_id, container_id)
  SELECT DISTINCT _invoice_id, r.container_id
  FROM _eligible_transfers e JOIN public.repatriations r ON r.id = e.repatriation_id
  ON CONFLICT DO NOTHING;

  INSERT INTO public.repatriation_transfer_invoice_lines(organization_id,repatriation_id,invoice_id,amount,currency,repatriation_number,container_number,rate_card_id,created_by)
  SELECT _org, e.repatriation_id, _invoice_id, e.amount, 'USD', e.repatriation_number, e.container_number, e.rate_card_id, auth.uid()
  FROM _eligible_transfers e;

  UPDATE public.repatriations r
  SET transfer_invoice_id = _invoice_id,
      transfer_fee_applied = e.amount,
      transfer_fee_currency = 'USD',
      transfer_fee_applied_at = now(),
      updated_at = now()
  FROM _eligible_transfers e
  WHERE r.id = e.repatriation_id;

  PERFORM public.log_org_event(_org,'repatriation_transfer_invoiced',jsonb_build_object('invoice_id',_invoice_id,'invoice_number',_invoice_number,'customer',btrim(_customer_name),'line_count',_count,'amount',_total,'currency','USD'));
  RETURN QUERY SELECT _invoice_id,_invoice_number,_count,_total;
END $$;

REVOKE ALL ON FUNCTION public.generate_repatriation_transfer_invoice(uuid[],text,numeric,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.generate_repatriation_transfer_invoice(uuid[],text,numeric,text) TO authenticated, service_role;

-- handling invoices should also carry their container links
CREATE OR REPLACE FUNCTION public.generate_repatriation_handling_invoice(_repatriation_ids uuid[] DEFAULT NULL::uuid[], _customer_name text DEFAULT 'JJ MES DMCC'::text, _amount numeric DEFAULT 30, _currency text DEFAULT 'USD'::text)
RETURNS TABLE(invoice_id uuid, invoice_number text, line_count integer, total_amount numeric)
LANGUAGE plpgsql SET search_path TO 'public'
AS $function$
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
  IF _org IS NULL OR _amount <= 0 OR upper(btrim(_currency)) <> 'USD' THEN
    RAISE EXCEPTION 'handling_invoice_requires_positive_usd_amount';
  END IF;

  CREATE TEMP TABLE _eligible_repats ON COMMIT DROP AS
  SELECT r.id repatriation_id,r.repatriation_number,c.container_number
  FROM public.repatriations r
  JOIN public.containers c ON c.id=r.container_id
  WHERE r.organization_id=_org
    AND r.status <> 'cancelled'
    AND (_repatriation_ids IS NULL OR r.id=ANY(_repatriation_ids))
    AND (upper(btrim(coalesce(r.shipping_line,''))) IN (upper(btrim(_customer_name)),'JJ MES') OR upper(btrim(coalesce(c.owner,'')))=upper(btrim(_customer_name)))
    AND NOT EXISTS (SELECT 1 FROM public.repatriation_handling_invoice_lines h WHERE h.repatriation_id=r.id);

  SELECT count(*)::int,count(*)*_amount INTO _count,_total FROM _eligible_repats;
  IF _count=0 THEN RAISE EXCEPTION 'no_unbilled_repatriation_handling'; END IF;

  _customer_id := public.find_or_create_customer_by_name(_org,btrim(_customer_name));
  _invoice_number := 'RPH-'||to_char(current_date,'YYYYMMDD')||'-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,6));
  INSERT INTO public.invoices(invoice_number,customer_name,customer_reference,invoice_type,subtotal,tax_rate,tax_amount,total_amount,currency,status,created_by,organization_id,customer_id,notes,due_at)
  VALUES(_invoice_number,btrim(_customer_name),'Repatriation handling','handling',_total,0,0,_total,'USD','draft',auth.uid(),_org,_customer_id,'Bundled USD 30 handling fees; transport billed separately',now()+interval '30 days')
  RETURNING id INTO _invoice_id;

  INSERT INTO public.invoice_line_items(invoice_id,description,quantity,unit_price,total_price,charge_type,organization_id)
  SELECT _invoice_id, e.container_number||' — '||e.repatriation_number||' — handling',1,_amount,_amount,'handling',_org
  FROM _eligible_repats e ORDER BY e.container_number;

  INSERT INTO public.invoice_containers(invoice_id, container_id)
  SELECT DISTINCT _invoice_id, r.container_id
  FROM _eligible_repats e JOIN public.repatriations r ON r.id = e.repatriation_id
  ON CONFLICT DO NOTHING;

  INSERT INTO public.repatriation_handling_invoice_lines(organization_id,repatriation_id,invoice_id,amount,currency,repatriation_number,container_number,created_by)
  SELECT _org,e.repatriation_id,_invoice_id,_amount,'USD',e.repatriation_number,e.container_number,auth.uid() FROM _eligible_repats e;

  UPDATE public.repatriations r SET handling_invoice_id=_invoice_id,handling_amount=_amount,updated_at=now()
  WHERE r.id IN (SELECT e.repatriation_id FROM _eligible_repats e);

  PERFORM public.log_org_event(_org,'repatriation_handling_invoiced',jsonb_build_object('invoice_id',_invoice_id,'invoice_number',_invoice_number,'customer',btrim(_customer_name),'line_count',_count,'amount',_total,'currency','USD'));
  RETURN QUERY SELECT _invoice_id,_invoice_number,_count,_total;
END $function$;
