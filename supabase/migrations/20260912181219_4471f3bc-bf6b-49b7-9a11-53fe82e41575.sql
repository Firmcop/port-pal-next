
-- 1. Extend category → GL code mapping ---------------------------------------
CREATE OR REPLACE FUNCTION public.category_to_gl_code(_category text, _account_type account_type)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE _category
    WHEN 'container_sale'               THEN '4030'
    WHEN 'container_sale_cogs'          THEN '5010'
    WHEN 'container_cogs'               THEN '5010'
    WHEN 'container_inventory'          THEN '1200'
    WHEN 'work_in_progress'             THEN '1220'
    WHEN 'accounts_receivable'          THEN '1100'
    WHEN 'accounts_payable'             THEN '2000'
    WHEN 'container_acquisition_payable' THEN '2010'
    WHEN 'container_acquisition_payable_adjustment' THEN '2010'
    WHEN 'cost_adjustment'              THEN CASE _account_type::text
                                              WHEN 'liability' THEN '2010'
                                              WHEN 'asset' THEN '1200'
                                              ELSE '5010' END
    WHEN 'grni'                         THEN '2100'
    WHEN 'accrued_expenses'             THEN '2100'
    WHEN 'cash'                         THEN '1000'
    WHEN 'bank'                         THEN '1010'
    WHEN 'inventory'                    THEN '1200'
    WHEN 'materials_inventory'          THEN '1210'
    WHEN 'gate_fee'                     THEN '4010'
    WHEN 'storage'                      THEN '4000'
    WHEN 'handling'                     THEN '4010'
    WHEN 'repair_revenue'               THEN '4020'
    WHEN 'conversion_revenue'           THEN '4040'
    WHEN 'lease_revenue'                THEN '4050'
    WHEN 'logistics_revenue'            THEN '4060'
    WHEN 'fuel'                         THEN '6400'
    WHEN 'tolls'                        THEN '6400'
    WHEN 'loading'                      THEN '6400'
    WHEN 'permits'                      THEN '6400'
    WHEN 'parking'                      THEN '6400'
    WHEN 'subcontractor'                THEN '6400'
    WHEN 'mileage'                      THEN '6400'
    WHEN 'truck_hire'                   THEN '6400'
    WHEN 'driver_allowance'             THEN '6400'
    WHEN 'driver_salary'                THEN '6000'
    WHEN 'repairs'                      THEN '6500'
    WHEN 'payroll'                      THEN '6000'
    WHEN 'wage_allowances'              THEN '6000'
    WHEN 'wages_payable'                THEN '2300'
    WHEN 'payroll_payment'              THEN '2300'
    WHEN 'project_labour'               THEN '5030'
    WHEN 'direct_labour'                THEN '5030'
    WHEN 'conversion_materials'         THEN '5020'
    WHEN 'input_tax'                    THEN '2210'
    WHEN 'output_tax'                   THEN '2200'
    WHEN 'rent'                         THEN '6100'
    WHEN 'utilities'                    THEN '6200'
    WHEN 'office'                       THEN '6300'
    WHEN 'bank_charges'                 THEN '6700'
    WHEN 'fx_gain_loss'                 THEN '6800'
    WHEN 'depreciation'                 THEN '6600'
    WHEN 'accumulated_depreciation'     THEN '1510'
    WHEN 'fixed_asset'                  THEN '1500'
    WHEN 'loan_principal'               THEN '2500'
    WHEN 'loan_interest_accrual'        THEN '2510'
    WHEN 'opening_balance_equity'       THEN '3900'
    WHEN 'loan_opening_balance'         THEN '3900'
    WHEN 'inventory_variance'           THEN '5920'
    WHEN 'other'                        THEN CASE _account_type::text
                                              WHEN 'revenue' THEN '4900'
                                              WHEN 'expense' THEN '6900'
                                              WHEN 'cost_of_goods' THEN '5000'
                                              ELSE NULL END
    ELSE NULL
  END;
$$;

-- 2. Automatic counter-leg for one-sided module postings ----------------------
CREATE OR REPLACE FUNCTION public.post_ledger_counter_leg()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _cat text;
  _type account_type;
BEGIN
  -- Only mirror the known one-sided module postings; never mirror a mirror.
  IF NEW.category IN ('container_inventory','work_in_progress') THEN
    RETURN NEW;
  END IF;

  IF NEW.reference_type = 'supplier_invoices'
     AND NEW.category IN ('container_acquisition_payable','container_acquisition_payable_adjustment','cost_adjustment') THEN
    _cat := 'container_inventory'; _type := 'asset';
  ELSIF NEW.reference_type = 'container_sales'
     AND NEW.category IN ('container_sale_cogs','container_cogs','cost_adjustment') THEN
    _cat := 'container_inventory'; _type := 'asset';
  ELSIF NEW.reference_type = 'container_conversions'
     AND NEW.category IN ('cost_adjustment') THEN
    _cat := 'work_in_progress'; _type := 'asset';
  ELSE
    RETURN NEW;
  END IF;

  INSERT INTO public.accounting_transactions (
    transaction_number, transaction_date, account_type, category, description,
    debit_amount, credit_amount, reference_type, reference_id, organization_id,
    currency, fx_rate, base_currency, project_id, depot_id, created_by
  ) VALUES (
    COALESCE(NEW.transaction_number,'TXN') || '-CL',
    NEW.transaction_date, _type, _cat,
    COALESCE(NEW.description,'') || ' — contra entry',
    COALESCE(NEW.credit_amount,0), COALESCE(NEW.debit_amount,0),
    NEW.reference_type, NEW.reference_id, NEW.organization_id,
    NEW.currency, NEW.fx_rate, NEW.base_currency, NEW.project_id, NEW.depot_id, NEW.created_by
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_post_ledger_counter_leg ON public.accounting_transactions;
CREATE TRIGGER trg_post_ledger_counter_leg
AFTER INSERT ON public.accounting_transactions
FOR EACH ROW EXECUTE FUNCTION public.post_ledger_counter_leg();

-- 3. Trial balance ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.finance_trial_balance(_currency text DEFAULT NULL)
RETURNS TABLE (
  currency text, account_type text, gl_code text, gl_name text,
  debit numeric, credit numeric, balance numeric, entries bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT t.currency,
         t.account_type::text,
         ga.code,
         ga.name,
         round(sum(t.debit_amount),2),
         round(sum(t.credit_amount),2),
         round(sum(t.debit_amount) - sum(t.credit_amount),2),
         count(*)
    FROM accounting_transactions t
    LEFT JOIN gl_accounts ga ON ga.id = t.gl_account_id
   WHERE t.organization_id = current_org_id()
     AND (_currency IS NULL OR upper(t.currency) = upper(_currency))
   GROUP BY t.currency, t.account_type, ga.code, ga.name
   ORDER BY t.currency, ga.code NULLS LAST;
$$;

-- 4. Documents with a one-sided entry ----------------------------------------
CREATE OR REPLACE FUNCTION public.finance_unbalanced_documents()
RETURNS TABLE (
  reference_type text, reference_id uuid, currency text,
  debit numeric, credit numeric, difference numeric, entries bigint, last_posted timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT t.reference_type, t.reference_id, t.currency,
         round(sum(t.debit_amount),2), round(sum(t.credit_amount),2),
         round(sum(t.debit_amount) - sum(t.credit_amount),2),
         count(*), max(t.transaction_date)
    FROM accounting_transactions t
   WHERE t.organization_id = current_org_id()
   GROUP BY t.reference_type, t.reference_id, t.currency
  HAVING abs(round(sum(t.debit_amount) - sum(t.credit_amount),2)) > 0.01
   ORDER BY abs(round(sum(t.debit_amount) - sum(t.credit_amount),2)) DESC;
$$;

-- 5. Module feed status -------------------------------------------------------
CREATE OR REPLACE FUNCTION public.finance_module_feed_status()
RETURNS TABLE (module text, documents bigint, posted bigint, unposted bigint, last_posted timestamptz)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE _org uuid := current_org_id();
BEGIN
  RETURN QUERY
  WITH led AS (
    SELECT reference_type, reference_id, max(transaction_date) d
      FROM accounting_transactions WHERE organization_id = _org
     GROUP BY 1,2
  )
  SELECT 'Customer invoices'::text, count(*)::bigint,
         count(*) FILTER (WHERE EXISTS (SELECT 1 FROM led l WHERE l.reference_type='invoice' AND l.reference_id=i.id))::bigint,
         count(*) FILTER (WHERE NOT EXISTS (SELECT 1 FROM led l WHERE l.reference_type='invoice' AND l.reference_id=i.id))::bigint,
         (SELECT max(d) FROM led WHERE reference_type='invoice')
    FROM invoices i WHERE i.organization_id=_org AND i.status::text <> 'draft'
  UNION ALL
  SELECT 'Customer payments', count(*)::bigint,
         count(*) FILTER (WHERE EXISTS (SELECT 1 FROM led l WHERE l.reference_type='payment' AND l.reference_id=p.id))::bigint,
         count(*) FILTER (WHERE NOT EXISTS (SELECT 1 FROM led l WHERE l.reference_type='payment' AND l.reference_id=p.id))::bigint,
         (SELECT max(d) FROM led WHERE reference_type='payment')
    FROM payments p WHERE p.organization_id=_org
  UNION ALL
  SELECT 'Purchase invoices', count(*)::bigint,
         count(*) FILTER (WHERE EXISTS (SELECT 1 FROM led l WHERE l.reference_type='supplier_invoices' AND l.reference_id=s.id))::bigint,
         count(*) FILTER (WHERE NOT EXISTS (SELECT 1 FROM led l WHERE l.reference_type='supplier_invoices' AND l.reference_id=s.id))::bigint,
         (SELECT max(d) FROM led WHERE reference_type='supplier_invoices')
    FROM supplier_invoices s WHERE s.organization_id=_org AND s.status <> 'cancelled'
  UNION ALL
  SELECT 'Goods receipts', count(*)::bigint,
         count(*) FILTER (WHERE EXISTS (SELECT 1 FROM led l WHERE l.reference_type='goods_receipt' AND l.reference_id=g.id))::bigint,
         count(*) FILTER (WHERE NOT EXISTS (SELECT 1 FROM led l WHERE l.reference_type='goods_receipt' AND l.reference_id=g.id))::bigint,
         (SELECT max(d) FROM led WHERE reference_type='goods_receipt')
    FROM goods_receipts g WHERE g.organization_id=_org
  UNION ALL
  SELECT 'Container sales', count(*)::bigint,
         count(*) FILTER (WHERE EXISTS (SELECT 1 FROM led l WHERE l.reference_type IN ('container_sales','container_sale') AND l.reference_id=c.id))::bigint,
         count(*) FILTER (WHERE NOT EXISTS (SELECT 1 FROM led l WHERE l.reference_type IN ('container_sales','container_sale') AND l.reference_id=c.id))::bigint,
         (SELECT max(d) FROM led WHERE reference_type IN ('container_sales','container_sale'))
    FROM container_sales c WHERE c.organization_id=_org AND c.status::text='sold'
  UNION ALL
  SELECT 'Operating expenses', count(*)::bigint,
         count(*) FILTER (WHERE EXISTS (SELECT 1 FROM led l WHERE l.reference_type='operating_expense' AND l.reference_id=e.id))::bigint,
         count(*) FILTER (WHERE NOT EXISTS (SELECT 1 FROM led l WHERE l.reference_type='operating_expense' AND l.reference_id=e.id))::bigint,
         (SELECT max(d) FROM led WHERE reference_type='operating_expense')
    FROM operating_expenses e WHERE e.organization_id=_org AND e.status='posted'
  UNION ALL
  SELECT 'Logistics trip costs', count(*)::bigint,
         count(*) FILTER (WHERE EXISTS (SELECT 1 FROM led l WHERE l.reference_type='trip_cost' AND l.reference_id=tc.id))::bigint,
         count(*) FILTER (WHERE NOT EXISTS (SELECT 1 FROM led l WHERE l.reference_type='trip_cost' AND l.reference_id=tc.id))::bigint,
         (SELECT max(d) FROM led WHERE reference_type='trip_cost')
    FROM logistics_trip_costs tc WHERE tc.organization_id=_org
  UNION ALL
  SELECT 'Logistics trip revenue', count(*)::bigint,
         count(*) FILTER (WHERE EXISTS (SELECT 1 FROM led l WHERE l.reference_type='trip_revenue' AND l.reference_id=tr.id))::bigint,
         count(*) FILTER (WHERE NOT EXISTS (SELECT 1 FROM led l WHERE l.reference_type='trip_revenue' AND l.reference_id=tr.id))::bigint,
         (SELECT max(d) FROM led WHERE reference_type='trip_revenue')
    FROM logistics_trip_revenue tr WHERE tr.organization_id=_org
  UNION ALL
  SELECT 'Payroll — payslips', count(*)::bigint,
         count(*) FILTER (WHERE EXISTS (SELECT 1 FROM led l WHERE l.reference_type='payslip' AND l.reference_id=ps.id))::bigint,
         count(*) FILTER (WHERE NOT EXISTS (SELECT 1 FROM led l WHERE l.reference_type='payslip' AND l.reference_id=ps.id))::bigint,
         (SELECT max(d) FROM led WHERE reference_type='payslip')
    FROM payslips ps WHERE ps.organization_id=_org
  UNION ALL
  SELECT 'Payroll — attendance weeks', count(*)::bigint,
         count(*) FILTER (WHERE EXISTS (SELECT 1 FROM led l WHERE l.reference_type LIKE 'attendance_week%' AND l.reference_id=aw.id))::bigint,
         count(*) FILTER (WHERE NOT EXISTS (SELECT 1 FROM led l WHERE l.reference_type LIKE 'attendance_week%' AND l.reference_id=aw.id))::bigint,
         (SELECT max(d) FROM led WHERE reference_type LIKE 'attendance_week%')
    FROM attendance_weeks aw WHERE aw.organization_id=_org AND aw.status IN ('approved','paid')
  UNION ALL
  SELECT 'Fixed asset depreciation', count(*)::bigint,
         count(*) FILTER (WHERE EXISTS (SELECT 1 FROM led l WHERE l.reference_type='depreciation_run' AND l.reference_id=dr.id))::bigint,
         count(*) FILTER (WHERE NOT EXISTS (SELECT 1 FROM led l WHERE l.reference_type='depreciation_run' AND l.reference_id=dr.id))::bigint,
         (SELECT max(d) FROM led WHERE reference_type='depreciation_run')
    FROM fixed_asset_depreciation_runs dr WHERE dr.organization_id=_org;
END;
$$;

-- 6. Goods receipt backfill ---------------------------------------------------
CREATE OR REPLACE FUNCTION public.backfill_goods_receipt_postings()
RETURNS TABLE (receipt_id uuid, posted boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE _org uuid := current_org_id(); _r record;
BEGIN
  IF NOT (is_org_admin(_org) OR has_role(auth.uid(),'admin') OR has_role(auth.uid(),'org_owner') OR has_role(auth.uid(),'accountant')) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;
  FOR _r IN
    SELECT g.id FROM goods_receipts g
     WHERE g.organization_id = _org
       AND NOT EXISTS (SELECT 1 FROM accounting_transactions t
                        WHERE t.reference_type='goods_receipt' AND t.reference_id=g.id)
     ORDER BY g.created_at
  LOOP
    PERFORM public.post_goods_receipt_to_ledger(_r.id);
    receipt_id := _r.id;
    posted := EXISTS (SELECT 1 FROM accounting_transactions t
                       WHERE t.reference_type='goods_receipt' AND t.reference_id=_r.id);
    RETURN NEXT;
  END LOOP;
END;
$$;

-- 7. Logistics trip revenue posting ------------------------------------------
CREATE OR REPLACE FUNCTION public.post_trip_revenue_to_ledger(_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE _r logistics_trip_revenue%ROWTYPE; _curr text; _label text;
BEGIN
  SELECT * INTO _r FROM logistics_trip_revenue WHERE id = _id;
  IF NOT FOUND OR COALESCE(_r.amount,0) <= 0 THEN RETURN; END IF;
  IF EXISTS (SELECT 1 FROM accounting_transactions WHERE reference_type='trip_revenue' AND reference_id=_id) THEN RETURN; END IF;
  _curr := COALESCE(_r.currency, (SELECT currency FROM organizations WHERE id=_r.organization_id), 'USD');
  _label := 'Logistics revenue — trip ' || COALESCE((SELECT trip_number FROM logistics_trips WHERE id=_r.trip_id), substr(_r.trip_id::text,1,8));

  INSERT INTO accounting_transactions(transaction_number, transaction_date, account_type, category, description,
    debit_amount, credit_amount, reference_type, reference_id, organization_id, currency)
  VALUES ('TRP-AR-'||substr(replace(_id::text,'-',''),1,10), COALESCE(_r.created_at, now()),
    'asset','accounts_receivable', _label, _r.amount, 0, 'trip_revenue', _id, _r.organization_id, _curr);

  INSERT INTO accounting_transactions(transaction_number, transaction_date, account_type, category, description,
    debit_amount, credit_amount, reference_type, reference_id, organization_id, currency)
  VALUES ('TRP-REV-'||substr(replace(_id::text,'-',''),1,10), COALESCE(_r.created_at, now()),
    'revenue','logistics_revenue', _label, 0, _r.amount, 'trip_revenue', _id, _r.organization_id, _curr);
END;
$$;

CREATE OR REPLACE FUNCTION public.trg_trip_revenue_autopost()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  PERFORM public.post_trip_revenue_to_ledger(NEW.id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_trip_revenue_autopost ON public.logistics_trip_revenue;
CREATE TRIGGER trg_trip_revenue_autopost
AFTER INSERT ON public.logistics_trip_revenue
FOR EACH ROW EXECUTE FUNCTION public.trg_trip_revenue_autopost();

CREATE OR REPLACE FUNCTION public.backfill_trip_revenue_postings()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE _org uuid := current_org_id(); _r record; _n integer := 0;
BEGIN
  IF NOT (is_org_admin(_org) OR has_role(auth.uid(),'admin') OR has_role(auth.uid(),'org_owner') OR has_role(auth.uid(),'accountant')) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;
  FOR _r IN SELECT id FROM logistics_trip_revenue WHERE organization_id=_org LOOP
    PERFORM public.post_trip_revenue_to_ledger(_r.id);
    _n := _n + 1;
  END LOOP;
  RETURN _n;
END;
$$;

-- 8. Guard the auto-balancing journal ----------------------------------------
CREATE OR REPLACE FUNCTION public.finance_currency_difference(_currency text)
RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT round(COALESCE(sum(debit_amount) - sum(credit_amount),0),2)
    FROM accounting_transactions
   WHERE organization_id = current_org_id() AND upper(currency) = upper(_currency);
$$;

REVOKE ALL ON FUNCTION public.finance_trial_balance(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.finance_unbalanced_documents() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.finance_module_feed_status() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.backfill_goods_receipt_postings() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.backfill_trip_revenue_postings() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.post_trip_revenue_to_ledger(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.finance_currency_difference(text) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.finance_trial_balance(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.finance_unbalanced_documents() TO authenticated;
GRANT EXECUTE ON FUNCTION public.finance_module_feed_status() TO authenticated;
GRANT EXECUTE ON FUNCTION public.backfill_goods_receipt_postings() TO authenticated;
GRANT EXECUTE ON FUNCTION public.backfill_trip_revenue_postings() TO authenticated;
GRANT EXECUTE ON FUNCTION public.post_trip_revenue_to_ledger(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.finance_currency_difference(text) TO authenticated;
