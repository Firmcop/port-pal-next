
-- HC/LC height class for dry containers
CREATE TYPE public.container_height_class AS ENUM ('HC', 'LC');

ALTER TABLE public.containers ADD COLUMN height_class public.container_height_class;
ALTER TABLE public.tariffs ADD COLUMN height_class public.container_height_class;
ALTER TABLE public.lease_rate_cards ADD COLUMN height_class public.container_height_class;

-- Backfill: existing dry rows default to LC (standard height); non-dry stay NULL
UPDATE public.containers SET height_class = 'LC' WHERE category = 'dry' AND height_class IS NULL;
UPDATE public.tariffs SET height_class = 'LC' WHERE container_category = 'dry' AND height_class IS NULL;
UPDATE public.lease_rate_cards SET height_class = 'LC' WHERE container_category = 'dry' AND height_class IS NULL;

-- Validation triggers (CHECK constraints not used per project rules)
CREATE OR REPLACE FUNCTION public.validate_container_height_class()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.category = 'dry' AND NEW.height_class IS NULL THEN
    RAISE EXCEPTION 'height_class is required for dry containers (HC or LC)';
  END IF;
  IF NEW.category <> 'dry' AND NEW.height_class IS NOT NULL THEN
    RAISE EXCEPTION 'height_class must be NULL for non-dry containers';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER trg_validate_container_height_class
  BEFORE INSERT OR UPDATE ON public.containers
  FOR EACH ROW EXECUTE FUNCTION public.validate_container_height_class();

CREATE OR REPLACE FUNCTION public.validate_tariff_height_class()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.container_category = 'dry' AND NEW.height_class IS NULL THEN
    RAISE EXCEPTION 'height_class is required for dry tariffs (HC or LC)';
  END IF;
  IF NEW.container_category <> 'dry' AND NEW.height_class IS NOT NULL THEN
    RAISE EXCEPTION 'height_class must be NULL for non-dry tariffs';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER trg_validate_tariff_height_class
  BEFORE INSERT OR UPDATE ON public.tariffs
  FOR EACH ROW EXECUTE FUNCTION public.validate_tariff_height_class();

CREATE OR REPLACE FUNCTION public.validate_rate_card_height_class()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.container_category = 'dry' AND NEW.height_class IS NULL THEN
    RAISE EXCEPTION 'height_class is required for dry rate cards (HC or LC)';
  END IF;
  IF NEW.container_category <> 'dry' AND NEW.height_class IS NOT NULL THEN
    RAISE EXCEPTION 'height_class must be NULL for non-dry rate cards';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER trg_validate_rate_card_height_class
  BEFORE INSERT OR UPDATE ON public.lease_rate_cards
  FOR EACH ROW EXECUTE FUNCTION public.validate_rate_card_height_class();

-- Update lease invoice generator to match height_class for dry containers
CREATE OR REPLACE FUNCTION public.generate_lease_invoices(_period_start date, _period_end date)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

      _rate := COALESCE(_unit.effective_per_diem, _lease.default_per_diem);
      SELECT container_number, size::text AS sz, category::text AS cat, height_class::text AS hc
        INTO _container FROM public.containers WHERE id = _unit.container_id;

      IF _container.sz IS NOT NULL THEN
        SELECT per_diem_rate INTO _rate
        FROM public.lease_rate_cards
        WHERE lease_id = _lease.id
          AND container_size = _container.sz
          AND container_category = _container.cat
          AND (
            (_container.cat = 'dry' AND height_class::text = _container.hc)
            OR (_container.cat <> 'dry')
          )
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
$function$;
