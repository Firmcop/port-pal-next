
CREATE OR REPLACE FUNCTION public.set_created_by_default()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.created_by IS NULL THEN
    NEW.created_by := auth.uid();
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_eir_set_created_by ON public.eir_records;
CREATE TRIGGER trg_eir_set_created_by BEFORE INSERT ON public.eir_records
  FOR EACH ROW EXECUTE FUNCTION public.set_created_by_default();

DROP TRIGGER IF EXISTS trg_payments_set_created_by ON public.payments;
CREATE TRIGGER trg_payments_set_created_by BEFORE INSERT ON public.payments
  FOR EACH ROW EXECUTE FUNCTION public.set_created_by_default();

DROP TRIGGER IF EXISTS trg_vendor_payments_set_created_by ON public.vendor_payments;
CREATE TRIGGER trg_vendor_payments_set_created_by BEFORE INSERT ON public.vendor_payments
  FOR EACH ROW EXECUTE FUNCTION public.set_created_by_default();

-- The approval trigger must run AFTER created_by is set; BEFORE triggers fire in name order.
-- Rename approval triggers with a "z" prefix so they evaluate last.
DROP TRIGGER IF EXISTS trg_eir_approval ON public.eir_records;
CREATE TRIGGER zz_eir_approval BEFORE INSERT ON public.eir_records
  FOR EACH ROW EXECUTE FUNCTION public.flag_document_for_approval('eir','gate_fee_amount');

DROP TRIGGER IF EXISTS trg_payments_approval ON public.payments;
CREATE TRIGGER zz_payments_approval BEFORE INSERT ON public.payments
  FOR EACH ROW EXECUTE FUNCTION public.flag_document_for_approval('payment','amount');

DROP TRIGGER IF EXISTS trg_vendor_payments_approval ON public.vendor_payments;
CREATE TRIGGER zz_vendor_payments_approval BEFORE INSERT ON public.vendor_payments
  FOR EACH ROW EXECUTE FUNCTION public.flag_document_for_approval('vendor_payment','amount');
