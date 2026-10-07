
-- Enums
CREATE TYPE public.container_status AS ENUM ('available', 'allocated', 'damaged', 'repair_pending', 'in_repair', 'hold');
CREATE TYPE public.container_category AS ENUM ('dry', 'reefer', 'tank', 'flat_rack', 'open_top');
CREATE TYPE public.container_size AS ENUM ('20', '40', '45');
CREATE TYPE public.block_type AS ENUM ('dry', 'reefer', 'hazmat', 'mixed');
CREATE TYPE public.movement_type AS ENUM ('gate_in', 'gate_out', 'reposition', 'stack', 'unstack');
CREATE TYPE public.app_role AS ENUM ('admin', 'yard_operator', 'gate_clerk', 'viewer');

-- Profiles
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL UNIQUE,
  display_name TEXT,
  phone TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- User roles
CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  role app_role NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);

-- Depots
CREATE TABLE public.depots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  code TEXT NOT NULL UNIQUE,
  location TEXT,
  timezone TEXT NOT NULL DEFAULT 'UTC',
  currency TEXT NOT NULL DEFAULT 'USD',
  config JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Yard blocks
CREATE TABLE public.yard_blocks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  depot_id UUID REFERENCES public.depots(id) ON DELETE CASCADE NOT NULL,
  name TEXT NOT NULL,
  block_type block_type NOT NULL DEFAULT 'dry',
  max_rows INT NOT NULL DEFAULT 10,
  max_bays INT NOT NULL DEFAULT 10,
  max_tiers INT NOT NULL DEFAULT 5,
  has_power BOOLEAN NOT NULL DEFAULT false,
  coordinates JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (depot_id, name)
);

-- Containers
CREATE TABLE public.containers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  container_number TEXT NOT NULL UNIQUE,
  iso_type TEXT,
  size container_size NOT NULL DEFAULT '20',
  category container_category NOT NULL DEFAULT 'dry',
  status container_status NOT NULL DEFAULT 'available',
  owner TEXT,
  shipping_line TEXT,
  weight_kg NUMERIC,
  tare_weight_kg NUMERIC,
  imo_class TEXT,
  is_empty BOOLEAN NOT NULL DEFAULT true,
  depot_id UUID REFERENCES public.depots(id),
  block_id UUID REFERENCES public.yard_blocks(id),
  bay INT,
  row INT,
  tier INT,
  gate_in_at TIMESTAMPTZ,
  gate_out_at TIMESTAMPTZ,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Container movements (append-only audit trail)
CREATE TABLE public.container_movements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  container_id UUID REFERENCES public.containers(id) ON DELETE CASCADE NOT NULL,
  movement_type movement_type NOT NULL,
  from_block_id UUID REFERENCES public.yard_blocks(id),
  from_bay INT,
  from_row INT,
  from_tier INT,
  to_block_id UUID REFERENCES public.yard_blocks(id),
  to_bay INT,
  to_row INT,
  to_tier INT,
  performed_by UUID REFERENCES auth.users(id),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX idx_containers_number ON public.containers(container_number);
CREATE INDEX idx_containers_status ON public.containers(status);
CREATE INDEX idx_containers_depot ON public.containers(depot_id);
CREATE INDEX idx_containers_block ON public.containers(block_id);
CREATE INDEX idx_movements_container ON public.container_movements(container_id);
CREATE INDEX idx_movements_created ON public.container_movements(created_at DESC);

-- Updated_at trigger function
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

-- Apply updated_at triggers
CREATE TRIGGER update_profiles_updated_at BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_depots_updated_at BEFORE UPDATE ON public.depots FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_yard_blocks_updated_at BEFORE UPDATE ON public.yard_blocks FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_containers_updated_at BEFORE UPDATE ON public.containers FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Auto-create profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (user_id, display_name)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'display_name', NEW.email));
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Security definer function for role checks
CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role app_role)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = _role
  )
$$;

-- Enable RLS on all tables
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.depots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.yard_blocks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.containers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.container_movements ENABLE ROW LEVEL SECURITY;

-- Profiles policies
CREATE POLICY "Users can view own profile" ON public.profiles FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users can update own profile" ON public.profiles FOR UPDATE TO authenticated USING (auth.uid() = user_id);

-- User roles policies
CREATE POLICY "Users can view own roles" ON public.user_roles FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Admins can manage roles" ON public.user_roles FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- Depots policies
CREATE POLICY "Authenticated users can view depots" ON public.depots FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins can manage depots" ON public.depots FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- Yard blocks policies
CREATE POLICY "Authenticated users can view yard blocks" ON public.yard_blocks FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins can manage yard blocks" ON public.yard_blocks FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- Containers policies
CREATE POLICY "Authenticated users can view containers" ON public.containers FOR SELECT TO authenticated USING (true);
CREATE POLICY "Operators and admins can insert containers" ON public.containers FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'yard_operator'));
CREATE POLICY "Operators and admins can update containers" ON public.containers FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'yard_operator'));

-- Movements policies
CREATE POLICY "Authenticated users can view movements" ON public.container_movements FOR SELECT TO authenticated USING (true);
CREATE POLICY "Operators and admins can insert movements" ON public.container_movements FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'yard_operator'));
