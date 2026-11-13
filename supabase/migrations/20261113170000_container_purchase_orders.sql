-- =====================================================================
-- Container purchase orders (13 Nov 2026).
--
-- Buying containers from a supplier who does not store them with us:
--   order  -> a PO of type 'containers' (size, type, grade, qty, price);
--             the usual PO approval applies
--   bill   -> the supplier's invoice is recorded against the PO
--             (container_po_record_bill); like every PO bill it is a document,
--             the payable is posted by the receipt
--   pay    -> the usual Pay supplier on the PO; money paid before delivery
--             is a supplier advance (1300) and is set against the payable
--             automatically when the containers arrive
--   receive-> container_po_receive: one row per container. Each unit is
--             added to the yard as owned by the company at the PO price, with
--             a gate-in appointment, gate-in EIR and movement, and its
--             transport / crane bills; or recorded as delivered direct to a
--             customer (no gate-in). The receipt is a goods receipt on the
--             PO, so Dr Inventory (1200) / Cr Accounts Payable (2000) posts
--             through the existing goods-receipt posting.
--   close  -> container_po_close_short: stop waiting for undelivered units.
--
-- A container received on a PO is never billed again to an "owner" when it is
-- later sold, gated out or put on a conversion.
-- The consignment route (containers stored for an owner and billed when used)
-- is unchanged.
-- =====================================================================

-- 1. PO type and container lines ------------------------------------------
ALTER TABLE public.purchase_orders ADD COLUMN IF NOT EXISTS po_type text NOT NULL DEFAULT 'materials';
DO $$ BEGIN
  ALTER TABLE public.purchase_orders ADD CONSTRAINT purchase_orders_po_type_check CHECK (po_type IN ('materials', 'containers'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
ALTER TABLE public.purchase_orders ADD COLUMN IF NOT EXISTS pickup_location text;
ALTER TABLE public.purchase_orders ADD COLUMN IF NOT EXISTS expected_delivery date;
COMMENT ON COLUMN public.purchase_orders.po_type IS 'materials: store items; containers: containers bought from a supplier and received into the yard.';

ALTER TABLE public.po_items ADD COLUMN IF NOT EXISTS container_size text;
ALTER TABLE public.po_items ADD COLUMN IF NOT EXISTS container_height text;
ALTER TABLE public.po_items ADD COLUMN IF NOT EXISTS container_category text;
ALTER TABLE public.po_items ADD COLUMN IF NOT EXISTS container_grade text;
DO $$ BEGIN
  ALTER TABLE public.po_items ADD CONSTRAINT po_items_container_size_check CHECK (container_size IS NULL OR container_size IN ('10', '20', '30', '40', '45'));
  ALTER TABLE public.po_items ADD CONSTRAINT po_items_container_height_check CHECK (container_height IS NULL OR container_height IN ('HC', 'LC'));
  ALTER TABLE public.po_items ADD CONSTRAINT po_items_container_category_check CHECK (container_category IS NULL OR container_category IN ('dry', 'reefer', 'tank', 'flat_rack', 'open_top'));
  ALTER TABLE public.po_items ADD CONSTRAINT po_items_container_grade_check CHECK (container_grade IS NULL OR container_grade IN ('A', 'B', 'C', 'D', 'as_is'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 2. Which container came from which PO line ------------------------------
CREATE TABLE IF NOT EXISTS public.container_po_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  po_id uuid NOT NULL REFERENCES public.purchase_orders(id) ON DELETE RESTRICT,
  po_item_id uuid NOT NULL REFERENCES public.po_items(id) ON DELETE RESTRICT,
  goods_receipt_id uuid REFERENCES public.goods_receipts(id) ON DELETE SET NULL,
  container_id uuid NOT NULL REFERENCES public.containers(id) ON DELETE RESTRICT,
  received_at date NOT NULL DEFAULT current_date,
  delivery text NOT NULL DEFAULT 'yard' CHECK (delivery IN ('yard', 'direct')),
  customer_id uuid REFERENCES public.customers(id) ON DELETE SET NULL,
  unit_cost numeric(14,2) NOT NULL DEFAULT 0,
  currency text,
  eir_id uuid,
  notes text,
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (container_id)
);
CREATE INDEX IF NOT EXISTS container_po_receipts_po_idx ON public.container_po_receipts (po_id);
ALTER TABLE public.container_po_receipts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS container_po_receipts_select ON public.container_po_receipts;
CREATE POLICY container_po_receipts_select ON public.container_po_receipts FOR SELECT TO authenticated
  USING (organization_id = public.current_org_id() OR public.is_platform_admin());
GRANT SELECT ON public.container_po_receipts TO authenticated;
GRANT ALL ON public.container_po_receipts TO service_role;
COMMENT ON TABLE public.container_po_receipts IS 'Containers received against a container purchase order. Written only by container_po_receive.';

-- 3. Who may do what --------------------------------------------------------
CREATE OR REPLACE FUNCTION public.can_manage_container_po()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT public.is_platform_admin()
      OR public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'org_owner')
      OR public.has_role(auth.uid(), 'accountant')
      OR public.has_role(auth.uid(), 'procurement_officer') OR public.has_role(auth.uid(), 'supply_chain_manager')
      OR public.can_write_module(auth.uid(), 'procurement');
$$;
-- receiving is also open to the yard and the gate
CREATE OR REPLACE FUNCTION public.can_receive_container_po()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT public.can_manage_container_po()
      OR public.has_role(auth.uid(), 'yard_operator') OR public.has_role(auth.uid(), 'gate_clerk');
$$;

-- 4. Receive containers -----------------------------------------------------
-- _units: one object per container:
--   po_item_id (required), container_number (required unless container_id),
--   container_id (an existing container: link only, e.g. from the gate-in screen),
--   received_at (date), delivery ('yard' | 'direct'), customer_id (direct),
--   depot_id, grade (A-D), transporter, truck_registration, driver_name,
--   driver_phone, driver_id_number, transport_vendor, transport_cost,
--   offloading_vendor, offloading_cost, service_currency, notes
CREATE OR REPLACE FUNCTION public.container_po_receive(_po_id uuid, _units jsonb, _notes text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  _po purchase_orders%ROWTYPE;
  _org uuid; _legal text; _supplier text; _base text;
  _u jsonb; _it po_items%ROWTYPE;
  _n int; _need record;
  _gr uuid; _gri uuid; _cid uuid; _num text; _existing record;
  _on date; _last date := NULL; _delivery text; _cost numeric; _cur text;
  _eir uuid; _eir_num text; _appt_num text; _grade text; _svc_cur text;
  _out jsonb := '[]'::jsonb; _all_received boolean; _email text;
  _depot uuid; _cust uuid;
BEGIN
  IF NOT public.can_receive_container_po() THEN
    RAISE EXCEPTION 'You do not have permission to receive containers on a purchase order';
  END IF;
  SELECT * INTO _po FROM purchase_orders WHERE id = _po_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Purchase order not found'; END IF;
  _org := _po.organization_id;
  IF _org <> public.current_org_id() AND NOT public.is_platform_admin() THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF COALESCE(_po.po_type, 'materials') <> 'containers' THEN
    RAISE EXCEPTION '% is not a container purchase order', _po.po_number;
  END IF;
  IF COALESCE(_po.approval_status::text, 'not_required') IN ('pending', 'rejected') THEN
    RAISE EXCEPTION '% is % approval — it cannot be received yet', _po.po_number,
      CASE WHEN _po.approval_status::text = 'pending' THEN 'awaiting' ELSE 'rejected at' END;
  END IF;
  IF _po.status NOT IN ('confirmed', 'partially_received') THEN
    RAISE EXCEPTION '% is %: containers can be received once the supplier has confirmed the order',
      _po.po_number, replace(_po.status, '_', ' ');
  END IF;
  IF jsonb_typeof(_units) <> 'array' OR jsonb_array_length(_units) = 0 THEN
    RAISE EXCEPTION 'Enter at least one container';
  END IF;

  -- not more than ordered on any line
  FOR _need IN
    SELECT (u->>'po_item_id')::uuid AS item_id, count(*) AS n
      FROM jsonb_array_elements(_units) u GROUP BY 1
  LOOP
    SELECT * INTO _it FROM po_items WHERE id = _need.item_id AND po_id = _po_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'A container is not on a line of %', _po.po_number; END IF;
    IF _need.n > greatest(_it.quantity - COALESCE(_it.received_qty, 0), 0) THEN
      RAISE EXCEPTION '"%": % ordered, % already received — % more is too many',
        _it.description, _it.quantity::int, COALESCE(_it.received_qty, 0)::int, _need.n;
    END IF;
  END LOOP;

  _legal := public.depot_legal_name(_org);
  SELECT name INTO _supplier FROM suppliers WHERE id = _po.supplier_id;
  SELECT currency INTO _base FROM organizations WHERE id = _org;
  _cur := upper(COALESCE(NULLIF(btrim(_po.currency), ''), _base, 'KES'));
  SELECT email INTO _email FROM auth.users WHERE id = auth.uid();

  SELECT max(COALESCE(NULLIF(u->>'received_at', '')::date, current_date)) INTO _last FROM jsonb_array_elements(_units) u;
  INSERT INTO goods_receipts (po_id, received_by, received_at, notes, organization_id, has_variance,
                              approval_status, submitted_by, submitted_at)
  VALUES (_po_id, auth.uid(), (_last::timestamp + time '12:00') AT TIME ZONE 'Africa/Nairobi',
          COALESCE(NULLIF(btrim(_notes), ''), 'Containers received'), _org, false, 'auto_posted', auth.uid(), now())
  RETURNING id INTO _gr;

  FOR _u IN SELECT * FROM jsonb_array_elements(_units) LOOP
    SELECT * INTO _it FROM po_items WHERE id = (_u->>'po_item_id')::uuid;
    _on := COALESCE(NULLIF(_u->>'received_at', '')::date, current_date);
    _delivery := CASE WHEN _u->>'delivery' = 'direct' THEN 'direct' ELSE 'yard' END;
    _cost := round(COALESCE(NULLIF(_it.landed_unit_cost, 0), _it.unit_price, 0), 2);
    _grade := upper(NULLIF(btrim(COALESCE(_u->>'grade', _it.container_grade, '')), ''));
    IF _grade IS NULL OR _grade NOT IN ('A', 'B', 'C', 'D') THEN _grade := NULL; END IF;
    _cust := NULLIF(_u->>'customer_id', '')::uuid;
    _depot := NULLIF(_u->>'depot_id', '')::uuid;
    IF _delivery = 'direct' AND _cust IS NULL THEN
      RAISE EXCEPTION 'Pick the customer for a container delivered direct';
    END IF;
    _eir := NULL;

    -- the container
    _cid := NULLIF(_u->>'container_id', '')::uuid;
    _num := upper(regexp_replace(COALESCE(_u->>'container_number', ''), '[^A-Za-z0-9]', '', 'g'));
    IF _cid IS NULL THEN
      IF length(_num) < 4 THEN RAISE EXCEPTION 'Enter the container number for each container'; END IF;
      SELECT id INTO _cid FROM containers WHERE organization_id = _org AND upper(regexp_replace(container_number, '[^A-Za-z0-9]', '', 'g')) = _num LIMIT 1;
    END IF;

    IF _cid IS NOT NULL THEN
      SELECT c.id, c.container_number, r.po_id, p.po_number INTO _existing
        FROM containers c
        LEFT JOIN container_po_receipts r ON r.container_id = c.id
        LEFT JOIN purchase_orders p ON p.id = r.po_id
       WHERE c.id = _cid AND c.organization_id = _org;
      IF NOT FOUND THEN RAISE EXCEPTION 'Container not found'; END IF;
      IF _existing.po_id IS NOT NULL THEN
        RAISE EXCEPTION '% was already received on %', _existing.container_number, _existing.po_number;
      END IF;
      IF EXISTS (SELECT 1 FROM supplier_invoices si WHERE si.container_id = _cid AND si.reason = 'purchase'
                    AND si.status <> 'cancelled') THEN
        RAISE EXCEPTION '% already has a purchase bill — it cannot be received on % as well', _existing.container_number, _po.po_number;
      END IF;
      UPDATE containers SET owner = _legal, ownership_type = 'depot_owned',
             acquisition_cost = _cost, acquisition_currency = _cur,
             customer_id = COALESCE(_cust, customer_id), updated_at = now()
       WHERE id = _cid;
      _num := _existing.container_number;
    ELSE
      IF _it.container_size IS NULL THEN
        RAISE EXCEPTION 'Line "%" has no container size — edit the order first', _it.description;
      END IF;
      INSERT INTO containers (container_number, organization_id, size, height_class, category,
                              owner, ownership_type, status, is_empty, depot_id, customer_id, gate_in_at,
                              pickup_location, transporter, truck_registration, driver_name, driver_phone, driver_id_number,
                              acquisition_cost, acquisition_currency,
                              transport_vendor, transport_cost, transport_currency,
                              offloading_vendor, offloading_cost, offloading_currency, notes)
      VALUES (_num, _org, _it.container_size::container_size, _it.container_height::container_height_class,
              COALESCE(_it.container_category, 'dry')::container_category,
              _legal, 'depot_owned',
              CASE WHEN _delivery = 'direct' THEN 'allocated' ELSE 'available' END::container_status,
              true,
              CASE WHEN _delivery = 'yard' THEN _depot END,
              _cust,
              CASE WHEN _delivery = 'yard' THEN (_on::timestamp + time '12:00') AT TIME ZONE 'Africa/Nairobi' END,
              _po.pickup_location,
              NULLIF(btrim(_u->>'transporter'), ''), NULLIF(btrim(_u->>'truck_registration'), ''),
              NULLIF(btrim(_u->>'driver_name'), ''), NULLIF(btrim(_u->>'driver_phone'), ''), NULLIF(btrim(_u->>'driver_id_number'), ''),
              _cost, _cur,
              NULLIF(btrim(_u->>'transport_vendor'), ''), COALESCE(NULLIF(_u->>'transport_cost', '')::numeric, 0),
              upper(COALESCE(NULLIF(_u->>'service_currency', ''), _cur)),
              NULLIF(btrim(_u->>'offloading_vendor'), ''), COALESCE(NULLIF(_u->>'offloading_cost', '')::numeric, 0),
              upper(COALESCE(NULLIF(_u->>'service_currency', ''), _cur)),
              concat_ws(' · ', 'Bought on ' || _po.po_number || COALESCE(' from ' || _supplier, ''),
                        CASE WHEN _delivery = 'direct' THEN 'Delivered direct to the customer — raise the sale in Container Sales' END,
                        NULLIF(btrim(_u->>'notes'), '')))
      RETURNING id INTO _cid;

      IF _delivery = 'yard' THEN
        _appt_num := 'APT-PO-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
        INSERT INTO gate_appointments (appointment_number, appointment_type, scheduled_at, container_number, container_id,
                                       truck_plate, driver_name, shipping_line, status, notes, organization_id, created_by)
        VALUES (_appt_num, 'gate_in', (_on::timestamp + time '12:00') AT TIME ZONE 'Africa/Nairobi', _num, _cid,
                NULLIF(btrim(_u->>'truck_registration'), ''), NULLIF(btrim(_u->>'driver_name'), ''), _supplier,
                'completed', 'Received on ' || _po.po_number, _org, auth.uid());

        _eir_num := public.next_eir_number('EIR');
        INSERT INTO eir_records (eir_number, container_id, eir_type, condition_grade, cargo_status,
                                 transporter_company, truck_plate, driver_name, driver_phone, driver_id_number,
                                 origin_location, release_purpose, acquisition_supplier,
                                 purchase_price_snapshot, purchase_price_currency, inspector_notes,
                                 completed_at, organization_id, created_by)
        VALUES (_eir_num, _cid, 'gate_in', COALESCE(_grade, 'A')::condition_grade, 'empty',
                NULLIF(btrim(_u->>'transporter'), ''), NULLIF(btrim(_u->>'truck_registration'), ''),
                NULLIF(btrim(_u->>'driver_name'), ''), NULLIF(btrim(_u->>'driver_phone'), ''), NULLIF(btrim(_u->>'driver_id_number'), ''),
                _po.pickup_location, 'depot_purchase', _supplier, _cost, _cur,
                'Bought on ' || _po.po_number, (_on::timestamp + time '12:00') AT TIME ZONE 'Africa/Nairobi', _org, auth.uid())
        RETURNING id INTO _eir;

        INSERT INTO container_movements (container_id, movement_type, notes, organization_id, performed_by)
        VALUES (_cid, 'gate_in', 'Received on ' || _po.po_number || COALESCE(' from ' || _supplier, ''), _org, auth.uid());
      END IF;

      -- transport and crane / offloading bills, as for any container received
      _svc_cur := upper(COALESCE(NULLIF(_u->>'service_currency', ''), _cur));
      IF NULLIF(btrim(_u->>'transport_vendor'), '') IS NOT NULL AND COALESCE(NULLIF(_u->>'transport_cost', '')::numeric, 0) > 0 THEN
        PERFORM public.record_container_service_invoice(_cid, btrim(_u->>'transport_vendor'), (_u->>'transport_cost')::numeric,
                                                        _svc_cur, 'transport', _num, NULL);
      END IF;
      IF NULLIF(btrim(_u->>'offloading_vendor'), '') IS NOT NULL AND COALESCE(NULLIF(_u->>'offloading_cost', '')::numeric, 0) > 0 THEN
        PERFORM public.record_container_service_invoice(_cid, btrim(_u->>'offloading_vendor'), (_u->>'offloading_cost')::numeric,
                                                        _svc_cur, 'crane_offloading', _num, NULL);
      END IF;
    END IF;

    INSERT INTO container_po_receipts (organization_id, po_id, po_item_id, goods_receipt_id, container_id, received_at,
                                       delivery, customer_id, unit_cost, currency, eir_id, notes)
    VALUES (_org, _po_id, _it.id, _gr, _cid, _on, _delivery, _cust, _cost, _cur, _eir, NULLIF(btrim(_u->>'notes'), ''));

    _out := _out || jsonb_build_object('container_id', _cid, 'container_number', _num, 'delivery', _delivery, 'eir_id', _eir);
  END LOOP;

  -- the goods receipt lines (posted to the ledger when the transaction commits)
  FOR _need IN
    SELECT (u->>'po_item_id')::uuid AS item_id, count(*) AS n FROM jsonb_array_elements(_units) u GROUP BY 1
  LOOP
    SELECT * INTO _it FROM po_items WHERE id = _need.item_id;
    INSERT INTO goods_receipt_items (receipt_id, po_item_id, received_qty, ordered_qty, variance_type, organization_id,
                                     is_vatable, tax_rate)
    VALUES (_gr, _it.id, _need.n, _need.n, 'exact', _org, COALESCE(_it.is_vatable, false), COALESCE(_it.tax_rate, 0))
    RETURNING id INTO _gri;
    INSERT INTO goods_receipt_audit (receipt_id, receipt_item_id, po_id, action, actor_user_id, actor_email, organization_id, payload)
    VALUES (_gr, _gri, _po_id, 'submitted', auth.uid(), _email, _org,
            jsonb_build_object('po_item_id', _it.id, 'description', _it.description, 'received_qty', _need.n, 'kind', 'containers'));
  END LOOP;
  PERFORM public.post_receipt_stock(_gr);   -- moves po_items.received_qty

  SELECT bool_and(COALESCE(received_qty, 0) >= quantity) INTO _all_received FROM po_items WHERE po_id = _po_id;
  UPDATE purchase_orders SET status = CASE WHEN COALESCE(_all_received, true) THEN 'received' ELSE 'partially_received' END
   WHERE id = _po_id;

  INSERT INTO goods_receipt_audit (receipt_id, po_id, action, actor_user_id, actor_email, organization_id, payload)
  VALUES (_gr, _po_id, 'inventory_posted', auth.uid(), _email, _org,
          jsonb_build_object('containers', jsonb_array_length(_units), 'kind', 'containers'));

  RETURN jsonb_build_object('receipt_id', _gr, 'containers', _out,
                            'status', (SELECT status FROM purchase_orders WHERE id = _po_id));
END $$;

-- 5. The supplier's invoice -------------------------------------------------
-- One bill per PO, for the PO total. Like every PO bill it carries no ledger
-- entry of its own: the payable is posted when the containers are received.
CREATE OR REPLACE FUNCTION public.container_po_record_bill(_po_id uuid, _supplier_ref text, _issue_date date DEFAULT NULL,
                                                           _due_date date DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _po purchase_orders%ROWTYPE; _inv uuid; _amt numeric; _tax numeric;
BEGIN
  IF NOT public.can_manage_container_po() THEN RAISE EXCEPTION 'You do not have permission to record supplier invoices'; END IF;
  SELECT * INTO _po FROM purchase_orders WHERE id = _po_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Purchase order not found'; END IF;
  IF _po.organization_id <> public.current_org_id() AND NOT public.is_platform_admin() THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF COALESCE(_po.po_type, 'materials') <> 'containers' THEN RAISE EXCEPTION '% is not a container purchase order', _po.po_number; END IF;
  IF _po.status IN ('draft', 'cancelled') THEN RAISE EXCEPTION '% is % — send and confirm it first', _po.po_number, _po.status; END IF;
  IF NULLIF(btrim(COALESCE(_supplier_ref, '')), '') IS NULL THEN RAISE EXCEPTION 'Enter the supplier''s invoice number'; END IF;

  SELECT id INTO _inv FROM supplier_invoices WHERE purchase_order_id = _po_id AND status <> 'cancelled' ORDER BY created_at LIMIT 1;
  IF _inv IS NULL THEN
    _inv := public.ensure_supplier_invoice_for_po(_po_id);
  END IF;
  IF _inv IS NULL THEN RAISE EXCEPTION 'The PO has no amount to bill'; END IF;

  _amt := round(COALESCE(NULLIF(_po.total_cost, 0), 0), 2);
  _tax := LEAST(GREATEST(round(COALESCE(_po.tax_total, 0), 2), 0), _amt);
  UPDATE supplier_invoices
     SET supplier_ref = btrim(_supplier_ref),
         issue_date = COALESCE(_issue_date, issue_date),
         due_date = COALESCE(_due_date, COALESCE(_issue_date, issue_date) + 30),
         subtotal = CASE WHEN COALESCE(paid_amount, 0) <= _amt THEN _amt - _tax ELSE subtotal END,
         tax_amount = CASE WHEN COALESCE(paid_amount, 0) <= _amt THEN _tax ELSE tax_amount END,
         total_amount = CASE WHEN COALESCE(paid_amount, 0) <= _amt THEN _amt ELSE total_amount END,
         notes = concat_ws(E'\n', NULLIF(notes, ''), 'Supplier invoice ' || btrim(_supplier_ref) || ' for ' || _po.po_number),
         updated_at = now()
   WHERE id = _inv;
  RETURN _inv;
END $$;

-- 6. Close short: stop waiting for undelivered containers -------------------
CREATE OR REPLACE FUNCTION public.container_po_close_short(_po_id uuid, _reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _po purchase_orders%ROWTYPE; _short numeric; _new_total numeric; _paid numeric; _inv uuid; _tax numeric;
BEGIN
  IF NOT public.can_manage_container_po() THEN RAISE EXCEPTION 'You do not have permission to change this order'; END IF;
  IF NULLIF(btrim(COALESCE(_reason, '')), '') IS NULL THEN RAISE EXCEPTION 'Give a reason'; END IF;
  SELECT * INTO _po FROM purchase_orders WHERE id = _po_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Purchase order not found'; END IF;
  IF _po.organization_id <> public.current_org_id() AND NOT public.is_platform_admin() THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF COALESCE(_po.po_type, 'materials') <> 'containers' THEN RAISE EXCEPTION '% is not a container purchase order', _po.po_number; END IF;
  IF _po.status NOT IN ('confirmed', 'partially_received') THEN
    RAISE EXCEPTION '% is % — only an order still waiting for containers can be closed short', _po.po_number, replace(_po.status, '_', ' ');
  END IF;

  SELECT COALESCE(sum(quantity - COALESCE(received_qty, 0)), 0) INTO _short FROM po_items WHERE po_id = _po_id;

  IF NOT EXISTS (SELECT 1 FROM po_items WHERE po_id = _po_id AND COALESCE(received_qty, 0) > 0) THEN
    UPDATE purchase_orders SET status = 'cancelled' WHERE id = _po_id;
  ELSE
    UPDATE po_items SET quantity = COALESCE(received_qty, 0),
                        total_cost = round(COALESCE(received_qty, 0) * unit_price, 2)
     WHERE po_id = _po_id AND quantity > COALESCE(received_qty, 0);
    -- delete lines with nothing received
    DELETE FROM po_items i WHERE i.po_id = _po_id AND COALESCE(i.received_qty, 0) = 0
       AND NOT EXISTS (SELECT 1 FROM goods_receipt_items g WHERE g.po_item_id = i.id)
       AND NOT EXISTS (SELECT 1 FROM container_po_receipts r WHERE r.po_item_id = i.id);
    UPDATE purchase_orders SET status = 'received' WHERE id = _po_id;
  END IF;

  SELECT CASE WHEN status = 'cancelled' THEN 0 ELSE total_cost END, tax_total INTO _new_total, _tax
    FROM purchase_orders WHERE id = _po_id;
  -- the bill follows the order
  SELECT id, COALESCE(paid_amount, 0) INTO _inv, _paid FROM supplier_invoices
   WHERE purchase_order_id = _po_id AND status <> 'cancelled' ORDER BY created_at LIMIT 1;
  IF _inv IS NOT NULL THEN
    IF COALESCE(_new_total, 0) <= 0 AND _paid = 0 THEN
      UPDATE supplier_invoices SET status = 'cancelled', updated_at = now(),
             notes = concat_ws(E'\n', NULLIF(notes, ''), 'Cancelled: order closed short — ' || btrim(_reason))
       WHERE id = _inv;
    ELSIF COALESCE(_new_total, 0) <= 0 THEN
      -- payments already set against it: leave it for finance to settle with the supplier
      UPDATE supplier_invoices SET updated_at = now(),
             notes = concat_ws(E'\n', NULLIF(notes, ''), 'Order cancelled with nothing delivered — ' || btrim(_reason)
                               || '. Payments made are owed back by the supplier.')
       WHERE id = _inv;
    ELSE
      UPDATE supplier_invoices
         SET total_amount = round(COALESCE(_new_total, 0), 2),
             tax_amount = LEAST(GREATEST(round(COALESCE(_tax, 0), 2), 0), round(COALESCE(_new_total, 0), 2)),
             subtotal = round(COALESCE(_new_total, 0), 2) - LEAST(GREATEST(round(COALESCE(_tax, 0), 2), 0), round(COALESCE(_new_total, 0), 2)),
             notes = concat_ws(E'\n', NULLIF(notes, ''), 'Reduced to the containers delivered: ' || btrim(_reason)),
             updated_at = now()
       WHERE id = _inv;
    END IF;
  END IF;

  INSERT INTO finance_audit_log (organization_id, entity_type, entity_id, action, summary)
  VALUES (_po.organization_id, 'purchase_orders', _po_id, 'container_po_closed_short',
          jsonb_build_object('po_number', _po.po_number, 'units_not_delivered', _short, 'reason', btrim(_reason),
                             'old_total', _po.total_cost, 'new_total', _new_total,
                             'advance_not_used', public.po_advance_balance(_po_id)));

  RETURN jsonb_build_object('units_not_delivered', _short, 'new_total', COALESCE(_new_total, 0),
                            'advance_not_used', greatest(public.po_advance_balance(_po_id), 0),
                            'status', (SELECT status FROM purchase_orders WHERE id = _po_id));
END $$;

-- 7. One line per container PO for the screen and the reports ---------------
CREATE OR REPLACE VIEW public.v_container_po_summary WITH (security_invoker = on) AS
SELECT po.id AS po_id, po.organization_id, po.po_number, po.supplier_id, po.status, po.approval_status,
       po.currency, po.total_cost, po.order_date, po.expected_delivery, po.created_at,
       COALESCE((SELECT sum(i.quantity) FROM po_items i WHERE i.po_id = po.id), 0)::int AS units_ordered,
       (SELECT count(*) FROM container_po_receipts r WHERE r.po_id = po.id)::int AS units_received,
       COALESCE((SELECT sum(r.unit_cost) FROM container_po_receipts r WHERE r.po_id = po.id), 0) AS value_received,
       b.id AS bill_id, b.invoice_number AS bill_number, b.supplier_ref AS bill_supplier_ref,
       COALESCE(b.total_amount, 0) AS billed,
       COALESCE((SELECT sum(v.amount) FROM vendor_payments v WHERE v.po_id = po.id
                  AND COALESCE(v.approval_status::text, 'not_required') NOT IN ('pending', 'rejected')), 0) AS paid,
       COALESCE((SELECT sum(v.amount) FROM vendor_payments v WHERE v.po_id = po.id
                  AND COALESCE(v.approval_status::text, 'not_required') = 'pending'), 0) AS paid_pending_approval
  FROM purchase_orders po
  LEFT JOIN LATERAL (SELECT si.id, si.invoice_number, si.supplier_ref, si.total_amount FROM supplier_invoices si
                      WHERE si.purchase_order_id = po.id AND si.status <> 'cancelled'
                      ORDER BY si.created_at LIMIT 1) b ON true
 WHERE po.po_type = 'containers';
GRANT SELECT ON public.v_container_po_summary TO authenticated;

-- 8. A container received on a PO is never billed again to an "owner" ------
DO $$
DECLARE _def text;
        _anchor text := 'IF _container_id IS NULL OR _amount IS NULL OR _amount <= 0 THEN RETURN NULL; END IF;';
        _guard text := E'\n\n  -- GUARD PO: bought on a container purchase order; the PO carries the cost.\n'
          || E'  IF EXISTS (SELECT 1 FROM public.container_po_receipts r WHERE r.container_id = _container_id) THEN\n'
          || E'    INSERT INTO public.finance_audit_log (organization_id, entity_type, entity_id, action, summary)\n'
          || E'    VALUES (current_org_id(), ''containers'', _container_id, ''acquisition_skipped_bought_on_po'',\n'
          || E'      jsonb_build_object(''reason'', _reason, ''reference'', _reference, ''amount'', _amount));\n'
          || E'    RETURN (SELECT r.po_id FROM public.container_po_receipts r WHERE r.container_id = _container_id);\n'
          || E'  END IF;';
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO _def FROM pg_proc p
   WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'acquire_container_from_owner';
  IF _def IS NULL THEN RAISE EXCEPTION 'acquire_container_from_owner not found'; END IF;
  IF position('GUARD PO:' IN _def) = 0 THEN
    IF position(_anchor IN _def) = 0 THEN RAISE EXCEPTION 'acquire_container_from_owner: anchor not found'; END IF;
    EXECUTE replace(_def, _anchor, _anchor || _guard);
  END IF;
END $$;

REVOKE ALL ON FUNCTION public.container_po_receive(uuid, jsonb, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.container_po_record_bill(uuid, text, date, date) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.container_po_close_short(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.container_po_receive(uuid, jsonb, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.container_po_record_bill(uuid, text, date, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.container_po_close_short(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_manage_container_po() TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_receive_container_po() TO authenticated;
