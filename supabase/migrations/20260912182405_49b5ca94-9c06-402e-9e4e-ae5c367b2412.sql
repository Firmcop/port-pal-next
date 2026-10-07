
CREATE OR REPLACE FUNCTION public.finance_module_feed_status()
RETURNS TABLE(module text, documents bigint, posted bigint, unposted bigint, last_posted timestamptz)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE _org uuid := current_org_id();
BEGIN
  RETURN QUERY
  WITH led AS (
    SELECT reference_type, reference_id, max(transaction_date) d
      FROM accounting_transactions WHERE organization_id = _org
     GROUP BY 1,2
  ),
  gr_posted_po AS (
    SELECT DISTINCT gr.po_id
      FROM goods_receipts gr
      JOIN led l ON l.reference_type = 'goods_receipt' AND l.reference_id = gr.id
     WHERE gr.organization_id = _org AND gr.po_id IS NOT NULL
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
         count(*) FILTER (WHERE EXISTS (SELECT 1 FROM led l WHERE l.reference_type='supplier_invoices' AND l.reference_id=s.id)
                             OR s.purchase_order_id IN (SELECT po_id FROM gr_posted_po))::bigint,
         count(*) FILTER (WHERE NOT EXISTS (SELECT 1 FROM led l WHERE l.reference_type='supplier_invoices' AND l.reference_id=s.id)
                            AND (s.purchase_order_id IS NULL OR s.purchase_order_id NOT IN (SELECT po_id FROM gr_posted_po)))::bigint,
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
$function$;

REVOKE ALL ON FUNCTION public.finance_module_feed_status() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.finance_module_feed_status() TO authenticated;
