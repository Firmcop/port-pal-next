
-- Store Issues: materials issued from stock to conversion jobs
CREATE TABLE public.store_issues (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  issue_number text NOT NULL UNIQUE,
  conversion_id uuid NOT NULL REFERENCES public.container_conversions(id),
  material_id uuid NOT NULL REFERENCES public.materials(id),
  quantity numeric NOT NULL DEFAULT 0,
  issued_by uuid,
  notes text,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.store_issues ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff can view store_issues" ON public.store_issues
  FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'yard_operator'::app_role) OR has_role(auth.uid(), 'viewer'::app_role));

CREATE POLICY "Admins and operators can insert store_issues" ON public.store_issues
  FOR INSERT TO authenticated
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'yard_operator'::app_role));

CREATE POLICY "Admins and operators can update store_issues" ON public.store_issues
  FOR UPDATE TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'yard_operator'::app_role));

-- Store Returns: materials returned from jobs back to store
CREATE TABLE public.store_returns (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  return_number text NOT NULL UNIQUE,
  conversion_id uuid REFERENCES public.container_conversions(id),
  material_id uuid NOT NULL REFERENCES public.materials(id),
  quantity numeric NOT NULL DEFAULT 0,
  returned_by uuid,
  reason text,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.store_returns ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff can view store_returns" ON public.store_returns
  FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'yard_operator'::app_role) OR has_role(auth.uid(), 'viewer'::app_role));

CREATE POLICY "Admins and operators can insert store_returns" ON public.store_returns
  FOR INSERT TO authenticated
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'yard_operator'::app_role));

CREATE POLICY "Admins and operators can update store_returns" ON public.store_returns
  FOR UPDATE TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'yard_operator'::app_role));
