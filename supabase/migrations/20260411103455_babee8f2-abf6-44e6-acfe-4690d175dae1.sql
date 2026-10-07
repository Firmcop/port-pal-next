
-- 1. Add new columns to eir_records
ALTER TABLE public.eir_records
  ADD COLUMN IF NOT EXISTS release_purpose text DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS released_by_name text DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS released_by_role text DEFAULT NULL;

-- 2. Create customer_type enum
CREATE TYPE public.customer_type AS ENUM ('buyer', 'shipping_line', 'owner', 'agent');

-- 3. Create customers table
CREATE TABLE public.customers (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  customer_type public.customer_type NOT NULL,
  company_name text NOT NULL,
  contact_person text,
  email text,
  phone text,
  whatsapp_number text,
  address text,
  tax_id text,
  notes text,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view customers"
  ON public.customers FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "Admins operators clerks can insert customers"
  ON public.customers FOR INSERT TO authenticated
  WITH CHECK (
    has_role(auth.uid(), 'admin'::app_role)
    OR has_role(auth.uid(), 'yard_operator'::app_role)
    OR has_role(auth.uid(), 'gate_clerk'::app_role)
  );

CREATE POLICY "Admins operators clerks can update customers"
  ON public.customers FOR UPDATE TO authenticated
  USING (
    has_role(auth.uid(), 'admin'::app_role)
    OR has_role(auth.uid(), 'yard_operator'::app_role)
    OR has_role(auth.uid(), 'gate_clerk'::app_role)
  );

CREATE TRIGGER update_customers_updated_at
  BEFORE UPDATE ON public.customers
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 4. Create notification_log table
CREATE TABLE public.notification_log (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  recipient_name text NOT NULL,
  recipient_contact text NOT NULL,
  channel text NOT NULL DEFAULT 'email',
  message_summary text NOT NULL,
  reference_type text,
  reference_id uuid,
  sent_by uuid,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.notification_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view notification logs"
  ON public.notification_log FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "Admins operators clerks can insert notification logs"
  ON public.notification_log FOR INSERT TO authenticated
  WITH CHECK (
    has_role(auth.uid(), 'admin'::app_role)
    OR has_role(auth.uid(), 'yard_operator'::app_role)
    OR has_role(auth.uid(), 'gate_clerk'::app_role)
  );

-- 5. Create container-photos storage bucket
INSERT INTO storage.buckets (id, name, public)
VALUES ('container-photos', 'container-photos', true);

CREATE POLICY "Anyone can view container photos"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'container-photos');

CREATE POLICY "Authenticated users can upload container photos"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'container-photos');

CREATE POLICY "Authenticated users can update container photos"
  ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'container-photos');
