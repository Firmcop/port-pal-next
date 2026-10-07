-- Add resolution columns to bank_reconciliation_lines
ALTER TABLE public.bank_reconciliation_lines
  ADD COLUMN IF NOT EXISTS override_reason text,
  ADD COLUMN IF NOT EXISTS excluded boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS resolved_at timestamptz,
  ADD COLUMN IF NOT EXISTS resolved_by uuid;

-- =====================================================================
-- run_recurring_transfer_now: post one occurrence immediately
-- =====================================================================
CREATE OR REPLACE FUNCTION public.run_recurring_transfer_now(_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r record;
  v_transfer_id uuid;
  v_num text;
  v_next timestamptz;
BEGIN
  SELECT * INTO r FROM public.recurring_transfers WHERE id = _id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Recurring transfer not found'; END IF;
  IF NOT (is_platform_admin() OR (r.organization_id = current_org_id() AND has_role(auth.uid(),'admin'::app_role))) THEN
    RAISE EXCEPTION 'Permission denied';
  END IF;

  v_num := 'TRF-' || to_char(now(),'YYMMDDHH24MISS') || '-' || substr(replace(r.id::text,'-',''),1,4);
  INSERT INTO public.inter_account_transfers (organization_id, transfer_number, transfer_date,
    from_account_id, to_account_id, amount, fx_rate, fees, description, reference, created_by)
  VALUES (r.organization_id, v_num, now(), r.from_account_id, r.to_account_id, r.amount,
    r.fx_rate, r.fees, COALESCE(r.description,'') || ' (manual run: ' || r.name || ')', r.reference, auth.uid())
  RETURNING id INTO v_transfer_id;

  INSERT INTO public.recurring_transfer_runs (organization_id, recurring_transfer_id, scheduled_for, transfer_id, status)
  VALUES (r.organization_id, r.id, now(), v_transfer_id, 'posted');

  v_next := CASE r.frequency
    WHEN 'daily' THEN r.next_run_at + (r.interval_count || ' days')::interval
    WHEN 'weekly' THEN r.next_run_at + (r.interval_count || ' weeks')::interval
    WHEN 'monthly' THEN r.next_run_at + (r.interval_count || ' months')::interval
    WHEN 'quarterly' THEN r.next_run_at + (r.interval_count * 3 || ' months')::interval
  END;

  UPDATE public.recurring_transfers
  SET last_run_at = now(),
      next_run_at = GREATEST(v_next, now() + interval '1 minute'),
      status = CASE WHEN r.end_date IS NOT NULL AND v_next::date > r.end_date THEN 'ended' ELSE status END
  WHERE id = r.id;

  INSERT INTO public.org_lifecycle_events (organization_id, event_type, actor_user_id, details)
  VALUES (r.organization_id, 'recurring_transfer_posted', auth.uid(),
    jsonb_build_object('recurring_transfer_id', r.id, 'transfer_id', v_transfer_id, 'manual', true));

  RETURN v_transfer_id;
END;
$$;

-- =====================================================================
-- resolve_reconciliation_conflict
-- =====================================================================
CREATE OR REPLACE FUNCTION public.resolve_reconciliation_conflict(
  _line_id uuid,
  _action text,
  _note text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  l record;
BEGIN
  SELECT * INTO l FROM public.bank_reconciliation_lines WHERE id = _line_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Line not found'; END IF;
  IF NOT (is_platform_admin() OR (l.organization_id = current_org_id()
    AND (has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'yard_operator'::app_role)))) THEN
    RAISE EXCEPTION 'Permission denied';
  END IF;

  IF _action = 'use_existing' THEN
    UPDATE public.bank_reconciliation_lines
      SET cleared = true, override_reason = COALESCE(_note,'use existing cleared txn'),
          resolved_at = now(), resolved_by = auth.uid()
      WHERE id = _line_id;

  ELSIF _action = 'detach_relink' THEN
    UPDATE public.accounting_transactions
      SET reconciliation_id = l.reconciliation_id
      WHERE id = l.transaction_id;
    UPDATE public.bank_reconciliation_lines
      SET cleared = true, override_reason = COALESCE(_note,'detached from prior reconciliation'),
          resolved_at = now(), resolved_by = auth.uid()
      WHERE id = _line_id;

  ELSIF _action = 'accept_anyway' THEN
    UPDATE public.bank_reconciliation_lines
      SET cleared = true, override_reason = COALESCE(_note,'date outside window — accepted'),
          resolved_at = now(), resolved_by = auth.uid()
      WHERE id = _line_id;

  ELSIF _action = 'mark_duplicate' THEN
    UPDATE public.bank_reconciliation_lines
      SET excluded = true, cleared = false,
          override_reason = COALESCE(_note,'marked as duplicate'),
          resolved_at = now(), resolved_by = auth.uid()
      WHERE id = _line_id;

  ELSE
    RAISE EXCEPTION 'Unknown action: %', _action;
  END IF;

  INSERT INTO public.org_lifecycle_events (organization_id, event_type, actor_user_id, details)
  VALUES (l.organization_id, 'reconciliation_conflict_resolved', auth.uid(),
    jsonb_build_object('line_id', _line_id, 'reconciliation_id', l.reconciliation_id, 'action', _action, 'note', _note));
END;
$$;

-- =====================================================================
-- bulk_clear_reconciliation_lines_v2 (line-id based, partial-apply, audit)
-- =====================================================================
CREATE OR REPLACE FUNCTION public.bulk_clear_reconciliation_lines_v2(
  _recon_id uuid,
  _line_ids uuid[],
  _skip_conflicts boolean DEFAULT true
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_recon record;
  v_cleared integer := 0;
  v_skipped jsonb := '[]'::jsonb;
  l record;
  v_conflict text;
BEGIN
  SELECT * INTO v_recon FROM public.bank_reconciliations WHERE id = _recon_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Reconciliation not found'; END IF;
  IF NOT (is_platform_admin() OR (v_recon.organization_id = current_org_id()
    AND (has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'yard_operator'::app_role)))) THEN
    RAISE EXCEPTION 'Permission denied';
  END IF;

  FOR l IN
    SELECT brl.*, at.reconciliation_id AS txn_recon_id, at.transaction_date
    FROM public.bank_reconciliation_lines brl
    JOIN public.accounting_transactions at ON at.id = brl.transaction_id
    WHERE brl.id = ANY(_line_ids) AND brl.reconciliation_id = _recon_id
  LOOP
    v_conflict := NULL;
    IF l.excluded THEN v_conflict := 'excluded'; END IF;
    IF v_conflict IS NULL AND l.txn_recon_id IS NOT NULL AND l.txn_recon_id <> _recon_id AND l.resolved_at IS NULL THEN
      v_conflict := 'linked to other reconciliation';
    END IF;

    IF v_conflict IS NOT NULL AND _skip_conflicts THEN
      v_skipped := v_skipped || jsonb_build_object('line_id', l.id, 'reason', v_conflict);
      CONTINUE;
    END IF;

    UPDATE public.bank_reconciliation_lines
      SET cleared = true
      WHERE id = l.id;
    v_cleared := v_cleared + 1;
  END LOOP;

  INSERT INTO public.org_lifecycle_events (organization_id, event_type, actor_user_id, details)
  VALUES (v_recon.organization_id, 'reconciliation_bulk_cleared', auth.uid(),
    jsonb_build_object(
      'reconciliation_id', _recon_id,
      'cleared_count', v_cleared,
      'skipped_count', jsonb_array_length(v_skipped),
      'line_ids', to_jsonb(_line_ids),
      'skipped', v_skipped
    ));

  RETURN jsonb_build_object('cleared', v_cleared, 'skipped', v_skipped);
END;
$$;

-- =====================================================================
-- undo_bulk_clear
-- =====================================================================
CREATE OR REPLACE FUNCTION public.undo_bulk_clear(
  _recon_id uuid,
  _line_ids uuid[]
) RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_recon record;
  v_count integer;
BEGIN
  SELECT * INTO v_recon FROM public.bank_reconciliations WHERE id = _recon_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Reconciliation not found'; END IF;
  IF NOT (is_platform_admin() OR (v_recon.organization_id = current_org_id()
    AND (has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'yard_operator'::app_role)))) THEN
    RAISE EXCEPTION 'Permission denied';
  END IF;

  UPDATE public.bank_reconciliation_lines
    SET cleared = false
    WHERE id = ANY(_line_ids) AND reconciliation_id = _recon_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;

  INSERT INTO public.org_lifecycle_events (organization_id, event_type, actor_user_id, details)
  VALUES (v_recon.organization_id, 'reconciliation_bulk_clear_undone', auth.uid(),
    jsonb_build_object('reconciliation_id', _recon_id, 'count', v_count, 'line_ids', to_jsonb(_line_ids)));

  RETURN v_count;
END;
$$;