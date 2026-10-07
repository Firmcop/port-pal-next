
-- Add new enum values
ALTER TYPE public.container_status ADD VALUE IF NOT EXISTS 'booked_for_repatriation';
ALTER TYPE public.movement_type ADD VALUE IF NOT EXISTS 'repatriation';

-- Create repatriation status enum
CREATE TYPE public.repatriation_status AS ENUM ('pending', 'approved', 'dispatched', 'completed', 'cancelled');

-- Create repatriations table
CREATE TABLE public.repatriations (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  repatriation_number TEXT NOT NULL UNIQUE,
  container_id UUID REFERENCES public.containers(id),
  release_order_no TEXT NOT NULL,
  shipping_line TEXT NOT NULL,
  destination TEXT NOT NULL,
  transporter TEXT,
  status public.repatriation_status NOT NULL DEFAULT 'pending',
  requested_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  approved_at TIMESTAMP WITH TIME ZONE,
  dispatched_at TIMESTAMP WITH TIME ZONE,
  completed_at TIMESTAMP WITH TIME ZONE,
  approved_by UUID,
  created_by UUID,
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.repatriations ENABLE ROW LEVEL SECURITY;

-- RLS policies
CREATE POLICY "Authenticated users can view repatriations"
  ON public.repatriations FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "Admins operators clerks can insert repatriations"
  ON public.repatriations FOR INSERT TO authenticated
  WITH CHECK (
    has_role(auth.uid(), 'admin'::app_role)
    OR has_role(auth.uid(), 'yard_operator'::app_role)
    OR has_role(auth.uid(), 'gate_clerk'::app_role)
  );

CREATE POLICY "Admins operators clerks can update repatriations"
  ON public.repatriations FOR UPDATE TO authenticated
  USING (
    has_role(auth.uid(), 'admin'::app_role)
    OR has_role(auth.uid(), 'yard_operator'::app_role)
    OR has_role(auth.uid(), 'gate_clerk'::app_role)
  );

-- Timestamp trigger
CREATE TRIGGER update_repatriations_updated_at
  BEFORE UPDATE ON public.repatriations
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
