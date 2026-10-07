
-- ============================================================
-- LOGISTICS MODULE — Schema, RLS, helpers
-- ============================================================

-- Enums
CREATE TYPE logistics_carrier_type AS ENUM ('internal', 'subcontractor');
CREATE TYPE logistics_rate_type AS ENUM ('per_trip', 'per_km', 'per_container');
CREATE TYPE logistics_vehicle_type AS ENUM ('truck', 'trailer', 'prime_mover');
CREATE TYPE logistics_vehicle_status AS ENUM ('available', 'on_trip', 'maintenance', 'retired');
CREATE TYPE logistics_order_type AS ENUM ('shuttle', 'custom');
CREATE TYPE logistics_order_status AS ENUM ('draft','confirmed','assigned','in_transit','delivered','invoiced','cancelled');
CREATE TYPE logistics_trip_status AS ENUM ('planned','dispatched','in_transit','completed','cancelled');
CREATE TYPE logistics_billing_mode AS ENUM ('per_trip','periodic');
CREATE TYPE logistics_billing_cycle AS ENUM ('weekly','biweekly','monthly');
CREATE TYPE logistics_cost_category AS ENUM (
  'fuel','driver_allowance','tolls','parking','repairs',
  'subcontractor','loading','permits','other'
);

-- Module catalog entry
INSERT INTO modules_catalog (code, name, description, monthly_price, is_core, sort_order)
VALUES ('logistics','Logistics','Shuttle ops, custom transport orders, fleet & subcontractors with per-trip costing', 79.00, false, 95)
ON CONFLICT (code) DO NOTHING;

-- ============================================================
-- Carriers (internal + subcontractors)
-- ============================================================
CREATE TABLE public.logistics_carriers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL DEFAULT current_org_id() REFERENCES organizations(id),
  name text NOT NULL,
  type logistics_carrier_type NOT NULL DEFAULT 'internal',
  supplier_id uuid REFERENCES suppliers(id),
  contact_name text,
  contact_phone text,
  contact_email text,
  default_currency text DEFAULT 'USD',
  notes text,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(organization_id, name)
);

-- ============================================================
-- Vehicles
-- ============================================================
CREATE TABLE public.logistics_vehicles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL DEFAULT current_org_id() REFERENCES organizations(id),
  registration text NOT NULL,
  type logistics_vehicle_type NOT NULL DEFAULT 'truck',
  make text,
  model text,
  capacity_tons numeric(10,2),
  container_slots int DEFAULT 1,
  ownership text DEFAULT 'own', -- own | leased
  carrier_id uuid REFERENCES logistics_carriers(id),
  status logistics_vehicle_status NOT NULL DEFAULT 'available',
  odometer numeric(12,2) DEFAULT 0,
  insurance_expiry date,
  notes text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(organization_id, registration)
);

-- ============================================================
-- Drivers
-- ============================================================
CREATE TABLE public.logistics_drivers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL DEFAULT current_org_id() REFERENCES organizations(id),
  name text NOT NULL,
  phone text,
  license_no text,
  license_expiry date,
  carrier_id uuid REFERENCES logistics_carriers(id),
  status text DEFAULT 'available',
  notes text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ============================================================
-- Routes
-- ============================================================
CREATE TABLE public.logistics_routes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL DEFAULT current_org_id() REFERENCES organizations(id),
  code text NOT NULL,
  name text NOT NULL,
  origin text NOT NULL,
  destination text NOT NULL,
  distance_km numeric(10,2),
  default_duration_min int,
  default_carrier_id uuid REFERENCES logistics_carriers(id),
  default_rate numeric(14,2) DEFAULT 0,
  currency text DEFAULT 'USD',
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(organization_id, code)
);

-- ============================================================
-- Carrier Rate cards
-- ============================================================
CREATE TABLE public.logistics_carrier_rates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL DEFAULT current_org_id() REFERENCES organizations(id),
  carrier_id uuid NOT NULL REFERENCES logistics_carriers(id) ON DELETE CASCADE,
  route_id uuid REFERENCES logistics_routes(id),
  rate_type logistics_rate_type NOT NULL DEFAULT 'per_trip',
  container_size text, -- 20ft, 40ft, etc, nullable
  amount numeric(14,2) NOT NULL,
  currency text DEFAULT 'USD',
  effective_from date NOT NULL DEFAULT CURRENT_DATE,
  effective_to date,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ============================================================
-- Shuttle Schedules
-- ============================================================
CREATE TABLE public.logistics_shuttle_schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL DEFAULT current_org_id() REFERENCES organizations(id),
  route_id uuid NOT NULL REFERENCES logistics_routes(id) ON DELETE CASCADE,
  name text NOT NULL,
  days_of_week int[] NOT NULL DEFAULT '{1,2,3,4,5}', -- 0=Sun..6=Sat
  departure_times text[] NOT NULL DEFAULT '{"08:00"}',
  default_vehicle_id uuid REFERENCES logistics_vehicles(id),
  default_driver_id uuid REFERENCES logistics_drivers(id),
  default_carrier_id uuid REFERENCES logistics_carriers(id),
  auto_create_trips boolean NOT NULL DEFAULT false,
  lead_days int NOT NULL DEFAULT 1,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ============================================================
-- Transport Orders
-- ============================================================
CREATE TABLE public.logistics_transport_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL DEFAULT current_org_id() REFERENCES organizations(id),
  ref text NOT NULL,
  customer_id uuid REFERENCES customers(id),
  customer_name text,
  order_type logistics_order_type NOT NULL DEFAULT 'custom',
  service_date date NOT NULL,
  pickup_location text NOT NULL,
  dropoff_location text NOT NULL,
  route_id uuid REFERENCES logistics_routes(id),
  container_ids uuid[],
  cargo_description text,
  qty int DEFAULT 1,
  quoted_price numeric(14,2) NOT NULL DEFAULT 0,
  currency text DEFAULT 'USD',
  billing_mode logistics_billing_mode NOT NULL DEFAULT 'per_trip',
  status logistics_order_status NOT NULL DEFAULT 'draft',
  special_instructions text,
  invoice_id uuid REFERENCES invoices(id),
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(organization_id, ref)
);
CREATE INDEX idx_lto_org_status ON logistics_transport_orders(organization_id, status);
CREATE INDEX idx_lto_customer ON logistics_transport_orders(customer_id);
CREATE INDEX idx_lto_service_date ON logistics_transport_orders(service_date);

-- ============================================================
-- Trips
-- ============================================================
CREATE TABLE public.logistics_trips (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL DEFAULT current_org_id() REFERENCES organizations(id),
  ref text NOT NULL,
  trip_date date NOT NULL,
  carrier_id uuid REFERENCES logistics_carriers(id),
  vehicle_id uuid REFERENCES logistics_vehicles(id),
  driver_id uuid REFERENCES logistics_drivers(id),
  route_id uuid REFERENCES logistics_routes(id),
  shuttle_schedule_id uuid REFERENCES logistics_shuttle_schedules(id),
  planned_distance_km numeric(10,2),
  actual_distance_km numeric(10,2),
  departure_at timestamptz,
  arrival_at timestamptz,
  status logistics_trip_status NOT NULL DEFAULT 'planned',
  odometer_start numeric(12,2),
  odometer_end numeric(12,2),
  notes text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(organization_id, ref)
);
CREATE INDEX idx_ltrip_org_status ON logistics_trips(organization_id, status);
CREATE INDEX idx_ltrip_date ON logistics_trips(trip_date);

-- ============================================================
-- Trip Legs
-- ============================================================
CREATE TABLE public.logistics_trip_legs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL DEFAULT current_org_id() REFERENCES organizations(id),
  trip_id uuid NOT NULL REFERENCES logistics_trips(id) ON DELETE CASCADE,
  sequence int NOT NULL DEFAULT 1,
  transport_order_id uuid REFERENCES logistics_transport_orders(id),
  pickup_location text,
  dropoff_location text,
  pickup_at timestamptz,
  dropoff_at timestamptz,
  container_id uuid,
  signed_pod_url text,
  pod_signed_by text,
  pod_signed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_ltleg_trip ON logistics_trip_legs(trip_id);
CREATE INDEX idx_ltleg_order ON logistics_trip_legs(transport_order_id);

-- ============================================================
-- Trip Costs
-- ============================================================
CREATE TABLE public.logistics_trip_costs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL DEFAULT current_org_id() REFERENCES organizations(id),
  trip_id uuid NOT NULL REFERENCES logistics_trips(id) ON DELETE CASCADE,
  category logistics_cost_category NOT NULL,
  description text,
  amount numeric(14,2) NOT NULL,
  currency text DEFAULT 'USD',
  supplier_id uuid REFERENCES suppliers(id),
  expense_txn_id uuid REFERENCES accounting_transactions(id),
  receipt_url text,
  recorded_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_ltcost_trip ON logistics_trip_costs(trip_id);

-- ============================================================
-- Trip Revenue
-- ============================================================
CREATE TABLE public.logistics_trip_revenue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL DEFAULT current_org_id() REFERENCES organizations(id),
  trip_id uuid NOT NULL REFERENCES logistics_trips(id) ON DELETE CASCADE,
  transport_order_id uuid REFERENCES logistics_transport_orders(id),
  amount numeric(14,2) NOT NULL,
  currency text DEFAULT 'USD',
  invoice_id uuid REFERENCES invoices(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_ltrev_trip ON logistics_trip_revenue(trip_id);

-- ============================================================
-- P&L view
-- ============================================================
CREATE OR REPLACE VIEW public.logistics_trip_pnl AS
SELECT
  t.id AS trip_id,
  t.organization_id,
  t.ref,
  t.trip_date,
  t.route_id,
  t.carrier_id,
  t.vehicle_id,
  COALESCE((SELECT SUM(amount) FROM logistics_trip_revenue r WHERE r.trip_id = t.id), 0) AS revenue,
  COALESCE((SELECT SUM(amount) FROM logistics_trip_costs c WHERE c.trip_id = t.id), 0) AS total_cost,
  COALESCE((SELECT SUM(amount) FROM logistics_trip_revenue r WHERE r.trip_id = t.id), 0)
    - COALESCE((SELECT SUM(amount) FROM logistics_trip_costs c WHERE c.trip_id = t.id), 0) AS gross_margin,
  CASE
    WHEN COALESCE((SELECT SUM(amount) FROM logistics_trip_revenue r WHERE r.trip_id = t.id), 0) = 0 THEN NULL
    ELSE ROUND(
      ((COALESCE((SELECT SUM(amount) FROM logistics_trip_revenue r WHERE r.trip_id = t.id), 0)
        - COALESCE((SELECT SUM(amount) FROM logistics_trip_costs c WHERE c.trip_id = t.id), 0))
       / COALESCE((SELECT SUM(amount) FROM logistics_trip_revenue r WHERE r.trip_id = t.id), 0)) * 100, 2)
  END AS margin_pct
FROM logistics_trips t;

-- ============================================================
-- Customer billing prefs
-- ============================================================
ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS logistics_billing_mode logistics_billing_mode DEFAULT 'per_trip',
  ADD COLUMN IF NOT EXISTS logistics_billing_cycle logistics_billing_cycle DEFAULT 'monthly';

-- ============================================================
-- Updated-at triggers (reuse existing fn)
-- ============================================================
DO $$
DECLARE
  t text;
BEGIN
  FOR t IN SELECT unnest(ARRAY[
    'logistics_carriers','logistics_vehicles','logistics_drivers',
    'logistics_routes','logistics_shuttle_schedules',
    'logistics_transport_orders','logistics_trips'
  ])
  LOOP
    EXECUTE format(
      'CREATE TRIGGER %I_updated_at BEFORE UPDATE ON public.%I
       FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column()',
      t, t
    );
  END LOOP;
END $$;

-- ============================================================
-- RLS
-- ============================================================
DO $$
DECLARE t text;
BEGIN
  FOR t IN SELECT unnest(ARRAY[
    'logistics_carriers','logistics_vehicles','logistics_drivers',
    'logistics_routes','logistics_shuttle_schedules','logistics_carrier_rates',
    'logistics_transport_orders','logistics_trips','logistics_trip_legs',
    'logistics_trip_costs','logistics_trip_revenue'
  ])
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY "%s_org_select" ON public.%I FOR SELECT
       USING (organization_id = current_org_id() OR is_platform_admin())',
      t, t
    );
    EXECUTE format(
      'CREATE POLICY "%s_org_write" ON public.%I FOR ALL
       USING (organization_id = current_org_id() OR is_platform_admin())
       WITH CHECK (organization_id = current_org_id() OR is_platform_admin())',
      t, t
    );
  END LOOP;
END $$;

-- ============================================================
-- Helper: generate next ref
-- ============================================================
CREATE OR REPLACE FUNCTION public.logistics_next_ref(_prefix text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _seq int;
BEGIN
  IF _prefix = 'TO' THEN
    SELECT COALESCE(MAX(NULLIF(regexp_replace(ref, '\D','','g'),'')::int),0)+1
      INTO _seq FROM logistics_transport_orders WHERE organization_id = current_org_id();
  ELSIF _prefix = 'TR' THEN
    SELECT COALESCE(MAX(NULLIF(regexp_replace(ref, '\D','','g'),'')::int),0)+1
      INTO _seq FROM logistics_trips WHERE organization_id = current_org_id();
  ELSE
    _seq := 1;
  END IF;
  RETURN _prefix || '-' || lpad(_seq::text, 6, '0');
END $$;

-- ============================================================
-- RPC: post trip cost as accounting expense
-- ============================================================
CREATE OR REPLACE FUNCTION public.logistics_post_trip_cost(_cost_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _cost logistics_trip_costs%ROWTYPE;
  _trip logistics_trips%ROWTYPE;
  _txn_id uuid;
BEGIN
  SELECT * INTO _cost FROM logistics_trip_costs WHERE id = _cost_id
    AND organization_id = current_org_id();
  IF _cost.id IS NULL THEN
    RAISE EXCEPTION 'cost_not_found';
  END IF;
  IF _cost.expense_txn_id IS NOT NULL THEN
    RETURN _cost.expense_txn_id;
  END IF;
  SELECT * INTO _trip FROM logistics_trips WHERE id = _cost.trip_id;

  INSERT INTO accounting_transactions (
    organization_id, transaction_number, transaction_date, account_type,
    category, description, debit_amount, credit_amount,
    reference_type, reference_id, created_by
  ) VALUES (
    _cost.organization_id,
    'LOG-COST-' || substr(_cost.id::text, 1, 8),
    now(), 'expense',
    'Logistics: ' || _cost.category::text,
    COALESCE(_cost.description, _trip.ref || ' - ' || _cost.category::text),
    _cost.amount, 0,
    'logistics_trip_cost', _cost.id, _cost.recorded_by
  ) RETURNING id INTO _txn_id;

  UPDATE logistics_trip_costs SET expense_txn_id = _txn_id WHERE id = _cost.id;
  RETURN _txn_id;
END $$;

-- ============================================================
-- RPC: invoice a transport order (per-trip billing)
-- ============================================================
CREATE OR REPLACE FUNCTION public.logistics_invoice_order(_order_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _order logistics_transport_orders%ROWTYPE;
  _customer customers%ROWTYPE;
  _invoice_id uuid;
  _trip_id uuid;
BEGIN
  SELECT * INTO _order FROM logistics_transport_orders
    WHERE id = _order_id AND organization_id = current_org_id();
  IF _order.id IS NULL THEN RAISE EXCEPTION 'order_not_found'; END IF;
  IF _order.invoice_id IS NOT NULL THEN RETURN _order.invoice_id; END IF;
  IF _order.status NOT IN ('delivered','in_transit','assigned') THEN
    RAISE EXCEPTION 'order_not_ready';
  END IF;

  SELECT * INTO _customer FROM customers WHERE id = _order.customer_id;

  INSERT INTO invoices (
    organization_id, invoice_number, customer_name, customer_reference,
    invoice_type, subtotal, tax_rate, tax_amount, total_amount, currency,
    status, issued_at, due_at, notes, created_by
  ) VALUES (
    _order.organization_id,
    'LOG-' || _order.ref,
    COALESCE(_customer.company_name, _order.customer_name, 'Walk-in'),
    _order.ref, 'service',
    _order.quoted_price, 0, 0, _order.quoted_price, _order.currency,
    'issued', now(), now() + interval '30 days',
    'Logistics: ' || _order.pickup_location || ' → ' || _order.dropoff_location,
    _order.created_by
  ) RETURNING id INTO _invoice_id;

  UPDATE logistics_transport_orders
    SET invoice_id = _invoice_id, status = 'invoiced', updated_at = now()
    WHERE id = _order.id;

  -- Link revenue to first matching trip (if any)
  SELECT trip_id INTO _trip_id FROM logistics_trip_legs
    WHERE transport_order_id = _order.id LIMIT 1;
  IF _trip_id IS NOT NULL THEN
    INSERT INTO logistics_trip_revenue (
      organization_id, trip_id, transport_order_id, amount, currency, invoice_id
    ) VALUES (
      _order.organization_id, _trip_id, _order.id,
      _order.quoted_price, _order.currency, _invoice_id
    );
  END IF;

  RETURN _invoice_id;
END $$;

-- ============================================================
-- RPC: batch billing run (periodic)
-- ============================================================
CREATE OR REPLACE FUNCTION public.logistics_run_batch_billing(
  _customer_id uuid, _from date, _to date
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _orders logistics_transport_orders%ROWTYPE;
  _customer customers%ROWTYPE;
  _total numeric(14,2) := 0;
  _invoice_id uuid;
  _curr text := 'USD';
  _notes text := '';
BEGIN
  SELECT * INTO _customer FROM customers
    WHERE id = _customer_id AND organization_id = current_org_id();
  IF _customer.id IS NULL THEN RAISE EXCEPTION 'customer_not_found'; END IF;

  SELECT COALESCE(SUM(quoted_price),0), MAX(currency)
    INTO _total, _curr
  FROM logistics_transport_orders
  WHERE organization_id = current_org_id()
    AND customer_id = _customer_id
    AND status = 'delivered'
    AND invoice_id IS NULL
    AND service_date BETWEEN _from AND _to;

  IF _total <= 0 THEN RAISE EXCEPTION 'nothing_to_invoice'; END IF;

  INSERT INTO invoices (
    organization_id, invoice_number, customer_name, customer_reference,
    invoice_type, subtotal, tax_rate, tax_amount, total_amount, currency,
    status, issued_at, due_at, notes
  ) VALUES (
    current_org_id(),
    'LOG-BATCH-' || to_char(now(),'YYMMDD-HH24MISS'),
    _customer.company_name, _customer.id::text, 'service',
    _total, 0, 0, _total, COALESCE(_curr,'USD'),
    'issued', now(), now() + interval '30 days',
    'Logistics batch billing ' || _from || ' → ' || _to
  ) RETURNING id INTO _invoice_id;

  UPDATE logistics_transport_orders
    SET invoice_id = _invoice_id, status = 'invoiced', updated_at = now()
  WHERE organization_id = current_org_id()
    AND customer_id = _customer_id
    AND status = 'delivered'
    AND invoice_id IS NULL
    AND service_date BETWEEN _from AND _to;

  -- Link revenue to trips touched in period
  INSERT INTO logistics_trip_revenue (organization_id, trip_id, transport_order_id, amount, currency, invoice_id)
  SELECT DISTINCT current_org_id(), l.trip_id, o.id, o.quoted_price, o.currency, _invoice_id
  FROM logistics_transport_orders o
  JOIN logistics_trip_legs l ON l.transport_order_id = o.id
  WHERE o.invoice_id = _invoice_id;

  INSERT INTO org_lifecycle_events (organization_id, event_type, details)
  VALUES (current_org_id(), 'logistics_batch_invoice', jsonb_build_object(
    'invoice_id', _invoice_id, 'customer_id', _customer_id, 'from', _from, 'to', _to, 'amount', _total
  ));

  RETURN _invoice_id;
END $$;
