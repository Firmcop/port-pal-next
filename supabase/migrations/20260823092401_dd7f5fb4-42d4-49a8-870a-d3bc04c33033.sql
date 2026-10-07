ALTER VIEW public.v_unallocated_vendor_payments SET (security_invoker = on);

CREATE TABLE IF NOT EXISTS public.contra_settlements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL DEFAULT current_org_id() REFERENCES public.organizations(id),
  settlement_number text NOT NULL,
  supplier_id uuid NOT NULL REFERENCES public.suppliers(id) ON DELETE RESTRICT,
  customer_id uuid REFERENCES public.customers(id) ON DELETE SET NULL,
  counterparty_name text NOT NULL,
  currency text NOT NULL,
  amount numeric NOT NULL CHECK (amount > 0),
  status text NOT NULL DEFAULT 'posted' CHECK (status IN ('posted','reversed')),
  settled_on date NOT NULL DEFAULT CURRENT_DATE,
  notes text,
  ar_payment_ids uuid[] NOT NULL DEFAULT '{}',
  ap_payment_id uuid,
  reversal_of uuid REFERENCES public.contra_settlements(id) ON DELETE SET NULL,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, settlement_number)
);

CREATE TABLE IF NOT EXISTS public.contra_settlement_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL DEFAULT current_org_id() REFERENCES public.organizations(id),
  settlement_id uuid NOT NULL REFERENCES public.contra_settlements(id) ON DELETE CASCADE,
  side text NOT NULL CHECK (side IN ('ar','ap')),
  invoice_id uuid REFERENCES public.invoices(id) ON DELETE SET NULL,
  supplier_invoice_id uuid REFERENCES public.supplier_invoices(id) ON DELETE SET NULL,
  document_number text,
  amount numeric NOT NULL CHECK (amount > 0),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_contra_settlements_org ON public.contra_settlements(organization_id);
CREATE INDEX IF NOT EXISTS idx_contra_settlements_supplier ON public.contra_settlements(supplier_id);
CREATE INDEX IF NOT EXISTS idx_contra_lines_settlement ON public.contra_settlement_lines(settlement_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.contra_settlements TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.contra_settlement_lines TO authenticated;
GRANT ALL ON public.contra_settlements TO service_role;
GRANT ALL ON public.contra_settlement_lines TO service_role;

ALTER TABLE public.contra_settlements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contra_settlement_lines ENABLE ROW LEVEL SECURITY;

CREATE POLICY "finance roles read contra settlements" ON public.contra_settlements
FOR SELECT TO authenticated
USING (organization_id = current_org_id() AND (
  has_role(auth.uid(),'admin') OR has_role(auth.uid(),'org_owner') OR has_role(auth.uid(),'accountant')));

CREATE POLICY "finance roles write contra settlements" ON public.contra_settlements
FOR ALL TO authenticated
USING (organization_id = current_org_id() AND (
  has_role(auth.uid(),'admin') OR has_role(auth.uid(),'org_owner') OR has_role(auth.uid(),'accountant')))
WITH CHECK (organization_id = current_org_id() AND (
  has_role(auth.uid(),'admin') OR has_role(auth.uid(),'org_owner') OR has_role(auth.uid(),'accountant')));

CREATE POLICY "finance roles read contra lines" ON public.contra_settlement_lines
FOR SELECT TO authenticated
USING (organization_id = current_org_id() AND (
  has_role(auth.uid(),'admin') OR has_role(auth.uid(),'org_owner') OR has_role(auth.uid(),'accountant')));

CREATE POLICY "finance roles write contra lines" ON public.contra_settlement_lines
FOR ALL TO authenticated
USING (organization_id = current_org_id() AND (
  has_role(auth.uid(),'admin') OR has_role(auth.uid(),'org_owner') OR has_role(auth.uid(),'accountant')))
WITH CHECK (organization_id = current_org_id() AND (
  has_role(auth.uid(),'admin') OR has_role(auth.uid(),'org_owner') OR has_role(auth.uid(),'accountant')));

-- Dedicated clearing account so both legs net to zero -------------------------
CREATE OR REPLACE FUNCTION public.ensure_contra_clearing_account(_org uuid, _currency text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE _id uuid;
BEGIN
  SELECT id INTO _id FROM public.financial_accounts
   WHERE organization_id = _org
     AND name = 'Contra Set-off Clearing'
     AND upper(COALESCE(currency,'')) = upper(COALESCE(_currency,''))
   LIMIT 1;
  IF _id IS NULL THEN
    INSERT INTO public.financial_accounts(organization_id, name, account_type, currency, is_active, notes)
    VALUES (_org, 'Contra Set-off Clearing', 'other', upper(_currency), true,
            'System account used to offset receivables against payables for a counterparty that is both customer and supplier (IAS 32.42).')
    RETURNING id INTO _id;
  END IF;
  RETURN _id;
END;
$$;

-- Counterparty net position ---------------------------------------------------
CREATE OR REPLACE FUNCTION public.preview_contra_settlement(_supplier_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  _org uuid := public.current_org_id();
  _sup record;
  _cust record;
  _ar jsonb := '[]'::jsonb;
  _ap jsonb := '[]'::jsonb;
  _totals jsonb := '[]'::jsonb;
  _r record;
BEGIN
  IF _org IS NULL THEN RAISE EXCEPTION 'No organization context'; END IF;
  SELECT * INTO _sup FROM public.suppliers WHERE id = _supplier_id AND organization_id = _org;
  IF NOT FOUND THEN RAISE EXCEPTION 'supplier_not_found'; END IF;

  SELECT * INTO _cust FROM public.customers
   WHERE organization_id = _org
     AND (id = _sup.linked_customer_id OR lower(btrim(name)) = lower(btrim(_sup.name)))
   ORDER BY (id = _sup.linked_customer_id) DESC LIMIT 1;

  IF _cust.id IS NULL THEN
    RETURN jsonb_build_object('supplier_id', _supplier_id, 'supplier_name', _sup.name,
                              'customer_id', NULL, 'linked', false,
                              'ar', _ar, 'ap', _ap, 'totals', _totals);
  END IF;

  FOR _r IN
    SELECT i.id, i.invoice_number, i.currency, i.issued_at, i.due_at, i.total_amount,
           COALESCE((SELECT sum(p.amount) FROM public.payments p WHERE p.invoice_id = i.id), 0) AS paid
      FROM public.invoices i
     WHERE i.organization_id = _org
       AND (i.customer_id = _cust.id OR lower(btrim(i.customer_name)) = lower(btrim(_cust.name)))
       AND i.status IN ('sent','overdue')
       AND i.voided_at IS NULL
     ORDER BY i.due_at NULLS LAST, i.created_at
  LOOP
    IF _r.total_amount - _r.paid > 0.01 THEN
      _ar := _ar || jsonb_build_object('invoice_id', _r.id, 'document_number', _r.invoice_number,
              'currency', upper(COALESCE(_r.currency,'')), 'due_at', _r.due_at,
              'total_amount', _r.total_amount, 'paid', _r.paid, 'outstanding', _r.total_amount - _r.paid);
    END IF;
  END LOOP;

  FOR _r IN
    SELECT si.id, si.invoice_number, si.currency, si.due_date, si.total_amount, COALESCE(si.paid_amount,0) AS paid
      FROM public.supplier_invoices si
     WHERE si.organization_id = _org AND si.supplier_id = _supplier_id
       AND COALESCE(si.status,'') <> 'cancelled'
       AND si.total_amount > COALESCE(si.paid_amount,0)
     ORDER BY si.due_date, si.created_at
  LOOP
    _ap := _ap || jsonb_build_object('supplier_invoice_id', _r.id, 'document_number', _r.invoice_number,
            'currency', upper(COALESCE(_r.currency,'')), 'due_at', _r.due_date,
            'total_amount', _r.total_amount, 'paid', _r.paid, 'outstanding', _r.total_amount - _r.paid);
  END LOOP;

  SELECT jsonb_agg(t) INTO _totals FROM (
    SELECT c AS currency,
           COALESCE((SELECT sum((x->>'outstanding')::numeric) FROM jsonb_array_elements(_ar) x WHERE x->>'currency' = c),0) AS ar_total,
           COALESCE((SELECT sum((x->>'outstanding')::numeric) FROM jsonb_array_elements(_ap) x WHERE x->>'currency' = c),0) AS ap_total,
           LEAST(
             COALESCE((SELECT sum((x->>'outstanding')::numeric) FROM jsonb_array_elements(_ar) x WHERE x->>'currency' = c),0),
             COALESCE((SELECT sum((x->>'outstanding')::numeric) FROM jsonb_array_elements(_ap) x WHERE x->>'currency' = c),0)
           ) AS offsettable
      FROM (SELECT DISTINCT x->>'currency' AS c FROM jsonb_array_elements(_ar || _ap) x) s
  ) t;

  RETURN jsonb_build_object('supplier_id', _supplier_id, 'supplier_name', _sup.name,
                            'customer_id', _cust.id, 'customer_name', _cust.name,
                            'linked', _sup.linked_customer_id IS NOT NULL,
                            'ar', _ar, 'ap', _ap, 'totals', COALESCE(_totals,'[]'::jsonb));
END;
$$;

-- Post the set-off ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.post_contra_settlement(
  _supplier_id uuid,
  _currency text,
  _amount numeric,
  _notes text DEFAULT NULL,
  _settled_on date DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  _org uuid := public.current_org_id();
  _preview jsonb;
  _cur text := upper(btrim(_currency));
  _on date := COALESCE(_settled_on, CURRENT_DATE);
  _acct uuid;
  _sid uuid;
  _num text;
  _left_ar numeric := _amount;
  _left_ap numeric := _amount;
  _take numeric;
  _row jsonb;
  _pay uuid;
  _ar_ids uuid[] := '{}';
  _ap_payment uuid;
  _customer uuid;
  _name text;
  _offsettable numeric;
BEGIN
  IF _org IS NULL THEN RAISE EXCEPTION 'No organization context'; END IF;
  IF NOT (has_role(auth.uid(),'admin') OR has_role(auth.uid(),'org_owner')
          OR has_role(auth.uid(),'accountant') OR is_platform_admin()) THEN
    RAISE EXCEPTION 'not_authorised';
  END IF;
  IF _amount IS NULL OR _amount <= 0 THEN RAISE EXCEPTION 'invalid_amount'; END IF;

  _preview := public.preview_contra_settlement(_supplier_id);
  _customer := NULLIF(_preview->>'customer_id','')::uuid;
  _name := _preview->>'supplier_name';
  IF _customer IS NULL THEN RAISE EXCEPTION 'counterparty_not_linked'; END IF;

  SELECT COALESCE((t->>'offsettable')::numeric,0) INTO _offsettable
    FROM jsonb_array_elements(_preview->'totals') t WHERE t->>'currency' = _cur;
  IF COALESCE(_offsettable,0) + 0.01 < _amount THEN
    RAISE EXCEPTION 'amount_exceeds_offsettable_balance';
  END IF;

  _acct := public.ensure_contra_clearing_account(_org, _cur);
  _num := 'CONTRA-'||to_char(now(),'YYYYMMDD')||'-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,5));

  INSERT INTO public.contra_settlements(organization_id, settlement_number, supplier_id, customer_id,
    counterparty_name, currency, amount, status, settled_on, notes, created_by)
  VALUES (_org, _num, _supplier_id, _customer, _name, _cur, _amount, 'posted', _on, _notes, auth.uid())
  RETURNING id INTO _sid;

  -- AR side: settle oldest sales invoices through the clearing account
  FOR _row IN SELECT x FROM jsonb_array_elements(_preview->'ar') x WHERE x->>'currency' = _cur
  LOOP
    EXIT WHEN _left_ar <= 0.005;
    _take := LEAST(_left_ar, (_row->>'outstanding')::numeric);
    IF _take > 0 THEN
      INSERT INTO public.payments(payment_number, invoice_id, amount, payment_method, reference_number,
        paid_at, notes, recorded_by, organization_id, financial_account_id, currency)
      VALUES ('PAY-'||_num||'-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,4)),
              (_row->>'invoice_id')::uuid, _take, 'other', _num, _on::timestamptz,
              'Contra set-off against supplier balance ('||_name||')', auth.uid(), _org, _acct, _cur)
      RETURNING id INTO _pay;
      _ar_ids := _ar_ids || _pay;
      INSERT INTO public.contra_settlement_lines(organization_id, settlement_id, side, invoice_id, document_number, amount)
      VALUES (_org, _sid, 'ar', (_row->>'invoice_id')::uuid, _row->>'document_number', _take);
      _left_ar := _left_ar - _take;
    END IF;
  END LOOP;

  -- AP side: one on-account payment through the same clearing account, split FIFO
  INSERT INTO public.vendor_payments(payment_number, po_id, supplier_id, amount, payment_method,
    reference_number, paid_at, notes, recorded_by, organization_id, financial_account_id, currency)
  VALUES ('VPAY-'||_num, NULL, _supplier_id, _amount, 'other', _num, _on::timestamptz,
          'Contra set-off against customer balance ('||_name||')', auth.uid(), _org, _acct, _cur)
  RETURNING id INTO _ap_payment;

  FOR _row IN SELECT x FROM jsonb_array_elements(_preview->'ap') x WHERE x->>'currency' = _cur
  LOOP
    EXIT WHEN _left_ap <= 0.005;
    _take := LEAST(_left_ap, (_row->>'outstanding')::numeric);
    IF _take > 0 THEN
      INSERT INTO public.contra_settlement_lines(organization_id, settlement_id, side, supplier_invoice_id, document_number, amount)
      VALUES (_org, _sid, 'ap', (_row->>'supplier_invoice_id')::uuid, _row->>'document_number', _take);
      _left_ap := _left_ap - _take;
    END IF;
  END LOOP;

  UPDATE public.contra_settlements
     SET ar_payment_ids = _ar_ids, ap_payment_id = _ap_payment
   WHERE id = _sid;

  INSERT INTO public.finance_audit_log(organization_id, actor_user_id, entity_type, entity_id, entity_ref, action, summary)
  VALUES (_org, auth.uid(), 'contra_settlement', _sid, _num, 'contra_settlement_posted',
          jsonb_build_object('supplier_id', _supplier_id, 'customer_id', _customer,
                             'currency', _cur, 'amount', _amount,
                             'standard', 'IAS 32.42 offsetting — legally enforceable right of set-off',
                             'notes', _notes));

  RETURN jsonb_build_object('settlement_id', _sid, 'settlement_number', _num,
                            'currency', _cur, 'amount', _amount,
                            'ar_payments', array_length(_ar_ids,1),
                            'ap_payment_id', _ap_payment);
END;
$$;

CREATE OR REPLACE FUNCTION public.reverse_contra_settlement(_settlement_id uuid, _reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  _org uuid := public.current_org_id();
  _s public.contra_settlements%ROWTYPE;
BEGIN
  IF NOT (has_role(auth.uid(),'admin') OR has_role(auth.uid(),'org_owner')
          OR has_role(auth.uid(),'accountant') OR is_platform_admin()) THEN
    RAISE EXCEPTION 'not_authorised';
  END IF;
  SELECT * INTO _s FROM public.contra_settlements WHERE id = _settlement_id AND organization_id = _org;
  IF NOT FOUND THEN RAISE EXCEPTION 'settlement_not_found'; END IF;
  IF _s.status = 'reversed' THEN RAISE EXCEPTION 'already_reversed'; END IF;
  IF COALESCE(btrim(_reason),'') = '' THEN RAISE EXCEPTION 'reason_required'; END IF;

  DELETE FROM public.payments WHERE id = ANY(_s.ar_payment_ids);
  DELETE FROM public.vendor_payments WHERE id = _s.ap_payment_id;

  UPDATE public.contra_settlements SET status = 'reversed', notes = COALESCE(notes,'')||' | Reversed: '||_reason
   WHERE id = _settlement_id;

  INSERT INTO public.finance_audit_log(organization_id, actor_user_id, entity_type, entity_id, entity_ref, action, summary)
  VALUES (_org, auth.uid(), 'contra_settlement', _settlement_id, _s.settlement_number, 'contra_settlement_reversed',
          jsonb_build_object('reason', _reason, 'amount', _s.amount, 'currency', _s.currency));

  RETURN jsonb_build_object('settlement_id', _settlement_id, 'status', 'reversed');
END;
$$;

REVOKE ALL ON FUNCTION public.ensure_contra_clearing_account(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.preview_contra_settlement(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.post_contra_settlement(uuid, text, numeric, text, date) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.reverse_contra_settlement(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.preview_contra_settlement(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.post_contra_settlement(uuid, text, numeric, text, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reverse_contra_settlement(uuid, text) TO authenticated;