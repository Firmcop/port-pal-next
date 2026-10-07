
-- 1. Extend rfq_suppliers with invitation tracking
ALTER TABLE public.rfq_suppliers DROP CONSTRAINT IF EXISTS rfq_suppliers_status_chk;
ALTER TABLE public.rfq_suppliers ADD CONSTRAINT rfq_suppliers_status_chk
  CHECK (status IN ('invited','accepted','declined','responded','no_response'));
ALTER TABLE public.rfq_suppliers
  ADD COLUMN IF NOT EXISTS invited_at timestamptz,
  ADD COLUMN IF NOT EXISTS responded_at timestamptz,
  ADD COLUMN IF NOT EXISTS decline_reason text,
  ADD COLUMN IF NOT EXISTS invite_channel text,
  ADD COLUMN IF NOT EXISTS last_reminder_at timestamptz;

-- 2. rfq_items specification and part number
ALTER TABLE public.rfq_items
  ADD COLUMN IF NOT EXISTS specification text,
  ADD COLUMN IF NOT EXISTS part_number text;

-- 3. Attachments table
CREATE TABLE IF NOT EXISTS public.rfq_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL DEFAULT current_org_id(),
  rfq_id uuid NOT NULL REFERENCES public.rfqs(id) ON DELETE CASCADE,
  rfq_item_id uuid REFERENCES public.rfq_items(id) ON DELETE CASCADE,
  file_path text NOT NULL,
  file_name text NOT NULL,
  content_type text,
  size_bytes bigint,
  label text,
  uploaded_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_rfq_attachments_rfq ON public.rfq_attachments(rfq_id);
CREATE INDEX IF NOT EXISTS idx_rfq_attachments_org ON public.rfq_attachments(organization_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.rfq_attachments TO authenticated;
GRANT ALL ON public.rfq_attachments TO service_role;
ALTER TABLE public.rfq_attachments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS rbac_select ON public.rfq_attachments;
CREATE POLICY rbac_select ON public.rfq_attachments FOR SELECT USING (
  organization_id = current_org_id() AND (is_platform_admin() OR can_view_module(auth.uid(),'procurement'))
);
DROP POLICY IF EXISTS rbac_insert ON public.rfq_attachments;
CREATE POLICY rbac_insert ON public.rfq_attachments FOR INSERT WITH CHECK (
  organization_id = current_org_id() AND (is_platform_admin() OR can_write_module(auth.uid(),'procurement'))
);
DROP POLICY IF EXISTS rbac_delete ON public.rfq_attachments;
CREATE POLICY rbac_delete ON public.rfq_attachments FOR DELETE USING (
  organization_id = current_org_id() AND (is_platform_admin() OR can_write_module(auth.uid(),'procurement'))
);

-- 4. Invitation RPCs
CREATE OR REPLACE FUNCTION public.mark_supplier_invitation(_rfq_supplier_id uuid, _status text, _reason text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_org uuid := current_org_id();
  v_rs public.rfq_suppliers%ROWTYPE;
BEGIN
  IF NOT (is_platform_admin() OR can_write_module(auth.uid(),'procurement')) THEN
    RAISE EXCEPTION 'permission denied for procurement';
  END IF;
  IF _status NOT IN ('invited','accepted','declined','responded','no_response') THEN
    RAISE EXCEPTION 'invalid status: %', _status;
  END IF;
  SELECT * INTO v_rs FROM public.rfq_suppliers WHERE id = _rfq_supplier_id;
  IF NOT FOUND OR v_rs.organization_id <> v_org THEN
    RAISE EXCEPTION 'rfq supplier not found';
  END IF;

  UPDATE public.rfq_suppliers
     SET status = _status,
         decline_reason = CASE WHEN _status = 'declined' THEN _reason ELSE decline_reason END,
         responded_at = CASE WHEN _status IN ('accepted','declined','responded') THEN COALESCE(responded_at, now()) ELSE responded_at END
   WHERE id = _rfq_supplier_id;
END; $$;
REVOKE EXECUTE ON FUNCTION public.mark_supplier_invitation(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mark_supplier_invitation(uuid, text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.resend_supplier_invitation(_rfq_supplier_id uuid, _channel text DEFAULT 'manual')
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_org uuid := current_org_id();
BEGIN
  IF NOT (is_platform_admin() OR can_write_module(auth.uid(),'procurement')) THEN
    RAISE EXCEPTION 'permission denied for procurement';
  END IF;
  UPDATE public.rfq_suppliers
     SET last_reminder_at = now(),
         invite_channel = COALESCE(_channel, invite_channel),
         invited_at = COALESCE(invited_at, now())
   WHERE id = _rfq_supplier_id AND organization_id = v_org;
  IF NOT FOUND THEN RAISE EXCEPTION 'rfq supplier not found'; END IF;
END; $$;
REVOKE EXECUTE ON FUNCTION public.resend_supplier_invitation(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resend_supplier_invitation(uuid, text) TO authenticated;

-- 5. Award with overrides
DROP FUNCTION IF EXISTS public.award_rfq(uuid, uuid);
CREATE OR REPLACE FUNCTION public.award_rfq(_rfq_id uuid, _supplier_id uuid, _overrides jsonb DEFAULT '{}'::jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_org uuid := current_org_id();
  v_rfq public.rfqs%ROWTYPE;
  v_rs public.rfq_suppliers%ROWTYPE;
  v_po_id uuid;
  v_po_num text;
  v_year text := to_char(now(),'YYYY');
  v_seq int;
  v_lines jsonb := COALESCE(_overrides->'lines','[]'::jsonb);
  v_freight numeric := COALESCE((_overrides->>'freight_amount')::numeric, 0);
  v_other numeric := COALESCE((_overrides->>'other_charges_amount')::numeric, 0);
  v_incl boolean := COALESCE((_overrides->>'prices_include_tax')::boolean, false);
  v_use_overrides boolean := jsonb_array_length(v_lines) > 0;
BEGIN
  IF NOT (is_platform_admin() OR can_write_module(auth.uid(),'procurement')) THEN
    RAISE EXCEPTION 'permission denied for procurement';
  END IF;

  SELECT * INTO v_rfq FROM public.rfqs WHERE id = _rfq_id;
  IF NOT FOUND OR v_rfq.organization_id <> v_org THEN
    RAISE EXCEPTION 'rfq not found';
  END IF;
  IF v_rfq.status = 'awarded' AND v_rfq.awarded_po_id IS NOT NULL THEN
    RETURN v_rfq.awarded_po_id;
  END IF;

  SELECT * INTO v_rs FROM public.rfq_suppliers
   WHERE rfq_id = _rfq_id AND supplier_id = _supplier_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'supplier not invited to this RFQ'; END IF;

  SELECT COALESCE(MAX((regexp_match(po_number, '^PO-' || v_year || '-(\d+)$'))[1]::int), 0) + 1
    INTO v_seq
  FROM public.purchase_orders
  WHERE organization_id = v_org
    AND po_number ~ ('^PO-' || v_year || '-\d+$');
  v_po_num := 'PO-' || v_year || '-' || lpad(v_seq::text, 4, '0');

  INSERT INTO public.purchase_orders (
    organization_id, po_number, supplier_id, status, order_date, created_by,
    freight_amount, other_charges_amount, prices_include_tax
  ) VALUES (
    v_org, v_po_num, _supplier_id, 'draft', CURRENT_DATE, auth.uid(),
    v_freight, v_other, v_incl
  ) RETURNING id INTO v_po_id;

  IF v_use_overrides THEN
    INSERT INTO public.po_items (
      organization_id, po_id, material_id, description, quantity, unit_price, tax_rate, is_vatable
    )
    SELECT
      v_org, v_po_id,
      NULLIF(l->>'material_id','')::uuid,
      COALESCE(l->>'description',''),
      COALESCE((l->>'quantity')::numeric, 0),
      COALESCE((l->>'unit_price')::numeric, 0),
      COALESCE((l->>'tax_rate')::numeric, 0),
      COALESCE((l->>'is_vatable')::boolean, (COALESCE((l->>'tax_rate')::numeric,0) > 0))
    FROM jsonb_array_elements(v_lines) AS l;
  ELSE
    INSERT INTO public.po_items (
      organization_id, po_id, material_id, description, quantity, unit_price
    )
    SELECT
      v_org, v_po_id, i.material_id, i.description, i.quantity,
      COALESCE(q.unit_price, 0)
    FROM public.rfq_items i
    LEFT JOIN public.rfq_supplier_quotes q
      ON q.rfq_item_id = i.id AND q.rfq_supplier_id = v_rs.id
    WHERE i.rfq_id = _rfq_id
    ORDER BY i.sort_order, i.created_at;
  END IF;

  UPDATE public.rfqs
     SET status = 'awarded',
         awarded_supplier_id = _supplier_id,
         awarded_po_id = v_po_id
   WHERE id = _rfq_id;

  RETURN v_po_id;
END; $$;
REVOKE EXECUTE ON FUNCTION public.award_rfq(uuid, uuid, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.award_rfq(uuid, uuid, jsonb) TO authenticated;

-- 6. Storage policies for rfq-attachments bucket
DROP POLICY IF EXISTS "rfq_attachments_read" ON storage.objects;
CREATE POLICY "rfq_attachments_read" ON storage.objects FOR SELECT
USING (
  bucket_id = 'rfq-attachments'
  AND (
    is_platform_admin()
    OR (
      (storage.foldername(name))[1]::uuid = current_org_id()
      AND can_view_module(auth.uid(),'procurement')
    )
  )
);
DROP POLICY IF EXISTS "rfq_attachments_write" ON storage.objects;
CREATE POLICY "rfq_attachments_write" ON storage.objects FOR INSERT
WITH CHECK (
  bucket_id = 'rfq-attachments'
  AND (storage.foldername(name))[1]::uuid = current_org_id()
  AND (is_platform_admin() OR can_write_module(auth.uid(),'procurement'))
);
DROP POLICY IF EXISTS "rfq_attachments_delete" ON storage.objects;
CREATE POLICY "rfq_attachments_delete" ON storage.objects FOR DELETE
USING (
  bucket_id = 'rfq-attachments'
  AND (storage.foldername(name))[1]::uuid = current_org_id()
  AND (is_platform_admin() OR can_write_module(auth.uid(),'procurement'))
);

-- 7. record_supplier_quote also sets responded_at
CREATE OR REPLACE FUNCTION public.record_supplier_quote(_rfq_supplier_id uuid, _quotes jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_org uuid := current_org_id();
  v_rs public.rfq_suppliers%ROWTYPE;
  v_q jsonb;
BEGIN
  IF NOT (is_platform_admin() OR can_write_module(auth.uid(),'procurement')) THEN
    RAISE EXCEPTION 'permission denied for procurement';
  END IF;
  SELECT * INTO v_rs FROM public.rfq_suppliers WHERE id = _rfq_supplier_id;
  IF NOT FOUND OR v_rs.organization_id <> v_org THEN
    RAISE EXCEPTION 'rfq supplier not found';
  END IF;
  FOR v_q IN SELECT * FROM jsonb_array_elements(COALESCE(_quotes,'[]'::jsonb)) LOOP
    INSERT INTO public.rfq_supplier_quotes (
      organization_id, rfq_supplier_id, rfq_item_id, unit_price, lead_time_days, notes
    ) VALUES (
      v_org, _rfq_supplier_id,
      (v_q->>'rfq_item_id')::uuid,
      COALESCE((v_q->>'unit_price')::numeric, 0),
      NULLIF(v_q->>'lead_time_days','')::int,
      NULLIF(v_q->>'notes','')
    )
    ON CONFLICT (rfq_supplier_id, rfq_item_id)
    DO UPDATE SET
      unit_price = EXCLUDED.unit_price,
      lead_time_days = EXCLUDED.lead_time_days,
      notes = EXCLUDED.notes,
      updated_at = now();
  END LOOP;
  UPDATE public.rfq_suppliers
     SET status = 'responded',
         responded_at = COALESCE(responded_at, now())
   WHERE id = _rfq_supplier_id;
END; $$;
REVOKE EXECUTE ON FUNCTION public.record_supplier_quote(uuid, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_supplier_quote(uuid, jsonb) TO authenticated;

-- 8. create_rfq stamps invited_at and channel, saves spec/part_number
CREATE OR REPLACE FUNCTION public.create_rfq(_payload jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_org uuid := current_org_id();
  v_id uuid;
  v_num text;
  v_year text := to_char(now(),'YYYY');
  v_seq int;
  v_item jsonb;
  v_sup jsonb;
BEGIN
  IF NOT (is_platform_admin() OR can_write_module(auth.uid(),'procurement')) THEN
    RAISE EXCEPTION 'permission denied for procurement';
  END IF;

  SELECT COALESCE(MAX((regexp_match(rfq_number, '^RFQ-' || v_year || '-(\d+)$'))[1]::int), 0) + 1
    INTO v_seq
  FROM public.rfqs
  WHERE organization_id = v_org
    AND rfq_number ~ ('^RFQ-' || v_year || '-\d+$');
  v_num := 'RFQ-' || v_year || '-' || lpad(v_seq::text, 4, '0');

  INSERT INTO public.rfqs (organization_id, rfq_number, title, response_deadline, notes, created_by, status)
  VALUES (
    v_org, v_num,
    COALESCE(_payload->>'title','Untitled RFQ'),
    NULLIF(_payload->>'response_deadline','')::date,
    NULLIF(_payload->>'notes',''),
    auth.uid(),
    'draft'
  ) RETURNING id INTO v_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(COALESCE(_payload->'items','[]'::jsonb)) LOOP
    INSERT INTO public.rfq_items (
      organization_id, rfq_id, material_id, description, quantity, uom, sort_order, specification, part_number
    ) VALUES (
      v_org, v_id,
      NULLIF(v_item->>'material_id','')::uuid,
      COALESCE(v_item->>'description',''),
      COALESCE((v_item->>'quantity')::numeric, 1),
      NULLIF(v_item->>'uom',''),
      COALESCE((v_item->>'sort_order')::int, 0),
      NULLIF(v_item->>'specification',''),
      NULLIF(v_item->>'part_number','')
    );
  END LOOP;

  FOR v_sup IN SELECT * FROM jsonb_array_elements(COALESCE(_payload->'suppliers','[]'::jsonb)) LOOP
    INSERT INTO public.rfq_suppliers (
      organization_id, rfq_id, supplier_id, status, invited_at, invite_channel
    ) VALUES (
      v_org, v_id,
      (v_sup->>'supplier_id')::uuid,
      'invited',
      now(),
      COALESCE(v_sup->>'invite_channel','manual')
    ) ON CONFLICT (rfq_id, supplier_id) DO NOTHING;
  END LOOP;

  RETURN v_id;
END; $$;
REVOKE EXECUTE ON FUNCTION public.create_rfq(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_rfq(jsonb) TO authenticated;
