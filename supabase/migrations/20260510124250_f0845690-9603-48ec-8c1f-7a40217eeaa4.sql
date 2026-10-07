
-- ============================================================
-- Conversion jobs: splits, finished products, sub-assemblies,
-- material movements & variance tracking
-- ============================================================

-- 1) Enums
DO $$ BEGIN
  CREATE TYPE public.conversion_job_kind AS ENUM ('split','product','sub_assembly');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.finished_product_status AS ENUM ('in_production','in_stock','reserved','sold','leased','scrapped');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.material_movement_type AS ENUM ('receipt','issue','return','adjustment','scrap');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.assembly_type AS ENUM ('door','window_frame','panel','electrical_kit','plumbing_kit','insulation_pack','other');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Add 'converted' to container_status if missing
DO $$ BEGIN
  ALTER TYPE public.container_status ADD VALUE IF NOT EXISTS 'converted';
EXCEPTION WHEN others THEN NULL; END $$;

-- 2) Extend container_conversions
ALTER TABLE public.container_conversions
  ADD COLUMN IF NOT EXISTS job_kind public.conversion_job_kind NOT NULL DEFAULT 'product',
  ADD COLUMN IF NOT EXISTS assembly_type public.assembly_type,
  ADD COLUMN IF NOT EXISTS unit_of_measure text,
  ADD COLUMN IF NOT EXISTS qty_produced numeric NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS unit_cost numeric NOT NULL DEFAULT 0;

-- 3) Extend containers
ALTER TABLE public.containers
  ADD COLUMN IF NOT EXISTS parent_container_id uuid REFERENCES public.containers(id),
  ADD COLUMN IF NOT EXISTS acquisition_cost numeric NOT NULL DEFAULT 0;

-- 4) Extend materials with stock fields
ALTER TABLE public.materials
  ADD COLUMN IF NOT EXISTS on_hand_qty numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS avg_unit_cost numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS reorder_point numeric NOT NULL DEFAULT 0;

-- 5) conversion_outputs (planned children for split jobs)
CREATE TABLE IF NOT EXISTS public.conversion_outputs (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  conversion_id uuid NOT NULL REFERENCES public.container_conversions(id) ON DELETE CASCADE,
  size public.container_size NOT NULL,
  category public.container_category NOT NULL,
  height_class public.container_height_class,
  planned_count integer NOT NULL DEFAULT 1,
  number_prefix text,
  target_owner text,
  notes text,
  organization_id uuid NOT NULL DEFAULT current_org_id(),
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.conversion_outputs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "co_select" ON public.conversion_outputs FOR SELECT TO authenticated
  USING (organization_id = current_org_id() OR is_platform_admin());
CREATE POLICY "co_write" ON public.conversion_outputs FOR ALL TO authenticated
  USING (organization_id = current_org_id() OR is_platform_admin())
  WITH CHECK (organization_id = current_org_id() OR is_platform_admin());

-- 6) finished_products
CREATE TABLE IF NOT EXISTS public.finished_products (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  product_number text NOT NULL UNIQUE,
  product_type public.conversion_product_type NOT NULL DEFAULT 'other',
  serial_no text,
  name text,
  description text,
  source_conversion_id uuid REFERENCES public.container_conversions(id),
  source_container_id uuid REFERENCES public.containers(id),
  total_cost numeric NOT NULL DEFAULT 0,
  list_price numeric NOT NULL DEFAULT 0,
  status public.finished_product_status NOT NULL DEFAULT 'in_stock',
  customer_id uuid REFERENCES public.customers(id),
  sales_order_id uuid REFERENCES public.sales_orders(id),
  lease_id uuid,
  photos jsonb NOT NULL DEFAULT '[]'::jsonb,
  dimensions jsonb,
  location text,
  notes text,
  organization_id uuid NOT NULL DEFAULT current_org_id(),
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.finished_products ENABLE ROW LEVEL SECURITY;
CREATE POLICY "fp_select" ON public.finished_products FOR SELECT TO authenticated
  USING (organization_id = current_org_id() OR is_platform_admin());
CREATE POLICY "fp_write" ON public.finished_products FOR ALL TO authenticated
  USING (organization_id = current_org_id() OR is_platform_admin())
  WITH CHECK (organization_id = current_org_id() OR is_platform_admin());
CREATE TRIGGER trg_fp_updated BEFORE UPDATE ON public.finished_products
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 7) sub_assembly_stock (one per SKU)
CREATE TABLE IF NOT EXISTS public.sub_assembly_stock (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  assembly_type public.assembly_type NOT NULL,
  name text NOT NULL,
  uom text NOT NULL DEFAULT 'pcs',
  on_hand_qty numeric NOT NULL DEFAULT 0,
  avg_unit_cost numeric NOT NULL DEFAULT 0,
  reorder_point numeric NOT NULL DEFAULT 0,
  notes text,
  organization_id uuid NOT NULL DEFAULT current_org_id(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, assembly_type, name)
);
ALTER TABLE public.sub_assembly_stock ENABLE ROW LEVEL SECURITY;
CREATE POLICY "sas_select" ON public.sub_assembly_stock FOR SELECT TO authenticated
  USING (organization_id = current_org_id() OR is_platform_admin());
CREATE POLICY "sas_write" ON public.sub_assembly_stock FOR ALL TO authenticated
  USING (organization_id = current_org_id() OR is_platform_admin())
  WITH CHECK (organization_id = current_org_id() OR is_platform_admin());
CREATE TRIGGER trg_sas_updated BEFORE UPDATE ON public.sub_assembly_stock
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 8) sub_assembly_lots (audit per producing job)
CREATE TABLE IF NOT EXISTS public.sub_assembly_lots (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  assembly_stock_id uuid NOT NULL REFERENCES public.sub_assembly_stock(id) ON DELETE CASCADE,
  conversion_id uuid REFERENCES public.container_conversions(id),
  qty numeric NOT NULL,
  unit_cost numeric NOT NULL DEFAULT 0,
  organization_id uuid NOT NULL DEFAULT current_org_id(),
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.sub_assembly_lots ENABLE ROW LEVEL SECURITY;
CREATE POLICY "sal_select" ON public.sub_assembly_lots FOR SELECT TO authenticated
  USING (organization_id = current_org_id() OR is_platform_admin());
CREATE POLICY "sal_write" ON public.sub_assembly_lots FOR ALL TO authenticated
  USING (organization_id = current_org_id() OR is_platform_admin())
  WITH CHECK (organization_id = current_org_id() OR is_platform_admin());

-- 9) conversion_sub_assemblies (consumption on parent jobs)
CREATE TABLE IF NOT EXISTS public.conversion_sub_assemblies (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  conversion_id uuid NOT NULL REFERENCES public.container_conversions(id) ON DELETE CASCADE,
  assembly_stock_id uuid NOT NULL REFERENCES public.sub_assembly_stock(id),
  qty_planned numeric NOT NULL DEFAULT 0,
  qty_used numeric NOT NULL DEFAULT 0,
  unit_cost_snapshot numeric NOT NULL DEFAULT 0,
  total_cost numeric NOT NULL DEFAULT 0,
  organization_id uuid NOT NULL DEFAULT current_org_id(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.conversion_sub_assemblies ENABLE ROW LEVEL SECURITY;
CREATE POLICY "csa_select" ON public.conversion_sub_assemblies FOR SELECT TO authenticated
  USING (organization_id = current_org_id() OR is_platform_admin());
CREATE POLICY "csa_write" ON public.conversion_sub_assemblies FOR ALL TO authenticated
  USING (organization_id = current_org_id() OR is_platform_admin())
  WITH CHECK (organization_id = current_org_id() OR is_platform_admin());
CREATE TRIGGER trg_csa_updated BEFORE UPDATE ON public.conversion_sub_assemblies
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 10) material_movements (immutable ledger)
CREATE TABLE IF NOT EXISTS public.material_movements (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  material_id uuid NOT NULL REFERENCES public.materials(id),
  movement_type public.material_movement_type NOT NULL,
  qty numeric NOT NULL,           -- signed: receipt/return positive, issue/scrap negative
  unit_cost numeric NOT NULL DEFAULT 0,
  conversion_id uuid REFERENCES public.container_conversions(id),
  goods_receipt_id uuid,
  reason text,
  organization_id uuid NOT NULL DEFAULT current_org_id(),
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.material_movements ENABLE ROW LEVEL SECURITY;
CREATE POLICY "mm_select" ON public.material_movements FOR SELECT TO authenticated
  USING (organization_id = current_org_id() OR is_platform_admin());
CREATE POLICY "mm_insert" ON public.material_movements FOR INSERT TO authenticated
  WITH CHECK (organization_id = current_org_id() OR is_platform_admin());
-- immutable: no update/delete policy

-- 11) Trigger: apply material movement to materials.on_hand_qty + weighted avg cost
CREATE OR REPLACE FUNCTION public.apply_material_movement()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  _on_hand numeric; _avg numeric; _new_on_hand numeric; _new_avg numeric;
BEGIN
  SELECT on_hand_qty, avg_unit_cost INTO _on_hand, _avg
    FROM public.materials WHERE id = NEW.material_id FOR UPDATE;

  _new_on_hand := COALESCE(_on_hand,0) + NEW.qty;
  IF NEW.qty > 0 AND NEW.unit_cost > 0 THEN
    _new_avg := ((COALESCE(_on_hand,0) * COALESCE(_avg,0)) + (NEW.qty * NEW.unit_cost))
                / NULLIF(_new_on_hand, 0);
  ELSE
    _new_avg := _avg;
  END IF;

  UPDATE public.materials
    SET on_hand_qty = _new_on_hand,
        avg_unit_cost = COALESCE(_new_avg, avg_unit_cost)
    WHERE id = NEW.material_id;

  -- Update qty_used on the conversion_materials row when issuing/returning
  IF NEW.conversion_id IS NOT NULL THEN
    UPDATE public.conversion_materials
      SET qty_used = COALESCE(qty_used,0) - NEW.qty  -- issue (qty<0) increments used
      WHERE conversion_id = NEW.conversion_id AND material_id = NEW.material_id;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_apply_material_movement ON public.material_movements;
CREATE TRIGGER trg_apply_material_movement
AFTER INSERT ON public.material_movements
FOR EACH ROW EXECUTE FUNCTION public.apply_material_movement();

-- 12) RPC: issue / return material to a job
CREATE OR REPLACE FUNCTION public.issue_material_to_job(
  _conversion_id uuid, _material_id uuid, _qty numeric, _allow_negative boolean DEFAULT false
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE _on_hand numeric; _cost numeric; _id uuid;
BEGIN
  IF _qty <= 0 THEN RAISE EXCEPTION 'qty must be positive'; END IF;
  SELECT on_hand_qty, COALESCE(avg_unit_cost, unit_cost, 0)
    INTO _on_hand, _cost FROM public.materials WHERE id = _material_id;
  IF _on_hand < _qty AND NOT _allow_negative AND NOT has_role(auth.uid(),'admin'::app_role) THEN
    RAISE EXCEPTION 'insufficient_stock';
  END IF;

  INSERT INTO public.material_movements (material_id, movement_type, qty, unit_cost, conversion_id, created_by, reason)
  VALUES (_material_id, 'issue', -_qty, _cost, _conversion_id, auth.uid(), 'Issue to job')
  RETURNING id INTO _id;
  RETURN _id;
END $$;

CREATE OR REPLACE FUNCTION public.return_material_from_job(
  _conversion_id uuid, _material_id uuid, _qty numeric
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE _cost numeric; _id uuid;
BEGIN
  IF _qty <= 0 THEN RAISE EXCEPTION 'qty must be positive'; END IF;
  SELECT COALESCE(avg_unit_cost, unit_cost, 0) INTO _cost FROM public.materials WHERE id=_material_id;
  INSERT INTO public.material_movements (material_id, movement_type, qty, unit_cost, conversion_id, created_by, reason)
  VALUES (_material_id, 'return', _qty, _cost, _conversion_id, auth.uid(), 'Return from job')
  RETURNING id INTO _id;
  RETURN _id;
END $$;

-- 13) Sub-assembly stock movement helpers
CREATE OR REPLACE FUNCTION public.add_sub_assembly_stock(
  _stock_id uuid, _qty numeric, _unit_cost numeric, _conversion_id uuid
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE _on_hand numeric; _avg numeric; _new_on_hand numeric; _new_avg numeric;
BEGIN
  SELECT on_hand_qty, avg_unit_cost INTO _on_hand, _avg
    FROM public.sub_assembly_stock WHERE id=_stock_id FOR UPDATE;
  _new_on_hand := COALESCE(_on_hand,0) + _qty;
  _new_avg := CASE WHEN _new_on_hand > 0
    THEN ((COALESCE(_on_hand,0)*COALESCE(_avg,0)) + (_qty*_unit_cost))/_new_on_hand
    ELSE _avg END;
  UPDATE public.sub_assembly_stock SET on_hand_qty=_new_on_hand, avg_unit_cost=_new_avg WHERE id=_stock_id;
  INSERT INTO public.sub_assembly_lots (assembly_stock_id, conversion_id, qty, unit_cost)
  VALUES (_stock_id, _conversion_id, _qty, _unit_cost);
END $$;

CREATE OR REPLACE FUNCTION public.consume_sub_assembly(
  _conversion_id uuid, _csa_id uuid, _qty numeric
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE _stock_id uuid; _on_hand numeric; _cost numeric;
BEGIN
  IF _qty <= 0 THEN RAISE EXCEPTION 'qty must be positive'; END IF;
  SELECT assembly_stock_id INTO _stock_id FROM public.conversion_sub_assemblies WHERE id=_csa_id;
  SELECT on_hand_qty, avg_unit_cost INTO _on_hand, _cost
    FROM public.sub_assembly_stock WHERE id=_stock_id FOR UPDATE;
  IF _on_hand < _qty AND NOT has_role(auth.uid(),'admin'::app_role) THEN
    RAISE EXCEPTION 'insufficient_assembly_stock';
  END IF;
  UPDATE public.sub_assembly_stock SET on_hand_qty = on_hand_qty - _qty WHERE id=_stock_id;
  UPDATE public.conversion_sub_assemblies
    SET qty_used = COALESCE(qty_used,0) + _qty,
        unit_cost_snapshot = _cost,
        total_cost = (COALESCE(qty_used,0) + _qty) * _cost
    WHERE id=_csa_id;
END $$;

-- 14) Master completion RPC
CREATE OR REPLACE FUNCTION public.complete_conversion(_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  _job RECORD; _mat numeric:=0; _lab numeric:=0; _svc numeric:=0; _sub numeric:=0;
  _total numeric; _children_count int:=0; _per_child numeric:=0;
  _out RECORD; _i int; _new_id uuid; _num text; _result jsonb;
  _stock_id uuid; _fp_id uuid; _fp_count int:=0;
BEGIN
  SELECT * INTO _job FROM public.container_conversions WHERE id=_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'job_not_found'; END IF;
  IF _job.status='completed' THEN RAISE EXCEPTION 'already_completed'; END IF;

  SELECT COALESCE(SUM(total_cost),0) INTO _mat FROM public.conversion_materials WHERE conversion_id=_id;
  SELECT COALESCE(SUM(total_cost),0) INTO _lab FROM public.conversion_labour WHERE conversion_id=_id;
  SELECT COALESCE(SUM(cost),0) INTO _svc FROM public.conversion_services WHERE conversion_id=_id;
  SELECT COALESCE(SUM(total_cost),0) INTO _sub FROM public.conversion_sub_assemblies WHERE conversion_id=_id;
  _total := COALESCE(_job.container_cost,0) + _mat + _lab + _svc + _sub;

  IF _job.job_kind = 'split' THEN
    SELECT COALESCE(SUM(planned_count),0) INTO _children_count FROM public.conversion_outputs WHERE conversion_id=_id;
    IF _children_count = 0 THEN RAISE EXCEPTION 'split_requires_outputs'; END IF;
    _per_child := _total / _children_count;
    FOR _out IN SELECT * FROM public.conversion_outputs WHERE conversion_id=_id LOOP
      FOR _i IN 1.._out.planned_count LOOP
        _num := COALESCE(_out.number_prefix,'CHILD-') || to_char(now(),'YYMMDDHH24MISS') || '-' || lpad(_i::text,2,'0') || '-' || substring(gen_random_uuid()::text,1,4);
        INSERT INTO public.containers (container_number, size, category, height_class, owner, status, parent_container_id, acquisition_cost, organization_id)
        VALUES (_num, _out.size, _out.category, _out.height_class,
                COALESCE(_out.target_owner, (SELECT owner FROM public.containers WHERE id=_job.container_id)),
                'available', _job.container_id, _per_child, _job.organization_id)
        RETURNING id INTO _new_id;
      END LOOP;
    END LOOP;
    -- mark parent
    UPDATE public.containers SET status='converted' WHERE id=_job.container_id;

  ELSIF _job.job_kind = 'product' THEN
    FOR _i IN 1..GREATEST(1, _job.qty_produced::int) LOOP
      _num := 'FP-' || to_char(now(),'YYMMDDHH24MISS') || '-' || lpad(_i::text,2,'0');
      INSERT INTO public.finished_products (product_number, product_type, source_conversion_id, source_container_id, total_cost, list_price, status, organization_id, created_by)
      VALUES (_num, _job.product_type, _id, _job.container_id, _total / GREATEST(1,_job.qty_produced),
              COALESCE(_job.quoted_price,0)/GREATEST(1,_job.qty_produced), 'in_stock', _job.organization_id, auth.uid())
      RETURNING id INTO _fp_id;
      _fp_count := _fp_count + 1;
    END LOOP;
    IF _job.container_id IS NOT NULL THEN
      UPDATE public.containers SET status='converted' WHERE id=_job.container_id;
    END IF;

  ELSIF _job.job_kind = 'sub_assembly' THEN
    IF _job.assembly_type IS NULL THEN RAISE EXCEPTION 'sub_assembly_requires_type'; END IF;
    INSERT INTO public.sub_assembly_stock (assembly_type, name, uom, organization_id)
    VALUES (_job.assembly_type, COALESCE(_job.description, _job.assembly_type::text), COALESCE(_job.unit_of_measure,'pcs'), _job.organization_id)
    ON CONFLICT (organization_id, assembly_type, name) DO UPDATE SET updated_at=now()
    RETURNING id INTO _stock_id;
    PERFORM public.add_sub_assembly_stock(_stock_id, _job.qty_produced, _total / GREATEST(1,_job.qty_produced), _id);
  END IF;

  UPDATE public.container_conversions
    SET status='completed', completed_at=now(),
        actual_cost=_total,
        unit_cost = _total / GREATEST(1, COALESCE(_children_count, _job.qty_produced::int, 1))
    WHERE id=_id;

  _result := jsonb_build_object(
    'job_kind', _job.job_kind,
    'total_cost', _total,
    'children_created', _children_count,
    'finished_products_created', _fp_count
  );
  RETURN _result;
END $$;

-- 15) Lease units link to finished products
ALTER TABLE public.lease_units
  ADD COLUMN IF NOT EXISTS finished_product_id uuid REFERENCES public.finished_products(id);

-- 16) Indexes
CREATE INDEX IF NOT EXISTS idx_mm_material ON public.material_movements(material_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_mm_conv ON public.material_movements(conversion_id);
CREATE INDEX IF NOT EXISTS idx_fp_status ON public.finished_products(organization_id, status);
CREATE INDEX IF NOT EXISTS idx_co_conv ON public.conversion_outputs(conversion_id);
CREATE INDEX IF NOT EXISTS idx_csa_conv ON public.conversion_sub_assemblies(conversion_id);
