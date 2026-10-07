
CREATE OR REPLACE FUNCTION public.supplier_invoice_cost_in_ledger(_invoice_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM accounting_transactions t
     WHERE t.reference_type = 'supplier_invoices' AND t.reference_id = _invoice_id
  ) OR EXISTS (
    SELECT 1
      FROM supplier_invoices si
      JOIN goods_receipts gr ON gr.po_id = si.purchase_order_id
      JOIN accounting_transactions t
        ON t.reference_type = 'goods_receipt' AND t.reference_id = gr.id
     WHERE si.id = _invoice_id
  );
$$;

REVOKE ALL ON FUNCTION public.supplier_invoice_cost_in_ledger(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.supplier_invoice_cost_in_ledger(uuid) TO authenticated;
