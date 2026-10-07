
-- 1. Link invoices to source events + void/credit metadata
ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS source_movement_id uuid REFERENCES public.container_movements(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS source_eir_id uuid REFERENCES public.eir_records(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS voided_at timestamptz,
  ADD COLUMN IF NOT EXISTS voided_by uuid,
  ADD COLUMN IF NOT EXISTS void_reason text,
  ADD COLUMN IF NOT EXISTS credit_of_invoice_id uuid REFERENCES public.invoices(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_invoices_source_movement ON public.invoices(source_movement_id);
CREATE INDEX IF NOT EXISTS idx_invoices_source_eir ON public.invoices(source_eir_id);
CREATE INDEX IF NOT EXISTS idx_invoices_credit_of ON public.invoices(credit_of_invoice_id);

-- 2. Updated bill_gate_in capturing source movement / EIR
CREATE OR REPLACE FUNCTION public.bill_gate_in(
  _container_id uuid,
  _customer_name text,
  _amount numeric,
  _currency text DEFAULT 'EUR',
  _source_movement_id uuid DEFAULT NULL,
  _source_eir_id uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _org uuid;
  _container_number text;
  _invoice_id uuid;
  _invoice_number text;
BEGIN
  IF _amount IS NULL OR _amount <= 0 THEN RAISE EXCEPTION 'invalid_amount'; END IF;
  IF _customer_name IS NULL OR length(trim(_customer_name)) = 0 THEN RAISE EXCEPTION 'missing_customer'; END IF;

  SELECT organization_id, container_number INTO _org, _container_number
    FROM public.containers WHERE id = _container_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'container_not_found'; END IF;

  IF NOT (
    public.is_platform_admin()
    OR public.has_role(auth.uid(),'admin'::app_role)
    OR public.has_role(auth.uid(),'gate_clerk'::app_role)
    OR public.has_role(auth.uid(),'yard_operator'::app_role)
  ) THEN RAISE EXCEPTION 'forbidden_role'; END IF;

  _invoice_number := 'GIN-' || to_char(now(),'YYYYMMDD') || '-' || upper(substr(replace(gen_random_uuid()::text,'-',''),1,6));

  INSERT INTO public.invoices (
    invoice_number, customer_name, container_id, invoice_type,
    subtotal, tax_rate, tax_amount, total_amount, currency, status,
    created_by, organization_id, source_movement_id, source_eir_id
  ) VALUES (
    _invoice_number, _customer_name, _container_id, 'gate_fee',
    _amount, 0, 0, _amount, COALESCE(_currency,'EUR'), 'draft',
    auth.uid(), _org, _source_movement_id, _source_eir_id
  ) RETURNING id INTO _invoice_id;

  INSERT INTO public.invoice_line_items (
    invoice_id, description, quantity, unit_price, total_price, charge_type, organization_id
  ) VALUES (
    _invoice_id, 'Gate-in fee – ' || COALESCE(_container_number,_container_id::text),
    1, _amount, _amount, 'gate_fee', _org
  );

  PERFORM public.log_org_event(_org,'gate_in_billed',
    jsonb_build_object('invoice_id',_invoice_id,'invoice_number',_invoice_number,
      'container_id',_container_id,'container_number',_container_number,
      'customer_name',_customer_name,'amount',_amount,'currency',COALESCE(_currency,'EUR'),
      'source_movement_id',_source_movement_id,'source_eir_id',_source_eir_id));

  BEGIN PERFORM public.generate_gate_in_edi(_invoice_id);
  EXCEPTION WHEN OTHERS THEN NULL; END;

  RETURN _invoice_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.bill_gate_in(uuid, text, numeric, text, uuid, uuid) TO authenticated;

-- 3. Issue (draft -> sent)
CREATE OR REPLACE FUNCTION public.issue_gate_fee_invoice(_invoice_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _row record;
BEGIN
  IF NOT (has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'gate_clerk'::app_role)) THEN
    RAISE EXCEPTION 'forbidden_role';
  END IF;
  SELECT id, organization_id, status, invoice_number INTO _row FROM public.invoices WHERE id=_invoice_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'invoice_not_found'; END IF;
  IF _row.status <> 'draft' THEN RAISE EXCEPTION 'only_draft_can_be_issued'; END IF;
  UPDATE public.invoices SET status='sent', issued_at=COALESCE(issued_at, now()) WHERE id=_invoice_id;
  PERFORM public.log_org_event(_row.organization_id,'gate_fee_issued',
    jsonb_build_object('invoice_id',_row.id,'invoice_number',_row.invoice_number));
END; $$;

GRANT EXECUTE ON FUNCTION public.issue_gate_fee_invoice(uuid) TO authenticated;

-- 4. Record payment
CREATE OR REPLACE FUNCTION public.record_gate_fee_payment(
  _invoice_id uuid, _amount numeric, _method public.payment_method DEFAULT 'bank_transfer',
  _reference text DEFAULT NULL, _paid_at timestamptz DEFAULT now(), _notes text DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _row record; _paid_total numeric; _payment_id uuid; _pnum text;
BEGIN
  IF NOT (has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'gate_clerk'::app_role)) THEN
    RAISE EXCEPTION 'forbidden_role';
  END IF;
  IF _amount IS NULL OR _amount <= 0 THEN RAISE EXCEPTION 'invalid_amount'; END IF;
  SELECT id, organization_id, status, invoice_number, total_amount INTO _row
    FROM public.invoices WHERE id=_invoice_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'invoice_not_found'; END IF;
  IF _row.status IN ('cancelled','credited') THEN RAISE EXCEPTION 'invoice_voided'; END IF;

  _pnum := 'PAY-' || to_char(now(),'YYYYMMDD') || '-' || upper(substr(replace(gen_random_uuid()::text,'-',''),1,6));
  INSERT INTO public.payments (
    payment_number, invoice_id, amount, payment_method, reference_number,
    paid_at, notes, recorded_by, organization_id
  ) VALUES (_pnum, _invoice_id, _amount, _method, _reference, _paid_at, _notes, auth.uid(), _row.organization_id)
  RETURNING id INTO _payment_id;

  SELECT COALESCE(SUM(amount),0) INTO _paid_total FROM public.payments WHERE invoice_id=_invoice_id;

  IF _paid_total >= _row.total_amount THEN
    UPDATE public.invoices SET status='paid', paid_at=COALESCE(paid_at, _paid_at) WHERE id=_invoice_id;
  ELSIF _row.status='draft' THEN
    UPDATE public.invoices SET status='sent', issued_at=COALESCE(issued_at, now()) WHERE id=_invoice_id;
  END IF;

  PERFORM public.log_org_event(_row.organization_id,'gate_fee_payment_recorded',
    jsonb_build_object('invoice_id',_row.id,'invoice_number',_row.invoice_number,
      'payment_id',_payment_id,'amount',_amount,'method',_method::text,
      'reference',_reference,'paid_total',_paid_total,'invoice_total',_row.total_amount));

  RETURN _payment_id;
END; $$;

GRANT EXECUTE ON FUNCTION public.record_gate_fee_payment(uuid, numeric, public.payment_method, text, timestamptz, text) TO authenticated;

-- 5. Void / refund
CREATE OR REPLACE FUNCTION public.void_gate_fee_invoice(_invoice_id uuid, _reason text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _row record; _credit_id uuid; _credit_no text; _was_paid boolean;
BEGIN
  IF NOT (
    public.is_platform_admin() OR has_role(auth.uid(),'admin'::app_role)
    OR has_role(auth.uid(),'gate_clerk'::app_role) OR has_role(auth.uid(),'yard_operator'::app_role)
  ) THEN RAISE EXCEPTION 'forbidden_role'; END IF;

  SELECT * INTO _row FROM public.invoices WHERE id=_invoice_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'invoice_not_found'; END IF;
  IF _row.invoice_type <> 'gate_fee' THEN RAISE EXCEPTION 'not_a_gate_fee_invoice'; END IF;
  IF _row.status IN ('cancelled','credited') THEN RETURN NULL; END IF;

  _was_paid := (_row.status = 'paid');

  UPDATE public.invoices
    SET status = CASE WHEN _was_paid THEN 'credited'::invoice_status ELSE 'cancelled'::invoice_status END,
        voided_at = now(), voided_by = auth.uid(), void_reason = _reason
    WHERE id = _invoice_id;

  IF _was_paid THEN
    _credit_no := 'CN-' || to_char(now(),'YYYYMMDD') || '-' || upper(substr(replace(gen_random_uuid()::text,'-',''),1,6));
    INSERT INTO public.invoices (
      invoice_number, customer_name, container_id, invoice_type,
      subtotal, tax_rate, tax_amount, total_amount, currency, status,
      created_by, organization_id, credit_of_invoice_id, notes
    ) VALUES (
      _credit_no, _row.customer_name, _row.container_id, 'gate_fee',
      -_row.subtotal, _row.tax_rate, -_row.tax_amount, -_row.total_amount, _row.currency,
      'credited', auth.uid(), _row.organization_id, _row.id,
      'Credit note for ' || _row.invoice_number || COALESCE(' — ' || _reason,'')
    ) RETURNING id INTO _credit_id;

    INSERT INTO public.invoice_line_items (
      invoice_id, description, quantity, unit_price, total_price, charge_type, organization_id
    ) VALUES (
      _credit_id, 'Refund for ' || _row.invoice_number,
      1, -_row.subtotal, -_row.subtotal, 'gate_fee', _row.organization_id
    );

    PERFORM public.log_org_event(_row.organization_id,'gate_fee_refunded',
      jsonb_build_object('invoice_id',_row.id,'invoice_number',_row.invoice_number,
        'credit_invoice_id',_credit_id,'credit_invoice_number',_credit_no,
        'amount',_row.total_amount,'reason',_reason));
  ELSE
    PERFORM public.log_org_event(_row.organization_id,'gate_fee_voided',
      jsonb_build_object('invoice_id',_row.id,'invoice_number',_row.invoice_number,
        'reason',_reason));
  END IF;

  RETURN _credit_id;
END; $$;

GRANT EXECUTE ON FUNCTION public.void_gate_fee_invoice(uuid, text) TO authenticated;

-- 6. Triggers: auto-void on cancellation/edit of gate_in movement or EIR
CREATE OR REPLACE FUNCTION public.trg_movement_void_gate_fee()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _inv record; _reason text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    _reason := 'Source gate-in movement deleted';
    FOR _inv IN SELECT id FROM public.invoices
      WHERE source_movement_id = OLD.id AND status NOT IN ('cancelled','credited')
        AND invoice_type = 'gate_fee'
    LOOP PERFORM public.void_gate_fee_invoice(_inv.id, _reason); END LOOP;
    RETURN OLD;
  ELSIF TG_OP = 'UPDATE' THEN
    IF OLD.movement_type IS DISTINCT FROM NEW.movement_type
       OR OLD.container_id IS DISTINCT FROM NEW.container_id THEN
      _reason := 'Source gate-in movement edited (type/container changed)';
      FOR _inv IN SELECT id FROM public.invoices
        WHERE source_movement_id = NEW.id AND status NOT IN ('cancelled','credited')
          AND invoice_type = 'gate_fee'
      LOOP PERFORM public.void_gate_fee_invoice(_inv.id, _reason); END LOOP;
    END IF;
    RETURN NEW;
  END IF;
  RETURN NULL;
END; $$;

DROP TRIGGER IF EXISTS movement_void_gate_fee ON public.container_movements;
CREATE TRIGGER movement_void_gate_fee
  AFTER UPDATE OR DELETE ON public.container_movements
  FOR EACH ROW EXECUTE FUNCTION public.trg_movement_void_gate_fee();

CREATE OR REPLACE FUNCTION public.trg_eir_void_gate_fee()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _inv record; _reason text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    _reason := 'Source gate-in EIR deleted';
    FOR _inv IN SELECT id FROM public.invoices
      WHERE source_eir_id = OLD.id AND status NOT IN ('cancelled','credited')
        AND invoice_type = 'gate_fee'
    LOOP PERFORM public.void_gate_fee_invoice(_inv.id, _reason); END LOOP;
    RETURN OLD;
  ELSIF TG_OP = 'UPDATE' THEN
    IF OLD.eir_type IS DISTINCT FROM NEW.eir_type
       OR OLD.container_id IS DISTINCT FROM NEW.container_id THEN
      _reason := 'Source gate-in EIR edited (type/container changed)';
      FOR _inv IN SELECT id FROM public.invoices
        WHERE source_eir_id = NEW.id AND status NOT IN ('cancelled','credited')
          AND invoice_type = 'gate_fee'
      LOOP PERFORM public.void_gate_fee_invoice(_inv.id, _reason); END LOOP;
    END IF;
    RETURN NEW;
  END IF;
  RETURN NULL;
END; $$;

DROP TRIGGER IF EXISTS eir_void_gate_fee ON public.eir_records;
CREATE TRIGGER eir_void_gate_fee
  AFTER UPDATE OR DELETE ON public.eir_records
  FOR EACH ROW EXECUTE FUNCTION public.trg_eir_void_gate_fee();

-- 7. Reconciliation RPC
CREATE OR REPLACE FUNCTION public.gate_in_reconciliation(
  _depot_id uuid DEFAULT NULL,
  _from date DEFAULT NULL,
  _to date DEFAULT NULL,
  _owner text DEFAULT NULL
)
RETURNS TABLE(
  movement_id uuid,
  container_id uuid,
  container_number text,
  owner text,
  shipping_line text,
  gate_in_at timestamptz,
  expected_amount numeric,
  expected_currency text,
  invoice_id uuid,
  invoice_number text,
  invoice_status text,
  billed_amount numeric,
  paid_amount numeric,
  variance numeric,
  reconciliation_state text
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE _org uuid := public.current_org_id();
BEGIN
  IF _org IS NULL AND NOT public.is_platform_admin() THEN RAISE EXCEPTION 'no_org'; END IF;

  RETURN QUERY
  WITH movs AS (
    SELECT m.id AS movement_id, m.container_id, m.created_at AS gate_in_at,
           c.container_number, c.owner, c.shipping_line, c.depot_id, c.organization_id
    FROM public.container_movements m
    JOIN public.containers c ON c.id = m.container_id
    WHERE m.movement_type = 'gate_in'
      AND (_org IS NULL OR m.organization_id = _org)
      AND (_depot_id IS NULL OR c.depot_id = _depot_id)
      AND (_from IS NULL OR m.created_at >= _from::timestamptz)
      AND (_to IS NULL OR m.created_at < (_to + 1)::timestamptz)
      AND (_owner IS NULL OR c.owner ILIKE _owner OR c.shipping_line ILIKE _owner)
  ),
  fees AS (
    SELECT mv.movement_id,
      (SELECT amount FROM public.lookup_gate_in_fee(mv.container_id) LIMIT 1) AS expected_amount,
      (SELECT currency FROM public.lookup_gate_in_fee(mv.container_id) LIMIT 1) AS expected_currency
    FROM movs mv
  ),
  paid AS (
    SELECT i.id AS invoice_id, COALESCE(SUM(p.amount),0) AS paid_amount
    FROM public.invoices i LEFT JOIN public.payments p ON p.invoice_id = i.id
    WHERE i.invoice_type='gate_fee'
    GROUP BY i.id
  )
  SELECT
    mv.movement_id, mv.container_id, mv.container_number, mv.owner, mv.shipping_line, mv.gate_in_at,
    f.expected_amount, f.expected_currency,
    i.id, i.invoice_number, i.status::text,
    i.total_amount,
    COALESCE(p.paid_amount, 0),
    COALESCE(i.total_amount,0) - COALESCE(f.expected_amount,0),
    CASE
      WHEN i.id IS NULL THEN 'unbilled'
      WHEN i.status IN ('cancelled','credited') THEN 'voided'
      WHEN f.expected_amount IS NOT NULL AND ROUND(i.total_amount,2) <> ROUND(f.expected_amount,2) THEN 'amount_mismatch'
      ELSE 'matched'
    END AS reconciliation_state
  FROM movs mv
  LEFT JOIN fees f ON f.movement_id = mv.movement_id
  LEFT JOIN public.invoices i
    ON i.source_movement_id = mv.movement_id AND i.invoice_type='gate_fee'
   AND i.credit_of_invoice_id IS NULL
  LEFT JOIN paid p ON p.invoice_id = i.id

  UNION ALL

  -- Orphan invoices: gate_fee invoices with no matching gate_in movement in scope
  SELECT
    NULL::uuid, i.container_id, c.container_number, c.owner, c.shipping_line,
    i.created_at,
    NULL::numeric, i.currency,
    i.id, i.invoice_number, i.status::text,
    i.total_amount,
    COALESCE((SELECT SUM(amount) FROM public.payments WHERE invoice_id=i.id),0),
    NULL::numeric,
    'orphan_invoice' AS reconciliation_state
  FROM public.invoices i
  LEFT JOIN public.containers c ON c.id = i.container_id
  WHERE i.invoice_type='gate_fee'
    AND i.credit_of_invoice_id IS NULL
    AND (_org IS NULL OR i.organization_id = _org)
    AND (_depot_id IS NULL OR c.depot_id = _depot_id)
    AND (_from IS NULL OR i.created_at >= _from::timestamptz)
    AND (_to IS NULL OR i.created_at < (_to + 1)::timestamptz)
    AND (_owner IS NULL OR c.owner ILIKE _owner OR c.shipping_line ILIKE _owner OR i.customer_name ILIKE _owner)
    AND (i.source_movement_id IS NULL
      OR NOT EXISTS (SELECT 1 FROM public.container_movements m WHERE m.id = i.source_movement_id AND m.movement_type='gate_in'))
  ORDER BY gate_in_at DESC NULLS LAST;
END; $$;

GRANT EXECUTE ON FUNCTION public.gate_in_reconciliation(uuid, date, date, text) TO authenticated;
