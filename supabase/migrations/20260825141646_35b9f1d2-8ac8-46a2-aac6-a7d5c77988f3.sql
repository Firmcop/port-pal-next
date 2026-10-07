CREATE OR REPLACE FUNCTION public.container_invoice_reconciliation()
RETURNS TABLE (
  container_id uuid,
  container_number text,
  container_status text,
  acquisition_count integer,
  duplicate_acquisition_count integer,
  sale_invoice_count integer,
  duplicate_sale_count integer,
  severity text,
  acquisition_invoices jsonb,
  sale_invoices jsonb
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH scoped AS (
    SELECT si.id, si.container_id, si.invoice_number, si.reason, si.reference,
           si.total_amount, si.currency, si.status, si.paid_amount, si.created_at,
           c.container_number, c.status::text AS container_status,
           s.name AS supplier_name
      FROM public.supplier_invoices si
      JOIN public.containers c ON c.id = si.container_id
      LEFT JOIN public.suppliers s ON s.id = si.supplier_id
     WHERE si.organization_id = current_org_id()
       AND si.status <> 'cancelled'
       AND si.invoice_number NOT LIKE 'PINV-ADJ-%'
       AND si.reason IN ('purchase','sale','gate_out_sale','conversion')
  ),
  purchases AS (
    SELECT container_id,
           (array_agg(invoice_number ORDER BY created_at))[1] AS keep_inv
      FROM scoped WHERE reason = 'purchase' GROUP BY container_id
  ),
  repeats AS (
    SELECT id,
           row_number() OVER (PARTITION BY container_id, reason, COALESCE(reference,'') ORDER BY created_at) AS rn,
           (array_agg(invoice_number) OVER (PARTITION BY container_id, reason, COALESCE(reference,'')))[1] AS first_inv
      FROM scoped
  ),
  enriched AS (
    SELECT sc.*,
           r.rn,
           CASE WHEN r.rn > 1 THEN 'repeat_invoice'
                WHEN sc.reason IN ('sale','gate_out_sale','conversion') AND p.container_id IS NOT NULL
                  THEN 'already_purchased'
                ELSE 'ok' END AS issue,
           CASE WHEN r.rn > 1 THEN r.first_inv ELSE p.keep_inv END AS keeps_invoice,
           cs.id AS sale_id, cs.sale_number,
           eir.id AS eir_id, eir.eir_number,
           cv.id AS conversion_id, cv.conversion_number
      FROM scoped sc
      JOIN repeats r ON r.id = sc.id
      LEFT JOIN purchases p ON p.container_id = sc.container_id
      LEFT JOIN LATERAL (
        SELECT cs.id, cs.sale_number FROM public.container_sales cs
         WHERE cs.organization_id = current_org_id()
           AND (cs.supplier_invoice_id = sc.id OR cs.purchase_invoice_id = sc.id
                OR (sc.reference IS NOT NULL AND cs.sale_number = sc.reference))
         ORDER BY cs.created_at LIMIT 1
      ) cs ON true
      LEFT JOIN LATERAL (
        SELECT e.id, e.eir_number FROM public.eir_records e
         WHERE e.organization_id = current_org_id()
           AND (e.supplier_invoice_id = sc.id
                OR (sc.reference IS NOT NULL AND e.eir_number = sc.reference))
         ORDER BY e.created_at LIMIT 1
      ) eir ON true
      LEFT JOIN LATERAL (
        SELECT v.id, v.conversion_number FROM public.container_conversions v
         WHERE v.organization_id = current_org_id()
           AND (v.supplier_invoice_id = sc.id
                OR (sc.reference IS NOT NULL AND (v.conversion_number = sc.reference OR v.id::text = sc.reference)))
         ORDER BY v.created_at LIMIT 1
      ) cv ON true
  ),
  pathed AS (
    SELECT e.*,
           CASE
             WHEN e.sale_id IS NOT NULL THEN 'sale'
             WHEN e.eir_id IS NOT NULL THEN 'eir'
             WHEN e.conversion_id IS NOT NULL THEN 'conversion'
             WHEN e.reason = 'purchase' THEN 'inventory_intake'
             ELSE 'unknown'
           END AS origin,
           CASE
             WHEN e.sale_id IS NOT NULL THEN COALESCE(e.sale_number, 'Container sale')
             WHEN e.eir_id IS NOT NULL THEN COALESCE(e.eir_number, 'Gate EIR')
             WHEN e.conversion_id IS NOT NULL THEN COALESCE(e.conversion_number, 'Conversion job')
             WHEN e.reason = 'purchase' THEN 'Inventory intake / backfill'
             ELSE COALESCE(e.reference, '—')
           END AS origin_label,
           CASE
             WHEN e.sale_id IS NOT NULL THEN '/sales'
             WHEN e.eir_id IS NOT NULL THEN '/gate/eir'
             WHEN e.conversion_id IS NOT NULL THEN '/conversions/' || e.conversion_id::text
             ELSE '/inventory'
           END AS origin_path
      FROM enriched e
  ),
  cust AS (
    SELECT ic.container_id,
           i.id, i.invoice_number, i.status::text AS status, i.total_amount,
           i.currency, i.created_at,
           row_number() OVER (PARTITION BY ic.container_id ORDER BY i.created_at) AS rn
      FROM public.invoice_containers ic
      JOIN public.invoices i ON i.id = ic.invoice_id
     WHERE ic.organization_id = current_org_id()
       AND i.status <> 'cancelled'
  ),
  agg_acq AS (
    SELECT p.container_id, p.container_number, p.container_status,
           count(*)::int AS acquisition_count,
           count(*) FILTER (WHERE p.issue <> 'ok')::int AS duplicate_acquisition_count,
           jsonb_agg(jsonb_build_object(
             'invoice_id', p.id, 'invoice_number', p.invoice_number, 'reason', p.reason,
             'reference', p.reference, 'supplier_name', p.supplier_name,
             'total_amount', p.total_amount, 'currency', p.currency, 'status', p.status,
             'paid_amount', p.paid_amount, 'created_at', p.created_at,
             'issue', p.issue, 'keeps_invoice', p.keeps_invoice,
             'origin', p.origin, 'origin_label', p.origin_label, 'origin_path', p.origin_path
           ) ORDER BY p.created_at) AS acquisition_invoices
      FROM pathed p
     GROUP BY 1,2,3
  ),
  agg_sale AS (
    SELECT c.container_id,
           count(*)::int AS sale_invoice_count,
           count(*) FILTER (WHERE c.rn > 1)::int AS duplicate_sale_count,
           jsonb_agg(jsonb_build_object(
             'invoice_id', c.id, 'invoice_number', c.invoice_number, 'status', c.status,
             'total_amount', c.total_amount, 'currency', c.currency,
             'created_at', c.created_at, 'duplicate', c.rn > 1
           ) ORDER BY c.created_at) AS sale_invoices
      FROM cust c GROUP BY 1
  )
  SELECT a.container_id, a.container_number, a.container_status,
         a.acquisition_count,
         a.duplicate_acquisition_count,
         COALESCE(s.sale_invoice_count, 0),
         COALESCE(s.duplicate_sale_count, 0),
         CASE
           WHEN a.duplicate_acquisition_count > 0 THEN 'critical'
           WHEN COALESCE(s.duplicate_sale_count,0) > 0 THEN 'warning'
           ELSE 'ok'
         END AS severity,
         a.acquisition_invoices,
         COALESCE(s.sale_invoices, '[]'::jsonb)
    FROM agg_acq a
    LEFT JOIN agg_sale s ON s.container_id = a.container_id
   WHERE a.duplicate_acquisition_count > 0
      OR COALESCE(s.duplicate_sale_count, 0) > 0
      OR a.acquisition_count > 1
   ORDER BY (a.duplicate_acquisition_count > 0) DESC, a.container_number;
$$;

REVOKE ALL ON FUNCTION public.container_invoice_reconciliation() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.container_invoice_reconciliation() TO authenticated;