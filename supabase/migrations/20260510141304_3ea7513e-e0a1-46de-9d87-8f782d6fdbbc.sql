
ALTER TABLE public.yard_blocks ADD COLUMN IF NOT EXISTS hazardous_zone boolean NOT NULL DEFAULT false;
ALTER TABLE public.containers ADD COLUMN IF NOT EXISTS hazard_class text;

CREATE TABLE IF NOT EXISTS public.import_audit_rows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL DEFAULT current_org_id(),
  table_name text NOT NULL,
  business_key text NOT NULL,
  row_number integer,
  outcome text NOT NULL,
  message text,
  payload jsonb,
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_import_audit_rows_org_created ON public.import_audit_rows (organization_id, created_at DESC);
ALTER TABLE public.import_audit_rows ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "audit_rows_select_org" ON public.import_audit_rows;
CREATE POLICY "audit_rows_select_org" ON public.import_audit_rows FOR SELECT
  USING (organization_id = current_org_id() OR is_platform_admin());
DROP POLICY IF EXISTS "audit_rows_insert_org" ON public.import_audit_rows;
CREATE POLICY "audit_rows_insert_org" ON public.import_audit_rows FOR INSERT
  WITH CHECK (
    organization_id = current_org_id() AND (
      has_role(auth.uid(),'admin'::app_role) OR
      has_role(auth.uid(),'gate_clerk'::app_role) OR
      has_role(auth.uid(),'yard_operator'::app_role)
    )
  );

CREATE OR REPLACE FUNCTION public.gate_out_imported_container(_container_number text, _payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _org uuid := current_org_id();
  _container RECORD;
  _gate_out_at timestamptz;
  _condition condition_grade;
  _seal text := nullif(_payload->>'exit_seal_number','');
  _eir_number text := nullif(_payload->>'exit_eir_number','');
  _gross numeric := NULLIF(_payload->>'gross_weight_kg','')::numeric;
  _ocr_match boolean := COALESCE((_payload->>'ocr_match')::boolean, true);
  _force boolean := COALESCE((_payload->>'force')::boolean, false);
  _variance numeric;
  _movement_id uuid;
  _eir_id uuid;
BEGIN
  IF _org IS NULL THEN RAISE EXCEPTION 'no_organization'; END IF;
  IF NOT (has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'gate_clerk'::app_role) OR has_role(auth.uid(),'yard_operator'::app_role)) THEN
    RAISE EXCEPTION 'forbidden_role';
  END IF;

  SELECT * INTO _container FROM public.containers
    WHERE organization_id = _org AND container_number = _container_number;
  IF NOT FOUND THEN RAISE EXCEPTION 'container_not_found:%', _container_number; END IF;
  IF _container.gate_in_at IS NULL THEN RAISE EXCEPTION 'not_gated_in:%', _container_number; END IF;
  IF _container.gate_out_at IS NOT NULL THEN RAISE EXCEPTION 'already_gated_out:%', _container_number; END IF;

  BEGIN _gate_out_at := COALESCE((_payload->>'gate_out_at')::timestamptz, now());
  EXCEPTION WHEN others THEN _gate_out_at := now(); END;

  IF NOT _ocr_match AND NOT _force THEN
    RAISE EXCEPTION 'ocr_mismatch:set force=true to override';
  END IF;

  IF _gross IS NOT NULL AND _container.tare_weight_kg IS NOT NULL AND _container.tare_weight_kg > 0 THEN
    _variance := abs(_gross - _container.tare_weight_kg) / _container.tare_weight_kg * 100;
    IF _variance > 50 AND NOT _force THEN
      RAISE EXCEPTION 'weight_variance_too_high: % pct', round(_variance,1);
    END IF;
  END IF;

  _condition := COALESCE(NULLIF(_payload->>'exit_condition_grade','')::condition_grade, 'A'::condition_grade);
  IF _eir_number IS NULL THEN
    _eir_number := 'EIR-OUT-' || to_char(now(),'YYMMDDHH24MISS') || '-' || substring(gen_random_uuid()::text,1,4);
  END IF;

  UPDATE public.containers
    SET gate_out_at = _gate_out_at,
        block_id = NULL, bay = NULL, row = NULL, tier = NULL,
        status = COALESCE(NULLIF(_payload->>'status','')::container_status, 'available'::container_status)
    WHERE id = _container.id;

  INSERT INTO public.container_movements (container_id, movement_type, performed_by, notes, organization_id)
  VALUES (_container.id, 'gate_out', auth.uid(),
    concat_ws(' | ',
      'Bulk import gate-out',
      NULLIF(_payload->>'exit_truck_plate',''),
      NULLIF(_payload->>'exit_driver_name',''),
      NULLIF(_payload->>'exit_transporter',''),
      CASE WHEN _gross IS NOT NULL THEN 'gross='||_gross::text ELSE NULL END,
      CASE WHEN _variance IS NOT NULL THEN 'variance='||round(_variance,1)::text||'%' ELSE NULL END,
      NULLIF(_payload->>'gate_out_notes','')
    ),
    _org)
  RETURNING id INTO _movement_id;

  INSERT INTO public.eir_records (eir_number, container_id, eir_type, condition_grade, cargo_status, seal_number, inspector_notes, inspected_by, completed_at, organization_id)
  VALUES (_eir_number, _container.id, 'gate_out', _condition, 'empty', _seal,
    concat_ws(' | ', 'Bulk import gate-out',
      NULLIF(_payload->>'exit_truck_plate',''),
      NULLIF(_payload->>'exit_driver_name',''),
      NULLIF(_payload->>'exit_transporter','')
    ),
    auth.uid(), _gate_out_at, _org)
  RETURNING id INTO _eir_id;

  RETURN jsonb_build_object('ok', true, 'container_id', _container.id, 'movement_id', _movement_id,
    'eir_id', _eir_id, 'eir_number', _eir_number, 'weight_variance_pct', _variance);
END $$;

CREATE OR REPLACE FUNCTION public.gate_dashboard(_from timestamptz, _to timestamptz)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _org uuid := current_org_id();
  _result jsonb;
BEGIN
  IF _org IS NULL AND NOT is_platform_admin() THEN
    RETURN jsonb_build_object('error','no_org');
  END IF;

  WITH mv AS (
    SELECT * FROM public.container_movements
    WHERE (_org IS NULL OR organization_id = _org)
      AND created_at >= _from AND created_at <= _to
  ),
  eirs AS (
    SELECT * FROM public.eir_records
    WHERE (_org IS NULL OR organization_id = _org)
      AND created_at >= _from AND created_at <= _to
  )
  SELECT jsonb_build_object(
    'kpis', jsonb_build_object(
      'gate_in', (SELECT count(*) FROM mv WHERE movement_type='gate_in'),
      'gate_out', (SELECT count(*) FROM mv WHERE movement_type='gate_out'),
      'avg_grade', (SELECT round(avg(CASE condition_grade WHEN 'A' THEN 4 WHEN 'B' THEN 3 WHEN 'C' THEN 2 WHEN 'D' THEN 1 END)::numeric, 2) FROM eirs),
      'failed_imports', (SELECT count(*) FROM public.import_audit_rows
                           WHERE (_org IS NULL OR organization_id = _org)
                             AND created_at >= _from AND created_at <= _to AND outcome='error')
    ),
    'series', (
      SELECT jsonb_agg(jsonb_build_object(
        'd', to_char(d,'Mon DD'),
        'gate_in', (SELECT count(*) FROM mv WHERE date_trunc('day',created_at) = d AND movement_type='gate_in'),
        'gate_out', (SELECT count(*) FROM mv WHERE date_trunc('day',created_at) = d AND movement_type='gate_out')
      ) ORDER BY d)
      FROM generate_series(date_trunc('day',_from), date_trunc('day',_to), interval '1 day') d
    ),
    'by_block', (
      SELECT jsonb_agg(jsonb_build_object('name', name, 'value', cnt) ORDER BY cnt DESC)
      FROM (
        SELECT yb.name, count(*) cnt
        FROM mv m JOIN public.yard_blocks yb ON yb.id = m.to_block_id
        WHERE m.movement_type='gate_in'
        GROUP BY yb.name LIMIT 20
      ) x
    ),
    'by_operator', (
      SELECT jsonb_agg(jsonb_build_object('name', COALESCE(p.display_name, 'Unknown'), 'value', cnt) ORDER BY cnt DESC)
      FROM (
        SELECT performed_by, count(*) cnt FROM mv WHERE movement_type IN ('gate_in','gate_out') GROUP BY performed_by LIMIT 10
      ) m LEFT JOIN public.profiles p ON p.user_id = m.performed_by
    ),
    'grade_mix', (
      SELECT jsonb_agg(jsonb_build_object('name','Grade '||condition_grade,'value', cnt) ORDER BY condition_grade)
      FROM (SELECT condition_grade, count(*) cnt FROM eirs GROUP BY condition_grade) x
    ),
    'issues', jsonb_build_object(
      'low_grade', (
        SELECT COALESCE(jsonb_agg(jsonb_build_object(
          'eir_number', e.eir_number, 'container', c.container_number,
          'grade', e.condition_grade, 'at', e.completed_at
        )), '[]'::jsonb)
        FROM eirs e JOIN public.containers c ON c.id = e.container_id
        WHERE e.condition_grade IN ('C','D')
      ),
      'recent_failed_imports', (
        SELECT COALESCE(jsonb_agg(jsonb_build_object(
          'business_key', business_key, 'message', message, 'at', created_at
        ) ORDER BY created_at DESC), '[]'::jsonb)
        FROM public.import_audit_rows
        WHERE (_org IS NULL OR organization_id = _org)
          AND created_at >= _from AND created_at <= _to AND outcome='error'
      )
    )
  ) INTO _result;
  RETURN _result;
END $$;
