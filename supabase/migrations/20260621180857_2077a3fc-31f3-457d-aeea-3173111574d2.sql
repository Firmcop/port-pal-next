
CREATE OR REPLACE FUNCTION public.backfill_sales_currency(_org uuid, _dry_run boolean DEFAULT true)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  org_base text;
  affected_count int := 0;
  missing_rates jsonb := '[]'::jsonb;
  samples jsonb := '[]'::jsonb;
  rec record;
  rate numeric;
  batch_id uuid := gen_random_uuid();
BEGIN
  IF NOT (public.is_platform_admin() OR _org = public.current_org_id()) THEN
    RAISE EXCEPTION 'not authorized';
  END IF;

  SELECT currency INTO org_base FROM public.organizations WHERE id = _org;
  IF org_base IS NULL THEN org_base := 'USD'; END IF;

  FOR rec IN
    SELECT at.id AS txn_id, at.currency AS txn_currency, at.debit_amount, at.credit_amount,
           at.transaction_date, at.fx_rate AS old_rate, at.base_currency AS old_base,
           cs.id AS sale_id, cs.sale_number, cs.currency AS sale_currency
    FROM public.accounting_transactions at
    JOIN public.container_sales cs ON cs.id = at.reference_id
    WHERE at.organization_id = _org
      AND at.reference_type = 'container_sales'
      AND cs.currency IS NOT NULL
      AND (at.currency IS DISTINCT FROM cs.currency
           OR at.fx_rate IS NULL
           OR at.base_currency IS DISTINCT FROM org_base)
  LOOP
    rate := public.get_fx_rate(_org, rec.sale_currency, org_base, rec.transaction_date::date);

    IF rate IS NULL THEN
      missing_rates := missing_rates || jsonb_build_object(
        'sale_number', rec.sale_number,
        'from', rec.sale_currency,
        'to', org_base,
        'on', rec.transaction_date::date
      );
      CONTINUE;
    END IF;

    affected_count := affected_count + 1;
    IF affected_count <= 25 THEN
      samples := samples || jsonb_build_object(
        'sale_number', rec.sale_number,
        'txn_id', rec.txn_id,
        'old_currency', rec.txn_currency,
        'new_currency', rec.sale_currency,
        'fx_rate', rate,
        'base_currency', org_base
      );
    END IF;

    IF NOT _dry_run THEN
      UPDATE public.accounting_transactions
      SET currency = rec.sale_currency,
          fx_rate = rate,
          base_currency = org_base
      WHERE id = rec.txn_id;

      INSERT INTO public.finance_audit_log
        (organization_id, actor_user_id, action, entity_type, entity_id, summary, after_data)
      VALUES (_org, auth.uid(), 'currency_backfill', 'accounting_transaction', rec.txn_id,
              format('Backfilled %s → %s @ %s', rec.txn_currency, rec.sale_currency, rate),
              jsonb_build_object('batch_id', batch_id, 'sale_number', rec.sale_number,
                                 'old_currency', rec.txn_currency, 'new_currency', rec.sale_currency,
                                 'fx_rate', rate, 'base_currency', org_base));
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'dry_run', _dry_run,
    'batch_id', batch_id,
    'org_base_currency', org_base,
    'affected', affected_count,
    'missing_rates', missing_rates,
    'samples', samples
  );
END;
$$;
