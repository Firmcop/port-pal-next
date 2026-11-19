-- =====================================================================
-- One set of job figures (19 Nov 2026) — step 1: every ledger line knows its job.
-- Job screens counted KES 14.6M of costs while the books carried KES 4.9M
-- against projects. From here the books are the single source: each cost or
-- sale line carries the conversion job (and so its project), and job, project
-- and company figures all read the same lines.
--  * accounting_transactions.conversion_id, stamped on insert from the source
--    document (store issues, expense lines, POs/bills/receipts, supplier
--    payments, container sales, attendance) and backfilled
--  * the project follows the job when the line has none
--  * ledger_sync_tagged(): like ledger_sync_lines but keeps job/project tags
--    apart, for the allocation steps that follow
--  * containers put into a job leave container stock: Dr 5010 (job) / Cr 1200,
--    at the container's book value, dated when the job started
-- =====================================================================
ALTER TABLE public.accounting_transactions ADD COLUMN IF NOT EXISTS conversion_id uuid REFERENCES public.container_conversions(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS accounting_transactions_conversion_idx ON public.accounting_transactions (conversion_id) WHERE conversion_id IS NOT NULL;
COMMENT ON COLUMN public.accounting_transactions.conversion_id IS 'The conversion job this line belongs to (job costing). The project follows the job.';

-- which job a source document belongs to
CREATE OR REPLACE FUNCTION public.ledger_job_for(_ref_type text, _ref_id uuid, _gl uuid, _amount numeric)
RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _c uuid; _n int;
BEGIN
  IF _ref_id IS NULL THEN RETURN NULL; END IF;
  IF _ref_type = 'material_movement' THEN
    SELECT conversion_id INTO _c FROM material_movements WHERE id = _ref_id;
  ELSIF _ref_type = 'container_conversions' THEN
    SELECT id INTO _c FROM container_conversions WHERE id = _ref_id;
  ELSIF _ref_type = 'container_sales' THEN
    SELECT conversion_id INTO _c FROM container_sales WHERE id = _ref_id;
  ELSIF _ref_type IN ('supplier_invoices', 'supplier_invoice') THEN
    SELECT po.conversion_id INTO _c FROM supplier_invoices si JOIN purchase_orders po ON po.id = si.purchase_order_id WHERE si.id = _ref_id;
  ELSIF _ref_type = 'goods_receipt' THEN
    SELECT po.conversion_id INTO _c FROM goods_receipts gr JOIN purchase_orders po ON po.id = gr.po_id WHERE gr.id = _ref_id;
  ELSIF _ref_type = 'vendor_payment' THEN
    SELECT COALESCE(vp.conversion_id, po.conversion_id) INTO _c
      FROM vendor_payments vp LEFT JOIN purchase_orders po ON po.id = vp.po_id WHERE vp.id = _ref_id;
  ELSIF _ref_type IN ('operating_expense', 'operating_expense_reversal') THEN
    -- the expense line with the same account (and amount, when several), if they agree on one job
    SELECT count(DISTINCT l.conversion_id), min(l.conversion_id::text)::uuid INTO _n, _c
      FROM operating_expense_lines l
     WHERE l.expense_id = _ref_id AND l.conversion_id IS NOT NULL
       AND (_gl IS NULL OR l.gl_account_id = _gl OR l.gl_account_id IS NULL)
       AND (_amount IS NULL OR NOT EXISTS (SELECT 1 FROM operating_expense_lines l2 WHERE l2.expense_id = _ref_id
                                            AND (_gl IS NULL OR l2.gl_account_id = _gl) AND abs(l2.amount + COALESCE(l2.tax_amount, 0) - _amount) < 0.01)
            OR abs(l.amount + COALESCE(l.tax_amount, 0) - _amount) < 0.01 OR abs(l.amount - _amount) < 0.01);
    IF _n <> 1 THEN
      SELECT conversion_id INTO _c FROM operating_expenses WHERE id = _ref_id;
    END IF;
  ELSIF _ref_type IN ('invoice', 'invoice_reversal') THEN
    SELECT COALESCE(
             (SELECT cs.conversion_id FROM container_sales cs WHERE cs.invoice_id = i.id AND cs.conversion_id IS NOT NULL LIMIT 1),
             (SELECT c.id FROM container_conversions c JOIN quotes q ON q.id = c.quote_id
               WHERE q.quote_number = i.customer_reference AND q.organization_id = i.organization_id
               ORDER BY c.created_at LIMIT 1),
             (SELECT c.id FROM container_conversions c WHERE i.notes ~* ('conversion job ' || c.conversion_number) LIMIT 1))
      INTO _c FROM invoices i WHERE i.id = _ref_id;
  END IF;
  RETURN _c;
END $$;

CREATE OR REPLACE FUNCTION public.trg_stamp_job_dimension()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NEW.conversion_id IS NULL THEN
    NEW.conversion_id := public.ledger_job_for(NEW.reference_type, NEW.reference_id, NEW.gl_account_id,
                                               greatest(COALESCE(NEW.debit_amount, 0), COALESCE(NEW.credit_amount, 0)));
  END IF;
  IF NEW.conversion_id IS NOT NULL AND NEW.project_id IS NULL THEN
    SELECT project_id INTO NEW.project_id FROM container_conversions WHERE id = NEW.conversion_id;
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;   -- tagging must never block a posting
END $$;
-- runs after the GL account is set (trigger names fire in order)
CREATE OR REPLACE TRIGGER trg_zz_stamp_job_dimension BEFORE INSERT ON public.accounting_transactions
  FOR EACH ROW EXECUTE FUNCTION public.trg_stamp_job_dimension();

-- backfill the tag on lines already posted (dimensions only; amounts untouched)
UPDATE accounting_transactions at
   SET conversion_id = public.ledger_job_for(at.reference_type, at.reference_id, at.gl_account_id,
                                             greatest(COALESCE(at.debit_amount, 0), COALESCE(at.credit_amount, 0)))
 WHERE at.conversion_id IS NULL
   AND at.reference_type IN ('material_movement', 'container_conversions', 'container_sales', 'supplier_invoices',
                             'supplier_invoice', 'goods_receipt', 'vendor_payment', 'operating_expense',
                             'operating_expense_reversal', 'invoice', 'invoice_reversal');
UPDATE accounting_transactions at SET project_id = c.project_id
  FROM container_conversions c
 WHERE at.conversion_id = c.id AND at.project_id IS NULL AND c.project_id IS NOT NULL;
-- invoices that belong to a job's project
UPDATE invoices i SET project_id = c.project_id
  FROM container_conversions c
 WHERE i.project_id IS NULL AND c.project_id IS NOT NULL
   AND c.id = public.ledger_job_for('invoice', i.id, NULL, NULL);

-- ---------------------------------------------------------------------
-- tagged sync: post only the difference between what a source should have
-- in the books and what it has, keeping job/project/GL apart
-- _desired: [{gl_account_id, account_type, category, amount(+dr/-cr), conversion_id?, project_id?}]
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ledger_sync_tagged(_org uuid, _ref_type text, _ref_id uuid, _number text,
                                                     _description text, _date timestamptz, _desired jsonb)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE r record; _n int := 0; _base text; _first boolean; _suffix text;
BEGIN
  SELECT currency INTO _base FROM organizations WHERE id = _org;
  SELECT NOT EXISTS (SELECT 1 FROM accounting_transactions WHERE reference_type = _ref_type AND reference_id = _ref_id) INTO _first;
  _suffix := CASE WHEN _first THEN '' ELSE '-ADJ' || to_char(clock_timestamp(), 'YYMMDDHH24MISSMS') END;
  FOR r IN
    WITH want AS (
      SELECT NULLIF(d->>'gl_account_id', '')::uuid gl, d->>'account_type' t, d->>'category' cat,
             NULLIF(d->>'conversion_id', '')::uuid cv, NULLIF(d->>'project_id', '')::uuid pj,
             sum((d->>'amount')::numeric) amt
        FROM jsonb_array_elements(COALESCE(_desired, '[]'::jsonb)) d GROUP BY 1, 2, 3, 4, 5
    ), have AS (
      SELECT gl_account_id gl, account_type::text t, category cat, conversion_id cv, project_id pj,
             sum(debit_amount - credit_amount) amt
        FROM accounting_transactions WHERE reference_type = _ref_type AND reference_id = _ref_id
       GROUP BY 1, 2, 3, 4, 5
    )
    SELECT COALESCE(w.gl, h.gl) gl, COALESCE(w.t, h.t) t, COALESCE(w.cat, h.cat) cat,
           COALESCE(w.cv, h.cv) cv, COALESCE(w.pj, h.pj) pj,
           round(COALESCE(w.amt, 0) - COALESCE(h.amt, 0), 2) delta
      FROM want w FULL JOIN have h
        ON h.gl IS NOT DISTINCT FROM w.gl AND h.t = w.t AND h.cat = w.cat
       AND h.cv IS NOT DISTINCT FROM w.cv AND h.pj IS NOT DISTINCT FROM w.pj
  LOOP
    CONTINUE WHEN abs(r.delta) < 0.005;
    _n := _n + 1;
    INSERT INTO accounting_transactions (transaction_number, transaction_date, account_type, category, description,
      debit_amount, credit_amount, reference_type, reference_id, organization_id, gl_account_id,
      currency, fx_rate, base_currency, conversion_id, project_id)
    VALUES (_number || _suffix || '-' || _n, _date, r.t::account_type, r.cat,
            _description || CASE WHEN _first THEN '' ELSE ' (update)' END,
            greatest(r.delta, 0), greatest(-r.delta, 0), _ref_type, _ref_id, _org, r.gl,
            _base, 1, _base, r.cv, r.pj);
  END LOOP;
  RETURN _n;
END $$;
REVOKE ALL ON FUNCTION public.ledger_sync_tagged(uuid, text, uuid, text, text, timestamptz, jsonb) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------
-- containers put into a job leave container stock
-- value: what the container cost in the books (its purchase bill + transport
-- and crane bills); the job's own figure when there is no bill
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.job_container_book_value(_cc_id uuid)
RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT COALESCE(
           NULLIF((SELECT round(sum(si.total_amount * COALESCE(si.fx_rate, 1)), 2) FROM supplier_invoices si
                    WHERE si.container_id = cc.container_id AND si.status <> 'cancelled'
                      AND si.reason IN ('purchase', 'conversion', 'acquisition_transport', 'acquisition_crane_offloading',
                                        'acquisition_cost_edit')), 0),
           COALESCE(cc.container_cost, 0) + COALESCE(cc.transport_offloading_cost, 0))
    FROM conversion_containers cc WHERE cc.id = _cc_id;
$$;

CREATE OR REPLACE FUNCTION public.sync_job_containers(_conversion_id uuid)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE c container_conversions%ROWTYPE; _val numeric; _already numeric; _inv uuid; _cogs uuid; _on timestamptz; _desired jsonb := '[]';
BEGIN
  SELECT * INTO c FROM container_conversions WHERE id = _conversion_id;
  IF NOT FOUND THEN RETURN 0; END IF;
  IF c.status::text <> 'cancelled' THEN
    SELECT COALESCE(sum(public.job_container_book_value(cc.id)), 0) INTO _val FROM conversion_containers cc WHERE cc.conversion_id = c.id;
    -- earlier container re-syncs for this job already in 5010
    SELECT COALESCE(sum(at.debit_amount - at.credit_amount), 0) INTO _already
      FROM accounting_transactions at JOIN gl_accounts g ON g.id = at.gl_account_id
     WHERE at.reference_type = 'container_conversions' AND at.reference_id = c.id AND g.code = '5010';
    _val := round(_val - _already, 2);
  ELSE
    _val := 0;
  END IF;
  _inv := public.ensure_gl_account(c.organization_id, '1200', 'Inventory - Containers', 'asset', 'container_inventory');
  _cogs := public.ensure_gl_account(c.organization_id, '5010', 'Container Acquisition Cost', 'cost_of_goods', 'container_cogs');
  IF _val <> 0 THEN
    _desired := jsonb_build_array(
      jsonb_build_object('gl_account_id', _cogs, 'account_type', 'cost_of_goods', 'category', 'job_container', 'amount', _val,
                         'conversion_id', c.id, 'project_id', c.project_id),
      jsonb_build_object('gl_account_id', _inv, 'account_type', 'asset', 'category', 'job_container', 'amount', -_val,
                         'conversion_id', c.id, 'project_id', c.project_id));
  END IF;
  _on := CASE WHEN EXISTS (SELECT 1 FROM accounting_transactions WHERE reference_type = 'job_container' AND reference_id = c.id)
              THEN now()
              ELSE COALESCE(c.started_at, c.start_date::timestamptz, c.created_at) END;
  RETURN public.ledger_sync_tagged(c.organization_id, 'job_container', c.id, 'JOBCNT-' || c.conversion_number,
                                   'Container(s) into job ' || c.conversion_number, _on, _desired);
END $$;

CREATE OR REPLACE FUNCTION public.trg_sync_job_containers()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  PERFORM public.sync_job_containers(COALESCE(NEW.conversion_id, OLD.conversion_id));
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'job container posting failed: %', SQLERRM;
  RETURN NULL;
END $$;
CREATE OR REPLACE TRIGGER trg_sync_job_containers AFTER INSERT OR UPDATE OR DELETE ON public.conversion_containers
  FOR EACH ROW EXECUTE FUNCTION public.trg_sync_job_containers();

CREATE OR REPLACE FUNCTION public.trg_sync_job_containers_on_status()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  PERFORM public.sync_job_containers(NEW.id);
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'job container posting failed: %', SQLERRM;
  RETURN NULL;
END $$;
CREATE OR REPLACE TRIGGER trg_sync_job_containers_on_status AFTER UPDATE OF status ON public.container_conversions
  FOR EACH ROW WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION public.trg_sync_job_containers_on_status();

-- backfill: every job since May
SELECT count(public.sync_job_containers(id)) FROM container_conversions;
