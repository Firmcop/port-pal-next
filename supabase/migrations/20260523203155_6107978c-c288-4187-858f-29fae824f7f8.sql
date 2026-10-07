
-- 1. BOM tables
CREATE TABLE public.sub_assembly_bom_materials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assembly_stock_id uuid NOT NULL REFERENCES public.sub_assembly_stock(id) ON DELETE CASCADE,
  material_id uuid NOT NULL REFERENCES public.materials(id),
  qty_per_unit numeric NOT NULL DEFAULT 0,
  notes text,
  organization_id uuid NOT NULL DEFAULT current_org_id() REFERENCES public.organizations(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (assembly_stock_id, material_id)
);
ALTER TABLE public.sub_assembly_bom_materials ENABLE ROW LEVEL SECURITY;
CREATE POLICY "sabm_select" ON public.sub_assembly_bom_materials FOR SELECT TO authenticated USING (organization_id = current_org_id() OR is_platform_admin());
CREATE POLICY "sabm_write" ON public.sub_assembly_bom_materials FOR ALL TO authenticated USING (organization_id = current_org_id() OR is_platform_admin()) WITH CHECK (organization_id = current_org_id() OR is_platform_admin());

CREATE TABLE public.sub_assembly_bom_labor (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assembly_stock_id uuid NOT NULL REFERENCES public.sub_assembly_stock(id) ON DELETE CASCADE,
  role text NOT NULL,
  hours_per_unit numeric NOT NULL DEFAULT 0,
  rate_per_hour numeric NOT NULL DEFAULT 0,
  notes text,
  organization_id uuid NOT NULL DEFAULT current_org_id() REFERENCES public.organizations(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.sub_assembly_bom_labor ENABLE ROW LEVEL SECURITY;
CREATE POLICY "sabl_select" ON public.sub_assembly_bom_labor FOR SELECT TO authenticated USING (organization_id = current_org_id() OR is_platform_admin());
CREATE POLICY "sabl_write" ON public.sub_assembly_bom_labor FOR ALL TO authenticated USING (organization_id = current_org_id() OR is_platform_admin()) WITH CHECK (organization_id = current_org_id() OR is_platform_admin());

CREATE TABLE public.sub_assembly_bom_overheads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assembly_stock_id uuid NOT NULL REFERENCES public.sub_assembly_stock(id) ON DELETE CASCADE,
  description text NOT NULL,
  cost_per_unit numeric NOT NULL DEFAULT 0,
  organization_id uuid NOT NULL DEFAULT current_org_id() REFERENCES public.organizations(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.sub_assembly_bom_overheads ENABLE ROW LEVEL SECURITY;
CREATE POLICY "sabo_select" ON public.sub_assembly_bom_overheads FOR SELECT TO authenticated USING (organization_id = current_org_id() OR is_platform_admin());
CREATE POLICY "sabo_write" ON public.sub_assembly_bom_overheads FOR ALL TO authenticated USING (organization_id = current_org_id() OR is_platform_admin()) WITH CHECK (organization_id = current_org_id() OR is_platform_admin());

-- 2. Add bom_unit_cost cache on sub_assembly_stock
ALTER TABLE public.sub_assembly_stock
  ADD COLUMN IF NOT EXISTS bom_unit_cost numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS default_sale_price numeric;

-- 3. Function to compute & cache BOM unit cost
CREATE OR REPLACE FUNCTION public.recalc_sub_assembly_bom_cost(_assembly_stock_id uuid)
RETURNS numeric
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE _mat numeric; _lab numeric; _ovh numeric; _total numeric;
BEGIN
  SELECT COALESCE(SUM(b.qty_per_unit * COALESCE(m.avg_unit_cost, m.unit_cost, 0)), 0)
    INTO _mat
    FROM sub_assembly_bom_materials b
    JOIN materials m ON m.id = b.material_id
    WHERE b.assembly_stock_id = _assembly_stock_id;
  SELECT COALESCE(SUM(hours_per_unit * rate_per_hour), 0) INTO _lab
    FROM sub_assembly_bom_labor WHERE assembly_stock_id = _assembly_stock_id;
  SELECT COALESCE(SUM(cost_per_unit), 0) INTO _ovh
    FROM sub_assembly_bom_overheads WHERE assembly_stock_id = _assembly_stock_id;
  _total := _mat + _lab + _ovh;
  UPDATE sub_assembly_stock SET bom_unit_cost = _total, updated_at = now()
    WHERE id = _assembly_stock_id;
  RETURN _total;
END $$;

-- 4. Trigger to refresh bom cost on BOM table changes
CREATE OR REPLACE FUNCTION public.trg_refresh_bom_cost()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.recalc_sub_assembly_bom_cost(COALESCE(NEW.assembly_stock_id, OLD.assembly_stock_id));
  RETURN COALESCE(NEW, OLD);
END $$;

CREATE TRIGGER trg_sabm_recalc AFTER INSERT OR UPDATE OR DELETE ON public.sub_assembly_bom_materials FOR EACH ROW EXECUTE FUNCTION public.trg_refresh_bom_cost();
CREATE TRIGGER trg_sabl_recalc AFTER INSERT OR UPDATE OR DELETE ON public.sub_assembly_bom_labor FOR EACH ROW EXECUTE FUNCTION public.trg_refresh_bom_cost();
CREATE TRIGGER trg_sabo_recalc AFTER INSERT OR UPDATE OR DELETE ON public.sub_assembly_bom_overheads FOR EACH ROW EXECUTE FUNCTION public.trg_refresh_bom_cost();

-- 5. Build RPC — consume materials, post labor+overhead, produce sub-assembly stock
CREATE OR REPLACE FUNCTION public.build_sub_assembly(_assembly_stock_id uuid, _qty numeric, _notes text DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  _org uuid;
  _bom_cost numeric;
  _mat_cost numeric := 0;
  _lab_cost numeric := 0;
  _ovh_cost numeric := 0;
  _on_hand numeric;
  _avg numeric;
  _new_on_hand numeric;
  _new_avg numeric;
  _lot_id uuid;
  _row record;
  _mat_on_hand numeric;
BEGIN
  IF _qty IS NULL OR _qty <= 0 THEN RAISE EXCEPTION 'qty must be positive'; END IF;

  SELECT organization_id, on_hand_qty, avg_unit_cost INTO _org, _on_hand, _avg
    FROM sub_assembly_stock WHERE id = _assembly_stock_id FOR UPDATE;
  IF _org IS NULL THEN RAISE EXCEPTION 'sub_assembly_stock not found'; END IF;

  -- Validate material availability and issue (negative qty)
  FOR _row IN
    SELECT b.material_id, b.qty_per_unit * _qty AS need, COALESCE(m.avg_unit_cost, m.unit_cost, 0) AS unit_cost
      FROM sub_assembly_bom_materials b
      JOIN materials m ON m.id = b.material_id
     WHERE b.assembly_stock_id = _assembly_stock_id
  LOOP
    SELECT on_hand_qty INTO _mat_on_hand FROM materials WHERE id = _row.material_id FOR UPDATE;
    IF _mat_on_hand < _row.need AND NOT has_role(auth.uid(), 'admin'::app_role) THEN
      RAISE EXCEPTION 'insufficient material stock for material %', _row.material_id;
    END IF;
    INSERT INTO material_movements (material_id, movement_type, qty, unit_cost, reason, organization_id, created_by)
      VALUES (_row.material_id, 'issue'::material_movement_type, -_row.need, _row.unit_cost,
              'sub_assembly_build:'||_assembly_stock_id::text, _org, auth.uid());
    _mat_cost := _mat_cost + _row.need * _row.unit_cost;
  END LOOP;

  -- Labor and overhead from BOM
  SELECT COALESCE(SUM(hours_per_unit * rate_per_hour), 0) * _qty INTO _lab_cost
    FROM sub_assembly_bom_labor WHERE assembly_stock_id = _assembly_stock_id;
  SELECT COALESCE(SUM(cost_per_unit), 0) * _qty INTO _ovh_cost
    FROM sub_assembly_bom_overheads WHERE assembly_stock_id = _assembly_stock_id;

  _bom_cost := (_mat_cost + _lab_cost + _ovh_cost) / NULLIF(_qty, 0);

  -- Insert build lot
  INSERT INTO sub_assembly_lots (assembly_stock_id, qty, unit_cost, organization_id)
    VALUES (_assembly_stock_id, _qty, COALESCE(_bom_cost, 0), _org)
    RETURNING id INTO _lot_id;

  -- Weighted-avg recompute
  _new_on_hand := COALESCE(_on_hand, 0) + _qty;
  IF _new_on_hand > 0 THEN
    _new_avg := ((COALESCE(_on_hand, 0) * COALESCE(_avg, 0)) + (_qty * COALESCE(_bom_cost, 0))) / _new_on_hand;
  ELSE
    _new_avg := _avg;
  END IF;
  UPDATE sub_assembly_stock
     SET on_hand_qty = _new_on_hand,
         avg_unit_cost = COALESCE(_new_avg, avg_unit_cost),
         updated_at = now()
   WHERE id = _assembly_stock_id;

  -- Post labor + overhead to accounting (expense entries) if any
  IF _lab_cost > 0 THEN
    INSERT INTO accounting_transactions (transaction_number, account_type, category, description, debit_amount, reference_type, reference_id, organization_id, created_by)
      VALUES ('SA-LAB-'||substr(_lot_id::text,1,8), 'expense'::account_type, 'manufacturing_labor',
              'Sub-assembly build labor', _lab_cost, 'sub_assembly_lot', _lot_id, _org, auth.uid());
  END IF;
  IF _ovh_cost > 0 THEN
    INSERT INTO accounting_transactions (transaction_number, account_type, category, description, debit_amount, reference_type, reference_id, organization_id, created_by)
      VALUES ('SA-OVH-'||substr(_lot_id::text,1,8), 'expense'::account_type, 'manufacturing_overhead',
              'Sub-assembly build overhead', _ovh_cost, 'sub_assembly_lot', _lot_id, _org, auth.uid());
  END IF;

  RETURN _lot_id;
END $$;

-- 6. Sub-assembly sales table
CREATE TABLE public.sub_assembly_sales (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assembly_stock_id uuid NOT NULL REFERENCES public.sub_assembly_stock(id),
  qty numeric NOT NULL,
  unit_cost_snapshot numeric NOT NULL DEFAULT 0,
  unit_price numeric NOT NULL DEFAULT 0,
  total_price numeric NOT NULL DEFAULT 0,
  buyer_customer_id uuid,
  buyer_name text NOT NULL,
  invoice_id uuid REFERENCES public.invoices(id),
  notes text,
  sold_at timestamptz NOT NULL DEFAULT now(),
  organization_id uuid NOT NULL DEFAULT current_org_id() REFERENCES public.organizations(id),
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.sub_assembly_sales ENABLE ROW LEVEL SECURITY;
CREATE POLICY "sas_sale_select" ON public.sub_assembly_sales FOR SELECT TO authenticated USING (organization_id = current_org_id() OR is_platform_admin());
CREATE POLICY "sas_sale_write" ON public.sub_assembly_sales FOR ALL TO authenticated USING (organization_id = current_org_id() OR is_platform_admin()) WITH CHECK (organization_id = current_org_id() OR is_platform_admin());

-- 7. Sell RPC
CREATE OR REPLACE FUNCTION public.sell_sub_assembly(
  _assembly_stock_id uuid,
  _qty numeric,
  _unit_price numeric,
  _buyer_name text,
  _buyer_customer_id uuid DEFAULT NULL,
  _notes text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  _org uuid; _on_hand numeric; _avg numeric; _total numeric; _cogs numeric;
  _sale_id uuid; _invoice_id uuid; _inv_num text; _sku_name text;
BEGIN
  IF _qty IS NULL OR _qty <= 0 THEN RAISE EXCEPTION 'qty must be positive'; END IF;
  IF _unit_price IS NULL OR _unit_price < 0 THEN RAISE EXCEPTION 'unit_price required'; END IF;

  SELECT organization_id, on_hand_qty, avg_unit_cost, name
    INTO _org, _on_hand, _avg, _sku_name
    FROM sub_assembly_stock WHERE id = _assembly_stock_id FOR UPDATE;
  IF _org IS NULL THEN RAISE EXCEPTION 'sub_assembly_stock not found'; END IF;
  IF _on_hand < _qty AND NOT has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'insufficient_assembly_stock';
  END IF;

  _total := _qty * _unit_price;
  _cogs := _qty * COALESCE(_avg, 0);

  -- Deduct stock
  UPDATE sub_assembly_stock SET on_hand_qty = on_hand_qty - _qty, updated_at = now()
    WHERE id = _assembly_stock_id;

  -- Generate invoice
  _inv_num := 'SA-'||to_char(now(),'YYMMDD')||'-'||substr(gen_random_uuid()::text,1,6);
  INSERT INTO invoices (invoice_number, customer_name, customer_reference, invoice_type,
                        subtotal, total_amount, status, issued_at, notes, organization_id, created_by)
    VALUES (_inv_num, _buyer_name, _buyer_customer_id::text, 'other'::charge_type,
            _total, _total, 'issued'::invoice_status, now(),
            COALESCE(_notes,'')||' [Sub-assembly: '||_sku_name||' x '||_qty||']',
            _org, auth.uid())
    RETURNING id INTO _invoice_id;

  -- Accounting: revenue (credit) + COGS (debit)
  INSERT INTO accounting_transactions (transaction_number, account_type, category, description, credit_amount, reference_type, reference_id, organization_id, created_by)
    VALUES (_inv_num||'-REV', 'revenue'::account_type, 'sub_assembly_sale',
            'Sale: '||_sku_name||' x '||_qty, _total, 'invoice', _invoice_id, _org, auth.uid());
  IF _cogs > 0 THEN
    INSERT INTO accounting_transactions (transaction_number, account_type, category, description, debit_amount, reference_type, reference_id, organization_id, created_by)
      VALUES (_inv_num||'-COGS', 'expense'::account_type, 'cogs',
              'COGS: '||_sku_name||' x '||_qty, _cogs, 'invoice', _invoice_id, _org, auth.uid());
  END IF;

  INSERT INTO sub_assembly_sales (assembly_stock_id, qty, unit_cost_snapshot, unit_price, total_price,
                                  buyer_customer_id, buyer_name, invoice_id, notes, organization_id, created_by)
    VALUES (_assembly_stock_id, _qty, COALESCE(_avg,0), _unit_price, _total,
            _buyer_customer_id, _buyer_name, _invoice_id, _notes, _org, auth.uid())
    RETURNING id INTO _sale_id;

  RETURN _sale_id;
END $$;
