
-- Rate limit log for public endpoints
CREATE TABLE IF NOT EXISTS public.public_request_log (
  id BIGSERIAL PRIMARY KEY,
  endpoint TEXT NOT NULL,
  ip_hash TEXT NOT NULL,
  email_hash TEXT,
  organization_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT ALL ON public.public_request_log TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.public_request_log_id_seq TO service_role;

ALTER TABLE public.public_request_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service role manages public request log"
  ON public.public_request_log FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE INDEX IF NOT EXISTS public_request_log_lookup_idx
  ON public.public_request_log (endpoint, ip_hash, created_at DESC);
CREATE INDEX IF NOT EXISTS public_request_log_email_idx
  ON public.public_request_log (endpoint, email_hash, created_at DESC)
  WHERE email_hash IS NOT NULL;

-- Best-effort prune: keep 7 days
CREATE OR REPLACE FUNCTION public.prune_public_request_log()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  DELETE FROM public.public_request_log WHERE created_at < now() - interval '7 days';
$$;

REVOKE ALL ON FUNCTION public.prune_public_request_log() FROM PUBLIC, anon, authenticated;

-- Extend leads with metadata for inbound triage if missing
ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb;
