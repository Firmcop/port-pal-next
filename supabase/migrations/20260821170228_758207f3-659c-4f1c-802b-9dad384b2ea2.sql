CREATE TABLE public.conversion_revenue_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversion_id uuid NOT NULL REFERENCES public.container_conversions(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL,
  old_amount numeric NOT NULL DEFAULT 0,
  new_amount numeric NOT NULL DEFAULT 0,
  currency text,
  reason text NOT NULL,
  changed_by uuid,
  changed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX cra_conversion_idx ON public.conversion_revenue_audit(conversion_id, changed_at DESC);

GRANT SELECT ON public.conversion_revenue_audit TO authenticated;
GRANT ALL ON public.conversion_revenue_audit TO service_role;

ALTER TABLE public.conversion_revenue_audit ENABLE ROW LEVEL SECURITY;

CREATE POLICY "cra_select_org_finance" ON public.conversion_revenue_audit
FOR SELECT TO authenticated
USING (
  is_platform_admin()
  OR (organization_id = current_org_id() AND (
    is_org_admin(organization_id)
    OR has_role(auth.uid(), 'admin'::app_role)
    OR has_role(auth.uid(), 'org_owner'::app_role)
    OR has_role(auth.uid(), 'accountant'::app_role)
    OR has_role(auth.uid(), 'production_manager'::app_role)
  ))
);

CREATE OR REPLACE FUNCTION public.admin_adjust_conversion_revenue(
  _conversion_id uuid,
  _new_amount numeric,
  _reason text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _row public.container_conversions%ROWTYPE;
  _old numeric;
  _delta numeric;
  _currency text;
  _ref text;
  _ledger_posted boolean := false;
  _has_revenue boolean := false;
  _fx numeric;
  _base text;
BEGIN
  SELECT * INTO _row FROM public.container_conversions WHERE id = _conversion_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'conversion_not_found'; END IF;

  IF NOT is_platform_admin() AND _row.organization_id <> current_org_id() THEN
    RAISE EXCEPTION 'conversion_not_found';
  END IF;

  IF NOT (is_platform_admin()
          OR is_org_admin(_row.organization_id)
          OR has_role(auth.uid(), 'admin'::app_role)
          OR has_role(auth.uid(), 'org_owner'::app_role)) THEN
    RAISE EXCEPTION 'Only admins can adjust conversion revenue';
  END IF;

  IF _row.status = 'cancelled' THEN
    RAISE EXCEPTION 'Cancelled jobs cannot be edited';
  END IF;

  IF _new_amount IS NULL OR _new_amount < 0 THEN
    RAISE EXCEPTION 'Revenue must be zero or greater';
  END IF;

  IF _reason IS NULL OR length(btrim(_reason)) < 10 THEN
    RAISE EXCEPTION 'A reason of at least 10 characters is required';
  END IF;

  _old := COALESCE(_row.quoted_price, 0);
  _delta := _new_amount - _old;
  _currency := COALESCE(_row.currency, 'USD');
  _ref := COALESCE(_row.conversion_number, _conversion_id::text);

  UPDATE public.container_conversions
     SET quoted_price = _new_amount, updated_at = now()
   WHERE id = _conversion_id;

  INSERT INTO public.conversion_revenue_audit (
    conversion_id, organization_id, old_amount, new_amount, currency, reason, changed_by
  ) VALUES (
    _conversion_id, _row.organization_id, _old, _new_amount, _currency, btrim(_reason), auth.uid()
  );

  SELECT EXISTS (
    SELECT 1 FROM public.accounting_transactions
     WHERE reference_type = 'container_conversions'
       AND reference_id = _conversion_id
       AND account_type = 'revenue'
  ) INTO _has_revenue;

  IF _has_revenue AND _delta <> 0 THEN
    SELECT fx_rate, base_currency INTO _fx, _base
      FROM public.accounting_transactions
     WHERE reference_type = 'container_conversions'
       AND reference_id = _conversion_id
       AND account_type = 'revenue'
     ORDER BY created_at DESC LIMIT 1;

    INSERT INTO public.accounting_transactions (
      transaction_number, account_type, category, description,
      debit_amount, credit_amount, reference_type, reference_id,
      organization_id, project_id, currency, fx_rate, base_currency
    ) VALUES (
      'TXN-CONV-REVADJ-' || substr(replace(gen_random_uuid()::text,'-',''),1,10),
      'revenue',
      'revenue_adjustment',
      'Conversion revenue adjustment — ' || _ref || ' (' || _old || ' → ' || _new_amount || '): ' || btrim(_reason),
      CASE WHEN _delta < 0 THEN -_delta ELSE 0 END,
      CASE WHEN _delta > 0 THEN _delta ELSE 0 END,
      'container_conversions', _conversion_id,
      _row.organization_id, _row.project_id, _currency, _fx, _base
    );
    _ledger_posted := true;
  END IF;

  RETURN jsonb_build_object(
    'old_amount', _old,
    'new_amount', _new_amount,
    'delta', _delta,
    'ledger_posted', _ledger_posted
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_adjust_conversion_revenue(uuid, numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_adjust_conversion_revenue(uuid, numeric, text) TO authenticated;