
-- Approval columns
ALTER TABLE public.quotes
  ADD COLUMN IF NOT EXISTS submitted_at timestamptz,
  ADD COLUMN IF NOT EXISTS submitted_by uuid,
  ADD COLUMN IF NOT EXISTS approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS approved_by uuid,
  ADD COLUMN IF NOT EXISTS rejection_reason text;

-- Versions
CREATE TABLE IF NOT EXISTS public.quote_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_id uuid NOT NULL REFERENCES public.quotes(id) ON DELETE CASCADE,
  version_no int NOT NULL,
  event text NOT NULL,
  snapshot jsonb NOT NULL,
  total_amount numeric NOT NULL DEFAULT 0,
  note text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  organization_id uuid NOT NULL DEFAULT current_org_id() REFERENCES public.organizations(id),
  UNIQUE (quote_id, version_no)
);
CREATE INDEX IF NOT EXISTS idx_quote_versions_quote_id ON public.quote_versions(quote_id, version_no DESC);
CREATE INDEX IF NOT EXISTS idx_quote_versions_org ON public.quote_versions(organization_id);

ALTER TABLE public.quote_versions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Org members view quote_versions" ON public.quote_versions FOR SELECT
USING (is_platform_admin() OR (organization_id = current_org_id() AND (
  has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'yard_operator'::app_role)
  OR has_role(auth.uid(),'gate_clerk'::app_role) OR has_role(auth.uid(),'viewer'::app_role))));
CREATE POLICY "Org staff insert quote_versions" ON public.quote_versions FOR INSERT
WITH CHECK (organization_id = current_org_id() AND (
  has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'yard_operator'::app_role) OR has_role(auth.uid(),'gate_clerk'::app_role)));

-- Service catalog
CREATE TABLE IF NOT EXISTS public.quote_service_catalog (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  category text NOT NULL DEFAULT 'service',
  unit text NOT NULL DEFAULT 'unit',
  default_price numeric NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  organization_id uuid NOT NULL DEFAULT current_org_id() REFERENCES public.organizations(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, name)
);
CREATE INDEX IF NOT EXISTS idx_quote_service_catalog_org ON public.quote_service_catalog(organization_id);

ALTER TABLE public.quote_service_catalog ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Org members view services" ON public.quote_service_catalog FOR SELECT
USING (is_platform_admin() OR (organization_id = current_org_id() AND (
  has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'yard_operator'::app_role)
  OR has_role(auth.uid(),'gate_clerk'::app_role) OR has_role(auth.uid(),'viewer'::app_role))));
CREATE POLICY "Org staff manage services" ON public.quote_service_catalog FOR ALL
USING (is_platform_admin() OR (organization_id = current_org_id() AND (
  has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'yard_operator'::app_role))))
WITH CHECK (organization_id = current_org_id() AND (
  has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'yard_operator'::app_role)));

-- Snapshot helper
CREATE OR REPLACE FUNCTION public.snapshot_quote(_id uuid, _event text, _note text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _q record;
  _next_no int;
  _snap jsonb;
  _vid uuid;
BEGIN
  SELECT * INTO _q FROM public.quotes WHERE id = _id;
  IF NOT FOUND THEN RAISE EXCEPTION 'quote_not_found'; END IF;

  SELECT COALESCE(MAX(version_no),0) + 1 INTO _next_no FROM public.quote_versions WHERE quote_id = _id;

  SELECT jsonb_build_object(
    'header', to_jsonb(_q),
    'sections', COALESCE((SELECT jsonb_agg(to_jsonb(s) ORDER BY s.sort_order, s.created_at)
                          FROM public.quote_sections s WHERE s.quote_id = _id), '[]'::jsonb),
    'items', COALESCE((SELECT jsonb_agg(to_jsonb(i) ORDER BY i.section_id, i.sort_order, i.created_at)
                       FROM public.quote_items i WHERE i.quote_id = _id), '[]'::jsonb)
  ) INTO _snap;

  INSERT INTO public.quote_versions (quote_id, version_no, event, snapshot, total_amount, note, created_by, organization_id)
  VALUES (_id, _next_no, _event, _snap, COALESCE(_q.total_amount,0), _note, auth.uid(), _q.organization_id)
  RETURNING id INTO _vid;
  RETURN _vid;
END $$;

-- Submit for approval
CREATE OR REPLACE FUNCTION public.request_quote_approval(_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _q record; _admin record;
BEGIN
  SELECT * INTO _q FROM public.quotes WHERE id = _id;
  IF NOT FOUND THEN RAISE EXCEPTION 'quote_not_found'; END IF;
  IF _q.status NOT IN ('draft','rejected') THEN
    RAISE EXCEPTION 'invalid_status_for_submit';
  END IF;

  UPDATE public.quotes
     SET status = 'pending_approval',
         submitted_at = now(),
         submitted_by = auth.uid(),
         rejection_reason = NULL
   WHERE id = _id;

  PERFORM public.snapshot_quote(_id, 'submitted', 'Submitted for approval');

  -- Notify org admins / owners
  FOR _admin IN
    SELECT user_id FROM public.organization_members
     WHERE organization_id = _q.organization_id
       AND status = 'active'
       AND role IN ('org_owner','admin')
  LOOP
    INSERT INTO public.notifications (user_id, title, message, type, reference_id, reference_type, organization_id)
    VALUES (_admin.user_id,
            'Quote awaiting approval',
            COALESCE(_q.quote_number,'Quote') || ' has been submitted and needs your approval.',
            'info', _id, 'quote', _q.organization_id);
  END LOOP;

  INSERT INTO public.org_lifecycle_events (organization_id, event_type, actor_user_id, details)
  VALUES (_q.organization_id, 'quote_submitted', auth.uid(), jsonb_build_object('quote_id', _id, 'quote_number', _q.quote_number, 'total_amount', _q.total_amount));
END $$;

-- Approve
CREATE OR REPLACE FUNCTION public.approve_quote(_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _q record;
BEGIN
  IF NOT (has_role(auth.uid(),'admin'::app_role) OR is_platform_admin()) THEN
    RAISE EXCEPTION 'only_admins_can_approve';
  END IF;
  SELECT * INTO _q FROM public.quotes WHERE id = _id;
  IF NOT FOUND THEN RAISE EXCEPTION 'quote_not_found'; END IF;
  IF _q.status <> 'pending_approval' THEN RAISE EXCEPTION 'not_pending_approval'; END IF;

  UPDATE public.quotes SET status='approved', approved_at=now(), approved_by=auth.uid() WHERE id=_id;
  PERFORM public.snapshot_quote(_id, 'approved', 'Approved');

  INSERT INTO public.org_lifecycle_events (organization_id, event_type, actor_user_id, details)
  VALUES (_q.organization_id, 'quote_approved', auth.uid(), jsonb_build_object('quote_id', _id, 'quote_number', _q.quote_number));

  IF _q.submitted_by IS NOT NULL THEN
    INSERT INTO public.notifications (user_id, title, message, type, reference_id, reference_type, organization_id)
    VALUES (_q.submitted_by, 'Quote approved', COALESCE(_q.quote_number,'Quote') || ' has been approved.', 'success', _id, 'quote', _q.organization_id);
  END IF;
END $$;

-- Reject
CREATE OR REPLACE FUNCTION public.reject_quote(_id uuid, _reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _q record;
BEGIN
  IF NOT (has_role(auth.uid(),'admin'::app_role) OR is_platform_admin()) THEN
    RAISE EXCEPTION 'only_admins_can_reject';
  END IF;
  SELECT * INTO _q FROM public.quotes WHERE id = _id;
  IF NOT FOUND THEN RAISE EXCEPTION 'quote_not_found'; END IF;
  IF _q.status <> 'pending_approval' THEN RAISE EXCEPTION 'not_pending_approval'; END IF;

  UPDATE public.quotes SET status='rejected', rejection_reason=_reason WHERE id=_id;
  PERFORM public.snapshot_quote(_id, 'rejected', _reason);

  INSERT INTO public.org_lifecycle_events (organization_id, event_type, actor_user_id, details)
  VALUES (_q.organization_id, 'quote_rejected', auth.uid(), jsonb_build_object('quote_id', _id, 'reason', _reason));

  IF _q.submitted_by IS NOT NULL THEN
    INSERT INTO public.notifications (user_id, title, message, type, reference_id, reference_type, organization_id)
    VALUES (_q.submitted_by, 'Quote rejected', COALESCE(_q.quote_number,'Quote') || ' was rejected: ' || COALESCE(_reason,'no reason'), 'warning', _id, 'quote', _q.organization_id);
  END IF;
END $$;

-- Bulk add items from catalog picker
CREATE OR REPLACE FUNCTION public.bulk_add_quote_items(_quote_id uuid, _section_id uuid, _items jsonb)
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _it jsonb; _added int := 0; _q record; _max_sort int;
BEGIN
  SELECT * INTO _q FROM public.quotes WHERE id = _quote_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'quote_not_found'; END IF;
  IF _q.status <> 'draft' THEN RAISE EXCEPTION 'quote_not_editable'; END IF;

  SELECT COALESCE(MAX(sort_order),0) INTO _max_sort FROM public.quote_items WHERE section_id = _section_id;

  FOR _it IN SELECT * FROM jsonb_array_elements(_items)
  LOOP
    _max_sort := _max_sort + 10;
    INSERT INTO public.quote_items (
      quote_id, section_id, item_type, item_kind, ref_table, ref_id,
      description, unit, quantity, unit_price, discount_pct, tax_pct, sort_order, organization_id
    ) VALUES (
      _quote_id, _section_id,
      COALESCE(_it->>'item_type','custom'),
      COALESCE(_it->>'item_kind','custom'),
      _it->>'ref_table',
      NULLIF(_it->>'ref_id','')::uuid,
      COALESCE(_it->>'description',''),
      _it->>'unit',
      COALESCE((_it->>'quantity')::numeric, 1),
      COALESCE((_it->>'unit_price')::numeric, 0),
      COALESCE((_it->>'discount_pct')::numeric, 0),
      COALESCE((_it->>'tax_pct')::numeric, 0),
      _max_sort,
      _q.organization_id
    );
    _added := _added + 1;
  END LOOP;
  RETURN _added;
END $$;
