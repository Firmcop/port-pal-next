
-- Enums
DO $$ BEGIN
  CREATE TYPE public.stock_adjustment_item_type AS ENUM ('material','finished_product','sub_assembly');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.stock_adjustment_type AS ENUM ('count_variance','write_off','write_on','reclassification');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.stock_adjustment_reason AS ENUM ('damage','loss','theft','found','recount','correction','transfer','other');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Table
CREATE TABLE IF NOT EXISTS public.stock_adjustments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL DEFAULT current_org_id() REFERENCES public.organizations(id),
  reference text NOT NULL,
  item_type public.stock_adjustment_item_type NOT NULL,
  item_id uuid NOT NULL,
  item_label text,
  adjustment_type public.stock_adjustment_type NOT NULL,
  reason_category public.stock_adjustment_reason NOT NULL,
  reason_text text NOT NULL CHECK (length(btrim(reason_text)) >= 5),
  qty_before numeric NOT NULL,
  qty_after numeric NOT NULL,
  qty_delta numeric NOT NULL,
  unit_cost numeric NOT NULL DEFAULT 0,
  value_delta numeric NOT NULL DEFAULT 0,
  currency text,
  from_depot_id uuid REFERENCES public.depots(id),
  to_depot_id uuid REFERENCES public.depots(id),
  gl_journal_id uuid,
  adjusted_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, reference)
);

CREATE INDEX IF NOT EXISTS idx_stock_adj_org_created ON public.stock_adjustments (organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_stock_adj_item ON public.stock_adjustments (item_type, item_id);

GRANT SELECT, INSERT ON public.stock_adjustments TO authenticated;
GRANT ALL ON public.stock_adjustments TO service_role;

ALTER TABLE public.stock_adjustments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "stock_adj_select" ON public.stock_adjustments
  FOR SELECT TO authenticated
  USING (organization_id = current_org_id() OR is_platform_admin());

CREATE POLICY "stock_adj_insert" ON public.stock_adjustments
  FOR INSERT TO authenticated
  WITH CHECK (
    organization_id = current_org_id()
    AND (
      has_role(auth.uid(),'admin'::app_role)
      OR has_role(auth.uid(),'production_manager'::app_role)
      OR has_role(auth.uid(),'asset_manager'::app_role)
      OR has_role(auth.uid(),'accountant'::app_role)
    )
  );

-- Immutability trigger
CREATE OR REPLACE FUNCTION public.trg_stock_adj_immutable()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'stock_adjustments rows are immutable';
END;
$$;

DROP TRIGGER IF EXISTS trg_stock_adj_no_update ON public.stock_adjustments;
CREATE TRIGGER trg_stock_adj_no_update
  BEFORE UPDATE OR DELETE ON public.stock_adjustments
  FOR EACH ROW EXECUTE FUNCTION public.trg_stock_adj_immutable();

-- Helper: ensure GL account exists
CREATE OR REPLACE FUNCTION public.ensure_stock_adj_gl_account(
  _org uuid, _code text, _name text, _type account_type
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _id uuid;
BEGIN
  SELECT id INTO _id FROM public.gl_accounts
   WHERE organization_id = _org AND code = _code;
  IF _id IS NULL THEN
    INSERT INTO public.gl_accounts(organization_id, code, name, account_type, is_system, system_code)
    VALUES (_org, _code, _name, _type, true, _code)
    RETURNING id INTO _id;
  END IF;
  RETURN _id;
END $$;

-- Reference generator
CREATE OR REPLACE FUNCTION public.next_stock_adj_reference(_org uuid)
RETURNS text LANGUAGE plpgsql AS $$
DECLARE _n int; _ref text;
BEGIN
  SELECT COUNT(*)+1 INTO _n FROM public.stock_adjustments
   WHERE organization_id = _org
     AND date_trunc('month', created_at) = date_trunc('month', now());
  _ref := 'ADJ-' || to_char(now(),'YYYYMM') || '-' || lpad(_n::text, 4, '0');
  RETURN _ref;
END $$;

-- Main RPC
CREATE OR REPLACE FUNCTION public.adjust_stock(
  _item_type public.stock_adjustment_item_type,
  _item_id uuid,
  _adjustment_type public.stock_adjustment_type,
  _reason_category public.stock_adjustment_reason,
  _reason_text text,
  _new_qty numeric,
  _unit_cost numeric DEFAULT NULL,
  _from_depot uuid DEFAULT NULL,
  _to_depot uuid DEFAULT NULL
) RETURNS public.stock_adjustments
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _org uuid := current_org_id();
  _uid uuid := auth.uid();
  _qty_before numeric := 0;
  _qty_after numeric := 0;
  _qty_delta numeric := 0;
  _cost numeric := COALESCE(_unit_cost, 0);
  _value_delta numeric := 0;
  _label text;
  _journal uuid;
  _txn_number text;
  _inv_acct uuid;
  _offset_acct uuid;
  _currency text;
  _row public.stock_adjustments;
  _ref text;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF NOT (
    has_role(_uid,'admin'::app_role)
    OR has_role(_uid,'production_manager'::app_role)
    OR has_role(_uid,'asset_manager'::app_role)
    OR has_role(_uid,'accountant'::app_role)
  ) THEN
    RAISE EXCEPTION 'Only admins, production managers, asset managers or accountants can adjust stock';
  END IF;

  IF length(btrim(COALESCE(_reason_text,''))) < 5 THEN
    RAISE EXCEPTION 'Reason is required (minimum 5 characters)';
  END IF;

  SELECT COALESCE(currency,'USD') INTO _currency FROM public.organizations WHERE id = _org;

  -- Load and lock current qty per item type
  IF _item_type = 'material' THEN
    SELECT ms.qty_available, m.name
      INTO _qty_before, _label
      FROM public.material_stock ms
      JOIN public.materials m ON m.id = ms.material_id
     WHERE ms.material_id = _item_id AND ms.organization_id = _org
     FOR UPDATE OF ms;

    IF NOT FOUND THEN
      -- Create stock row if missing
      INSERT INTO public.material_stock(material_id, qty_available, organization_id)
      VALUES (_item_id, 0, _org);
      _qty_before := 0;
      SELECT name INTO _label FROM public.materials WHERE id = _item_id;
    END IF;

    IF _cost = 0 THEN
      SELECT COALESCE(unit_cost, 0) INTO _cost FROM public.materials WHERE id = _item_id;
    END IF;

    _qty_after := _new_qty;
    _qty_delta := _qty_after - _qty_before;

    UPDATE public.material_stock
       SET qty_available = _qty_after, last_updated = now()
     WHERE material_id = _item_id AND organization_id = _org;

    INSERT INTO public.material_movements(material_id, movement_type, qty, unit_cost, reason, organization_id, created_by)
    VALUES (
      _item_id,
      CASE WHEN _adjustment_type = 'write_off' THEN 'scrap'::material_movement_type
           ELSE 'adjustment'::material_movement_type END,
      _qty_delta, _cost,
      concat_ws(' | ', _adjustment_type::text, _reason_category::text, _reason_text),
      _org, _uid
    );

  ELSIF _item_type = 'sub_assembly' THEN
    SELECT on_hand_qty, name INTO _qty_before, _label
      FROM public.sub_assembly_stock
     WHERE id = _item_id AND organization_id = _org
     FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Sub-assembly not found'; END IF;

    IF _cost = 0 THEN
      SELECT COALESCE(avg_unit_cost,0) INTO _cost FROM public.sub_assembly_stock WHERE id = _item_id;
    END IF;

    _qty_after := _new_qty;
    _qty_delta := _qty_after - _qty_before;

    UPDATE public.sub_assembly_stock
       SET on_hand_qty = _qty_after
     WHERE id = _item_id AND organization_id = _org;

    INSERT INTO public.sub_assembly_movements(assembly_stock_id, movement_type, qty, unit_cost, reason, organization_id, created_by)
    VALUES (_item_id, 'adjustment', _qty_delta, _cost,
      concat_ws(' | ', _adjustment_type::text, _reason_category::text, _reason_text), _org, _uid);

  ELSIF _item_type = 'finished_product' THEN
    SELECT (CASE WHEN status IN ('scrapped','sold','leased') THEN 0 ELSE 1 END),
           COALESCE(name, product_number),
           COALESCE(total_cost, 0)
      INTO _qty_before, _label, _cost
      FROM public.finished_products
     WHERE id = _item_id AND organization_id = _org
     FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Finished product not found'; END IF;

    _qty_after := LEAST(GREATEST(_new_qty, 0), 1);
    _qty_delta := _qty_after - _qty_before;

    IF _adjustment_type = 'write_off' THEN
      UPDATE public.finished_products
         SET status = 'scrapped'::finished_product_status
       WHERE id = _item_id;
      _qty_after := 0;
      _qty_delta := _qty_after - _qty_before;
    ELSIF _adjustment_type = 'write_on' THEN
      UPDATE public.finished_products
         SET status = 'in_stock'::finished_product_status
       WHERE id = _item_id;
      _qty_after := 1;
      _qty_delta := _qty_after - _qty_before;
    END IF;
  ELSE
    RAISE EXCEPTION 'Unknown item type';
  END IF;

  _value_delta := round((_qty_delta * _cost)::numeric, 2);
  _ref := public.next_stock_adj_reference(_org);

  -- GL posting (skip for zero-value or reclassification)
  IF _adjustment_type <> 'reclassification' AND _value_delta <> 0 THEN
    _inv_acct    := public.ensure_stock_adj_gl_account(_org, '1400', 'Inventory', 'asset'::account_type);

    IF _value_delta < 0 THEN
      -- Loss: Dr Expense/Variance, Cr Inventory
      IF _adjustment_type = 'write_off' THEN
        _offset_acct := public.ensure_stock_adj_gl_account(_org, '5910', 'Inventory Write-off Expense', 'expense'::account_type);
      ELSE
        _offset_acct := public.ensure_stock_adj_gl_account(_org, '5920', 'Inventory Shrinkage Variance', 'expense'::account_type);
      END IF;
    ELSE
      -- Gain: Dr Inventory, Cr Income/Variance
      IF _adjustment_type = 'write_on' THEN
        _offset_acct := public.ensure_stock_adj_gl_account(_org, '4910', 'Inventory Adjustment Income', 'revenue'::account_type);
      ELSE
        _offset_acct := public.ensure_stock_adj_gl_account(_org, '5920', 'Inventory Shrinkage Variance', 'expense'::account_type);
      END IF;
    END IF;

    _journal := gen_random_uuid();
    _txn_number := 'JV-ADJ-' || to_char(now(),'YYYYMMDD-HH24MISS') || '-' || substr(_journal::text,1,4);

    -- Debit leg
    INSERT INTO public.accounting_transactions(
      transaction_number, transaction_date, account_type, category, description,
      debit_amount, credit_amount, reference_type, reference_id, gl_account_id,
      journal_id, organization_id, created_by
    ) VALUES (
      _txn_number || '-D', now(),
      CASE WHEN _value_delta < 0 THEN 'expense'::account_type ELSE 'asset'::account_type END,
      'stock_adjustment',
      concat('Stock adjustment ', _ref, ' — ', _label, ' (', _adjustment_type::text, ')'),
      abs(_value_delta), 0,
      'stock_adjustment', NULL,
      CASE WHEN _value_delta < 0 THEN _offset_acct ELSE _inv_acct END,
      _journal, _org, _uid
    );
    -- Credit leg
    INSERT INTO public.accounting_transactions(
      transaction_number, transaction_date, account_type, category, description,
      debit_amount, credit_amount, reference_type, reference_id, gl_account_id,
      journal_id, organization_id, created_by
    ) VALUES (
      _txn_number || '-C', now(),
      CASE WHEN _value_delta < 0 THEN 'asset'::account_type ELSE 'revenue'::account_type END,
      'stock_adjustment',
      concat('Stock adjustment ', _ref, ' — ', _label, ' (', _adjustment_type::text, ')'),
      0, abs(_value_delta),
      'stock_adjustment', NULL,
      CASE WHEN _value_delta < 0 THEN _inv_acct ELSE _offset_acct END,
      _journal, _org, _uid
    );
  END IF;

  INSERT INTO public.stock_adjustments(
    organization_id, reference, item_type, item_id, item_label,
    adjustment_type, reason_category, reason_text,
    qty_before, qty_after, qty_delta, unit_cost, value_delta, currency,
    from_depot_id, to_depot_id, gl_journal_id, adjusted_by
  ) VALUES (
    _org, _ref, _item_type, _item_id, _label,
    _adjustment_type, _reason_category, _reason_text,
    _qty_before, _qty_after, _qty_delta, _cost, _value_delta, _currency,
    _from_depot, _to_depot, _journal, _uid
  ) RETURNING * INTO _row;

  -- Update reference_id on journal legs
  IF _journal IS NOT NULL THEN
    UPDATE public.accounting_transactions
       SET reference_id = _row.id
     WHERE journal_id = _journal;
  END IF;

  -- Finance audit log
  INSERT INTO public.finance_audit_log(
    organization_id, actor_user_id, entity_type, entity_id, entity_ref,
    action, summary
  ) VALUES (
    _org, _uid, 'stock_adjustment', _row.id, _ref,
    'adjust_stock',
    jsonb_build_object(
      'item_type', _item_type,
      'item_id', _item_id,
      'item_label', _label,
      'adjustment_type', _adjustment_type,
      'reason_category', _reason_category,
      'qty_before', _qty_before,
      'qty_after', _qty_after,
      'qty_delta', _qty_delta,
      'unit_cost', _cost,
      'value_delta', _value_delta,
      'journal_id', _journal
    )
  );

  RETURN _row;
END $$;

REVOKE ALL ON FUNCTION public.adjust_stock(
  public.stock_adjustment_item_type, uuid, public.stock_adjustment_type,
  public.stock_adjustment_reason, text, numeric, numeric, uuid, uuid
) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.adjust_stock(
  public.stock_adjustment_item_type, uuid, public.stock_adjustment_type,
  public.stock_adjustment_reason, text, numeric, numeric, uuid, uuid
) TO authenticated;
