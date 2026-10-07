
-- Inspection type enum
CREATE TYPE public.inspection_type AS ENUM ('gate_in', 'periodic', 'pre_delivery', 'damage');

-- Repair type enum
CREATE TYPE public.repair_type AS ENUM ('structural', 'cosmetic', 'mechanical', 'electrical', 'reefer');

-- Approval status enum
CREATE TYPE public.approval_status AS ENUM ('pending', 'approved', 'rejected', 'revised');

-- Work order status enum
CREATE TYPE public.wo_status AS ENUM ('open', 'in_progress', 'on_hold', 'completed', 'cancelled');

-- Work order priority enum
CREATE TYPE public.wo_priority AS ENUM ('low', 'medium', 'high', 'urgent');

-- Inspections table
CREATE TABLE public.inspections (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  inspection_number TEXT NOT NULL UNIQUE,
  container_id UUID REFERENCES public.containers(id),
  inspection_type public.inspection_type NOT NULL DEFAULT 'damage',
  findings TEXT,
  condition_grade public.condition_grade NOT NULL DEFAULT 'A',
  requires_repair BOOLEAN NOT NULL DEFAULT false,
  photos JSONB DEFAULT '[]'::jsonb,
  inspector_notes TEXT,
  inspected_by UUID,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.inspections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view inspections"
  ON public.inspections FOR SELECT TO authenticated USING (true);
CREATE POLICY "Operators, clerks, and admins can insert inspections"
  ON public.inspections FOR INSERT TO authenticated
  WITH CHECK (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'yard_operator') OR has_role(auth.uid(), 'gate_clerk'));
CREATE POLICY "Operators, clerks, and admins can update inspections"
  ON public.inspections FOR UPDATE TO authenticated
  USING (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'yard_operator') OR has_role(auth.uid(), 'gate_clerk'));

CREATE TRIGGER update_inspections_updated_at
  BEFORE UPDATE ON public.inspections FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Damage Estimates table
CREATE TABLE public.damage_estimates (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  estimate_number TEXT NOT NULL UNIQUE,
  inspection_id UUID REFERENCES public.inspections(id),
  container_id UUID REFERENCES public.containers(id),
  description TEXT NOT NULL,
  repair_type public.repair_type NOT NULL DEFAULT 'structural',
  labor_hours NUMERIC(6,2) DEFAULT 0,
  labor_cost NUMERIC(10,2) DEFAULT 0,
  material_cost NUMERIC(10,2) DEFAULT 0,
  total_cost NUMERIC(10,2) DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'EUR',
  approval_status public.approval_status NOT NULL DEFAULT 'pending',
  approved_by UUID,
  approved_at TIMESTAMP WITH TIME ZONE,
  rejection_reason TEXT,
  created_by UUID,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.damage_estimates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view estimates"
  ON public.damage_estimates FOR SELECT TO authenticated USING (true);
CREATE POLICY "Operators, clerks, and admins can insert estimates"
  ON public.damage_estimates FOR INSERT TO authenticated
  WITH CHECK (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'yard_operator') OR has_role(auth.uid(), 'gate_clerk'));
CREATE POLICY "Operators, clerks, and admins can update estimates"
  ON public.damage_estimates FOR UPDATE TO authenticated
  USING (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'yard_operator') OR has_role(auth.uid(), 'gate_clerk'));

CREATE TRIGGER update_damage_estimates_updated_at
  BEFORE UPDATE ON public.damage_estimates FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Repair Line Items
CREATE TABLE public.repair_line_items (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  estimate_id UUID NOT NULL REFERENCES public.damage_estimates(id) ON DELETE CASCADE,
  description TEXT NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 1,
  unit_cost NUMERIC(10,2) NOT NULL DEFAULT 0,
  total_cost NUMERIC(10,2) NOT NULL DEFAULT 0,
  part_number TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.repair_line_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view line items"
  ON public.repair_line_items FOR SELECT TO authenticated USING (true);
CREATE POLICY "Operators, clerks, and admins can insert line items"
  ON public.repair_line_items FOR INSERT TO authenticated
  WITH CHECK (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'yard_operator') OR has_role(auth.uid(), 'gate_clerk'));
CREATE POLICY "Operators, clerks, and admins can update line items"
  ON public.repair_line_items FOR UPDATE TO authenticated
  USING (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'yard_operator') OR has_role(auth.uid(), 'gate_clerk'));

-- Work Orders table
CREATE TABLE public.work_orders (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  wo_number TEXT NOT NULL UNIQUE,
  estimate_id UUID REFERENCES public.damage_estimates(id),
  container_id UUID REFERENCES public.containers(id),
  assigned_to TEXT,
  priority public.wo_priority NOT NULL DEFAULT 'medium',
  status public.wo_status NOT NULL DEFAULT 'open',
  started_at TIMESTAMP WITH TIME ZONE,
  completed_at TIMESTAMP WITH TIME ZONE,
  actual_cost NUMERIC(10,2),
  completion_notes TEXT,
  created_by UUID,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.work_orders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view work orders"
  ON public.work_orders FOR SELECT TO authenticated USING (true);
CREATE POLICY "Operators, clerks, and admins can insert work orders"
  ON public.work_orders FOR INSERT TO authenticated
  WITH CHECK (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'yard_operator') OR has_role(auth.uid(), 'gate_clerk'));
CREATE POLICY "Operators, clerks, and admins can update work orders"
  ON public.work_orders FOR UPDATE TO authenticated
  USING (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'yard_operator') OR has_role(auth.uid(), 'gate_clerk'));

CREATE TRIGGER update_work_orders_updated_at
  BEFORE UPDATE ON public.work_orders FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Indexes
CREATE INDEX idx_inspections_container ON public.inspections(container_id);
CREATE INDEX idx_damage_estimates_inspection ON public.damage_estimates(inspection_id);
CREATE INDEX idx_damage_estimates_status ON public.damage_estimates(approval_status);
CREATE INDEX idx_work_orders_status ON public.work_orders(status);
CREATE INDEX idx_work_orders_priority ON public.work_orders(priority);
CREATE INDEX idx_repair_line_items_estimate ON public.repair_line_items(estimate_id);
