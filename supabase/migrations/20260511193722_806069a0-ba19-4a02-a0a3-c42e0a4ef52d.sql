
-- Sections
CREATE TABLE public.quote_sections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_id uuid NOT NULL REFERENCES public.quotes(id) ON DELETE CASCADE,
  title text NOT NULL,
  kind text NOT NULL DEFAULT 'other',
  sort_order int NOT NULL DEFAULT 0,
  notes text,
  organization_id uuid NOT NULL DEFAULT current_org_id() REFERENCES public.organizations(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_quote_sections_quote_id ON public.quote_sections(quote_id);
CREATE INDEX idx_quote_sections_organization_id ON public.quote_sections(organization_id);

ALTER TABLE public.quote_sections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org members view quote_sections" ON public.quote_sections FOR SELECT
USING (is_platform_admin() OR (organization_id = current_org_id() AND (
  has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'yard_operator'::app_role)
  OR has_role(auth.uid(),'gate_clerk'::app_role) OR has_role(auth.uid(),'viewer'::app_role))));
CREATE POLICY "Org staff insert quote_sections" ON public.quote_sections FOR INSERT
WITH CHECK (organization_id = current_org_id() AND (
  has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'yard_operator'::app_role) OR has_role(auth.uid(),'gate_clerk'::app_role)));
CREATE POLICY "Org staff update quote_sections" ON public.quote_sections FOR UPDATE
USING (is_platform_admin() OR (organization_id = current_org_id() AND (
  has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'yard_operator'::app_role) OR has_role(auth.uid(),'gate_clerk'::app_role))));
CREATE POLICY "Org admins delete quote_sections" ON public.quote_sections FOR DELETE
USING (is_platform_admin() OR (organization_id = current_org_id() AND has_role(auth.uid(),'admin'::app_role)));

-- Extend quote_items
ALTER TABLE public.quote_items
  ADD COLUMN IF NOT EXISTS section_id uuid REFERENCES public.quote_sections(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS item_kind text NOT NULL DEFAULT 'custom',
  ADD COLUMN IF NOT EXISTS ref_table text,
  ADD COLUMN IF NOT EXISTS ref_id uuid,
  ADD COLUMN IF NOT EXISTS unit text,
  ADD COLUMN IF NOT EXISTS discount_pct numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS tax_pct numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS sort_order int NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_quote_items_section_id ON public.quote_items(section_id);

-- Recompute line total + quote grand total
CREATE OR REPLACE FUNCTION public.quote_items_recalc()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _qid uuid;
BEGIN
  IF (TG_OP = 'DELETE') THEN
    _qid := OLD.quote_id;
  ELSE
    NEW.total_price := round(COALESCE(NEW.quantity,0) * COALESCE(NEW.unit_price,0)
      * (1 - COALESCE(NEW.discount_pct,0)/100.0)
      * (1 + COALESCE(NEW.tax_pct,0)/100.0), 2);
    _qid := NEW.quote_id;
  END IF;

  -- defer parent recalc to AFTER trigger
  PERFORM 1;
  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END $$;

CREATE OR REPLACE FUNCTION public.quote_items_recalc_parent()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _qid uuid;
BEGIN
  _qid := COALESCE(NEW.quote_id, OLD.quote_id);
  UPDATE public.quotes q
     SET total_amount = COALESCE((SELECT SUM(total_price) FROM public.quote_items WHERE quote_id = _qid), 0)
   WHERE q.id = _qid;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS trg_quote_items_recalc ON public.quote_items;
CREATE TRIGGER trg_quote_items_recalc
BEFORE INSERT OR UPDATE ON public.quote_items
FOR EACH ROW EXECUTE FUNCTION public.quote_items_recalc();

DROP TRIGGER IF EXISTS trg_quote_items_recalc_parent ON public.quote_items;
CREATE TRIGGER trg_quote_items_recalc_parent
AFTER INSERT OR UPDATE OR DELETE ON public.quote_items
FOR EACH ROW EXECUTE FUNCTION public.quote_items_recalc_parent();
