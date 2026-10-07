
-- =========================================================
-- RFQs
-- =========================================================
CREATE TABLE public.rfqs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL DEFAULT current_org_id() REFERENCES public.organizations(id),
  rfq_number text NOT NULL,
  title text NOT NULL,
  status text NOT NULL DEFAULT 'draft',
  response_deadline date,
  notes text,
  currency text,
  awarded_supplier_id uuid REFERENCES public.suppliers(id),
  awarded_po_id uuid REFERENCES public.purchase_orders(id) ON DELETE SET NULL,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT rfqs_status_chk CHECK (status IN ('draft','sent','closed','awarded','cancelled')),
  CONSTRAINT rfqs_rfq_number_org_uniq UNIQUE (organization_id, rfq_number)
);
CREATE INDEX idx_rfqs_org ON public.rfqs(organization_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.rfqs TO authenticated;
GRANT ALL ON public.rfqs TO service_role;
ALTER TABLE public.rfqs ENABLE ROW LEVEL SECURITY;

CREATE POLICY rbac_select ON public.rfqs FOR SELECT USING (
  is_platform_admin() OR (organization_id = current_org_id() AND can_view_module(auth.uid(),'procurement'))
);
CREATE POLICY rbac_insert ON public.rfqs FOR INSERT WITH CHECK (
  is_platform_admin() OR (organization_id = current_org_id() AND can_write_module(auth.uid(),'procurement'))
);
CREATE POLICY rbac_update ON public.rfqs FOR UPDATE USING (
  is_platform_admin() OR (organization_id = current_org_id() AND can_write_module(auth.uid(),'procurement'))
);
CREATE POLICY rbac_delete ON public.rfqs FOR DELETE USING (
  is_platform_admin() OR (organization_id = current_org_id() AND has_role(auth.uid(),'admin'::app_role))
);

CREATE TRIGGER trg_rfqs_currency BEFORE INSERT ON public.rfqs
  FOR EACH ROW EXECUTE FUNCTION public.set_currency_from_org();

CREATE OR REPLACE FUNCTION public.rfqs_touch_updated_at()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END; $$;

CREATE TRIGGER trg_rfqs_updated_at BEFORE UPDATE ON public.rfqs
  FOR EACH ROW EXECUTE FUNCTION public.rfqs_touch_updated_at();

-- =========================================================
-- RFQ items
-- =========================================================
CREATE TABLE public.rfq_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL DEFAULT current_org_id() REFERENCES public.organizations(id),
  rfq_id uuid NOT NULL REFERENCES public.rfqs(id) ON DELETE CASCADE,
  material_id uuid REFERENCES public.materials(id),
  description text NOT NULL,
  quantity numeric NOT NULL DEFAULT 1,
  uom text,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_rfq_items_rfq ON public.rfq_items(rfq_id);
CREATE INDEX idx_rfq_items_org ON public.rfq_items(organization_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.rfq_items TO authenticated;
GRANT ALL ON public.rfq_items TO service_role;
ALTER TABLE public.rfq_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY rbac_select ON public.rfq_items FOR SELECT USING (
  is_platform_admin() OR (organization_id = current_org_id() AND can_view_module(auth.uid(),'procurement'))
);
CREATE POLICY rbac_insert ON public.rfq_items FOR INSERT WITH CHECK (
  is_platform_admin() OR (organization_id = current_org_id() AND can_write_module(auth.uid(),'procurement'))
);
CREATE POLICY rbac_update ON public.rfq_items FOR UPDATE USING (
  is_platform_admin() OR (organization_id = current_org_id() AND can_write_module(auth.uid(),'procurement'))
);
CREATE POLICY rbac_delete ON public.rfq_items FOR DELETE USING (
  is_platform_admin() OR (organization_id = current_org_id() AND can_write_module(auth.uid(),'procurement'))
);

-- =========================================================
-- RFQ suppliers
-- =========================================================
CREATE TABLE public.rfq_suppliers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL DEFAULT current_org_id() REFERENCES public.organizations(id),
  rfq_id uuid NOT NULL REFERENCES public.rfqs(id) ON DELETE CASCADE,
  supplier_id uuid NOT NULL REFERENCES public.suppliers(id),
  status text NOT NULL DEFAULT 'invited',
  sent_at timestamptz,
  token text NOT NULL DEFAULT encode(gen_random_bytes(16),'hex'),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT rfq_suppliers_status_chk CHECK (status IN ('invited','responded','declined')),
  CONSTRAINT rfq_suppliers_uniq UNIQUE (rfq_id, supplier_id)
);
CREATE INDEX idx_rfq_suppliers_rfq ON public.rfq_suppliers(rfq_id);
CREATE INDEX idx_rfq_suppliers_org ON public.rfq_suppliers(organization_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.rfq_suppliers TO authenticated;
GRANT ALL ON public.rfq_suppliers TO service_role;
ALTER TABLE public.rfq_suppliers ENABLE ROW LEVEL SECURITY;

CREATE POLICY rbac_select ON public.rfq_suppliers FOR SELECT USING (
  is_platform_admin() OR (organization_id = current_org_id() AND can_view_module(auth.uid(),'procurement'))
);
CREATE POLICY rbac_insert ON public.rfq_suppliers FOR INSERT WITH CHECK (
  is_platform_admin() OR (organization_id = current_org_id() AND can_write_module(auth.uid(),'procurement'))
);
CREATE POLICY rbac_update ON public.rfq_suppliers FOR UPDATE USING (
  is_platform_admin() OR (organization_id = current_org_id() AND can_write_module(auth.uid(),'procurement'))
);
CREATE POLICY rbac_delete ON public.rfq_suppliers FOR DELETE USING (
  is_platform_admin() OR (organization_id = current_org_id() AND can_write_module(auth.uid(),'procurement'))
);

-- =========================================================
-- Supplier quoted prices per item
-- =========================================================
CREATE TABLE public.rfq_supplier_quotes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL DEFAULT current_org_id() REFERENCES public.organizations(id),
  rfq_supplier_id uuid NOT NULL REFERENCES public.rfq_suppliers(id) ON DELETE CASCADE,
  rfq_item_id uuid NOT NULL REFERENCES public.rfq_items(id) ON DELETE CASCADE,
  unit_price numeric NOT NULL DEFAULT 0,
  lead_time_days integer,
  currency text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT rfq_supplier_quotes_uniq UNIQUE (rfq_supplier_id, rfq_item_id)
);
CREATE INDEX idx_rfq_sq_supplier ON public.rfq_supplier_quotes(rfq_supplier_id);
CREATE INDEX idx_rfq_sq_org ON public.rfq_supplier_quotes(organization_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.rfq_supplier_quotes TO authenticated;
GRANT ALL ON public.rfq_supplier_quotes TO service_role;
ALTER TABLE public.rfq_supplier_quotes ENABLE ROW LEVEL SECURITY;

CREATE POLICY rbac_select ON public.rfq_supplier_quotes FOR SELECT USING (
  is_platform_admin() OR (organization_id = current_org_id() AND can_view_module(auth.uid(),'procurement'))
);
CREATE POLICY rbac_insert ON public.rfq_supplier_quotes FOR INSERT WITH CHECK (
  is_platform_admin() OR (organization_id = current_org_id() AND can_write_module(auth.uid(),'procurement'))
);
CREATE POLICY rbac_update ON public.rfq_supplier_quotes FOR UPDATE USING (
  is_platform_admin() OR (organization_id = current_org_id() AND can_write_module(auth.uid(),'procurement'))
);
CREATE POLICY rbac_delete ON public.rfq_supplier_quotes FOR DELETE USING (
  is_platform_admin() OR (organization_id = current_org_id() AND can_write_module(auth.uid(),'procurement'))
);

CREATE TRIGGER trg_rfq_sq_currency BEFORE INSERT ON public.rfq_supplier_quotes
  FOR EACH ROW EXECUTE FUNCTION public.set_currency_from_org();

CREATE OR REPLACE FUNCTION public.rfq_sq_touch_updated_at()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END; $$;

CREATE TRIGGER trg_rfq_sq_updated_at BEFORE UPDATE ON public.rfq_supplier_quotes
  FOR EACH ROW EXECUTE FUNCTION public.rfq_sq_touch_updated_at();

-- =========================================================
-- Numbering helper
-- =========================================================
CREATE OR REPLACE FUNCTION public.next_rfq_number(_org uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_year text := to_char(now(),'YYYY');
  v_seq int;
BEGIN
  SELECT COALESCE(MAX((regexp_match(rfq_number, 'RFQ-' || v_year || '-(\d+)'))[1]::int), 0) + 1
    INTO v_seq
  FROM public.rfqs
  WHERE organization_id = _org
    AND rfq_number LIKE 'RFQ-' || v_year || '-%';
  RETURN 'RFQ-' || v_year || '-' || lpad(v_seq::text, 4, '0');
END; $$;
REVOKE EXECUTE ON FUNCTION public.next_rfq_number(uuid) FROM PUBLIC;

-- =========================================================
-- Create RFQ (atomic)
-- =========================================================
CREATE OR REPLACE FUNCTION public.create_rfq(_payload jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_org uuid := current_org_id();
  v_rfq_id uuid;
  v_item jsonb;
  v_sup jsonb;
BEGIN
  IF NOT (is_platform_admin() OR can_write_module(auth.uid(),'procurement')) THEN
    RAISE EXCEPTION 'permission denied for procurement';
  END IF;
  IF v_org IS NULL THEN RAISE EXCEPTION 'no organization context'; END IF;

  INSERT INTO public.rfqs (organization_id, rfq_number, title, response_deadline, notes, created_by)
  VALUES (
    v_org,
    public.next_rfq_number(v_org),
    COALESCE(NULLIF(_payload->>'title',''),'Untitled RFQ'),
    NULLIF(_payload->>'response_deadline','')::date,
    NULLIF(_payload->>'notes',''),
    auth.uid()
  ) RETURNING id INTO v_rfq_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(COALESCE(_payload->'items','[]'::jsonb)) LOOP
    INSERT INTO public.rfq_items (organization_id, rfq_id, material_id, description, quantity, uom, sort_order)
    VALUES (
      v_org, v_rfq_id,
      NULLIF(v_item->>'material_id','')::uuid,
      COALESCE(NULLIF(v_item->>'description',''),'Item'),
      COALESCE((v_item->>'quantity')::numeric, 1),
      NULLIF(v_item->>'uom',''),
      COALESCE((v_item->>'sort_order')::int, 0)
    );
  END LOOP;

  FOR v_sup IN SELECT * FROM jsonb_array_elements(COALESCE(_payload->'suppliers','[]'::jsonb)) LOOP
    INSERT INTO public.rfq_suppliers (organization_id, rfq_id, supplier_id)
    VALUES (v_org, v_rfq_id, (v_sup->>'supplier_id')::uuid)
    ON CONFLICT (rfq_id, supplier_id) DO NOTHING;
  END LOOP;

  RETURN v_rfq_id;
END; $$;
REVOKE EXECUTE ON FUNCTION public.create_rfq(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_rfq(jsonb) TO authenticated;

-- =========================================================
-- Record supplier quote (upsert per item)
-- =========================================================
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

  UPDATE public.rfq_suppliers SET status = 'responded' WHERE id = _rfq_supplier_id;
END; $$;
REVOKE EXECUTE ON FUNCTION public.record_supplier_quote(uuid, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_supplier_quote(uuid, jsonb) TO authenticated;

-- =========================================================
-- Award RFQ -> creates a PO for the winning supplier
-- =========================================================
CREATE OR REPLACE FUNCTION public.award_rfq(_rfq_id uuid, _supplier_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_org uuid := current_org_id();
  v_rfq public.rfqs%ROWTYPE;
  v_rs public.rfq_suppliers%ROWTYPE;
  v_po_id uuid;
  v_po_num text;
  v_year text := to_char(now(),'YYYY');
  v_seq int;
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
    organization_id, po_number, supplier_id, status, order_date, created_by
  ) VALUES (
    v_org, v_po_num, _supplier_id, 'draft', CURRENT_DATE, auth.uid()
  ) RETURNING id INTO v_po_id;

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

  UPDATE public.rfqs
     SET status = 'awarded',
         awarded_supplier_id = _supplier_id,
         awarded_po_id = v_po_id
   WHERE id = _rfq_id;

  RETURN v_po_id;
END; $$;
REVOKE EXECUTE ON FUNCTION public.award_rfq(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.award_rfq(uuid, uuid) TO authenticated;
