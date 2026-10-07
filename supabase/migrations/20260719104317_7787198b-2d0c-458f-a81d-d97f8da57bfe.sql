CREATE OR REPLACE FUNCTION public.gate_dashboard(_from timestamptz, _to timestamptz)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _org uuid := current_org_id();
  _result jsonb;
BEGIN
  IF _org IS NULL AND NOT is_platform_admin() THEN
    RETURN jsonb_build_object('error','no_org');
  END IF;

  WITH eirs AS (
    SELECT e.*, COALESCE(e.completed_at, e.created_at) AS at
    FROM public.eir_records e
    WHERE (_org IS NULL OR e.organization_id = _org)
      AND COALESCE(e.completed_at, e.created_at) >= _from
      AND COALESCE(e.completed_at, e.created_at) <= _to
  )
  SELECT jsonb_build_object(
    'kpis', jsonb_build_object(
      'gate_in',  (SELECT count(*) FROM eirs WHERE eir_type='gate_in'),
      'gate_out', (SELECT count(*) FROM eirs WHERE eir_type='gate_out'),
      'avg_grade', COALESCE((SELECT round(avg(CASE condition_grade WHEN 'A' THEN 4 WHEN 'B' THEN 3 WHEN 'C' THEN 2 WHEN 'D' THEN 1 END)::numeric, 2) FROM eirs), 0),
      'failed_imports', (SELECT count(*) FROM public.import_audit_rows
                           WHERE (_org IS NULL OR organization_id = _org)
                             AND created_at >= _from AND created_at <= _to AND outcome='error')
    ),
    'series', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'd', to_char(d,'Mon DD'),
        'gate_in',  (SELECT count(*) FROM eirs WHERE date_trunc('day', at) = d AND eir_type='gate_in'),
        'gate_out', (SELECT count(*) FROM eirs WHERE date_trunc('day', at) = d AND eir_type='gate_out')
      ) ORDER BY d), '[]'::jsonb)
      FROM generate_series(date_trunc('day',_from), date_trunc('day',_to), interval '1 day') d
    ),
    'by_block', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object('name', name, 'value', cnt) ORDER BY cnt DESC), '[]'::jsonb)
      FROM (
        SELECT yb.name, count(*) cnt
        FROM eirs e
        JOIN public.containers c ON c.id = e.container_id
        JOIN public.yard_blocks yb ON yb.id = c.block_id
        WHERE e.eir_type='gate_in'
        GROUP BY yb.name
        ORDER BY cnt DESC LIMIT 20
      ) x
    ),
    'by_operator', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object('name', COALESCE(p.display_name,'Unknown'), 'value', cnt) ORDER BY cnt DESC), '[]'::jsonb)
      FROM (
        SELECT inspected_by, count(*) cnt FROM eirs GROUP BY inspected_by ORDER BY count(*) DESC LIMIT 10
      ) m LEFT JOIN public.profiles p ON p.user_id = m.inspected_by
    ),
    'grade_mix', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object('name','Grade '||condition_grade,'value', cnt) ORDER BY condition_grade), '[]'::jsonb)
      FROM (SELECT condition_grade, count(*) cnt FROM eirs WHERE condition_grade IS NOT NULL GROUP BY condition_grade) x
    ),
    'issues', jsonb_build_object(
      'low_grade', (
        SELECT COALESCE(jsonb_agg(jsonb_build_object(
          'eir_number', e.eir_number, 'container', c.container_number,
          'grade', e.condition_grade, 'at', e.at
        ) ORDER BY e.at DESC), '[]'::jsonb)
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

REVOKE EXECUTE ON FUNCTION public.gate_dashboard(timestamptz, timestamptz) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.gate_dashboard(timestamptz, timestamptz) TO authenticated;