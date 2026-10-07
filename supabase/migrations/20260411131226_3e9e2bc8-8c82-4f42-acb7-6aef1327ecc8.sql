
-- 1. Alter container_conversions
ALTER TABLE public.container_conversions
  ADD COLUMN IF NOT EXISTS customer_id uuid,
  ADD COLUMN IF NOT EXISTS quoted_price numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS start_date date,
  ADD COLUMN IF NOT EXISTS end_date date,
  ADD COLUMN IF NOT EXISTS container_cost numeric DEFAULT 0;

-- 2. Alter conversion_materials
ALTER TABLE public.conversion_materials
  ADD COLUMN IF NOT EXISTS qty_planned numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS qty_used numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS source text DEFAULT 'purchase';

-- 3. Create conversion_labour
CREATE TABLE public.conversion_labour (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  conversion_id uuid NOT NULL REFERENCES public.container_conversions(id) ON DELETE CASCADE,
  worker_name text NOT NULL,
  role text,
  hours numeric NOT NULL DEFAULT 0,
  rate numeric NOT NULL DEFAULT 0,
  total_cost numeric NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.conversion_labour ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can view conversion_labour" ON public.conversion_labour FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins and operators can insert conversion_labour" ON public.conversion_labour FOR INSERT TO authenticated WITH CHECK (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'yard_operator'::app_role));
CREATE POLICY "Admins and operators can update conversion_labour" ON public.conversion_labour FOR UPDATE TO authenticated USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'yard_operator'::app_role));

-- 4. Create conversion_tasks
CREATE TABLE public.conversion_tasks (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  conversion_id uuid NOT NULL REFERENCES public.container_conversions(id) ON DELETE CASCADE,
  task_name text NOT NULL,
  assigned_to text,
  status text NOT NULL DEFAULT 'pending',
  start_time timestamptz,
  end_time timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.conversion_tasks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can view conversion_tasks" ON public.conversion_tasks FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins and operators can insert conversion_tasks" ON public.conversion_tasks FOR INSERT TO authenticated WITH CHECK (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'yard_operator'::app_role));
CREATE POLICY "Admins and operators can update conversion_tasks" ON public.conversion_tasks FOR UPDATE TO authenticated USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'yard_operator'::app_role));

-- 5. Create conversion_services
CREATE TABLE public.conversion_services (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  conversion_id uuid NOT NULL REFERENCES public.container_conversions(id) ON DELETE CASCADE,
  service_type text NOT NULL DEFAULT 'other',
  description text,
  cost numeric NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.conversion_services ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can view conversion_services" ON public.conversion_services FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins and operators can insert conversion_services" ON public.conversion_services FOR INSERT TO authenticated WITH CHECK (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'yard_operator'::app_role));
CREATE POLICY "Admins and operators can update conversion_services" ON public.conversion_services FOR UPDATE TO authenticated USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'yard_operator'::app_role));

-- 6. Create material_requests
CREATE TABLE public.material_requests (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  conversion_id uuid NOT NULL REFERENCES public.container_conversions(id) ON DELETE CASCADE,
  description text NOT NULL,
  quantity numeric NOT NULL DEFAULT 1,
  status text NOT NULL DEFAULT 'requested',
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.material_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can view material_requests" ON public.material_requests FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins and operators can insert material_requests" ON public.material_requests FOR INSERT TO authenticated WITH CHECK (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'yard_operator'::app_role));
CREATE POLICY "Admins and operators can update material_requests" ON public.material_requests FOR UPDATE TO authenticated USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'yard_operator'::app_role));

-- 7. Create purchases
CREATE TABLE public.purchases (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  conversion_id uuid NOT NULL REFERENCES public.container_conversions(id) ON DELETE CASCADE,
  supplier text NOT NULL,
  description text NOT NULL,
  quantity numeric NOT NULL DEFAULT 1,
  unit_price numeric NOT NULL DEFAULT 0,
  total_cost numeric NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.purchases ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can view purchases" ON public.purchases FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins and operators can insert purchases" ON public.purchases FOR INSERT TO authenticated WITH CHECK (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'yard_operator'::app_role));
CREATE POLICY "Admins and operators can update purchases" ON public.purchases FOR UPDATE TO authenticated USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'yard_operator'::app_role));
