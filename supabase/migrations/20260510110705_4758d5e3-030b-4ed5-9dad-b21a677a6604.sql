
-- Org-wide usage metrics for platform admins
CREATE OR REPLACE FUNCTION public.org_usage_metrics(_org_id uuid, _days int DEFAULT 30)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _result jsonb;
  _since timestamptz := now() - make_interval(days => _days);
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  WITH
  series AS (
    SELECT generate_series(date_trunc('day', _since), date_trunc('day', now()), interval '1 day')::date AS d
  ),
  daily AS (
    SELECT
      s.d,
      (SELECT count(*) FROM public.containers WHERE organization_id=_org_id AND created_at::date = s.d) AS containers_added,
      (SELECT count(*) FROM public.container_movements WHERE organization_id=_org_id AND created_at::date = s.d) AS movements,
      (SELECT count(*) FROM public.gate_appointments WHERE organization_id=_org_id AND created_at::date = s.d) AS appointments,
      (SELECT count(*) FROM public.work_orders WHERE organization_id=_org_id AND created_at::date = s.d) AS work_orders,
      (SELECT count(*) FROM public.invoices WHERE organization_id=_org_id AND created_at::date = s.d) AS invoices,
      (SELECT count(*) FROM public.payments WHERE organization_id=_org_id AND created_at::date = s.d) AS payments
    FROM series s
  )
  SELECT jsonb_build_object(
    'period_days', _days,
    'inventory', jsonb_build_object(
      'total_containers', (SELECT count(*) FROM public.containers WHERE organization_id=_org_id),
      'added', (SELECT count(*) FROM public.containers WHERE organization_id=_org_id AND created_at >= _since),
      'series', (SELECT jsonb_agg(jsonb_build_object('d', to_char(d,'Mon DD'), 'v', containers_added) ORDER BY d) FROM daily)
    ),
    'gate', jsonb_build_object(
      'gate_in', (SELECT count(*) FROM public.container_movements WHERE organization_id=_org_id AND created_at >= _since AND movement_type='gate_in'),
      'gate_out', (SELECT count(*) FROM public.container_movements WHERE organization_id=_org_id AND created_at >= _since AND movement_type='gate_out'),
      'appointments', (SELECT count(*) FROM public.gate_appointments WHERE organization_id=_org_id AND created_at >= _since),
      'series', (SELECT jsonb_agg(jsonb_build_object('d', to_char(d,'Mon DD'), 'v', movements) ORDER BY d) FROM daily)
    ),
    'mr', jsonb_build_object(
      'work_orders_open', (SELECT count(*) FROM public.work_orders WHERE organization_id=_org_id AND status NOT IN ('completed','cancelled')),
      'work_orders_recent', (SELECT count(*) FROM public.work_orders WHERE organization_id=_org_id AND created_at >= _since),
      'inspections', (SELECT count(*) FROM public.inspections WHERE organization_id=_org_id AND created_at >= _since),
      'series', (SELECT jsonb_agg(jsonb_build_object('d', to_char(d,'Mon DD'), 'v', work_orders) ORDER BY d) FROM daily)
    ),
    'billing', jsonb_build_object(
      'invoices', (SELECT count(*) FROM public.invoices WHERE organization_id=_org_id AND created_at >= _since),
      'invoices_paid', (SELECT count(*) FROM public.invoices WHERE organization_id=_org_id AND created_at >= _since AND status='paid'),
      'payments', (SELECT count(*) FROM public.payments WHERE organization_id=_org_id AND created_at >= _since),
      'revenue', (SELECT COALESCE(sum(total_amount),0) FROM public.invoices WHERE organization_id=_org_id AND created_at >= _since),
      'series', (SELECT jsonb_agg(jsonb_build_object('d', to_char(d,'Mon DD'), 'v', invoices) ORDER BY d) FROM daily)
    ),
    'accounting', jsonb_build_object(
      'transactions', (SELECT count(*) FROM public.accounting_transactions WHERE organization_id=_org_id AND created_at >= _since)
    ),
    'crm', jsonb_build_object(
      'leads', (SELECT count(*) FROM public.leads WHERE organization_id=_org_id AND created_at >= _since),
      'deals', (SELECT count(*) FROM public.deals WHERE organization_id=_org_id AND created_at >= _since),
      'quotes', (SELECT count(*) FROM public.quotes WHERE organization_id=_org_id AND created_at >= _since)
    ),
    'procurement', jsonb_build_object(
      'purchase_orders', (SELECT count(*) FROM public.purchase_orders WHERE organization_id=_org_id AND created_at >= _since),
      'goods_receipts', (SELECT count(*) FROM public.goods_receipts WHERE organization_id=_org_id AND created_at >= _since)
    ),
    'leasing', jsonb_build_object(
      'agreements', (SELECT count(*) FROM public.lease_agreements WHERE organization_id=_org_id),
      'agreements_recent', (SELECT count(*) FROM public.lease_agreements WHERE organization_id=_org_id AND created_at >= _since)
    ),
    'portal', jsonb_build_object(
      'release_instructions', (SELECT count(*) FROM public.release_instructions WHERE organization_id=_org_id AND created_at >= _since)
    ),
    'whatsapp', jsonb_build_object(
      'messages', (SELECT count(*) FROM public.push_notification_queue q
                    JOIN public.notifications n ON n.id = q.notification_id
                    WHERE n.organization_id=_org_id AND q.channel='whatsapp' AND q.created_at >= _since)
    ),
    'members', jsonb_build_object(
      'active', public.org_active_user_count(_org_id)
    )
  ) INTO _result;
  RETURN _result;
END;
$$;

-- Unified audit feed (platform admin)
CREATE OR REPLACE FUNCTION public.org_audit_feed(_org_id uuid, _limit int DEFAULT 100, _before timestamptz DEFAULT NULL)
RETURNS TABLE(ts timestamptz, entity text, action text, ref_id uuid, summary jsonb, actor_id uuid)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  RETURN QUERY
  WITH unioned AS (
    SELECT e.created_at AS ts, 'lifecycle'::text AS entity, e.event_type AS action, e.id AS ref_id, e.details AS summary, e.actor_user_id AS actor_id
      FROM public.org_lifecycle_events e WHERE e.organization_id = _org_id
    UNION ALL
    SELECT m.created_at, 'movement', m.movement_type::text, m.id, jsonb_build_object('container_id', m.container_id), m.created_by
      FROM public.container_movements m WHERE m.organization_id = _org_id
    UNION ALL
    SELECT w.created_at, 'work_order', w.status::text, w.id, jsonb_build_object('wo_number', w.wo_number), w.created_by
      FROM public.work_orders w WHERE w.organization_id = _org_id
    UNION ALL
    SELECT i.created_at, 'invoice', i.status::text, i.id, jsonb_build_object('invoice_number', i.invoice_number, 'total', i.total_amount), i.created_by
      FROM public.invoices i WHERE i.organization_id = _org_id
    UNION ALL
    SELECT a.created_at, 'appointment', a.status::text, a.id, jsonb_build_object('appointment_number', a.appointment_number), a.created_by
      FROM public.gate_appointments a WHERE a.organization_id = _org_id
  )
  SELECT u.ts, u.entity, u.action, u.ref_id, u.summary, u.actor_id
  FROM unioned u
  WHERE _before IS NULL OR u.ts < _before
  ORDER BY u.ts DESC
  LIMIT _limit;
END;
$$;

-- Depot-scoped helpers for vendor depot detail (platform admin only)
CREATE OR REPLACE FUNCTION public.depot_kpis(_depot_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE _result jsonb;
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  SELECT jsonb_build_object(
    'containers_total', (SELECT count(*) FROM public.containers WHERE depot_id = _depot_id),
    'in_yard', (SELECT count(*) FROM public.containers WHERE depot_id = _depot_id AND block_id IS NOT NULL),
    'open_work_orders', (SELECT count(*) FROM public.work_orders w
                          JOIN public.containers c ON c.id = w.container_id
                          WHERE c.depot_id = _depot_id AND w.status NOT IN ('completed','cancelled')),
    'gate_moves_today', (SELECT count(*) FROM public.container_movements m
                          JOIN public.containers c ON c.id = m.container_id
                          WHERE c.depot_id = _depot_id
                            AND m.movement_type IN ('gate_in','gate_out')
                            AND m.created_at::date = current_date),
    'avg_dwell_days', (SELECT COALESCE(round(avg(EXTRACT(EPOCH FROM (COALESCE(gate_out_at, now()) - gate_in_at))/86400))::int, 0)
                        FROM public.containers
                        WHERE depot_id = _depot_id AND gate_in_at IS NOT NULL)
  ) INTO _result;
  RETURN _result;
END;
$$;
