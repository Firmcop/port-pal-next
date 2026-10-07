
-- Phase 4: Billing schema

-- Extend organizations
ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS tax_id text,
  ADD COLUMN IF NOT EXISTS billing_address jsonb;

-- Extend subscriptions
ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS stripe_customer_id text,
  ADD COLUMN IF NOT EXISTS stripe_subscription_id text,
  ADD COLUMN IF NOT EXISTS billing_email text,
  ADD COLUMN IF NOT EXISTS next_invoice_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_invoiced_period_end date;

-- Status enum for platform invoices
DO $$ BEGIN
  CREATE TYPE public.platform_invoice_status AS ENUM ('draft','sent','paid','overdue','void');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.platform_invoice_line_type AS ENUM ('base','module','seats','adjustment');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- platform_invoices
CREATE TABLE IF NOT EXISTS public.platform_invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  invoice_number text NOT NULL UNIQUE,
  period_start date NOT NULL,
  period_end date NOT NULL,
  base_fee numeric(12,2) NOT NULL DEFAULT 0,
  modules_total numeric(12,2) NOT NULL DEFAULT 0,
  seat_count integer NOT NULL DEFAULT 0,
  seat_fee numeric(12,2) NOT NULL DEFAULT 0,
  seats_total numeric(12,2) NOT NULL DEFAULT 0,
  subtotal numeric(12,2) NOT NULL DEFAULT 0,
  tax_amount numeric(12,2) NOT NULL DEFAULT 0,
  total numeric(12,2) NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'USD',
  status public.platform_invoice_status NOT NULL DEFAULT 'draft',
  issued_at timestamptz NOT NULL DEFAULT now(),
  due_at timestamptz,
  sent_at timestamptz,
  paid_at timestamptz,
  stripe_invoice_id text,
  stripe_hosted_url text,
  stripe_pdf_url text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_platform_invoices_org ON public.platform_invoices(organization_id);
CREATE INDEX IF NOT EXISTS idx_platform_invoices_status ON public.platform_invoices(status);

ALTER TABLE public.platform_invoices ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org members read own invoices" ON public.platform_invoices
  FOR SELECT USING (organization_id = public.current_org_id() OR public.is_platform_admin());

CREATE POLICY "platform admin manage invoices" ON public.platform_invoices
  FOR ALL USING (public.is_platform_admin()) WITH CHECK (public.is_platform_admin());

CREATE TRIGGER trg_platform_invoices_updated
  BEFORE UPDATE ON public.platform_invoices
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- platform_invoice_lines
CREATE TABLE IF NOT EXISTS public.platform_invoice_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id uuid NOT NULL REFERENCES public.platform_invoices(id) ON DELETE CASCADE,
  line_type public.platform_invoice_line_type NOT NULL,
  description text NOT NULL,
  quantity numeric(12,2) NOT NULL DEFAULT 1,
  unit_price numeric(12,2) NOT NULL DEFAULT 0,
  total numeric(12,2) NOT NULL DEFAULT 0,
  module_code text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_platform_invoice_lines_invoice ON public.platform_invoice_lines(invoice_id);

ALTER TABLE public.platform_invoice_lines ENABLE ROW LEVEL SECURITY;

CREATE POLICY "lines visible with invoice" ON public.platform_invoice_lines
  FOR SELECT USING (EXISTS (
    SELECT 1 FROM public.platform_invoices i
    WHERE i.id = invoice_id
      AND (i.organization_id = public.current_org_id() OR public.is_platform_admin())
  ));

CREATE POLICY "platform admin manage lines" ON public.platform_invoice_lines
  FOR ALL USING (public.is_platform_admin()) WITH CHECK (public.is_platform_admin());

-- platform_invoice_runs
CREATE TABLE IF NOT EXISTS public.platform_invoice_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  period_start date NOT NULL,
  period_end date NOT NULL,
  triggered_by uuid,
  org_count integer NOT NULL DEFAULT 0,
  total_amount numeric(12,2) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.platform_invoice_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "platform admin read runs" ON public.platform_invoice_runs
  FOR SELECT USING (public.is_platform_admin());

CREATE POLICY "platform admin write runs" ON public.platform_invoice_runs
  FOR INSERT WITH CHECK (public.is_platform_admin());

-- Invoice number generator (year-month sequence)
CREATE OR REPLACE FUNCTION public.next_platform_invoice_number(_period_start date)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _ym text := to_char(_period_start, 'YYYYMM');
  _seq int;
BEGIN
  SELECT COUNT(*) + 1 INTO _seq
  FROM public.platform_invoices
  WHERE invoice_number LIKE 'INV-' || _ym || '-%';
  RETURN 'INV-' || _ym || '-' || lpad(_seq::text, 4, '0');
END;
$$;

-- Generator: monthly invoices for all orgs
CREATE OR REPLACE FUNCTION public.generate_platform_invoices(_period_start date, _period_end date)
RETURNS TABLE(invoices_created int, total_amount numeric)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _org RECORD;
  _sub RECORD;
  _mod RECORD;
  _seat_count int;
  _modules_total numeric := 0;
  _seats_total numeric := 0;
  _subtotal numeric := 0;
  _invoice_id uuid;
  _invoice_no text;
  _count int := 0;
  _grand_total numeric := 0;
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Only platform admins can generate invoices';
  END IF;

  FOR _org IN
    SELECT o.id, o.name FROM public.organizations o
    JOIN public.subscriptions s ON s.organization_id = o.id
    WHERE s.status IN ('trial','active','past_due')
      AND (s.last_invoiced_period_end IS NULL OR s.last_invoiced_period_end < _period_end)
  LOOP
    SELECT * INTO _sub FROM public.subscriptions WHERE organization_id = _org.id;
    _modules_total := 0;
    _seats_total := 0;

    SELECT public.org_active_user_count(_org.id) INTO _seat_count;
    _seats_total := _seat_count * COALESCE(_sub.per_seat_fee, 0);

    SELECT COALESCE(SUM(price_snapshot), 0) INTO _modules_total
      FROM public.subscription_modules
      WHERE organization_id = _org.id AND enabled = true;

    _subtotal := COALESCE(_sub.base_fee, 0) + _modules_total + _seats_total;

    IF _subtotal <= 0 THEN CONTINUE; END IF;

    _invoice_no := public.next_platform_invoice_number(_period_start);
    _invoice_id := gen_random_uuid();

    INSERT INTO public.platform_invoices (
      id, organization_id, invoice_number, period_start, period_end,
      base_fee, modules_total, seat_count, seat_fee, seats_total,
      subtotal, total, currency, status, issued_at, due_at
    ) VALUES (
      _invoice_id, _org.id, _invoice_no, _period_start, _period_end,
      COALESCE(_sub.base_fee, 0), _modules_total, _seat_count,
      COALESCE(_sub.per_seat_fee, 0), _seats_total,
      _subtotal, _subtotal, COALESCE(_sub.currency,'USD'), 'draft',
      now(), now() + interval '14 days'
    );

    -- Base line
    IF COALESCE(_sub.base_fee, 0) > 0 THEN
      INSERT INTO public.platform_invoice_lines (invoice_id, line_type, description, quantity, unit_price, total)
      VALUES (_invoice_id, 'base', 'Platform base fee', 1, _sub.base_fee, _sub.base_fee);
    END IF;

    -- Module lines
    FOR _mod IN
      SELECT sm.module_code, sm.price_snapshot, mc.name
      FROM public.subscription_modules sm
      LEFT JOIN public.modules_catalog mc ON mc.code = sm.module_code
      WHERE sm.organization_id = _org.id AND sm.enabled = true AND sm.price_snapshot > 0
    LOOP
      INSERT INTO public.platform_invoice_lines (invoice_id, line_type, description, quantity, unit_price, total, module_code)
      VALUES (_invoice_id, 'module', COALESCE(_mod.name, _mod.module_code) || ' module', 1, _mod.price_snapshot, _mod.price_snapshot, _mod.module_code);
    END LOOP;

    -- Seats
    IF _seats_total > 0 THEN
      INSERT INTO public.platform_invoice_lines (invoice_id, line_type, description, quantity, unit_price, total)
      VALUES (_invoice_id, 'seats', 'User seats (' || _seat_count || ' × ' || _sub.per_seat_fee || ')', _seat_count, _sub.per_seat_fee, _seats_total);
    END IF;

    UPDATE public.subscriptions
      SET last_invoiced_period_end = _period_end,
          next_invoice_at = (_period_end + interval '1 day')::timestamptz
      WHERE organization_id = _org.id;

    _count := _count + 1;
    _grand_total := _grand_total + _subtotal;
  END LOOP;

  INSERT INTO public.platform_invoice_runs (period_start, period_end, triggered_by, org_count, total_amount)
  VALUES (_period_start, _period_end, auth.uid(), _count, _grand_total);

  RETURN QUERY SELECT _count, _grand_total;
END;
$$;
