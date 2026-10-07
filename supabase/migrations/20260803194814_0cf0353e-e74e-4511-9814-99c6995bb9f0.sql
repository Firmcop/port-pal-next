ALTER TABLE public.quotes
  ADD COLUMN IF NOT EXISTS archived_at timestamptz,
  ADD COLUMN IF NOT EXISTS archived_by uuid,
  ADD COLUMN IF NOT EXISTS archive_reason text;

CREATE INDEX IF NOT EXISTS idx_quotes_archived_at ON public.quotes(archived_at);

CREATE TABLE IF NOT EXISTS public.quote_deletion_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL DEFAULT current_org_id(),
  quote_id uuid NOT NULL,
  quote_number text NOT NULL,
  customer_name text,
  total_amount numeric NOT NULL DEFAULT 0,
  reason text NOT NULL,
  snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  deleted_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.quote_deletion_audit TO authenticated;
GRANT ALL ON public.quote_deletion_audit TO service_role;
ALTER TABLE public.quote_deletion_audit ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "org read quote deletion audit" ON public.quote_deletion_audit;
CREATE POLICY "org read quote deletion audit" ON public.quote_deletion_audit
FOR SELECT TO authenticated
USING (organization_id = current_org_id() OR is_platform_admin());

CREATE OR REPLACE FUNCTION public.guard_archived_quote_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.archived_at IS NOT NULL AND NEW.archived_at IS NOT NULL THEN
    RAISE EXCEPTION 'This quote is archived. Restore it before making changes.';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.guard_archived_quote_update() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_guard_archived_quote_update ON public.quotes;
CREATE TRIGGER trg_guard_archived_quote_update
BEFORE UPDATE ON public.quotes
FOR EACH ROW EXECUTE FUNCTION public.guard_archived_quote_update();

CREATE OR REPLACE FUNCTION public._assert_quote_admin(_quote_id uuid)
RETURNS public.quotes
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE q public.quotes;
BEGIN
  SELECT * INTO q FROM public.quotes WHERE id = _quote_id;
  IF q.id IS NULL THEN
    RAISE EXCEPTION 'Quote not found';
  END IF;
  IF NOT is_platform_admin() AND q.organization_id <> current_org_id() THEN
    RAISE EXCEPTION 'Quote not found';
  END IF;
  IF NOT (is_platform_admin() OR has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'org_owner'::app_role)) THEN
    RAISE EXCEPTION 'Only admins can archive or delete quotes';
  END IF;
  RETURN q;
END;
$$;

REVOKE ALL ON FUNCTION public._assert_quote_admin(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.archive_quote(_quote_id uuid, _reason text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE q public.quotes;
BEGIN
  q := public._assert_quote_admin(_quote_id);
  IF q.archived_at IS NOT NULL THEN RETURN; END IF;
  UPDATE public.quotes
     SET archived_at = now(), archived_by = auth.uid(), archive_reason = NULLIF(btrim(coalesce(_reason,'')), '')
   WHERE id = _quote_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.unarchive_quote(_quote_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public._assert_quote_admin(_quote_id);
  UPDATE public.quotes
     SET archived_at = NULL, archived_by = NULL, archive_reason = NULL
   WHERE id = _quote_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_quote(_quote_id uuid, _reason text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  q public.quotes;
  blocker text;
  cust text;
BEGIN
  q := public._assert_quote_admin(_quote_id);

  IF btrim(coalesce(_reason, '')) = '' THEN
    RAISE EXCEPTION 'A reason is required to delete a quote';
  END IF;

  SELECT 'sales order ' || order_number INTO blocker
    FROM public.sales_orders WHERE quote_id = _quote_id LIMIT 1;
  IF blocker IS NULL THEN
    SELECT 'conversion job ' || coalesce(job_number, id::text) INTO blocker
      FROM public.container_conversions WHERE quote_id = _quote_id LIMIT 1;
  END IF;
  IF blocker IS NULL THEN
    SELECT 'container sale ' || id::text INTO blocker
      FROM public.container_sales WHERE quote_id = _quote_id LIMIT 1;
  END IF;
  IF blocker IS NOT NULL THEN
    RAISE EXCEPTION 'Cannot delete: quote is linked to %. Archive it instead.', blocker;
  END IF;

  SELECT company_name INTO cust FROM public.customers WHERE id = q.customer_id;

  INSERT INTO public.quote_deletion_audit (organization_id, quote_id, quote_number, customer_name, total_amount, reason, snapshot, deleted_by)
  VALUES (
    q.organization_id, q.id, q.quote_number, cust, coalesce(q.total_amount, 0), btrim(_reason),
    jsonb_build_object(
      'quote', to_jsonb(q),
      'items', coalesce((SELECT jsonb_agg(to_jsonb(i)) FROM public.quote_items i WHERE i.quote_id = q.id), '[]'::jsonb),
      'sections', coalesce((SELECT jsonb_agg(to_jsonb(s)) FROM public.quote_sections s WHERE s.quote_id = q.id), '[]'::jsonb)
    ),
    auth.uid()
  );

  UPDATE public.quotes SET archived_at = NULL WHERE id = _quote_id;
  DELETE FROM public.quote_visuals WHERE quote_id = _quote_id;
  DELETE FROM public.quote_versions WHERE quote_id = _quote_id;
  DELETE FROM public.quote_items WHERE quote_id = _quote_id;
  DELETE FROM public.quote_sections WHERE quote_id = _quote_id;
  DELETE FROM public.quotes WHERE id = _quote_id;
END;
$$;

REVOKE ALL ON FUNCTION public.archive_quote(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.unarchive_quote(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.delete_quote(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.archive_quote(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.unarchive_quote(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_quote(uuid, text) TO authenticated;