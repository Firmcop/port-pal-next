
-- 1) Revoke anon/public EXECUTE on internal trigger function
REVOKE EXECUTE ON FUNCTION public.set_repatriation_org() FROM PUBLIC, anon, authenticated;

-- 2) Add customer_id linking columns
ALTER TABLE public.invoices          ADD COLUMN IF NOT EXISTS customer_id uuid REFERENCES public.customers(id);
ALTER TABLE public.containers        ADD COLUMN IF NOT EXISTS customer_id uuid REFERENCES public.customers(id);
ALTER TABLE public.gate_appointments ADD COLUMN IF NOT EXISTS customer_id uuid REFERENCES public.customers(id);

CREATE INDEX IF NOT EXISTS idx_invoices_customer_id          ON public.invoices(customer_id);
CREATE INDEX IF NOT EXISTS idx_containers_customer_id        ON public.containers(customer_id);
CREATE INDEX IF NOT EXISTS idx_gate_appointments_customer_id ON public.gate_appointments(customer_id);

-- 3) Backfill only when exactly one customer in the org matches the name
UPDATE public.invoices i
SET customer_id = c.id
FROM public.customers c
WHERE i.customer_id IS NULL
  AND i.customer_name IS NOT NULL
  AND c.organization_id = i.organization_id
  AND lower(c.company_name) = lower(i.customer_name)
  AND (SELECT count(*) FROM public.customers c2
        WHERE c2.organization_id = i.organization_id
          AND lower(c2.company_name) = lower(i.customer_name)) = 1;

UPDATE public.containers ct
SET customer_id = c.id
FROM public.customers c
WHERE ct.customer_id IS NULL
  AND ct.owner IS NOT NULL
  AND c.organization_id = ct.organization_id
  AND lower(c.company_name) = lower(ct.owner)
  AND (SELECT count(*) FROM public.customers c2
        WHERE c2.organization_id = ct.organization_id
          AND lower(c2.company_name) = lower(ct.owner)) = 1;

UPDATE public.gate_appointments ga
SET customer_id = c.id
FROM public.customers c
WHERE ga.customer_id IS NULL
  AND ga.shipping_line IS NOT NULL
  AND c.organization_id = ga.organization_id
  AND lower(c.company_name) = lower(ga.shipping_line)
  AND (SELECT count(*) FROM public.customers c2
        WHERE c2.organization_id = ga.organization_id
          AND lower(c2.company_name) = lower(ga.shipping_line)) = 1;

-- 4) Replace portal RLS policies to match on customer_id only
DROP POLICY IF EXISTS "Portal users view own invoices"           ON public.invoices;
DROP POLICY IF EXISTS "Portal users view own containers"         ON public.containers;
DROP POLICY IF EXISTS "Portal users view own payments"           ON public.payments;
DROP POLICY IF EXISTS "Portal users view own gate_appointments"  ON public.gate_appointments;

CREATE POLICY "Portal users view own invoices"
ON public.invoices
FOR SELECT
USING (
  customer_id IS NOT NULL
  AND customer_id = public.get_portal_customer_id(auth.uid())
);

CREATE POLICY "Portal users view own containers"
ON public.containers
FOR SELECT
USING (
  customer_id IS NOT NULL
  AND customer_id = public.get_portal_customer_id(auth.uid())
);

CREATE POLICY "Portal users view own payments"
ON public.payments
FOR SELECT
USING (
  invoice_id IN (
    SELECT i.id FROM public.invoices i
    WHERE i.customer_id = public.get_portal_customer_id(auth.uid())
      AND i.customer_id IS NOT NULL
  )
);

CREATE POLICY "Portal users view own gate_appointments"
ON public.gate_appointments
FOR SELECT
USING (
  (created_by = auth.uid())
  OR (customer_id IS NOT NULL
      AND customer_id = public.get_portal_customer_id(auth.uid()))
);
