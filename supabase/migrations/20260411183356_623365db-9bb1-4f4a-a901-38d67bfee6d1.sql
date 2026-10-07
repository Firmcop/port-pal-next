
-- Employees register
CREATE TABLE public.employees (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name text NOT NULL,
  role text NOT NULL,
  phone text,
  daily_rate numeric NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.employees ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins and operators can insert employees"
  ON public.employees FOR INSERT TO authenticated
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'yard_operator'::app_role));

CREATE POLICY "Admins and operators can update employees"
  ON public.employees FOR UPDATE TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'yard_operator'::app_role));

CREATE POLICY "Staff can view employees"
  ON public.employees FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'yard_operator'::app_role) OR has_role(auth.uid(), 'viewer'::app_role));

-- Repatriation cost line items
CREATE TABLE public.repatriation_costs (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  repatriation_id uuid NOT NULL REFERENCES public.repatriations(id) ON DELETE CASCADE,
  cost_type text NOT NULL,
  description text,
  amount numeric NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.repatriation_costs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins and operators can insert repatriation_costs"
  ON public.repatriation_costs FOR INSERT TO authenticated
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'yard_operator'::app_role));

CREATE POLICY "Admins and operators can update repatriation_costs"
  ON public.repatriation_costs FOR UPDATE TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'yard_operator'::app_role));

CREATE POLICY "Staff can view repatriation_costs"
  ON public.repatriation_costs FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'yard_operator'::app_role) OR has_role(auth.uid(), 'viewer'::app_role));

-- Add charge_amount to repatriations
ALTER TABLE public.repatriations ADD COLUMN charge_amount numeric NOT NULL DEFAULT 0;
