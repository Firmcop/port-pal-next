CREATE TABLE public.security_findings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  description text,
  source text NOT NULL DEFAULT 'manual',
  external_id text,
  severity text NOT NULL DEFAULT 'medium' CHECK (severity IN ('low','medium','high','critical')),
  category text NOT NULL DEFAULT 'other' CHECK (category IN ('rls','migration','config','code','dependency','other')),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','in_progress','fixed','ignored','wont_fix')),
  affected_object text,
  remediation_sql text,
  remediation_notes text,
  reference_url text,
  organization_id uuid,
  detected_at timestamptz NOT NULL DEFAULT now(),
  fixed_at timestamptz,
  fixed_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_security_findings_status ON public.security_findings(status);
CREATE INDEX idx_security_findings_severity ON public.security_findings(severity);
CREATE INDEX idx_security_findings_source ON public.security_findings(source);

ALTER TABLE public.security_findings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "platform admins can view security findings"
  ON public.security_findings FOR SELECT
  USING (public.is_platform_admin());

CREATE POLICY "platform admins can insert security findings"
  ON public.security_findings FOR INSERT
  WITH CHECK (public.is_platform_admin());

CREATE POLICY "platform admins can update security findings"
  ON public.security_findings FOR UPDATE
  USING (public.is_platform_admin());

CREATE POLICY "platform admins can delete security findings"
  ON public.security_findings FOR DELETE
  USING (public.is_platform_admin());

CREATE TRIGGER trg_security_findings_updated_at
  BEFORE UPDATE ON public.security_findings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();