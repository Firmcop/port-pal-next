
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

  IF NOT (
    public.has_role(_uid, 'admin'::public.app_role) OR
    public.has_role(_uid, 'org_owner'::public.app_role) OR
    public.has_role(_uid, 'accountant'::public.app_role) OR
    public.has_role(_uid, 'production_manager'::public.app_role) OR
    public.has_role(_uid, 'sales_manager'::public.app_role) OR
    public.has_role(_uid, 'leasing_manager'::public.app_role) OR
    public.has_role(_uid, 'mr_supervisor'::public.app_role) OR
    public.has_role(_uid, 'supply_chain_manager'::public.app_role) OR
    public.has_role(_uid, 'procurement_officer'::public.app_role) OR
    public.has_role(_uid, 'hr_manager'::public.app_role) OR
    public.has_role(_uid, 'asset_manager'::public.app_role) OR
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
    _status::public.project_status,
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
