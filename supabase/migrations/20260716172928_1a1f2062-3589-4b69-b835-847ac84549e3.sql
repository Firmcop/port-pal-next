
-- 1. RPC: create_project_from_conversion (idempotent)
CREATE OR REPLACE FUNCTION public.create_project_from_conversion(_conversion_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _job public.container_conversions%ROWTYPE;
  _project_id uuid;
  _code text;
  _status text;
  _uid uuid := auth.uid();
BEGIN
  SELECT * INTO _job FROM public.container_conversions WHERE id = _conversion_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Conversion job not found'; END IF;

  -- Permission: admin/owner/manager/accountant on the org, or job creator
  IF NOT (
    public.has_role(_uid, 'admin') OR
    public.has_role(_uid, 'owner') OR
    public.has_role(_uid, 'manager') OR
    public.has_role(_uid, 'accountant') OR
    _job.created_by = _uid
  ) THEN
    RAISE EXCEPTION 'Not authorized to create a project from this conversion job';
  END IF;

  IF _job.project_id IS NOT NULL THEN
    RETURN _job.project_id;
  END IF;

  _status := CASE _job.status::text
    WHEN 'completed' THEN 'completed'
    WHEN 'cancelled' THEN 'archived'
    ELSE 'active'
  END;

  -- Ensure code uniqueness within organization
  _code := _job.conversion_number;
  IF EXISTS (SELECT 1 FROM public.projects WHERE organization_id = _job.organization_id AND code = _code) THEN
    _code := _code || '-' || substr(_job.id::text, 1, 4);
  END IF;

  INSERT INTO public.projects (
    organization_id, code, name, customer_id, status,
    start_date, end_date, budget_amount, currency, description, created_by
  ) VALUES (
    _job.organization_id,
    _code,
    'Conversion: ' || _job.conversion_number,
    _job.customer_id,
    _status,
    _job.start_date,
    _job.end_date,
    COALESCE(_job.quoted_price, 0),
    _job.currency,
    _job.description,
    _uid
  ) RETURNING id INTO _project_id;

  UPDATE public.container_conversions SET project_id = _project_id, updated_at = now() WHERE id = _conversion_id;

  PERFORM public.resync_conversion_project_txns(_conversion_id);

  RETURN _project_id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_project_from_conversion(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_project_from_conversion(uuid) TO authenticated;

-- 2. Helper: resync existing accounting_transactions for a conversion to its current project_id
CREATE OR REPLACE FUNCTION public.resync_conversion_project_txns(_conversion_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _pid uuid;
  _updated integer := 0;
BEGIN
  SELECT project_id INTO _pid FROM public.container_conversions WHERE id = _conversion_id;
  IF _pid IS NULL THEN RETURN 0; END IF;

  -- Direct: reference_type points at container_sales that belong to this conversion
  WITH sale_ids AS (
    SELECT id FROM public.container_sales WHERE conversion_id = _conversion_id
  )
  UPDATE public.accounting_transactions t
    SET project_id = _pid
  WHERE t.project_id IS DISTINCT FROM _pid
    AND t.reference_type = 'container_sales'
    AND t.reference_id IN (SELECT id FROM sale_ids);
  GET DIAGNOSTICS _updated = ROW_COUNT;

  -- Invoices whose project_id is already this project (defensive)
  UPDATE public.accounting_transactions t
    SET project_id = _pid
  WHERE t.project_id IS NULL
    AND t.reference_type = 'invoice'
    AND t.reference_id IN (SELECT id FROM public.invoices WHERE project_id = _pid);

  RETURN _updated;
END;
$$;

REVOKE ALL ON FUNCTION public.resync_conversion_project_txns(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resync_conversion_project_txns(uuid) TO authenticated;

-- 3. Trigger: auto-stamp project_id from conversion refs on new accounting_transactions
CREATE OR REPLACE FUNCTION public.stamp_project_from_conversion()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _pid uuid;
BEGIN
  IF NEW.project_id IS NOT NULL THEN RETURN NEW; END IF;

  IF NEW.reference_type = 'container_sales' AND NEW.reference_id IS NOT NULL THEN
    SELECT cc.project_id INTO _pid
      FROM public.container_sales cs
      JOIN public.container_conversions cc ON cc.id = cs.conversion_id
     WHERE cs.id = NEW.reference_id;
    IF _pid IS NOT NULL THEN NEW.project_id := _pid; RETURN NEW; END IF;
  END IF;

  IF NEW.reference_type = 'invoice' AND NEW.reference_id IS NOT NULL THEN
    SELECT project_id INTO _pid FROM public.invoices WHERE id = NEW.reference_id;
    IF _pid IS NOT NULL THEN NEW.project_id := _pid; RETURN NEW; END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_stamp_project_from_conversion ON public.accounting_transactions;
CREATE TRIGGER trg_stamp_project_from_conversion
BEFORE INSERT ON public.accounting_transactions
FOR EACH ROW EXECUTE FUNCTION public.stamp_project_from_conversion();
