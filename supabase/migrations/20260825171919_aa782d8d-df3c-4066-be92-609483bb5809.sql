CREATE TABLE public.repatriation_handling_invoice_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL DEFAULT public.current_org_id(),
  repatriation_id uuid NOT NULL REFERENCES public.repatriations(id) ON DELETE RESTRICT,
  invoice_id uuid NOT NULL REFERENCES public.invoices(id) ON DELETE RESTRICT,
  amount numeric NOT NULL DEFAULT 30 CHECK (amount > 0),
  currency text NOT NULL DEFAULT 'USD',
  repatriation_number text NOT NULL,
  container_number text NOT NULL,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (repatriation_id)
);
GRANT SELECT ON public.repatriation_handling_invoice_lines TO authenticated;
GRANT ALL ON public.repatriation_handling_invoice_lines TO service_role;
ALTER TABLE public.repatriation_handling_invoice_lines ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Org members can view repatriation handling links"
ON public.repatriation_handling_invoice_lines FOR SELECT TO authenticated
USING (organization_id = public.current_org_id() OR public.is_platform_admin());
CREATE INDEX repatriation_handling_invoice_lines_invoice_idx ON public.repatriation_handling_invoice_lines(invoice_id);

ALTER TABLE public.repatriations ADD COLUMN handling_invoice_id uuid REFERENCES public.invoices(id) ON DELETE SET NULL;
CREATE INDEX repatriations_handling_invoice_idx ON public.repatriations(handling_invoice_id);

CREATE OR REPLACE FUNCTION public.generate_repatriation_handling_invoice(
  _repatriation_ids uuid[] DEFAULT NULL,
  _customer_name text DEFAULT 'JJ MES DMCC',
  _amount numeric DEFAULT 30,
  _currency text DEFAULT 'USD'
) RETURNS TABLE(invoice_id uuid, invoice_number text, line_count integer, total_amount numeric)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
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
  SELECT _invoice_id,'Repatriation handling — '||e.repatriation_number||' — Container '||e.container_number,1,_amount,_amount,'handling',_org
  FROM _eligible_repats e ORDER BY e.repatriation_number;

  INSERT INTO public.repatriation_handling_invoice_lines(organization_id,repatriation_id,invoice_id,amount,currency,repatriation_number,container_number,created_by)
  SELECT _org,e.repatriation_id,_invoice_id,_amount,'USD',e.repatriation_number,e.container_number,auth.uid() FROM _eligible_repats e;

  UPDATE public.repatriations r SET handling_invoice_id=_invoice_id,handling_amount=_amount,updated_at=now()
  WHERE r.id IN (SELECT e.repatriation_id FROM _eligible_repats e);

  PERFORM public.log_org_event(_org,'repatriation_handling_invoiced',jsonb_build_object('invoice_id',_invoice_id,'invoice_number',_invoice_number,'customer',btrim(_customer_name),'line_count',_count,'amount',_total,'currency','USD'));
  RETURN QUERY SELECT _invoice_id,_invoice_number,_count,_total;
END $$;
REVOKE ALL ON FUNCTION public.generate_repatriation_handling_invoice(uuid[],text,numeric,text) FROM public,anon;
GRANT EXECUTE ON FUNCTION public.generate_repatriation_handling_invoice(uuid[],text,numeric,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.preview_repatriation_handling_invoice(
  _repatriation_ids uuid[] DEFAULT NULL,
  _customer_name text DEFAULT 'JJ MES DMCC'
) RETURNS TABLE(repatriation_id uuid,repatriation_number text,container_number text,status text,eligible boolean,exclusion_reason text,amount numeric,currency text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
SELECT r.id,r.repatriation_number,c.container_number,r.status::text,
  (r.status<>'cancelled' AND h.id IS NULL AND (upper(btrim(coalesce(r.shipping_line,''))) IN (upper(btrim(_customer_name)),'JJ MES') OR upper(btrim(coalesce(c.owner,'')))=upper(btrim(_customer_name)))) eligible,
  CASE WHEN r.status='cancelled' THEN 'Cancelled repatriation' WHEN h.id IS NOT NULL THEN 'Already billed on '||i.invoice_number WHEN NOT (upper(btrim(coalesce(r.shipping_line,''))) IN (upper(btrim(_customer_name)),'JJ MES') OR upper(btrim(coalesce(c.owner,'')))=upper(btrim(_customer_name))) THEN 'Different owner' ELSE NULL END,
  30::numeric,'USD'::text
FROM public.repatriations r JOIN public.containers c ON c.id=r.container_id
LEFT JOIN public.repatriation_handling_invoice_lines h ON h.repatriation_id=r.id
LEFT JOIN public.invoices i ON i.id=h.invoice_id
WHERE r.organization_id=public.current_org_id() AND (_repatriation_ids IS NULL OR r.id=ANY(_repatriation_ids))
ORDER BY r.repatriation_number;
$$;
REVOKE ALL ON FUNCTION public.preview_repatriation_handling_invoice(uuid[],text) FROM public,anon;
GRANT EXECUTE ON FUNCTION public.preview_repatriation_handling_invoice(uuid[],text) TO authenticated;

CREATE OR REPLACE FUNCTION public.repatriation_handling_reconciliation()
RETURNS TABLE(repatriation_id uuid,repatriation_number text,container_number text,handling_invoice_number text,amount numeric,currency text,issue text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
SELECT r.id,r.repatriation_number,c.container_number,i.invoice_number,h.amount,h.currency,
 CASE WHEN h.id IS NULL THEN 'missing_handling_invoice'
      WHEN h.currency<>'USD' THEN 'non_usd_handling'
      WHEN h.amount<>30 THEN 'incorrect_handling_amount'
      WHEN (SELECT count(*) FROM public.invoice_line_items l WHERE l.invoice_id=h.invoice_id AND l.charge_type='handling' AND l.description LIKE '%'||r.repatriation_number||'%')<>1 THEN 'missing_or_duplicate_invoice_line'
      ELSE 'ok' END
FROM public.repatriations r JOIN public.containers c ON c.id=r.container_id
LEFT JOIN public.repatriation_handling_invoice_lines h ON h.repatriation_id=r.id
LEFT JOIN public.invoices i ON i.id=h.invoice_id
WHERE r.organization_id=public.current_org_id() AND r.status<>'cancelled';
$$;
REVOKE ALL ON FUNCTION public.repatriation_handling_reconciliation() FROM public,anon;
GRANT EXECUTE ON FUNCTION public.repatriation_handling_reconciliation() TO authenticated;

CREATE OR REPLACE FUNCTION public.preview_repatriation_bill(_repatriation_id uuid)
RETURNS TABLE(gate_in numeric,storage numeric,storage_days integer,handling numeric,repat_fee numeric,currency text,owner text,already_invoiced boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE _rep record; _c record; _org uuid; _owner text; _currency text; _existing uuid;
BEGIN
 SELECT * INTO _rep FROM public.repatriations WHERE id=_repatriation_id; IF NOT FOUND THEN RETURN; END IF;
 _org:=_rep.organization_id; SELECT * INTO _c FROM public.containers WHERE id=_rep.container_id; IF NOT FOUND THEN RETURN; END IF;
 _owner:=btrim(coalesce(_c.owner,'')); _currency:=coalesce(nullif(btrim(_rep.currency),''),'USD');
 SELECT id INTO _existing FROM public.invoices WHERE organization_id=_org AND invoice_number='REP-'||_rep.repatriation_number LIMIT 1;
 RETURN QUERY SELECT 0::numeric,0::numeric,0,0::numeric,coalesce(_rep.charge_amount,0)::numeric,_currency,_owner,(_existing IS NOT NULL);
END $$;

CREATE OR REPLACE FUNCTION public.bill_repatriation_to_owner(_repatriation_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE _rep record; _c record; _org uuid; _owner text; _customer_id uuid; _currency text; _invoice_id uuid; _existing uuid; _invoice_number text; _amount numeric;
BEGIN
 SELECT * INTO _rep FROM public.repatriations WHERE id=_repatriation_id; IF NOT FOUND THEN RAISE EXCEPTION 'repatriation_not_found'; END IF;
 IF NOT (public.is_platform_admin() OR public.has_role(auth.uid(),'admin'::app_role) OR public.has_role(auth.uid(),'yard_operator'::app_role) OR public.has_role(auth.uid(),'gate_clerk'::app_role)) THEN RAISE EXCEPTION 'forbidden_role'; END IF;
 _org:=_rep.organization_id; SELECT * INTO _c FROM public.containers WHERE id=_rep.container_id; IF NOT FOUND THEN RAISE EXCEPTION 'container_not_found'; END IF;
 _owner:=btrim(coalesce(_c.owner,'')); IF _owner='' THEN RAISE EXCEPTION 'repatriation_owner_missing'; END IF;
 _invoice_number:='REP-'||_rep.repatriation_number; SELECT id INTO _existing FROM public.invoices WHERE organization_id=_org AND invoice_number=_invoice_number LIMIT 1;
 IF _existing IS NOT NULL THEN UPDATE public.repatriations SET invoice_id=_existing WHERE id=_repatriation_id; RAISE EXCEPTION 'repatriation_already_invoiced'; END IF;
 _amount:=coalesce(_rep.charge_amount,0); IF _amount<=0 THEN RAISE EXCEPTION 'repatriation_nothing_to_bill'; END IF;
 _currency:=coalesce(nullif(btrim(_rep.currency),''),'USD'); _customer_id:=public.find_or_create_customer_by_name(_org,_owner);
 INSERT INTO public.invoices(invoice_number,customer_name,container_id,invoice_type,subtotal,tax_rate,tax_amount,total_amount,currency,status,created_by,organization_id,source_eir_id,customer_id,notes,due_at)
 VALUES(_invoice_number,_owner,_c.id,'other',_amount,0,0,_amount,_currency,'draft',auth.uid(),_org,_rep.eir_id,_customer_id,'Repatriation transport invoice for '||_rep.repatriation_number||'; handling billed separately',now()+interval '30 days') RETURNING id INTO _invoice_id;
 INSERT INTO public.invoice_line_items(invoice_id,description,quantity,unit_price,total_price,charge_type,organization_id)
 VALUES(_invoice_id,'Repatriation transport — '||_rep.repatriation_number||' — Container '||_c.container_number,1,_amount,_amount,'other',_org);
 UPDATE public.repatriations SET invoice_id=_invoice_id,rate_amount_applied=_amount,rate_applied_at=coalesce(rate_applied_at,now()),updated_at=now() WHERE id=_repatriation_id;
 PERFORM public.log_org_event(_org,'repatriation_billed',jsonb_build_object('repatriation_id',_repatriation_id,'invoice_id',_invoice_id,'amount',_amount,'currency',_currency,'handling_separate',true));
 RETURN _invoice_id;
END $$;
REVOKE ALL ON FUNCTION public.bill_repatriation_to_owner(uuid) FROM public,anon;
GRANT EXECUTE ON FUNCTION public.bill_repatriation_to_owner(uuid) TO authenticated;