
ALTER TABLE public.suppliers ADD COLUMN IF NOT EXISTS linked_customer_id uuid REFERENCES public.customers(id) ON DELETE SET NULL;
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS linked_supplier_id uuid REFERENCES public.suppliers(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_suppliers_linked_customer_id ON public.suppliers(linked_customer_id);
CREATE INDEX IF NOT EXISTS idx_customers_linked_supplier_id ON public.customers(linked_supplier_id);

DO $$
DECLARE
  canonical uuid := 'a340bf60-0f10-49d9-877e-8895df17e845';
  dupes uuid[] := ARRAY[
    '8a78ed8f-ab3a-4c0f-a390-de81f1ae45e1'::uuid,
    'a29df015-20f9-4b85-802e-8864ff8f5827'::uuid,
    'b226463a-e3c4-43f6-9b2e-635239e285da'::uuid
  ];
  customer_id uuid := 'd596870c-8231-4455-8988-6efd97f66e65';
  po_cnt int; vp_cnt int; lc_cnt int; ltc_cnt int; si_cnt int; c_cnt int;
BEGIN
  UPDATE public.purchase_orders    SET supplier_id = canonical WHERE supplier_id = ANY(dupes);
  GET DIAGNOSTICS po_cnt = ROW_COUNT;
  UPDATE public.vendor_payments    SET supplier_id = canonical WHERE supplier_id = ANY(dupes);
  GET DIAGNOSTICS vp_cnt = ROW_COUNT;
  UPDATE public.logistics_carriers SET supplier_id = canonical WHERE supplier_id = ANY(dupes);
  GET DIAGNOSTICS lc_cnt = ROW_COUNT;
  UPDATE public.logistics_trip_costs SET supplier_id = canonical WHERE supplier_id = ANY(dupes);
  GET DIAGNOSTICS ltc_cnt = ROW_COUNT;
  UPDATE public.supplier_invoices  SET supplier_id = canonical WHERE supplier_id = ANY(dupes);
  GET DIAGNOSTICS si_cnt = ROW_COUNT;

  DELETE FROM public.suppliers WHERE id = ANY(dupes);

  UPDATE public.customers SET company_name = 'JJ MES DMCC' WHERE id = customer_id;
  UPDATE public.suppliers SET linked_customer_id = customer_id WHERE id = canonical;
  UPDATE public.customers SET linked_supplier_id = canonical WHERE id = customer_id;

  UPDATE public.containers
    SET owner = 'JJ MES DMCC'
    WHERE lower(regexp_replace(coalesce(owner,''), '\s+', ' ', 'g')) IN ('jj mes','jjmes','jj mes dmcc','jjmes dmcc')
      AND owner <> 'JJ MES DMCC';
  GET DIAGNOSTICS c_cnt = ROW_COUNT;

  UPDATE public.container_sales
    SET original_owner = 'JJ MES DMCC'
    WHERE lower(regexp_replace(coalesce(original_owner,''), '\s+', ' ', 'g')) IN ('jj mes','jjmes','jj mes dmcc','jjmes dmcc')
      AND original_owner <> 'JJ MES DMCC';

  INSERT INTO public.finance_audit_log(organization_id, action, entity_type, entity_id, summary, after_data)
  VALUES (
    '6b29b65b-fa63-4dcf-9854-ede5c9a8320b',
    'merge_supplier_identity',
    'suppliers',
    canonical,
    to_jsonb('Merged JJ MES / JJMES / JJMES DMCC into JJ MES DMCC and linked customer counterpart'::text),
    jsonb_build_object(
      'kept_supplier_id', canonical,
      'removed_supplier_ids', to_jsonb(dupes),
      'linked_customer_id', customer_id,
      'canonical_name', 'JJ MES DMCC',
      'rows_repointed', jsonb_build_object(
        'purchase_orders', po_cnt,
        'vendor_payments', vp_cnt,
        'logistics_carriers', lc_cnt,
        'logistics_trip_costs', ltc_cnt,
        'supplier_invoices', si_cnt,
        'containers_owner_normalized', c_cnt
      )
    )
  );
END $$;
