-- =========================================
-- Container Leasing Module
-- =========================================

-- Enums
CREATE TYPE public.lease_status AS ENUM ('draft','quoted','active','suspended','closed','cancelled');
CREATE TYPE public.lease_type AS ENUM ('master','long_term','short_term','one_way','spot','lease_purchase');
CREATE TYPE public.lease_unit_status AS ENUM ('on_hire','off_hire','in_transit','lost','damaged_total_loss');
CREATE TYPE public.lease_quote_status AS ENUM ('pending','sent','accepted','rejected','expired');
CREATE TYPE public.lease_billing_cycle AS ENUM ('weekly','monthly');

-- Extend container_status with on_lease
ALTER TYPE public.container_status ADD VALUE IF NOT EXISTS 'on_lease';

-- Extend charge_type with leasing charges
ALTER TYPE public.charge_type ADD VALUE IF NOT EXISTS 'per_diem';
ALTER TYPE public.charge_type ADD VALUE IF NOT EXISTS 'pickup_fee';
ALTER TYPE public.charge_type ADD VALUE IF NOT EXISTS 'dropoff_fee';
ALTER TYPE public.charge_type ADD VALUE IF NOT EXISTS 'dpp';
ALTER TYPE public.charge_type ADD VALUE IF NOT EXISTS 'redelivery_repair';
ALTER TYPE public.charge_type ADD VALUE IF NOT EXISTS 'loss_value';

-- =========================================
-- Lease Agreements
-- =========================================
CREATE TABLE public.lease_agreements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lease_number TEXT NOT NULL UNIQUE,
  customer_id UUID,
  lessee_name TEXT NOT NULL,
  lease_type public.lease_type NOT NULL DEFAULT 'master',
  status public.lease_status NOT NULL DEFAULT 'draft',
  currency TEXT NOT NULL DEFAULT 'USD',

  start_date DATE,
  end_date DATE,
  signed_at TIMESTAMPTZ,
  min_lease_days INT NOT NULL DEFAULT 0,
  auto_renew BOOLEAN NOT NULL DEFAULT false,

  free_days_pickup INT NOT NULL DEFAULT 0,
  free_days_redelivery INT NOT NULL DEFAULT 0,
  default_per_diem NUMERIC NOT NULL DEFAULT 0,
  billing_cycle public.lease_billing_cycle NOT NULL DEFAULT 'monthly',

  pickup_depots JSONB NOT NULL DEFAULT '[]'::jsonb,
  redelivery_depots JSONB NOT NULL DEFAULT '[]'::jsonb,

  pickup_fee NUMERIC NOT NULL DEFAULT 0,
  dropoff_fee NUMERIC NOT NULL DEFAULT 0,
  dpp_enabled BOOLEAN NOT NULL DEFAULT false,
  dpp_rate_per_day NUMERIC NOT NULL DEFAULT 0,
  dpp_cap_per_unit NUMERIC NOT NULL DEFAULT 0,

  min_units_committed INT NOT NULL DEFAULT 0,
  payment_terms_days INT NOT NULL DEFAULT 30,
  late_fee_pct NUMERIC NOT NULL DEFAULT 0,

  agreement_pdf_url TEXT,
  terms_text TEXT,
  notes TEXT,

  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.lease_agreements ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff can view lease agreements"
ON public.lease_agreements FOR SELECT TO authenticated
USING (
  has_role(auth.uid(),'admin'::app_role) OR
  has_role(auth.uid(),'yard_operator'::app_role) OR
  has_role(auth.uid(),'gate_clerk'::app_role) OR
  has_role(auth.uid(),'viewer'::app_role)
);

CREATE POLICY "Portal users view own lease agreements"
ON public.lease_agreements FOR SELECT TO authenticated
USING (customer_id = get_portal_customer_id(auth.uid()));

CREATE POLICY "Admins operators clerks insert lease agreements"
ON public.lease_agreements FOR INSERT TO authenticated
WITH CHECK (
  has_role(auth.uid(),'admin'::app_role) OR
  has_role(auth.uid(),'yard_operator'::app_role) OR
  has_role(auth.uid(),'gate_clerk'::app_role)
);

CREATE POLICY "Admins operators clerks update lease agreements"
ON public.lease_agreements FOR UPDATE TO authenticated
USING (
  has_role(auth.uid(),'admin'::app_role) OR
  has_role(auth.uid(),'yard_operator'::app_role) OR
  has_role(auth.uid(),'gate_clerk'::app_role)
);

CREATE TRIGGER trg_lease_agreements_updated
BEFORE UPDATE ON public.lease_agreements
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX idx_lease_agreements_customer ON public.lease_agreements(customer_id);
CREATE INDEX idx_lease_agreements_status ON public.lease_agreements(status);

-- =========================================
-- Lease Rate Cards (tiered per-diem)
-- =========================================
CREATE TABLE public.lease_rate_cards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lease_id UUID NOT NULL REFERENCES public.lease_agreements(id) ON DELETE CASCADE,
  container_size TEXT NOT NULL,
  container_category TEXT NOT NULL,
  per_diem_rate NUMERIC NOT NULL DEFAULT 0,
  tier_min_days INT NOT NULL DEFAULT 0,
  tier_max_days INT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.lease_rate_cards ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated view rate cards"
ON public.lease_rate_cards FOR SELECT TO authenticated USING (true);

CREATE POLICY "Admins operators clerks insert rate cards"
ON public.lease_rate_cards FOR INSERT TO authenticated
WITH CHECK (
  has_role(auth.uid(),'admin'::app_role) OR
  has_role(auth.uid(),'yard_operator'::app_role) OR
  has_role(auth.uid(),'gate_clerk'::app_role)
);

CREATE POLICY "Admins operators clerks update rate cards"
ON public.lease_rate_cards FOR UPDATE TO authenticated
USING (
  has_role(auth.uid(),'admin'::app_role) OR
  has_role(auth.uid(),'yard_operator'::app_role) OR
  has_role(auth.uid(),'gate_clerk'::app_role)
);

CREATE POLICY "Admins delete rate cards"
ON public.lease_rate_cards FOR DELETE TO authenticated
USING (has_role(auth.uid(),'admin'::app_role));

CREATE INDEX idx_rate_cards_lease ON public.lease_rate_cards(lease_id);

-- =========================================
-- Lease Units (the tracker)
-- =========================================
CREATE TABLE public.lease_units (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lease_id UUID NOT NULL REFERENCES public.lease_agreements(id) ON DELETE CASCADE,
  container_id UUID,
  status public.lease_unit_status NOT NULL DEFAULT 'on_hire',

  on_hire_at TIMESTAMPTZ,
  off_hire_at TIMESTAMPTZ,
  effective_per_diem NUMERIC NOT NULL DEFAULT 0,
  free_days_used INT NOT NULL DEFAULT 0,

  picked_up_depot_id UUID,
  redelivered_depot_id UUID,

  on_hire_eir_id UUID,
  off_hire_eir_id UUID,
  redelivery_estimate_id UUID,

  dpp_active BOOLEAN NOT NULL DEFAULT false,
  last_invoiced_through TIMESTAMPTZ,
  notes TEXT,

  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.lease_units ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff view lease units"
ON public.lease_units FOR SELECT TO authenticated
USING (
  has_role(auth.uid(),'admin'::app_role) OR
  has_role(auth.uid(),'yard_operator'::app_role) OR
  has_role(auth.uid(),'gate_clerk'::app_role) OR
  has_role(auth.uid(),'viewer'::app_role)
);

CREATE POLICY "Portal users view own lease units"
ON public.lease_units FOR SELECT TO authenticated
USING (
  lease_id IN (
    SELECT id FROM public.lease_agreements
    WHERE customer_id = get_portal_customer_id(auth.uid())
  )
);

CREATE POLICY "Admins operators clerks insert lease units"
ON public.lease_units FOR INSERT TO authenticated
WITH CHECK (
  has_role(auth.uid(),'admin'::app_role) OR
  has_role(auth.uid(),'yard_operator'::app_role) OR
  has_role(auth.uid(),'gate_clerk'::app_role)
);

CREATE POLICY "Admins operators clerks update lease units"
ON public.lease_units FOR UPDATE TO authenticated
USING (
  has_role(auth.uid(),'admin'::app_role) OR
  has_role(auth.uid(),'yard_operator'::app_role) OR
  has_role(auth.uid(),'gate_clerk'::app_role)
);

CREATE TRIGGER trg_lease_units_updated
BEFORE UPDATE ON public.lease_units
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX idx_lease_units_lease ON public.lease_units(lease_id);
CREATE INDEX idx_lease_units_container ON public.lease_units(container_id);
CREATE INDEX idx_lease_units_status ON public.lease_units(status);

-- =========================================
-- Lease Invoices Run (audit)
-- =========================================
CREATE TABLE public.lease_invoices_run (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lease_id UUID NOT NULL REFERENCES public.lease_agreements(id) ON DELETE CASCADE,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  invoice_id UUID,
  units_count INT NOT NULL DEFAULT 0,
  total_amount NUMERIC NOT NULL DEFAULT 0,
  generated_by UUID,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.lease_invoices_run ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff view lease billing runs"
ON public.lease_invoices_run FOR SELECT TO authenticated
USING (
  has_role(auth.uid(),'admin'::app_role) OR
  has_role(auth.uid(),'yard_operator'::app_role) OR
  has_role(auth.uid(),'gate_clerk'::app_role) OR
  has_role(auth.uid(),'viewer'::app_role)
);

CREATE POLICY "Admins clerks insert lease billing runs"
ON public.lease_invoices_run FOR INSERT TO authenticated
WITH CHECK (
  has_role(auth.uid(),'admin'::app_role) OR
  has_role(auth.uid(),'gate_clerk'::app_role)
);

CREATE INDEX idx_lease_runs_lease ON public.lease_invoices_run(lease_id);

-- =========================================
-- Lease Quotations
-- =========================================
CREATE TABLE public.lease_quotations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_number TEXT NOT NULL UNIQUE,
  customer_id UUID,
  lessee_name TEXT NOT NULL,
  lease_type public.lease_type NOT NULL DEFAULT 'master',
  status public.lease_quote_status NOT NULL DEFAULT 'pending',
  currency TEXT NOT NULL DEFAULT 'USD',

  proposed_start_date DATE,
  proposed_end_date DATE,
  proposed_per_diem NUMERIC NOT NULL DEFAULT 0,
  free_days_pickup INT NOT NULL DEFAULT 0,
  free_days_redelivery INT NOT NULL DEFAULT 0,
  pickup_fee NUMERIC NOT NULL DEFAULT 0,
  dropoff_fee NUMERIC NOT NULL DEFAULT 0,
  dpp_offered BOOLEAN NOT NULL DEFAULT false,
  dpp_rate_per_day NUMERIC NOT NULL DEFAULT 0,
  units_offered INT NOT NULL DEFAULT 0,
  container_size TEXT,
  container_category TEXT,

  valid_until DATE,
  pdf_url TEXT,
  notes TEXT,
  converted_lease_id UUID,

  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.lease_quotations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff view lease quotations"
ON public.lease_quotations FOR SELECT TO authenticated
USING (
  has_role(auth.uid(),'admin'::app_role) OR
  has_role(auth.uid(),'yard_operator'::app_role) OR
  has_role(auth.uid(),'gate_clerk'::app_role) OR
  has_role(auth.uid(),'viewer'::app_role)
);

CREATE POLICY "Portal users view own lease quotations"
ON public.lease_quotations FOR SELECT TO authenticated
USING (customer_id = get_portal_customer_id(auth.uid()));

CREATE POLICY "Admins operators clerks insert lease quotations"
ON public.lease_quotations FOR INSERT TO authenticated
WITH CHECK (
  has_role(auth.uid(),'admin'::app_role) OR
  has_role(auth.uid(),'yard_operator'::app_role) OR
  has_role(auth.uid(),'gate_clerk'::app_role)
);

CREATE POLICY "Admins operators clerks update lease quotations"
ON public.lease_quotations FOR UPDATE TO authenticated
USING (
  has_role(auth.uid(),'admin'::app_role) OR
  has_role(auth.uid(),'yard_operator'::app_role) OR
  has_role(auth.uid(),'gate_clerk'::app_role)
);

CREATE TRIGGER trg_lease_quotations_updated
BEFORE UPDATE ON public.lease_quotations
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX idx_lease_quotes_customer ON public.lease_quotations(customer_id);

-- =========================================
-- Billing function
-- Generates one invoice per lease covering the given period.
-- Returns the number of invoices created.
-- =========================================
CREATE OR REPLACE FUNCTION public.generate_lease_invoices(_period_start DATE, _period_end DATE)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _lease RECORD;
  _unit RECORD;
  _container RECORD;
  _rate NUMERIC;
  _days INT;
  _free_remaining INT;
  _billable_days INT;
  _line_amount NUMERIC;
  _dpp_amount NUMERIC;
  _subtotal NUMERIC;
  _invoice_id UUID;
  _invoice_no TEXT;
  _invoice_count INT := 0;
  _unit_count INT;
  _start TIMESTAMPTZ;
  _end TIMESTAMPTZ;
BEGIN
  IF NOT (has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'gate_clerk'::app_role)) THEN
    RAISE EXCEPTION 'Only admins or billing clerks can run lease billing';
  END IF;

  FOR _lease IN
    SELECT * FROM public.lease_agreements WHERE status IN ('active','closed')
  LOOP
    _subtotal := 0;
    _unit_count := 0;
    _invoice_no := 'LSE-' || to_char(now(),'YYYYMMDD') || '-' || substring(_lease.id::text,1,6);
    _invoice_id := gen_random_uuid();

    INSERT INTO public.invoices (
      id, invoice_number, customer_name, invoice_type, currency,
      subtotal, tax_amount, total_amount, status, issued_at, due_at, created_by, notes
    ) VALUES (
      _invoice_id, _invoice_no, _lease.lessee_name, 'per_diem', _lease.currency,
      0, 0, 0, 'draft', now(), now() + (_lease.payment_terms_days || ' days')::interval,
      auth.uid(),
      'Lease ' || _lease.lease_number || ' — period ' || _period_start || ' to ' || _period_end
    );

    FOR _unit IN
      SELECT * FROM public.lease_units
      WHERE lease_id = _lease.id
        AND on_hire_at IS NOT NULL
        AND on_hire_at::date <= _period_end
        AND (off_hire_at IS NULL OR off_hire_at::date >= _period_start)
    LOOP
      _start := GREATEST(_unit.on_hire_at, _period_start::timestamptz);
      _end := LEAST(COALESCE(_unit.off_hire_at, (_period_end + 1)::timestamptz), (_period_end + 1)::timestamptz);
      _days := GREATEST(0, EXTRACT(DAY FROM (_end - _start))::int);

      _free_remaining := GREATEST(0, _lease.free_days_pickup - _unit.free_days_used);
      _billable_days := GREATEST(0, _days - _free_remaining);

      IF _billable_days = 0 THEN CONTINUE; END IF;

      -- Resolve rate from rate cards by container size/category
      _rate := COALESCE(_unit.effective_per_diem, _lease.default_per_diem);
      SELECT container_number, size::text AS sz, category::text AS cat
        INTO _container FROM public.containers WHERE id = _unit.container_id;

      IF _container.sz IS NOT NULL THEN
        SELECT per_diem_rate INTO _rate
        FROM public.lease_rate_cards
        WHERE lease_id = _lease.id
          AND container_size = _container.sz
          AND container_category = _container.cat
          AND _billable_days >= tier_min_days
          AND (tier_max_days IS NULL OR _billable_days <= tier_max_days)
        ORDER BY tier_min_days DESC
        LIMIT 1;
        _rate := COALESCE(_rate, _unit.effective_per_diem, _lease.default_per_diem);
      END IF;

      _line_amount := _billable_days * _rate;
      _subtotal := _subtotal + _line_amount;
      _unit_count := _unit_count + 1;

      INSERT INTO public.invoice_line_items (
        invoice_id, description, charge_type, quantity, unit_price, total_price, period_from, period_to
      ) VALUES (
        _invoice_id,
        'Per diem — ' || COALESCE(_container.container_number,'Unit') || ' (' || _billable_days || ' days)',
        'per_diem', _billable_days, _rate, _line_amount, _start, _end
      );

      -- DPP line
      IF _lease.dpp_enabled AND _unit.dpp_active AND _lease.dpp_rate_per_day > 0 THEN
        _dpp_amount := _billable_days * _lease.dpp_rate_per_day;
        _subtotal := _subtotal + _dpp_amount;
        INSERT INTO public.invoice_line_items (
          invoice_id, description, charge_type, quantity, unit_price, total_price, period_from, period_to
        ) VALUES (
          _invoice_id,
          'DPP — ' || COALESCE(_container.container_number,'Unit'),
          'dpp', _billable_days, _lease.dpp_rate_per_day, _dpp_amount, _start, _end
        );
      END IF;

      -- Pickup fee on first invoice covering this unit
      IF _unit.last_invoiced_through IS NULL AND _lease.pickup_fee > 0 THEN
        _subtotal := _subtotal + _lease.pickup_fee;
        INSERT INTO public.invoice_line_items (
          invoice_id, description, charge_type, quantity, unit_price, total_price
        ) VALUES (
          _invoice_id,
          'Pickup fee — ' || COALESCE(_container.container_number,'Unit'),
          'pickup_fee', 1, _lease.pickup_fee, _lease.pickup_fee
        );
      END IF;

      -- Drop-off fee at off-hire
      IF _unit.off_hire_at IS NOT NULL
         AND _unit.off_hire_at::date BETWEEN _period_start AND _period_end
         AND _lease.dropoff_fee > 0 THEN
        _subtotal := _subtotal + _lease.dropoff_fee;
        INSERT INTO public.invoice_line_items (
          invoice_id, description, charge_type, quantity, unit_price, total_price
        ) VALUES (
          _invoice_id,
          'Drop-off fee — ' || COALESCE(_container.container_number,'Unit'),
          'dropoff_fee', 1, _lease.dropoff_fee, _lease.dropoff_fee
        );
      END IF;

      UPDATE public.lease_units
        SET last_invoiced_through = _end
        WHERE id = _unit.id;
    END LOOP;

    -- Finalise invoice
    IF _unit_count = 0 THEN
      DELETE FROM public.invoices WHERE id = _invoice_id;
    ELSE
      UPDATE public.invoices
        SET subtotal = _subtotal, total_amount = _subtotal
        WHERE id = _invoice_id;

      INSERT INTO public.lease_invoices_run (
        lease_id, period_start, period_end, invoice_id, units_count, total_amount, generated_by
      ) VALUES (
        _lease.id, _period_start, _period_end, _invoice_id, _unit_count, _subtotal, auth.uid()
      );
      _invoice_count := _invoice_count + 1;
    END IF;
  END LOOP;

  RETURN _invoice_count;
END;
$$;