CREATE OR REPLACE FUNCTION public.stamp_project_from_material_movement()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NEW.project_id IS NULL AND NEW.reference_type = 'material_movement' AND NEW.reference_id IS NOT NULL THEN
    SELECT c.project_id INTO NEW.project_id
    FROM material_movements m JOIN container_conversions c ON c.id = m.conversion_id
    WHERE m.id = NEW.reference_id;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_stamp_project_from_material_movement ON public.accounting_transactions;
CREATE TRIGGER trg_stamp_project_from_material_movement BEFORE INSERT ON public.accounting_transactions
FOR EACH ROW EXECUTE FUNCTION public.stamp_project_from_material_movement();

CREATE OR REPLACE FUNCTION public.project_pnl_report(_from date DEFAULT NULL, _to date DEFAULT NULL)
RETURNS TABLE(project_id uuid, code text, name text, status text, customer_id uuid, customer_name text,
  revenue numeric, materials numeric, other_cogs numeric, expenses numeric, gross_profit numeric, net_profit numeric,
  budget numeric, quoted numeric, variance numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  WITH t AS (
    SELECT a.project_id,
      SUM(CASE WHEN a.account_type='revenue' THEN a.credit_amount-a.debit_amount ELSE 0 END) rev,
      SUM(CASE WHEN a.account_type='cost_of_goods' AND a.category='cogs_conversion_materials' THEN a.debit_amount-a.credit_amount ELSE 0 END) mat,
      SUM(CASE WHEN a.account_type='cost_of_goods' AND a.category<>'cogs_conversion_materials' THEN a.debit_amount-a.credit_amount ELSE 0 END) oc,
      SUM(CASE WHEN a.account_type='expense' THEN a.debit_amount-a.credit_amount ELSE 0 END) ex
    FROM accounting_transactions a
    WHERE a.project_id IS NOT NULL AND a.organization_id = current_org_id()
      AND (_from IS NULL OR a.transaction_date >= _from) AND (_to IS NULL OR a.transaction_date <= _to)
    GROUP BY a.project_id
  ), b AS (SELECT bu.project_id, SUM(bu.amount) amt FROM budgets bu WHERE bu.organization_id=current_org_id() AND bu.project_id IS NOT NULL GROUP BY 1),
  q AS (SELECT cc.project_id, SUM(COALESCE(cc.quoted_price,0)) amt FROM container_conversions cc WHERE cc.organization_id=current_org_id() AND cc.project_id IS NOT NULL AND cc.status<>'cancelled' GROUP BY 1)
  SELECT p.id, p.code, p.name, p.status::text, p.customer_id, cu.company_name,
    COALESCE(t.rev,0), COALESCE(t.mat,0), COALESCE(t.oc,0), COALESCE(t.ex,0),
    COALESCE(t.rev,0)-COALESCE(t.mat,0)-COALESCE(t.oc,0),
    COALESCE(t.rev,0)-COALESCE(t.mat,0)-COALESCE(t.oc,0)-COALESCE(t.ex,0),
    COALESCE(NULLIF(b.amt,0), NULLIF(p.budget_amount,0)), q.amt,
    COALESCE(NULLIF(b.amt,0), NULLIF(p.budget_amount,0), NULLIF(q.amt,0)) - (COALESCE(t.mat,0)+COALESCE(t.oc,0)+COALESCE(t.ex,0))
  FROM projects p
  LEFT JOIN t ON t.project_id=p.id LEFT JOIN b ON b.project_id=p.id LEFT JOIN q ON q.project_id=p.id
  LEFT JOIN customers cu ON cu.id=p.customer_id
  WHERE p.organization_id = current_org_id()
  ORDER BY p.code;
$$;
REVOKE ALL ON FUNCTION public.project_pnl_report(date,date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.project_pnl_report(date,date) TO authenticated;