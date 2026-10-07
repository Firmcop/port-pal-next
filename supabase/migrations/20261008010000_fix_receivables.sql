-- =====================================================================
-- Finance audit, step 2 follow-up: Receivables
--
--  1. The ledger follows the invoice: editing a sent invoice posts the
--     difference, cancelling it reverses it, and a posted invoice can't be
--     deleted (cancel it or issue a credit note). Cancelling an invoice that
--     has payments is blocked.
--  2. Payments: only admins, accountants and gate clerks record them, only
--     against their own company's invoices; legacy invoices are only adopted
--     by the company that raised them. Editing a payment posts the
--     difference, deleting one reverses it; reconciled payments are locked.
--     Foreign-currency receipts post at the day's rate with the exchange
--     difference to FX gain/loss. Zero or negative payments are rejected.
--  3. Accountants can see, raise and edit customer invoices.
--  4. Invoices are linked to the customer record automatically.
--  5. Invoice numbers are sequential per company and year (INV-2026-00001);
--     credit notes CN-2026-00001. Numbers are unique per company.
--  6. Credit notes: create_credit_note() issues a full or partial credit note
--     against a sent invoice; outstanding balances take credits into account.
--  7. Customer statement: opening balance, credit notes, by customer id or
--     name, only posted documents.
--  8. Daily receivables job: marks overdue invoices, issues recurring
--     invoices (fixed) and sends dunning reminders by email.
-- =====================================================================

-- ---------------------------------------------------------------- shared: post the difference

-- Bring the ledger lines of one source document to the desired state by posting
-- only the difference. _desired: [{category, account_type, amount (+debit/-credit),
-- currency, fx_rate, gl_account_id?, financial_account_id?}]
CREATE OR REPLACE FUNCTION public.ledger_sync_lines(
  _org uuid, _ref_type text, _ref_id uuid, _number text, _description text,
  _date timestamptz, _desired jsonb)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE r record; _n int := 0; _first boolean; _base text; _suffix text;
BEGIN
  SELECT NOT EXISTS (SELECT 1 FROM accounting_transactions WHERE reference_type = _ref_type AND reference_id = _ref_id)
    INTO _first;
  SELECT currency INTO _base FROM organizations WHERE id = _org;
  _suffix := CASE WHEN _first THEN '' ELSE '-ADJ' || to_char(clock_timestamp(), 'YYMMDDHH24MISSMS') END;

  FOR r IN
    WITH want AS (
      SELECT d->>'category' AS category, (d->>'account_type') AS account_type,
             NULLIF(d->>'financial_account_id', '')::uuid AS fa, upper(d->>'currency') AS cur,
             sum((d->>'amount')::numeric) AS amt, max(NULLIF(d->>'fx_rate', '')::numeric) AS fx,
             (array_agg(NULLIF(d->>'gl_account_id', '')::uuid))[1] AS gl
        FROM jsonb_array_elements(COALESCE(_desired, '[]'::jsonb)) d
       GROUP BY 1, 2, 3, 4
    ), have AS (
      SELECT category, account_type::text AS account_type, financial_account_id AS fa, upper(currency) AS cur,
             sum(debit_amount - credit_amount) AS amt, max(fx_rate) AS fx,
             (array_agg(gl_account_id) FILTER (WHERE gl_account_id IS NOT NULL))[1] AS gl
        FROM accounting_transactions
       WHERE reference_type = _ref_type AND reference_id = _ref_id
       GROUP BY 1, 2, 3, 4
    )
    SELECT COALESCE(w.category, h.category) AS category,
           COALESCE(w.account_type, h.account_type) AS account_type,
           COALESCE(w.fa, h.fa) AS fa, COALESCE(w.cur, h.cur) AS cur,
           round(COALESCE(w.amt, 0) - COALESCE(h.amt, 0), 2) AS delta,
           COALESCE(h.fx, w.fx) AS fx_existing, w.fx AS fx_new,
           COALESCE(w.gl, h.gl) AS gl, h.amt IS NULL AS is_new
      FROM want w
      FULL JOIN have h ON h.category = w.category AND h.account_type = w.account_type
                       AND h.fa IS NOT DISTINCT FROM w.fa AND h.cur IS NOT DISTINCT FROM w.cur
  LOOP
    CONTINUE WHEN abs(r.delta) < 0.005;
    _n := _n + 1;
    INSERT INTO accounting_transactions
      (transaction_number, transaction_date, account_type, category, description, debit_amount, credit_amount,
       reference_type, reference_id, organization_id, financial_account_id, gl_account_id, currency, fx_rate,
       base_currency, created_by)
    VALUES (_number || _suffix || '-' || _n, _date, r.account_type::account_type, r.category,
            _description || CASE WHEN _first THEN '' ELSE ' (adjustment)' END,
            greatest(r.delta, 0), greatest(-r.delta, 0), _ref_type, _ref_id, _org, r.fa, r.gl, r.cur,
            CASE WHEN r.is_new THEN r.fx_new ELSE r.fx_existing END, _base, auth.uid());
  END LOOP;
  RETURN _n;
END $$;

-- ---------------------------------------------------------------- 1. invoices ↔ ledger

CREATE OR REPLACE FUNCTION public.invoice_credited_amount(_invoice_id uuid)
RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT COALESCE(-sum(total_amount), 0) FROM invoices
   WHERE credit_of_invoice_id = _invoice_id AND status <> 'cancelled'
$$;

CREATE OR REPLACE FUNCTION public.sync_invoice_ledger(_invoice_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE _inv invoices%ROWTYPE; _net numeric; _tax numeric; _desired jsonb := '[]'; _rev_cat text;
        _base text; _fx numeric; _posted boolean; _date timestamptz;
BEGIN
  SELECT * INTO _inv FROM invoices WHERE id = _invoice_id;
  IF NOT FOUND THEN RETURN; END IF;
  SELECT currency INTO _base FROM organizations WHERE id = _inv.organization_id;
  _posted := EXISTS (SELECT 1 FROM accounting_transactions WHERE reference_type = 'invoice' AND reference_id = _invoice_id);

  -- 'credited' stays posted (the credit note carries the reversal); 'cancelled' is reversed.
  IF _inv.status IN ('sent', 'paid', 'overdue', 'credited') AND COALESCE(_inv.total_amount, 0) <> 0 THEN
    _net := COALESCE(_inv.subtotal, _inv.total_amount - COALESCE(_inv.tax_amount, 0));
    _tax := COALESCE(_inv.tax_amount, 0);
    _rev_cat := CASE _inv.invoice_type::text
                  WHEN 'gate_fee' THEN 'gate_fee' WHEN 'storage' THEN 'storage' WHEN 'lease' THEN 'lease'
                  WHEN 'repair' THEN 'repair' WHEN 'logistics' THEN 'logistics' ELSE 'other' END;
    _fx := public.get_fx_rate(_inv.organization_id, COALESCE(_inv.currency, _base), _base,
                              COALESCE(_inv.issued_at, now())::date);
    _desired := jsonb_build_array(
      jsonb_build_object('category', 'accounts_receivable', 'account_type', 'asset', 'amount', _inv.total_amount,
                         'currency', COALESCE(_inv.currency, _base), 'fx_rate', _fx),
      jsonb_build_object('category', _rev_cat, 'account_type', 'revenue', 'amount', -_net,
                         'currency', COALESCE(_inv.currency, _base), 'fx_rate', _fx));
    IF _tax <> 0 THEN
      _desired := _desired || jsonb_build_object('category', 'output_tax', 'account_type', 'liability', 'amount', -_tax,
                                                 'currency', COALESCE(_inv.currency, _base), 'fx_rate', _fx);
    END IF;
  END IF;

  -- First posting is dated on the invoice; later corrections and reversals today.
  _date := CASE WHEN _posted THEN now() ELSE COALESCE(_inv.issued_at, now()) END;
  PERFORM public.ledger_sync_lines(_inv.organization_id, 'invoice', _invoice_id,
    CASE WHEN _inv.total_amount < 0 THEN 'CN-' ELSE 'AR-' END || substring(_inv.invoice_number FROM 1 FOR 30) || '-' || substring(_invoice_id::text, 1, 8),
    CASE WHEN _inv.credit_of_invoice_id IS NOT NULL THEN 'Credit note ' ELSE 'Invoice ' END
      || _inv.invoice_number || COALESCE(' — ' || _inv.customer_name, ''),
    _date, _desired);
END $$;

-- Existing callers keep working.
CREATE OR REPLACE FUNCTION public.post_invoice_to_ledger(_invoice_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$ BEGIN PERFORM public.sync_invoice_ledger(_invoice_id); END $$;

CREATE OR REPLACE FUNCTION public.trg_invoice_autopost_ledger()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  IF TG_OP = 'INSERT' AND NEW.status = 'draft' THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND OLD.status = 'draft' AND NEW.status IN ('draft', 'cancelled') THEN RETURN NEW; END IF;
  PERFORM public.sync_invoice_ledger(NEW.id);
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_invoice_autopost_ledger ON public.invoices;
CREATE TRIGGER trg_invoice_autopost_ledger
  AFTER INSERT OR UPDATE OF status, total_amount, subtotal, tax_amount, invoice_type, voided_at, currency
  ON public.invoices FOR EACH ROW EXECUTE FUNCTION public.trg_invoice_autopost_ledger();

-- Guard edits and cancellation of posted invoices.
CREATE OR REPLACE FUNCTION public.trg_invoice_edit_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE _paid numeric;
BEGIN
  IF OLD.status = 'draft' THEN RETURN NEW; END IF;
  SELECT COALESCE(sum(amount), 0) INTO _paid FROM payments
   WHERE invoice_id = NEW.id AND COALESCE(approval_status::text, 'not_required') NOT IN ('pending', 'rejected');

  IF NEW.status = 'cancelled' AND OLD.status <> 'cancelled' AND _paid > 0 THEN
    RAISE EXCEPTION 'invoice_has_payments: % has % in payments; remove them or issue a credit note instead',
      OLD.invoice_number, _paid USING ERRCODE = '22023';
  END IF;
  IF OLD.status = 'cancelled' AND NEW.status <> 'cancelled' THEN
    RAISE EXCEPTION 'invoice_cancelled: a cancelled invoice cannot be reopened; raise a new invoice' USING ERRCODE = '22023';
  END IF;
  IF NEW.total_amount IS DISTINCT FROM OLD.total_amount AND OLD.credit_of_invoice_id IS NULL
     AND NEW.total_amount + 0.01 < _paid + public.invoice_credited_amount(NEW.id) THEN
    RAISE EXCEPTION 'invoice_below_settled: new total % is less than what is already paid/credited (%)',
      NEW.total_amount, _paid + public.invoice_credited_amount(NEW.id) USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_invoice_edit_guard ON public.invoices;
CREATE TRIGGER trg_invoice_edit_guard
  BEFORE UPDATE OF status, total_amount, subtotal, tax_amount ON public.invoices
  FOR EACH ROW EXECUTE FUNCTION public.trg_invoice_edit_guard();

CREATE OR REPLACE FUNCTION public.trg_invoice_delete_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  IF auth.uid() IS NULL THEN RETURN OLD; END IF;
  IF EXISTS (SELECT 1 FROM accounting_transactions WHERE reference_type = 'invoice' AND reference_id = OLD.id)
     OR EXISTS (SELECT 1 FROM payments WHERE invoice_id = OLD.id) THEN
    RAISE EXCEPTION 'invoice_posted: % has been issued; cancel it or issue a credit note instead of deleting it',
      OLD.invoice_number USING ERRCODE = '22023';
  END IF;
  RETURN OLD;
END $$;
DROP TRIGGER IF EXISTS trg_invoice_delete_guard ON public.invoices;
CREATE TRIGGER trg_invoice_delete_guard BEFORE DELETE ON public.invoices
  FOR EACH ROW EXECUTE FUNCTION public.trg_invoice_delete_guard();

-- ---------------------------------------------------------------- 2. payments ↔ ledger

ALTER TABLE public.payments DROP CONSTRAINT IF EXISTS payments_amount_positive;
ALTER TABLE public.payments ADD CONSTRAINT payments_amount_positive CHECK (amount > 0) NOT VALID;

CREATE OR REPLACE FUNCTION public.sync_payment_ledger(_payment_id uuid, _org uuid DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE _p payments%ROWTYPE; _inv invoices%ROWTYPE; _base text; _cur text; _fx_pay numeric; _fx_ar numeric;
        _desired jsonb := '[]'; _diff numeric; _posted boolean; _org_id uuid; _num text;
BEGIN
  SELECT * INTO _p FROM payments WHERE id = _payment_id;
  _org_id := COALESCE(_p.organization_id, _org);
  IF _org_id IS NULL THEN RETURN; END IF;
  SELECT currency INTO _base FROM organizations WHERE id = _org_id;
  _posted := EXISTS (SELECT 1 FROM accounting_transactions WHERE reference_type = 'payment' AND reference_id = _payment_id);

  IF _p.id IS NOT NULL AND COALESCE(_p.amount, 0) > 0
     AND COALESCE(_p.approval_status::text, 'not_required') NOT IN ('pending', 'rejected') THEN
    SELECT * INTO _inv FROM invoices WHERE id = _p.invoice_id;
    _cur := upper(COALESCE(_inv.currency, _p.currency, _base));
    _fx_pay := public.get_fx_rate(_org_id, _cur, _base, COALESCE(_p.paid_at, now())::date);
    -- receivable is cleared at the rate it was raised at
    SELECT max(fx_rate) INTO _fx_ar FROM accounting_transactions
     WHERE reference_type = 'invoice' AND reference_id = _p.invoice_id AND category = 'accounts_receivable';
    _fx_ar := COALESCE(_fx_ar, _fx_pay);
    _desired := jsonb_build_array(
      jsonb_build_object('category', 'cash', 'account_type', 'asset', 'amount', _p.amount, 'currency', _cur,
                         'fx_rate', _fx_pay, 'financial_account_id', _p.financial_account_id),
      jsonb_build_object('category', 'accounts_receivable', 'account_type', 'asset', 'amount', -_p.amount,
                         'currency', _cur, 'fx_rate', _fx_ar));
    IF _cur <> upper(_base) AND _fx_pay IS NOT NULL AND _fx_ar IS NOT NULL THEN
      _diff := round(_p.amount * (_fx_pay - _fx_ar), 2);
      IF _diff <> 0 THEN
        _desired := _desired || jsonb_build_object('category', 'fx_gain_loss', 'account_type', 'expense', 'amount', -_diff,
                                                   'currency', _base, 'fx_rate', 1);
      END IF;
    END IF;
  END IF;

  _num := 'RCPT-' || COALESCE(substring(_p.payment_number FROM 1 FOR 30), 'PAY') || '-' || substring(_payment_id::text, 1, 8);
  PERFORM public.ledger_sync_lines(_org_id, 'payment', _payment_id, _num,
    'Customer payment ' || COALESCE(_p.payment_number, '(deleted)'),
    CASE WHEN _posted OR _p.id IS NULL THEN now() ELSE COALESCE(_p.paid_at, now()) END, _desired);
END $$;

CREATE OR REPLACE FUNCTION public.post_payment_to_ledger(_payment_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$ BEGIN PERFORM public.sync_payment_ledger(_payment_id); END $$;

CREATE OR REPLACE FUNCTION public.trg_payment_autopost()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM public.sync_payment_ledger(OLD.id, OLD.organization_id);
    RETURN OLD;
  END IF;
  PERFORM public.sync_payment_ledger(NEW.id);
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_payment_autopost ON public.payments;
DROP TRIGGER IF EXISTS trg_payment_autopost_on_approval ON public.payments;
CREATE TRIGGER trg_payment_autopost
  AFTER INSERT OR DELETE OR UPDATE OF amount, financial_account_id, approval_status, invoice_id
  ON public.payments FOR EACH ROW EXECUTE FUNCTION public.trg_payment_autopost();

-- Reconciled receipts are locked.
CREATE OR REPLACE FUNCTION public.trg_payment_lock_reconciled()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  IF auth.uid() IS NULL THEN RETURN COALESCE(NEW, OLD); END IF;
  IF EXISTS (SELECT 1 FROM accounting_transactions
              WHERE reference_type = 'payment' AND reference_id = OLD.id AND cleared_at IS NOT NULL) THEN
    IF TG_OP = 'DELETE' OR NEW.amount IS DISTINCT FROM OLD.amount
       OR NEW.financial_account_id IS DISTINCT FROM OLD.financial_account_id THEN
      RAISE EXCEPTION 'payment_reconciled: % is cleared in a bank reconciliation; undo that first', OLD.payment_number
        USING ERRCODE = '22023';
    END IF;
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;
DROP TRIGGER IF EXISTS trg_payment_lock_reconciled ON public.payments;
CREATE TRIGGER trg_payment_lock_reconciled BEFORE UPDATE OR DELETE ON public.payments
  FOR EACH ROW EXECUTE FUNCTION public.trg_payment_lock_reconciled();

-- Outstanding = total − payments − credit notes.
CREATE OR REPLACE FUNCTION public.prevent_invoice_overpayment()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE _total numeric(14,2); _paid numeric(14,2); _credited numeric(14,2); _is_cn boolean;
BEGIN
  IF NEW.invoice_id IS NULL THEN RETURN NEW; END IF;
  SELECT total_amount, credit_of_invoice_id IS NOT NULL INTO _total, _is_cn FROM invoices WHERE id = NEW.invoice_id;
  IF _is_cn THEN RAISE EXCEPTION 'credit_note_not_payable: payments are recorded against the original invoice' USING ERRCODE = '22023'; END IF;
  IF _total IS NULL OR _total <= 0 THEN RETURN NEW; END IF;
  SELECT COALESCE(SUM(amount), 0) INTO _paid FROM payments
   WHERE invoice_id = NEW.invoice_id AND (TG_OP = 'INSERT' OR id <> NEW.id)
     AND COALESCE(approval_status::text, 'not_required') <> 'rejected';
  _credited := public.invoice_credited_amount(NEW.invoice_id);
  IF _total - _credited - (_paid + NEW.amount) < -0.01 THEN
    RAISE EXCEPTION 'overpayment_not_allowed: invoice total %, credited %, already paid %, attempted %',
      _total, _credited, _paid, NEW.amount USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.reconcile_invoice_status(_invoice_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE _paid numeric(14,2); _total numeric(14,2); _credited numeric(14,2);
BEGIN
  SELECT total_amount INTO _total FROM invoices WHERE id = _invoice_id AND credit_of_invoice_id IS NULL;
  IF _total IS NULL THEN RETURN; END IF;
  SELECT COALESCE(SUM(amount), 0) INTO _paid FROM payments
   WHERE invoice_id = _invoice_id AND COALESCE(approval_status::text, 'not_required') NOT IN ('pending', 'rejected');
  _credited := public.invoice_credited_amount(_invoice_id);

  IF _credited >= _total AND _total > 0 THEN
    UPDATE invoices SET status = 'credited', partially_paid = false, updated_at = now()
     WHERE id = _invoice_id AND status NOT IN ('cancelled', 'credited');
    UPDATE invoices SET status = 'credited', updated_at = now()
     WHERE credit_of_invoice_id = _invoice_id AND status IN ('sent', 'overdue', 'paid');
  ELSIF _paid + _credited >= _total AND _total > 0 THEN
    UPDATE invoices SET status = 'paid', paid_at = COALESCE(paid_at, now()), partially_paid = false, updated_at = now()
     WHERE id = _invoice_id AND status NOT IN ('cancelled', 'credited');
    -- partial credit notes are used up once the invoice is settled
    UPDATE invoices SET status = 'paid', paid_at = COALESCE(paid_at, now()), updated_at = now()
     WHERE credit_of_invoice_id = _invoice_id AND status IN ('sent', 'overdue');
  ELSE
    UPDATE invoices
       SET partially_paid = (_paid > 0),
           status = CASE WHEN status = 'paid' THEN 'sent'::invoice_status ELSE status END,
           paid_at = NULL, updated_at = now()
     WHERE id = _invoice_id AND status NOT IN ('cancelled', 'credited');
    UPDATE invoices SET status = 'sent', paid_at = NULL, updated_at = now()
     WHERE credit_of_invoice_id = _invoice_id AND status = 'paid';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.payments_reconcile_invoice()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.invoice_id IS DISTINCT FROM NEW.invoice_id AND OLD.invoice_id IS NOT NULL THEN
    PERFORM public.reconcile_invoice_status(OLD.invoice_id);
  END IF;
  IF COALESCE(NEW.invoice_id, OLD.invoice_id) IS NOT NULL THEN
    PERFORM public.reconcile_invoice_status(COALESCE(NEW.invoice_id, OLD.invoice_id));
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;

CREATE OR REPLACE FUNCTION public.trg_invoice_paid_integrity()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE _paid numeric(14,2);
BEGIN
  IF NEW.status = 'paid' AND NEW.credit_of_invoice_id IS NULL AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM NEW.status) THEN
    SELECT COALESCE(SUM(amount), 0) INTO _paid FROM payments WHERE invoice_id = NEW.id;
    IF _paid + public.invoice_credited_amount(NEW.id) + 0.01 < COALESCE(NEW.total_amount, 0) THEN
      RAISE EXCEPTION 'invoice_paid_integrity: cannot set status=paid on % (paid=%, total=%)',
        NEW.invoice_number, _paid, NEW.total_amount USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.record_customer_payment(_invoice_id uuid, _amount numeric, _account_id uuid, _method payment_method DEFAULT 'bank_transfer'::payment_method, _reference text DEFAULT NULL::text, _paid_at timestamp with time zone DEFAULT now(), _notes text DEFAULT NULL::text)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  _inv invoices%ROWTYPE;
  _pid uuid;
  _num text;
  _legacy uuid := '00000000-0000-0000-0000-000000000001';
  _org uuid := public.current_org_id();
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF NOT (public.is_platform_admin()
          OR has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'accountant') OR has_role(auth.uid(), 'gate_clerk')) THEN
    RAISE EXCEPTION 'not_authorized: only admins, accountants and gate clerks can record payments' USING ERRCODE = '42501';
  END IF;
  IF _amount IS NULL OR _amount <= 0 THEN RAISE EXCEPTION 'invalid_amount'; END IF;
  IF _account_id IS NULL THEN RAISE EXCEPTION 'financial_account_required'; END IF;
  SELECT * INTO _inv FROM invoices WHERE id = _invoice_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'invoice_not_found'; END IF;
  IF _inv.status IN ('cancelled','credited','draft') THEN RAISE EXCEPTION 'invoice_not_payable: invoice is %', _inv.status; END IF;
  IF _inv.credit_of_invoice_id IS NOT NULL THEN RAISE EXCEPTION 'credit_note_not_payable'; END IF;

  IF _inv.organization_id IS NULL OR _inv.organization_id = _legacy THEN
    -- A legacy invoice is adopted only by the company that raised it.
    IF NOT (EXISTS (SELECT 1 FROM user_roles ur WHERE ur.user_id = _inv.created_by AND ur.organization_id = _org)
            OR EXISTS (SELECT 1 FROM customers c WHERE c.id = _inv.customer_id AND c.organization_id = _org)) THEN
      RAISE EXCEPTION 'invoice_not_found' USING HINT = 'legacy invoice belongs to another company';
    END IF;
    UPDATE public.invoices SET organization_id = _org WHERE id = _invoice_id;
  ELSIF _inv.organization_id IS DISTINCT FROM _org AND NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'invoice_not_found';
  END IF;

  _num := 'PAY-'||to_char(now(),'YYYYMMDD')||'-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,6));
  INSERT INTO public.payments(
    payment_number, invoice_id, amount, payment_method, reference_number,
    paid_at, notes, recorded_by, organization_id, financial_account_id
  ) VALUES (_num,_invoice_id,_amount,_method,_reference,COALESCE(_paid_at,now()),_notes,auth.uid(),COALESCE(_org, _inv.organization_id),_account_id)
  RETURNING id INTO _pid;
  RETURN _pid;
END $function$;

-- ---------------------------------------------------------------- 3. accountant access

DROP POLICY IF EXISTS "Org staff view invoices" ON public.invoices;
CREATE POLICY "Org staff view invoices" ON public.invoices FOR SELECT
  USING (is_platform_admin() OR (organization_id = current_org_id() AND (
         has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'accountant') OR has_role(auth.uid(), 'yard_operator')
         OR has_role(auth.uid(), 'gate_clerk') OR has_role(auth.uid(), 'viewer'))));
DROP POLICY IF EXISTS "Org clerks insert invoices" ON public.invoices;
CREATE POLICY "Org clerks insert invoices" ON public.invoices FOR INSERT
  WITH CHECK (organization_id = current_org_id() AND (
              has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'accountant') OR has_role(auth.uid(), 'gate_clerk')));
DROP POLICY IF EXISTS "Org clerks update invoices" ON public.invoices;
CREATE POLICY "Org clerks update invoices" ON public.invoices FOR UPDATE
  USING (is_platform_admin() OR (organization_id = current_org_id() AND (
         has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'accountant') OR has_role(auth.uid(), 'gate_clerk'))));

DROP POLICY IF EXISTS "Org staff view payments" ON public.payments;
CREATE POLICY "Org staff view payments" ON public.payments FOR SELECT
  USING (is_platform_admin() OR (organization_id = current_org_id() AND (
         has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'accountant') OR has_role(auth.uid(), 'yard_operator')
         OR has_role(auth.uid(), 'gate_clerk') OR has_role(auth.uid(), 'viewer'))));
DROP POLICY IF EXISTS "Org clerks insert payments" ON public.payments;
CREATE POLICY "Org clerks insert payments" ON public.payments FOR INSERT
  WITH CHECK (organization_id = current_org_id() AND (
              has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'accountant') OR has_role(auth.uid(), 'gate_clerk')));
DROP POLICY IF EXISTS "Org clerks update payments" ON public.payments;
CREATE POLICY "Org clerks update payments" ON public.payments FOR UPDATE
  USING (is_platform_admin() OR (organization_id = current_org_id() AND (
         has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'accountant') OR has_role(auth.uid(), 'gate_clerk'))));
DROP POLICY IF EXISTS "Org admins delete payments" ON public.payments;
CREATE POLICY "Org admins delete payments" ON public.payments FOR DELETE
  USING (is_platform_admin() OR (organization_id = current_org_id() AND (
         has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'accountant'))));

-- ---------------------------------------------------------------- 4 + 5. customer link and numbering

CREATE TABLE IF NOT EXISTS public.invoice_number_sequences (
  organization_id uuid NOT NULL,
  series text NOT NULL,
  year int NOT NULL,
  last_value int NOT NULL DEFAULT 0,
  PRIMARY KEY (organization_id, series, year)
);
ALTER TABLE public.invoice_number_sequences ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS invoice_number_sequences_read ON public.invoice_number_sequences;
CREATE POLICY invoice_number_sequences_read ON public.invoice_number_sequences FOR SELECT
  USING (organization_id = current_org_id());

CREATE OR REPLACE FUNCTION public.next_invoice_number(_org uuid, _series text DEFAULT 'INV', _on date DEFAULT current_date)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE _y int := extract(year FROM COALESCE(_on, current_date))::int; _n int;
BEGIN
  INSERT INTO invoice_number_sequences(organization_id, series, year, last_value)
  VALUES (_org, _series, _y, 1)
  ON CONFLICT (organization_id, series, year) DO UPDATE SET last_value = invoice_number_sequences.last_value + 1
  RETURNING last_value INTO _n;
  RETURN _series || '-' || _y || '-' || lpad(_n::text, 5, '0');
END $$;

CREATE OR REPLACE FUNCTION public.trg_invoice_number_and_customer()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE _cid uuid; _n int;
BEGIN
  -- Numbers made up by the app (random / timestamp based) are replaced with the
  -- company's sequential number. System numbers like REP-… keep their scheme.
  IF NEW.organization_id IS NOT NULL AND (
       NEW.invoice_number IS NULL OR btrim(NEW.invoice_number) = ''
       OR NEW.invoice_number ~ '^INV-[0-9]{6}-[0-9]{1,4}$'
       OR NEW.invoice_number ~ '^INV-[0-9A-Z]{6,12}$'
       OR NEW.invoice_number ~ '^REC-[0-9]{6}-'
       OR NEW.invoice_number ~ '^CN-DRAFT'
       OR NEW.invoice_number ~ '^CN-[0-9]{8}-[0-9A-F]{6}$') THEN
    NEW.invoice_number := public.next_invoice_number(NEW.organization_id,
      CASE WHEN NEW.credit_of_invoice_id IS NOT NULL THEN 'CN' ELSE 'INV' END, current_date);
  END IF;

  IF NEW.customer_id IS NULL AND NULLIF(btrim(NEW.customer_name), '') IS NOT NULL THEN
    SELECT min(c.id::text)::uuid, count(*) INTO _cid, _n FROM customers c
     WHERE c.organization_id = NEW.organization_id
       AND lower(btrim(c.company_name)) = lower(btrim(NEW.customer_name));
    IF _n = 1 THEN NEW.customer_id := _cid; END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_invoice_number_and_customer ON public.invoices;
CREATE TRIGGER trg_invoice_number_and_customer BEFORE INSERT ON public.invoices
  FOR EACH ROW EXECUTE FUNCTION public.trg_invoice_number_and_customer();

-- Link existing invoices to customers where the name matches exactly one customer.
UPDATE public.invoices i SET customer_id = m.cid
  FROM (SELECT i2.id, min(c.id::text)::uuid AS cid
          FROM invoices i2
          JOIN customers c ON c.organization_id = i2.organization_id
                          AND lower(btrim(c.company_name)) = lower(btrim(i2.customer_name))
         WHERE i2.customer_id IS NULL
         GROUP BY i2.id HAVING count(*) = 1) m
 WHERE i.id = m.id;

-- Numbers are unique per company, not across all companies.
ALTER TABLE public.invoices DROP CONSTRAINT IF EXISTS invoices_invoice_number_key;
CREATE UNIQUE INDEX IF NOT EXISTS invoices_org_invoice_number_key ON public.invoices (organization_id, invoice_number);

-- ---------------------------------------------------------------- 6. credit notes

CREATE OR REPLACE FUNCTION public.create_credit_note(_invoice_id uuid, _amount numeric DEFAULT NULL, _reason text DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE _inv invoices%ROWTYPE; _paid numeric; _credited numeric; _open numeric; _amt numeric;
        _tax numeric; _sub numeric; _id uuid;
BEGIN
  SELECT * INTO _inv FROM invoices WHERE id = _invoice_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'invoice_not_found'; END IF;
  PERFORM public.assert_finance_writer_for(_inv.organization_id);
  IF _inv.credit_of_invoice_id IS NOT NULL THEN RAISE EXCEPTION 'A credit note cannot itself be credited'; END IF;
  IF _inv.status NOT IN ('sent', 'overdue', 'paid') THEN
    RAISE EXCEPTION 'Only issued invoices can be credited (this one is %)', _inv.status;
  END IF;
  SELECT COALESCE(sum(amount), 0) INTO _paid FROM payments
   WHERE invoice_id = _invoice_id AND COALESCE(approval_status::text, 'not_required') NOT IN ('pending', 'rejected');
  _credited := public.invoice_credited_amount(_invoice_id);
  _open := _inv.total_amount - _paid - _credited;
  _amt := round(COALESCE(_amount, _open), 2);
  IF _amt <= 0 THEN RAISE EXCEPTION 'Nothing left to credit: the invoice is fully paid or credited'; END IF;
  IF _amt > _open + 0.01 THEN
    RAISE EXCEPTION 'Credit % is more than the unpaid balance % — refund the payment first', _amt, _open;
  END IF;

  _tax := round(COALESCE(_inv.tax_amount, 0) * _amt / NULLIF(_inv.total_amount, 0), 2);
  _sub := _amt - _tax;

  INSERT INTO invoices(invoice_number, customer_name, customer_id, customer_reference, container_id, invoice_type,
                       subtotal, tax_rate, tax_amount, total_amount, currency, status, issued_at, due_at, notes,
                       created_by, organization_id, credit_of_invoice_id, project_id)
  VALUES ('CN-DRAFT', _inv.customer_name, _inv.customer_id, _inv.invoice_number, _inv.container_id, _inv.invoice_type,
          -_sub, _inv.tax_rate, -_tax, -_amt, _inv.currency, 'sent', now(), now(),
          COALESCE(NULLIF(_reason, ''), 'Credit note') || ' — against ' || _inv.invoice_number,
          auth.uid(), _inv.organization_id, _invoice_id, _inv.project_id)
  RETURNING id INTO _id;

  PERFORM public.reconcile_invoice_status(_invoice_id);
  RETURN _id;
END $$;
GRANT EXECUTE ON FUNCTION public.create_credit_note(uuid, numeric, text) TO authenticated;

-- ---------------------------------------------------------------- 7. customer statement

CREATE OR REPLACE FUNCTION public.customer_statement(_customer text, _from date, _to date)
RETURNS TABLE(doc_date date, doc_type text, doc_number text, description text, debit numeric, credit numeric, currency text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  WITH cust AS (
    SELECT c.id, c.company_name FROM customers c
     WHERE c.organization_id = current_org_id()
       AND (c.id::text = _customer OR lower(btrim(c.company_name)) = lower(btrim(_customer)))
  ), docs AS (
    SELECT COALESCE(i.issued_at, i.created_at)::date AS d,
           CASE WHEN i.credit_of_invoice_id IS NOT NULL THEN 'credit_note' ELSE 'invoice' END AS t,
           i.invoice_number AS n,
           CASE WHEN i.credit_of_invoice_id IS NOT NULL THEN 'Credit note against ' || COALESCE(i.customer_reference, '')
                ELSE i.invoice_type::text END AS descr,
           greatest(i.total_amount, 0) AS dr, greatest(-i.total_amount, 0) AS cr, i.currency AS cur
      FROM invoices i
     WHERE i.organization_id = current_org_id()
       AND i.status IN ('sent', 'paid', 'overdue', 'credited')
       AND (i.customer_id IN (SELECT id FROM cust)
            OR (i.customer_id IS NULL AND (lower(btrim(i.customer_name)) = lower(btrim(_customer))
                                           OR lower(btrim(i.customer_name)) IN (SELECT lower(btrim(company_name)) FROM cust))))
    UNION ALL
    SELECT p.paid_at::date, 'payment', p.payment_number, COALESCE(p.notes, 'Payment'), 0, p.amount, i.currency
      FROM payments p JOIN invoices i ON i.id = p.invoice_id
     WHERE p.organization_id = current_org_id()
       AND COALESCE(p.approval_status::text, 'not_required') NOT IN ('pending', 'rejected')
       AND i.status IN ('sent', 'paid', 'overdue', 'credited')
       AND (i.customer_id IN (SELECT id FROM cust)
            OR (i.customer_id IS NULL AND (lower(btrim(i.customer_name)) = lower(btrim(_customer))
                                           OR lower(btrim(i.customer_name)) IN (SELECT lower(btrim(company_name)) FROM cust))))
  )
  SELECT _from, 'opening', NULL::text, 'Balance brought forward',
         greatest(sum(dr - cr), 0), greatest(-sum(dr - cr), 0), cur
    FROM docs WHERE d < _from GROUP BY cur HAVING round(sum(dr - cr), 2) <> 0
  UNION ALL
  SELECT d, t, n, descr, dr, cr, cur FROM docs WHERE d BETWEEN _from AND _to
  ORDER BY 1, 2 DESC;
$function$;

-- ---------------------------------------------------------------- 8. daily receivables job

CREATE OR REPLACE FUNCTION public.mark_overdue_invoices()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE n int;
BEGIN
  UPDATE invoices SET status = 'overdue', updated_at = now()
   WHERE status = 'sent' AND credit_of_invoice_id IS NULL AND due_at IS NOT NULL AND due_at < now();
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;

-- Recurring invoices: line items used a column that doesn't exist (line_total).
CREATE OR REPLACE FUNCTION public.issue_recurring_invoices()
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  tpl record; new_inv_id uuid; next_dt date; count_issued int := 0; _tax numeric;
BEGIN
  FOR tpl IN
    SELECT * FROM recurring_invoice_templates
     WHERE status = 'active' AND next_run_date <= current_date
       AND (end_date IS NULL OR next_run_date <= end_date)
       AND (auth.uid() IS NULL OR organization_id = current_org_id())
  LOOP
    BEGIN
      _tax := round(tpl.subtotal * COALESCE(tpl.tax_rate, 0) / 100, 2);
      INSERT INTO invoices (
        invoice_number, customer_name, customer_reference, invoice_type,
        subtotal, tax_rate, tax_amount, total_amount, currency,
        status, issued_at, due_at, notes, organization_id, created_by
      ) VALUES (
        NULL, tpl.customer_name, tpl.customer_reference, tpl.invoice_type,
        tpl.subtotal, COALESCE(tpl.tax_rate, 0), _tax, tpl.subtotal + _tax,
        tpl.currency, 'sent', now(), now() + (COALESCE(tpl.due_days, 30) || ' days')::interval,
        tpl.notes, tpl.organization_id, tpl.created_by
      ) RETURNING id INTO new_inv_id;

      IF jsonb_typeof(tpl.line_items) = 'array' AND jsonb_array_length(tpl.line_items) > 0 THEN
        INSERT INTO invoice_line_items (invoice_id, description, quantity, unit_price, total_price, charge_type, organization_id)
        SELECT new_inv_id, COALESCE(li->>'description', tpl.name),
               COALESCE((li->>'quantity')::numeric, 1),
               COALESCE((li->>'unit_price')::numeric, 0),
               COALESCE((li->>'quantity')::numeric, 1) * COALESCE((li->>'unit_price')::numeric, 0),
               COALESCE(tpl.invoice_type, 'other'::charge_type),
               tpl.organization_id
          FROM jsonb_array_elements(tpl.line_items) li;
      ELSE
        INSERT INTO invoice_line_items (invoice_id, description, quantity, unit_price, total_price, charge_type, organization_id)
        VALUES (new_inv_id, tpl.name, 1, tpl.subtotal, tpl.subtotal,
                COALESCE(tpl.invoice_type, 'other'::charge_type),
                tpl.organization_id);
      END IF;

      next_dt := CASE tpl.frequency
        WHEN 'weekly'    THEN tpl.next_run_date + (tpl.interval_count * 7) * interval '1 day'
        WHEN 'biweekly'  THEN tpl.next_run_date + (tpl.interval_count * 14) * interval '1 day'
        WHEN 'monthly'   THEN tpl.next_run_date + (tpl.interval_count || ' months')::interval
        WHEN 'quarterly' THEN tpl.next_run_date + (tpl.interval_count * 3 || ' months')::interval
        WHEN 'yearly'    THEN tpl.next_run_date + (tpl.interval_count || ' years')::interval
        ELSE tpl.next_run_date + interval '1 month'
      END::date;

      UPDATE recurring_invoice_templates
         SET next_run_date = next_dt, last_run_at = now(),
             status = CASE WHEN end_date IS NOT NULL AND next_dt > end_date THEN 'ended' ELSE status END,
             updated_at = now()
       WHERE id = tpl.id;

      INSERT INTO recurring_invoice_runs (organization_id, template_id, invoice_id, run_date, status)
      VALUES (tpl.organization_id, tpl.id, new_inv_id, current_date, 'issued');
      count_issued := count_issued + 1;
    EXCEPTION WHEN OTHERS THEN
      INSERT INTO recurring_invoice_runs (organization_id, template_id, invoice_id, run_date, status, error)
      VALUES (tpl.organization_id, tpl.id, NULL, current_date, 'failed', SQLERRM);
    END;
  END LOOP;
  RETURN count_issued;
END;
$function$;

CREATE OR REPLACE FUNCTION public.run_dunning(_org uuid DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE r record; _msg text; _status text; _n int := 0; _token text; _html text;
BEGIN
  IF auth.uid() IS NOT NULL THEN
    _org := COALESCE(_org, public.current_org_id());
    PERFORM public.assert_finance_writer_for(_org);
  END IF;

  FOR r IN
    SELECT DISTINCT ON (i.id) i.id AS invoice_id, i.organization_id, i.invoice_number, i.customer_name, i.currency,
           i.total_amount, i.due_at, dr.id AS rule_id, dr.channel, dr.template, dr.name AS rule_name,
           (current_date - i.due_at::date) AS days_overdue,
           i.total_amount - COALESCE((SELECT sum(p.amount) FROM payments p WHERE p.invoice_id = i.id
                                       AND COALESCE(p.approval_status::text, 'not_required') NOT IN ('pending', 'rejected')), 0)
                          - public.invoice_credited_amount(i.id) AS amount_due,
           c.email, o.name AS org_name
      FROM invoices i
      JOIN dunning_rules dr ON dr.organization_id = i.organization_id AND dr.is_active
      LEFT JOIN customers c ON c.id = i.customer_id
      LEFT JOIN organizations o ON o.id = i.organization_id
     WHERE i.status IN ('sent', 'overdue') AND i.credit_of_invoice_id IS NULL AND i.due_at IS NOT NULL
       AND (_org IS NULL OR i.organization_id = _org)
       AND current_date >= i.due_at::date + dr.days_after_due
       AND NOT EXISTS (SELECT 1 FROM dunning_log l WHERE l.invoice_id = i.id AND l.rule_id = dr.id)
     ORDER BY i.id, dr.days_after_due DESC   -- only the most advanced rule that is due
  LOOP
    CONTINUE WHEN r.amount_due <= 0.009;
    -- skip earlier rules once a later one has been sent
    CONTINUE WHEN EXISTS (SELECT 1 FROM dunning_log l JOIN dunning_rules d2 ON d2.id = l.rule_id
                           WHERE l.invoice_id = r.invoice_id
                             AND d2.days_after_due >= (SELECT days_after_due FROM dunning_rules WHERE id = r.rule_id));
    _msg := replace(replace(replace(replace(replace(replace(COALESCE(r.template, 'Invoice {{invoice_number}} is overdue.'),
              '{{customer_name}}', COALESCE(r.customer_name, 'Customer')),
              '{{invoice_number}}', r.invoice_number),
              '{{currency}}', COALESCE(r.currency, '')),
              '{{total_amount}}', to_char(r.amount_due, 'FM999,999,999,990.00')),
              '{{amount_due}}', to_char(r.amount_due, 'FM999,999,999,990.00')),
              '{{days_overdue}}', r.days_overdue::text);
    _status := 'no_email';
    IF r.channel = 'email' AND NULLIF(btrim(r.email), '') IS NOT NULL THEN
      IF EXISTS (SELECT 1 FROM suppressed_emails s WHERE lower(s.email) = lower(r.email)) THEN
        _status := 'suppressed';
      ELSE
        SELECT token INTO _token FROM email_unsubscribe_tokens WHERE lower(email) = lower(r.email) LIMIT 1;
        IF _token IS NULL THEN
          _token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
          INSERT INTO email_unsubscribe_tokens(email, token) VALUES (lower(r.email), _token);
        END IF;
        _html := '<p>' || replace(_msg, E'\n', '<br>') || '</p><p>' || COALESCE(r.org_name, '') || '</p>';
        PERFORM public.enqueue_email('transactional_emails', jsonb_build_object(
          'message_id', gen_random_uuid(),
          'to', r.email,
          'from', COALESCE(r.org_name, 'Port Pal') || ' <noreply@notify.portal.firmcop.com>',
          'sender_domain', 'notify.portal.firmcop.com',
          'subject', r.rule_name || ': invoice ' || r.invoice_number,
          'html', _html, 'text', _msg,
          'purpose', 'transactional', 'label', 'dunning-reminder',
          'idempotency_key', 'dunning-' || r.invoice_id || '-' || r.rule_id,
          'unsubscribe_token', _token,
          'queued_at', now()));
        _status := 'queued';
      END IF;
    ELSIF r.channel <> 'email' THEN
      _status := 'pending_' || r.channel;
    END IF;
    INSERT INTO dunning_log(organization_id, invoice_id, rule_id, sent_at, channel, status, message, created_by)
    VALUES (r.organization_id, r.invoice_id, r.rule_id, now(), r.channel, _status, _msg, auth.uid());
    _n := _n + 1;
  END LOOP;
  RETURN _n;
END $$;
GRANT EXECUTE ON FUNCTION public.run_dunning(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.run_daily_receivables()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE _o int; _r int; _d int;
BEGIN
  _o := public.mark_overdue_invoices();
  _r := public.issue_recurring_invoices();
  _d := public.run_dunning(NULL);
  RETURN jsonb_build_object('overdue', _o, 'recurring_issued', _r, 'reminders', _d);
END $$;
REVOKE EXECUTE ON FUNCTION public.run_daily_receivables() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.mark_overdue_invoices() FROM anon;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
              WHERE n.nspname = 'cron' AND p.proname = 'schedule') THEN
    BEGIN
      PERFORM cron.unschedule('finance-daily-receivables');
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
    PERFORM cron.schedule('finance-daily-receivables', '15 3 * * *', 'SELECT public.run_daily_receivables()');
  END IF;
END $$;

-- ---------------------------------------------------------------- sub-assembly sales

-- sell_sub_assembly booked revenue a second time (the invoice already posts it)
-- and a one-sided COGS line. Post COGS against materials stock instead.
DO $$
DECLARE def text;
BEGIN
  SELECT pg_get_functiondef('public.sell_sub_assembly'::regproc) INTO def;
  IF position('sub_assembly_sale''' IN def) > 0 AND position('-REV''' IN def) > 0 THEN
    def := regexp_replace(def,
      'INSERT INTO accounting_transactions \(transaction_number, account_type, category, description, credit_amount, reference_type, reference_id, organization_id, created_by\)\s*VALUES \(_inv_num\|\|''-REV''[^;]*;',
      '-- revenue is posted by the invoice itself');
    def := regexp_replace(def,
      'INSERT INTO accounting_transactions \(transaction_number, account_type, category, description, debit_amount, reference_type, reference_id, organization_id, created_by\)\s*VALUES \(_inv_num\|\|''-COGS''[^;]*;',
      'INSERT INTO accounting_transactions (transaction_number, account_type, category, description, debit_amount, credit_amount, reference_type, reference_id, organization_id, created_by, gl_account_id)
      VALUES (_inv_num||''-COGS'', ''cost_of_goods''::account_type, ''cogs'', ''COGS: ''||_sku_name||'' x ''||_qty, _cogs, 0, ''sub_assembly_sale'', _invoice_id, _org, auth.uid(),
              public.ensure_gl_account(_org, ''5000'', ''Cost of Goods Sold'', ''cost_of_goods'', ''cogs'')),
             (_inv_num||''-STK'', ''asset''::account_type, ''inventory_materials'', ''Stock out: ''||_sku_name||'' x ''||_qty, 0, _cogs, ''sub_assembly_sale'', _invoice_id, _org, auth.uid(),
              public.ensure_gl_account(_org, ''1210'', ''Inventory - Materials'', ''asset'', ''inventory_materials''));');
    IF position('-REV''' IN def) > 0 OR position('-STK''' IN def) = 0 THEN
      RAISE EXCEPTION 'sell_sub_assembly patch did not apply';
    END IF;
    EXECUTE def;
  END IF;
  -- it also used an invoice status that doesn't exist ('issued'), so every sale failed
  SELECT pg_get_functiondef('public.sell_sub_assembly'::regproc) INTO def;
  IF position('''issued''::invoice_status' IN def) > 0 THEN
    def := replace(def, '''issued''::invoice_status', '''sent''::invoice_status');
    def := replace(def, '''other''::charge_type,', '''other'',');
    EXECUTE def;
  END IF;
END $$;
