-- =====================================================================
-- Tax fixes (finance audit, step 5)
--
--  1. VAT return is computed from the ledger (output VAT credited to 2200,
--     input VAT debited to 2210 in the period), so it always agrees with the
--     books. The old version multiplied line amounts by the rate as a whole
--     number (×16, not ×16%), read purchase orders instead of bills, and
--     included cancelled invoices.
--  2. Company + role checks on computing and posting the return; a filed
--     return is locked.
--  3. Posting the return moves net VAT into 2220 "VAT Payable to KRA"
--     (reversing the previous settlement if the return is re-posted).
--  4. Withholding: WHT payable lands on 2230; the withheld amount must equal
--     rate × base; posted certificates are delete-and-re-enter; deleting
--     reverses; accountants may record certificates and returns.
--  5. eTIMS: sending an invoice queues it in etims_submissions (status
--     'pending') for the KRA connector to pick up.
-- Uses helpers from 20261007200000_fix_payables_posting.sql and
-- 20261007210000_fix_cash_bank.sql.
-- =====================================================================

-- Creates a GL account if the company doesn't have that code yet.
CREATE OR REPLACE FUNCTION public.ensure_gl_account(_org uuid, _code text, _name text, _type account_type, _system_code text)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE _id uuid;
BEGIN
  SELECT id INTO _id FROM gl_accounts WHERE organization_id = _org AND code = _code;
  IF _id IS NULL THEN
    INSERT INTO gl_accounts(organization_id, code, name, account_type, is_active, is_system, system_code)
    VALUES (_org, _code, _name, _type, true, true, _system_code)
    ON CONFLICT (organization_id, code) DO NOTHING
    RETURNING id INTO _id;
    IF _id IS NULL THEN SELECT id INTO _id FROM gl_accounts WHERE organization_id = _org AND code = _code; END IF;
  END IF;
  RETURN _id;
END $$;
REVOKE ALL ON FUNCTION public.ensure_gl_account(uuid, text, text, account_type, text) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------- write access

DO $$
DECLARE p record;
BEGIN
  FOR p IN SELECT pol.polname, c.relname FROM pg_policy pol JOIN pg_class c ON c.oid = pol.polrelid
            WHERE c.relname IN ('tax_returns', 'withholding_certificates') AND pol.polcmd = '*'
  LOOP
    EXECUTE format('DROP POLICY %I ON public.%I', p.polname, p.relname);
  END LOOP;
END $$;
CREATE POLICY "Finance staff manage tax returns" ON public.tax_returns FOR ALL
  USING (is_platform_admin() OR (organization_id = current_org_id() AND (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'accountant'))))
  WITH CHECK (organization_id = current_org_id() AND (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'accountant')));
CREATE POLICY "Finance staff manage withholding certificates" ON public.withholding_certificates FOR ALL
  USING (is_platform_admin() OR (organization_id = current_org_id() AND (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'accountant'))))
  WITH CHECK (organization_id = current_org_id() AND (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'accountant')));

-- ---------------------------------------------------------------- VAT return

CREATE OR REPLACE FUNCTION public.compute_tax_return(_period_id uuid, _jurisdiction text DEFAULT 'KE')
RETURNS TABLE(output_total numeric, input_total numeric, net_payable numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE p_start date; p_end date; org uuid;
BEGIN
  SELECT start_date, end_date, organization_id INTO p_start, p_end, org FROM fiscal_periods WHERE id = _period_id;
  IF p_start IS NULL OR (org IS DISTINCT FROM current_org_id() AND NOT is_platform_admin()) THEN
    RAISE EXCEPTION 'Period not found';
  END IF;
  RETURN QUERY
  WITH v AS (
    SELECT t.category,
           -- amounts in the company's base currency
           (t.credit_amount - t.debit_amount)
             * CASE WHEN t.base_currency IS NULL OR upper(t.currency) = upper(t.base_currency) THEN 1 ELSE COALESCE(t.fx_rate, 1) END AS cr
      FROM accounting_transactions t
     WHERE t.organization_id = org
       AND t.category IN ('output_tax', 'input_tax')
       AND t.reference_type NOT IN ('tax_return', 'tax_return_reversal')
       AND t.transaction_date::date BETWEEN p_start AND p_end
  )
  SELECT round(COALESCE(sum(cr) FILTER (WHERE category = 'output_tax'), 0), 2),
         round(COALESCE(-sum(cr) FILTER (WHERE category = 'input_tax'), 0), 2),
         round(COALESCE(sum(cr) FILTER (WHERE category = 'output_tax'), 0) + COALESCE(sum(cr) FILTER (WHERE category = 'input_tax'), 0), 2)
    FROM v;
END $function$;

CREATE OR REPLACE FUNCTION public.post_tax_return(_period_id uuid, _jurisdiction text DEFAULT 'KE')
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE org uuid; r record; ret record; ret_id uuid; _journal uuid := gen_random_uuid();
        _out uuid; _in uuid; _kra uuid; _base text;
BEGIN
  SELECT organization_id INTO org FROM fiscal_periods WHERE id = _period_id;
  IF org IS NULL THEN RAISE EXCEPTION 'Period not found'; END IF;
  PERFORM public.assert_finance_writer_for(org);

  SELECT * INTO ret FROM tax_returns WHERE organization_id = org AND period_id = _period_id AND jurisdiction = _jurisdiction;
  IF ret.status = 'filed' THEN
    RAISE EXCEPTION 'return_filed: this VAT return has been filed with KRA and is locked' USING ERRCODE = '55000';
  END IF;
  PERFORM public.assert_period_open(org, current_date);

  SELECT * INTO r FROM public.compute_tax_return(_period_id, _jurisdiction);

  -- Re-posting replaces the previous settlement journal.
  IF ret.journal_id IS NOT NULL THEN
    PERFORM public.post_reversal_of('tax_return', ret.journal_id, 'VAT return recalculated');
  END IF;

  SELECT currency INTO _base FROM organizations WHERE id = org;
  _out := public.ensure_gl_account(org, '2200', 'VAT Payable (Output)', 'liability', 'vat_output');
  _in  := public.ensure_gl_account(org, '2210', 'VAT Recoverable (Input)', 'liability', 'vat_input');
  _kra := public.ensure_gl_account(org, '2220', 'VAT Payable to KRA', 'liability', 'vat_payable_authority');

  -- Clear output and input VAT for the period into one amount owed to (or reclaimable from) KRA.
  IF COALESCE(r.output_total, 0) <> 0 OR COALESCE(r.input_total, 0) <> 0 THEN
    INSERT INTO accounting_transactions(transaction_number, transaction_date, account_type, category, description,
      debit_amount, credit_amount, reference_type, reference_id, organization_id, gl_account_id, currency, base_currency)
    VALUES
      ('VATR-OUT-'||substr(_journal::text,1,8), now(), 'liability', 'vat_settlement', 'VAT return — clear output VAT',
        GREATEST(r.output_total, 0), GREATEST(-r.output_total, 0), 'tax_return', _journal, org, _out, _base, _base),
      ('VATR-IN-'||substr(_journal::text,1,8), now(), 'liability', 'vat_settlement', 'VAT return — clear input VAT',
        GREATEST(-r.input_total, 0), GREATEST(r.input_total, 0), 'tax_return', _journal, org, _in, _base, _base),
      ('VATR-KRA-'||substr(_journal::text,1,8), now(), 'liability', 'vat_settlement', 'VAT return — net VAT payable to KRA',
        GREATEST(-r.net_payable, 0), GREATEST(r.net_payable, 0), 'tax_return', _journal, org, _kra, _base, _base);
  ELSE
    _journal := NULL;
  END IF;

  INSERT INTO tax_returns (organization_id, period_id, jurisdiction, output_total, input_total, net_payable, status, journal_id)
  VALUES (org, _period_id, _jurisdiction, r.output_total, r.input_total, r.net_payable, 'posted', _journal)
  ON CONFLICT (organization_id, period_id, jurisdiction) DO UPDATE
    SET output_total = EXCLUDED.output_total, input_total = EXCLUDED.input_total,
        net_payable = EXCLUDED.net_payable, status = 'posted', journal_id = EXCLUDED.journal_id, updated_at = now()
  RETURNING id INTO ret_id;
  RETURN ret_id;
END $function$;

CREATE OR REPLACE FUNCTION public.trg_lock_filed_tax_return()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  IF OLD.status = 'filed' AND (TG_OP = 'DELETE' OR NEW.status IS DISTINCT FROM 'filed'
      OR (NEW.output_total, NEW.input_total, NEW.net_payable) IS DISTINCT FROM (OLD.output_total, OLD.input_total, OLD.net_payable)) THEN
    RAISE EXCEPTION 'return_filed: this VAT return has been filed with KRA and is locked' USING ERRCODE = '55000';
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;

DROP TRIGGER IF EXISTS trg_lock_filed_tax_return ON public.tax_returns;
CREATE TRIGGER trg_lock_filed_tax_return
  BEFORE UPDATE OR DELETE ON public.tax_returns
  FOR EACH ROW EXECUTE FUNCTION public.trg_lock_filed_tax_return();

-- ---------------------------------------------------------------- withholding

CREATE OR REPLACE FUNCTION public.post_withholding_to_ledger(_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE _w withholding_certificates%ROWTYPE; _curr text; _wht uuid;
BEGIN
  SELECT * INTO _w FROM withholding_certificates WHERE id = _id;
  IF NOT FOUND OR COALESCE(_w.amount_withheld, 0) <= 0 THEN RETURN; END IF;
  IF EXISTS (SELECT 1 FROM accounting_transactions WHERE reference_type = 'withholding_certificate' AND reference_id = _id) THEN RETURN; END IF;
  PERFORM public.assert_period_open(_w.organization_id, COALESCE(_w.certificate_date, current_date));
  _curr := COALESCE((SELECT currency FROM organizations WHERE id = _w.organization_id), 'USD');
  _wht := public.ensure_gl_account(_w.organization_id, '2230', 'Withholding Tax Payable', 'liability', 'wht_payable');

  INSERT INTO accounting_transactions(transaction_number, transaction_date, account_type, category, description,
    debit_amount, credit_amount, reference_type, reference_id, organization_id, currency)
  VALUES ('WHT-DR-'||substring(_w.id::text,1,8), COALESCE(_w.certificate_date::timestamptz, _w.created_at, now()),
    'liability', 'accounts_payable', 'WHT deducted from supplier — '||COALESCE(_w.certificate_number, _w.id::text),
    _w.amount_withheld, 0, 'withholding_certificate', _w.id, _w.organization_id, _curr);
  INSERT INTO accounting_transactions(transaction_number, transaction_date, account_type, category, description,
    debit_amount, credit_amount, reference_type, reference_id, organization_id, currency, gl_account_id)
  VALUES ('WHT-CR-'||substring(_w.id::text,1,8), COALESCE(_w.certificate_date::timestamptz, _w.created_at, now()),
    'liability', 'wht_payable', 'WHT payable to KRA — '||COALESCE(_w.certificate_number, _w.id::text),
    0, _w.amount_withheld, 'withholding_certificate', _w.id, _w.organization_id, _curr, _wht);
END $function$;

-- Existing WHT payable lines had no GL account; point them at 2230.
DO $$
DECLARE o uuid;
BEGIN
  FOR o IN SELECT DISTINCT organization_id FROM accounting_transactions WHERE category = 'wht_payable' AND gl_account_id IS NULL LOOP
    UPDATE accounting_transactions
       SET gl_account_id = public.ensure_gl_account(o, '2230', 'Withholding Tax Payable', 'liability', 'wht_payable')
     WHERE organization_id = o AND category = 'wht_payable' AND gl_account_id IS NULL;
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.trg_withholding_guard()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.rate IS NOT NULL AND NEW.base_amount IS NOT NULL
     AND abs(round(NEW.base_amount * NEW.rate / 100.0, 2) - COALESCE(NEW.amount_withheld, 0)) > 0.01 THEN
    RAISE EXCEPTION 'wht_amount_mismatch: % %% of % is %, not %', NEW.rate, NEW.base_amount,
      round(NEW.base_amount * NEW.rate / 100.0, 2), NEW.amount_withheld USING ERRCODE = '22023';
  END IF;
  IF TG_OP = 'UPDATE'
     AND (NEW.amount_withheld, NEW.base_amount, NEW.rate, NEW.certificate_date, NEW.supplier_id)
         IS DISTINCT FROM (OLD.amount_withheld, OLD.base_amount, OLD.rate, OLD.certificate_date, OLD.supplier_id)
     AND EXISTS (SELECT 1 FROM accounting_transactions WHERE reference_type = 'withholding_certificate' AND reference_id = OLD.id) THEN
    RAISE EXCEPTION 'certificate_posted: delete this certificate and record it again to change its amounts, date or supplier'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS a_trg_withholding_guard ON public.withholding_certificates;
CREATE TRIGGER a_trg_withholding_guard
  BEFORE INSERT OR UPDATE ON public.withholding_certificates
  FOR EACH ROW EXECUTE FUNCTION public.trg_withholding_guard();

CREATE OR REPLACE FUNCTION public.trg_withholding_on_delete()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  PERFORM public.post_reversal_of('withholding_certificate', OLD.id, 'certificate '||OLD.certificate_number||' deleted');
  RETURN OLD;
END $$;

DROP TRIGGER IF EXISTS trg_withholding_on_delete ON public.withholding_certificates;
CREATE TRIGGER trg_withholding_on_delete
  AFTER DELETE ON public.withholding_certificates
  FOR EACH ROW EXECUTE FUNCTION public.trg_withholding_on_delete();

-- ---------------------------------------------------------------- eTIMS queue

-- Every invoice that is sent to a customer is queued once for KRA eTIMS. The
-- connector (edge function) signs it with KRA and fills cu_number / qr_payload.
CREATE UNIQUE INDEX IF NOT EXISTS etims_submissions_invoice_uniq ON public.etims_submissions(invoice_id);

CREATE OR REPLACE FUNCTION public.trg_queue_etims_submission()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.status IN ('sent', 'overdue', 'paid') AND (TG_OP = 'INSERT' OR OLD.status = 'draft')
     AND upper(COALESCE((SELECT country FROM organizations WHERE id = NEW.organization_id), '')) IN ('KE', 'KENYA') THEN
    INSERT INTO etims_submissions(organization_id, invoice_id, status)
    VALUES (NEW.organization_id, NEW.id, 'pending')
    ON CONFLICT (invoice_id) DO NOTHING;
  END IF;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS trg_queue_etims_submission ON public.invoices;
CREATE TRIGGER trg_queue_etims_submission
  AFTER INSERT OR UPDATE OF status ON public.invoices
  FOR EACH ROW EXECUTE FUNCTION public.trg_queue_etims_submission();
