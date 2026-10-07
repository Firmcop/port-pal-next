
ALTER TABLE public.eir_records
  ADD COLUMN IF NOT EXISTS lease_agreement_id uuid REFERENCES public.lease_agreements(id),
  ADD COLUMN IF NOT EXISTS lease_unit_id uuid REFERENCES public.lease_units(id),
  ADD COLUMN IF NOT EXISTS lease_invoice_id uuid REFERENCES public.invoices(id);

CREATE INDEX IF NOT EXISTS idx_eir_records_lease_unit ON public.eir_records(lease_unit_id);
CREATE INDEX IF NOT EXISTS idx_eir_records_lease_agreement ON public.eir_records(lease_agreement_id);
