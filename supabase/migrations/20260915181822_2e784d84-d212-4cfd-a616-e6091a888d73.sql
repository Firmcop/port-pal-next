CREATE OR REPLACE FUNCTION public.post_material_consumption_to_ledger(_movement_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _m public.material_movements%ROWTYPE;
  _amt numeric;
  _curr text;
  _label text;
  _num text;
BEGIN
  SELECT * INTO _m FROM public.material_movements WHERE id = _movement_id;
  IF NOT FOUND THEN RETURN; END IF;
  IF _m.conversion_id IS NULL THEN RETURN; END IF;
  IF _m.movement_type::text NOT IN ('issue','return') THEN RETURN; END IF;

  _amt := ROUND(-1 * COALESCE(_m.qty,0) * COALESCE(_m.unit_cost,0), 2);
  IF _amt = 0 THEN RETURN; END IF;

  IF EXISTS (SELECT 1 FROM public.accounting_transactions
              WHERE reference_type = 'material_movement' AND reference_id = _m.id) THEN
    RETURN;
  END IF;

  _curr := COALESCE((SELECT currency FROM public.organizations WHERE id = _m.organization_id), 'USD');
  _num  := 'MAT-' || substring(_m.id::text, 1, 8);
  _label := CASE WHEN _amt > 0 THEN 'Materials issued to job ' ELSE 'Materials returned from job ' END
            || COALESCE((SELECT conversion_number FROM public.container_conversions WHERE id = _m.conversion_id), '')
            || COALESCE(' — ' || (SELECT name FROM public.materials WHERE id = _m.material_id), '');

  INSERT INTO public.accounting_transactions(
    transaction_number, transaction_date, account_type, category, description,
    debit_amount, credit_amount, reference_type, reference_id, organization_id, currency)
  VALUES (_num || '-C', COALESCE(_m.created_at, now()),
          'cost_of_goods', 'cogs_conversion_materials', _label,
          GREATEST(_amt, 0), GREATEST(-_amt, 0),
          'material_movement', _m.id, _m.organization_id, _curr);

  INSERT INTO public.accounting_transactions(
    transaction_number, transaction_date, account_type, category, description,
    debit_amount, credit_amount, reference_type, reference_id, organization_id, currency)
  VALUES (_num || '-I', COALESCE(_m.created_at, now()),
          'asset', 'inventory', 'Materials inventory relieved — ' || _label,
          GREATEST(-_amt, 0), GREATEST(_amt, 0),
          'material_movement', _m.id, _m.organization_id, _curr);
END $$;