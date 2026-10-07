
CREATE OR REPLACE FUNCTION public.sale_pricing_skip_revenue_txn(_sale_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $$
  SELECT EXISTS (SELECT 1 FROM container_sales WHERE id = _sale_id AND invoice_id IS NOT NULL);
$$;
