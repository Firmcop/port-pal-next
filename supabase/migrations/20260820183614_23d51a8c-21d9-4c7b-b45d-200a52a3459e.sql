-- D1. Admin editing of purchase (supplier) invoices with an audit trail
CREATE TABLE IF NOT EXISTS public.supplier_invoice_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  invoice_id uuid NOT NULL REFERENCES public.supplier_invoices(id) ON DELETE CASCADE,
  actor_id uuid,
  action text NOT NULL,
  reason text NOT NULL,
  changes jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.supplier_invoice_audit TO authenticated;
GRANT ALL ON public.supplier_invoice_audit TO service_role;
ALTER TABLE public.supplier_invoice_audit ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "finance roles read supplier invoice audit" ON public.supplier_invoice_audit;
CREATE POLICY "finance roles read supplier invoice audit" ON public.supplier_invoice_audit
FOR SELECT TO authenticated
USING (organization_id = current_org_id() AND (
  has_role(auth.uid(),'admin') OR has_role(auth.uid(),'org_owner') OR has_role(auth.uid(),'accountant')));

CREATE OR REPLACE FUNCTION public.admin_update_supplier_invoice(
  _invoice_id uuid, _patch jsonb, _reason text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _uid uuid := auth.uid();
  _org uuid := current_org_id();
  _before public.supplier_invoices%ROWTYPE;
  _changes jsonb := '{}'::jsonb;
  _k text;
BEGIN
  IF NOT (has_role(_uid,'admin') OR has_role(_uid,'org_owner') OR has_role(_uid,'accountant')) THEN
    RAISE EXCEPTION 'Not authorized to edit purchase invoices';
  END IF;
  IF _reason IS NULL OR length(btrim(_reason)) < 5 THEN
    RAISE EXCEPTION 'A reason of at least 5 characters is required';
  END IF;

  SELECT * INTO _before FROM public.supplier_invoices WHERE id = _invoice_id AND organization_id = _org;
  IF NOT FOUND THEN RAISE EXCEPTION 'Purchase invoice not found'; END IF;

  FOR _k IN SELECT jsonb_object_keys(_patch) LOOP
    IF _k NOT IN ('issue_date','due_date','subtotal','tax_amount','total_amount','currency','reference','notes','status','reason') THEN
      RAISE EXCEPTION 'Field % cannot be edited', _k;
    END IF;
  END LOOP;

  UPDATE public.supplier_invoices SET
    issue_date   = COALESCE((_patch->>'issue_date')::date, issue_date),
    due_date     = COALESCE((_patch->>'due_date')::date, due_date),
    subtotal     = COALESCE((_patch->>'subtotal')::numeric, subtotal),
    tax_amount   = COALESCE((_patch->>'tax_amount')::numeric, tax_amount),
    total_amount = COALESCE((_patch->>'total_amount')::numeric, total_amount),
    currency     = COALESCE(NULLIF(_patch->>'currency',''), currency),
    reference    = COALESCE(_patch->>'reference', reference),
    notes        = COALESCE(_patch->>'notes', notes),
    status       = COALESCE(NULLIF(_patch->>'status',''), status),
    reason       = COALESCE(_patch->>'reason', reason),
    updated_at   = now()
  WHERE id = _invoice_id;

  SELECT jsonb_object_agg(k, jsonb_build_object('from', b.v, 'to', a.v)) INTO _changes
    FROM jsonb_each_text(to_jsonb(_before)) b(k,v)
    JOIN jsonb_each_text((SELECT to_jsonb(si) FROM public.supplier_invoices si WHERE si.id = _invoice_id)) a(k,v) USING (k)
   WHERE b.v IS DISTINCT FROM a.v AND k <> 'updated_at';

  INSERT INTO public.supplier_invoice_audit (organization_id, invoice_id, actor_id, action, reason, changes)
  VALUES (_org, _invoice_id, _uid, 'edit', btrim(_reason), COALESCE(_changes,'{}'::jsonb));

  -- keep the payable ledger entry in step with the new total
  UPDATE public.accounting_transactions t
     SET credit_amount = (SELECT total_amount FROM public.supplier_invoices WHERE id = _invoice_id),
         currency      = (SELECT currency FROM public.supplier_invoices WHERE id = _invoice_id)
   WHERE t.reference_type IN ('supplier_invoices','supplier_invoice')
     AND t.reference_id = _invoice_id AND t.credit_amount > 0;

  RETURN _invoice_id;
END $$;
REVOKE ALL ON FUNCTION public.admin_update_supplier_invoice(uuid,jsonb,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_update_supplier_invoice(uuid,jsonb,text) TO authenticated;
