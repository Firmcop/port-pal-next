-- 1) Total material cost already expensed to the ledger for a conversion job
CREATE OR REPLACE FUNCTION public.conversion_material_cost_expensed(_conversion_id uuid)
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT COALESCE(SUM(t.debit_amount - t.credit_amount), 0)
    FROM public.accounting_transactions t
    JOIN public.material_movements mm ON mm.id = t.reference_id
   WHERE t.reference_type = 'material_movement'
     AND t.category = 'cogs_conversion_materials'
     AND mm.conversion_id = _conversion_id;
$$;

REVOKE ALL ON FUNCTION public.conversion_material_cost_expensed(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.conversion_material_cost_expensed(uuid) TO authenticated;

-- 2) Post a material issue / return to the ledger
CREATE OR REPLACE FUNCTION public.post_material_consumption_to_ledger(_movement_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _m public.material_movements%ROWTYPE;
  _amt numeric;
  _curr text;
  _label text;
  _num text;
BEGIN
  SELECT * INTO _m FROM public.material_movements WHERE id = _movement_id;
  IF NOT FOUND THEN RETURN; END IF;
  IF _m.conversion_id IS NULL THEN RETURN; END IF;
  IF _m.movement_type::text NOT IN ('issue','return') THEN RETURN; END IF;

  -- issues carry a negative qty, returns a positive qty
  _amt := ROUND(-1 * COALESCE(_m.qty,0) * COALESCE(_m.unit_cost,0), 2);
  IF _amt = 0 THEN RETURN; END IF;

  IF EXISTS (SELECT 1 FROM public.accounting_transactions
              WHERE reference_type = 'material_movement' AND reference_id = _m.id) THEN
    RETURN;
  END IF;

  _curr := COALESCE((SELECT currency FROM public.organizations WHERE id = _m.organization_id), 'USD');
  _num  := 'MAT-' || substring(_m.id::text, 1, 8);
  _label := CASE WHEN _amt > 0 THEN 'Materials issued to job ' ELSE 'Materials returned from job ' END
            || COALESCE((SELECT job_number FROM public.container_conversions WHERE id = _m.conversion_id), '')
            || COALESCE(' — ' || (SELECT name FROM public.materials WHERE id = _m.material_id), '');

  INSERT INTO public.accounting_transactions(
    transaction_number, transaction_date, account_type, category, description,
    debit_amount, credit_amount, reference_type, reference_id, organization_id, currency)
  VALUES (_num || '-C', COALESCE(_m.created_at, now()),
          'cost_of_goods', 'cogs_conversion_materials', _label,
          GREATEST(_amt, 0), GREATEST(-_amt, 0),
          'material_movement', _m.id, _m.organization_id, _curr);

  INSERT INTO public.accounting_transactions(
    transaction_number, transaction_date, account_type, category, description,
    debit_amount, credit_amount, reference_type, reference_id, organization_id, currency)
  VALUES (_num || '-I', COALESCE(_m.created_at, now()),
          'asset', 'inventory', 'Materials inventory relieved — ' || _label,
          GREATEST(-_amt, 0), GREATEST(_amt, 0),
          'material_movement', _m.id, _m.organization_id, _curr);
END $$;

REVOKE ALL ON FUNCTION public.post_material_consumption_to_ledger(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.post_material_consumption_to_ledger(uuid) TO authenticated;

-- 3) Trigger on every new material movement
CREATE OR REPLACE FUNCTION public.trg_post_material_consumption()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  PERFORM public.post_material_consumption_to_ledger(NEW.id);
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_post_material_consumption ON public.material_movements;
CREATE TRIGGER trg_post_material_consumption
AFTER INSERT ON public.material_movements
FOR EACH ROW EXECUTE FUNCTION public.trg_post_material_consumption();

-- 4) Container sale: do not charge material cost twice
CREATE OR REPLACE FUNCTION public.post_container_sale_to_ledger(_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _s container_sales%ROWTYPE;
  _curr text;
  _cogs numeric;
  _expensed numeric := 0;
  _outputs int := 0;
BEGIN
  SELECT * INTO _s FROM container_sales WHERE id=_id;
  IF NOT FOUND OR COALESCE(_s.selling_price,0) <= 0 THEN RETURN; END IF;
  IF _s.status::text <> 'sold' OR _s.invoice_id IS NOT NULL THEN RETURN; END IF;
  IF EXISTS (SELECT 1 FROM accounting_transactions WHERE reference_type='container_sale' AND reference_id=_id) THEN RETURN; END IF;
  _curr := COALESCE((SELECT currency FROM organizations WHERE id=_s.organization_id),'USD');

  INSERT INTO accounting_transactions(transaction_number, transaction_date, account_type, category, description,
    debit_amount, credit_amount, reference_type, reference_id, organization_id, currency)
  VALUES ('CS-AR-'||substring(_s.id::text,1,8), COALESCE(_s.sold_at,_s.created_at,now()),
    'asset','accounts_receivable','Container sale '||_s.sale_number,
    _s.selling_price, 0, 'container_sale', _s.id, _s.organization_id, _curr);

  INSERT INTO accounting_transactions(transaction_number, transaction_date, account_type, category, description,
    debit_amount, credit_amount, reference_type, reference_id, organization_id, currency)
  VALUES ('CS-REV-'||substring(_s.id::text,1,8), COALESCE(_s.sold_at,_s.created_at,now()),
    'revenue','container_sale','Container sale revenue '||_s.sale_number,
    0, _s.selling_price, 'container_sale', _s.id, _s.organization_id, _curr);

  _cogs := COALESCE(_s.entry_price,0);

  IF _s.conversion_id IS NOT NULL THEN
    SELECT GREATEST(COUNT(*),1) INTO _outputs
      FROM public.conversion_outputs WHERE conversion_id = _s.conversion_id;
    _expensed := ROUND(public.conversion_material_cost_expensed(_s.conversion_id) / _outputs, 2);
    _cogs := GREATEST(_cogs - GREATEST(_expensed,0), 0);
  END IF;

  IF _cogs > 0 THEN
    INSERT INTO accounting_transactions(transaction_number, transaction_date, account_type, category, description,
      debit_amount, credit_amount, reference_type, reference_id, organization_id, currency)
    VALUES ('CS-COGS-'||substring(_s.id::text,1,8), COALESCE(_s.sold_at,_s.created_at,now()),
      'cost_of_goods','container_cogs','COGS — '||_s.sale_number
        || CASE WHEN _expensed > 0 THEN ' (materials already expensed at issue)' ELSE '' END,
      _cogs, 0, 'container_sale', _s.id, _s.organization_id, _curr);
    INSERT INTO accounting_transactions(transaction_number, transaction_date, account_type, category, description,
      debit_amount, credit_amount, reference_type, reference_id, organization_id, currency)
    VALUES ('CS-INV-'||substring(_s.id::text,1,8), COALESCE(_s.sold_at,_s.created_at,now()),
      'asset','inventory','Inventory relieved — '||_s.sale_number,
      0, _cogs, 'container_sale', _s.id, _s.organization_id, _curr);
  END IF;
END $$;

-- 5) Posting status also counts material cost now in the ledger
CREATE OR REPLACE FUNCTION public.conversion_posting_status(_conversion_id uuid)
RETURNS TABLE(job_status text, job_cost_total numeric, posted_amount numeric, posted_entries integer, last_posted_at timestamp with time zone)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  WITH j AS (
    SELECT id, status, project_id, organization_id
      FROM public.container_conversions
     WHERE id = _conversion_id
       AND organization_id = public.current_org_id()
  )
  SELECT j.status::text,
         COALESCE((SELECT SUM(COALESCE(m.total_cost,0)) FROM public.conversion_materials m WHERE m.conversion_id = j.id), 0)
       + COALESCE((SELECT SUM(COALESCE(l.total_cost,0)) FROM public.conversion_labour l WHERE l.conversion_id = j.id), 0)
       + COALESCE((SELECT SUM(COALESCE(sv.cost,0)) FROM public.conversion_services sv WHERE sv.conversion_id = j.id), 0)
       + COALESCE((SELECT SUM(COALESCE(cc.container_cost,0) + COALESCE(cc.transport_offloading_cost,0)) FROM public.conversion_containers cc WHERE cc.conversion_id = j.id), 0)
       + COALESCE((SELECT SUM(ROUND((el.amount + COALESCE(el.tax_amount,0)) * COALESCE(ex.fx_rate,1), 2))
                     FROM public.operating_expense_lines el
                     JOIN public.operating_expenses ex ON ex.id = el.expense_id
                    WHERE ex.organization_id = j.organization_id
                      AND ex.posted_at IS NOT NULL
                      AND ex.reversed_at IS NULL
                      AND ex.approval_status::text = 'approved'
                      AND (
                            COALESCE(el.conversion_id, ex.conversion_id) = j.id
                         OR (j.project_id IS NOT NULL
                             AND COALESCE(el.project_id, ex.project_id) = j.project_id
                             AND COALESCE(el.conversion_id, ex.conversion_id) IS NULL
                             AND (SELECT COUNT(*) FROM public.container_conversions cv
                                   WHERE cv.project_id = j.project_id
                                     AND cv.organization_id = j.organization_id
                                     AND cv.status <> 'cancelled') = 1)
                          )), 0),
         COALESCE((SELECT SUM(t.debit_amount) FROM public.accounting_transactions t
                    WHERE t.reference_id = j.id AND t.reference_type = 'container_conversions'), 0)
       + public.conversion_material_cost_expensed(j.id),
         COALESCE((SELECT COUNT(*)::int FROM public.accounting_transactions t
                    WHERE t.reference_id = j.id AND t.reference_type = 'container_conversions'), 0)
       + COALESCE((SELECT COUNT(*)::int FROM public.accounting_transactions t
                     JOIN public.material_movements mm ON mm.id = t.reference_id
                    WHERE t.reference_type = 'material_movement'
                      AND t.category = 'cogs_conversion_materials'
                      AND mm.conversion_id = j.id), 0),
         GREATEST(
           (SELECT MAX(t.transaction_date) FROM public.accounting_transactions t
             WHERE t.reference_id = j.id AND t.reference_type = 'container_conversions'),
           (SELECT MAX(t.transaction_date) FROM public.accounting_transactions t
              JOIN public.material_movements mm ON mm.id = t.reference_id
             WHERE t.reference_type = 'material_movement'
               AND t.category = 'cogs_conversion_materials'
               AND mm.conversion_id = j.id))
    FROM j;
$$;