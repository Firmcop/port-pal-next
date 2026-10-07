
-- Gate appointment status enum
CREATE TYPE public.appointment_status AS ENUM ('scheduled', 'confirmed', 'in_progress', 'completed', 'cancelled', 'no_show');

-- EIR type enum
CREATE TYPE public.eir_type AS ENUM ('gate_in', 'gate_out');

-- Condition grade enum
CREATE TYPE public.condition_grade AS ENUM ('A', 'B', 'C', 'D');

-- Gate Appointments table
CREATE TABLE public.gate_appointments (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  appointment_number TEXT NOT NULL UNIQUE,
  appointment_type TEXT NOT NULL CHECK (appointment_type IN ('gate_in', 'gate_out')),
  scheduled_at TIMESTAMP WITH TIME ZONE NOT NULL,
  container_number TEXT,
  container_id UUID REFERENCES public.containers(id),
  truck_plate TEXT,
  driver_name TEXT,
  driver_license TEXT,
  shipping_line TEXT,
  status public.appointment_status NOT NULL DEFAULT 'scheduled',
  notes TEXT,
  created_by UUID,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.gate_appointments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view appointments"
  ON public.gate_appointments FOR SELECT TO authenticated USING (true);

CREATE POLICY "Operators, clerks, and admins can insert appointments"
  ON public.gate_appointments FOR INSERT TO authenticated
  WITH CHECK (
    has_role(auth.uid(), 'admin') OR
    has_role(auth.uid(), 'yard_operator') OR
    has_role(auth.uid(), 'gate_clerk')
  );

CREATE POLICY "Operators, clerks, and admins can update appointments"
  ON public.gate_appointments FOR UPDATE TO authenticated
  USING (
    has_role(auth.uid(), 'admin') OR
    has_role(auth.uid(), 'yard_operator') OR
    has_role(auth.uid(), 'gate_clerk')
  );

CREATE TRIGGER update_gate_appointments_updated_at
  BEFORE UPDATE ON public.gate_appointments
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Trucks & Drivers registry
CREATE TABLE public.trucks_drivers (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  truck_plate TEXT NOT NULL,
  driver_name TEXT NOT NULL,
  driver_license TEXT,
  driver_phone TEXT,
  company TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.trucks_drivers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view trucks_drivers"
  ON public.trucks_drivers FOR SELECT TO authenticated USING (true);

CREATE POLICY "Operators, clerks, and admins can insert trucks_drivers"
  ON public.trucks_drivers FOR INSERT TO authenticated
  WITH CHECK (
    has_role(auth.uid(), 'admin') OR
    has_role(auth.uid(), 'yard_operator') OR
    has_role(auth.uid(), 'gate_clerk')
  );

CREATE POLICY "Operators, clerks, and admins can update trucks_drivers"
  ON public.trucks_drivers FOR UPDATE TO authenticated
  USING (
    has_role(auth.uid(), 'admin') OR
    has_role(auth.uid(), 'yard_operator') OR
    has_role(auth.uid(), 'gate_clerk')
  );

CREATE TRIGGER update_trucks_drivers_updated_at
  BEFORE UPDATE ON public.trucks_drivers
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- EIR Records table
CREATE TABLE public.eir_records (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  eir_number TEXT NOT NULL UNIQUE,
  appointment_id UUID REFERENCES public.gate_appointments(id),
  container_id UUID REFERENCES public.containers(id),
  eir_type public.eir_type NOT NULL,
  condition_grade public.condition_grade NOT NULL DEFAULT 'A',
  damage_description TEXT,
  cargo_status TEXT NOT NULL DEFAULT 'empty' CHECK (cargo_status IN ('empty', 'laden')),
  seal_number TEXT,
  photos JSONB DEFAULT '[]'::jsonb,
  inspector_notes TEXT,
  inspected_by UUID,
  completed_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.eir_records ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view eir_records"
  ON public.eir_records FOR SELECT TO authenticated USING (true);

CREATE POLICY "Operators, clerks, and admins can insert eir_records"
  ON public.eir_records FOR INSERT TO authenticated
  WITH CHECK (
    has_role(auth.uid(), 'admin') OR
    has_role(auth.uid(), 'yard_operator') OR
    has_role(auth.uid(), 'gate_clerk')
  );

CREATE POLICY "Operators, clerks, and admins can update eir_records"
  ON public.eir_records FOR UPDATE TO authenticated
  USING (
    has_role(auth.uid(), 'admin') OR
    has_role(auth.uid(), 'yard_operator') OR
    has_role(auth.uid(), 'gate_clerk')
  );

CREATE TRIGGER update_eir_records_updated_at
  BEFORE UPDATE ON public.eir_records
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Indexes
CREATE INDEX idx_gate_appointments_scheduled_at ON public.gate_appointments(scheduled_at);
CREATE INDEX idx_gate_appointments_status ON public.gate_appointments(status);
CREATE INDEX idx_eir_records_eir_type ON public.eir_records(eir_type);
CREATE INDEX idx_trucks_drivers_plate ON public.trucks_drivers(truck_plate);
