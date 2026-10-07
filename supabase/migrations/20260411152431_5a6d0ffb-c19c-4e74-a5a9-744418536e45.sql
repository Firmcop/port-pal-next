
-- 1. Add 'customer' to the app_role enum
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'customer';

-- 2. Create customer_portal_users table
CREATE TABLE public.customer_portal_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE,
  customer_id uuid NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.customer_portal_users ENABLE ROW LEVEL SECURITY;

-- Portal users can view their own record
CREATE POLICY "Portal users can view own record"
  ON public.customer_portal_users FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- Staff can view all portal users
CREATE POLICY "Staff can view all portal users"
  ON public.customer_portal_users FOR SELECT
  TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));

-- Admins can insert portal users
CREATE POLICY "Admins can insert portal users"
  ON public.customer_portal_users FOR INSERT
  TO authenticated
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

-- Admins can update portal users
CREATE POLICY "Admins can update portal users"
  ON public.customer_portal_users FOR UPDATE
  TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));

-- Admins can delete portal users
CREATE POLICY "Admins can delete portal users"
  ON public.customer_portal_users FOR DELETE
  TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));

-- 3. Create security definer function to get portal customer_id
CREATE OR REPLACE FUNCTION public.get_portal_customer_id(_user_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT customer_id FROM public.customer_portal_users
  WHERE user_id = _user_id AND is_active = true
  LIMIT 1
$$;

-- 4. Create release_instructions table
CREATE TABLE public.release_instructions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  instruction_number text NOT NULL UNIQUE,
  customer_id uuid NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  container_id uuid REFERENCES public.containers(id),
  container_number text,
  release_type text NOT NULL DEFAULT 'pickup' CHECK (release_type IN ('pickup', 'delivery', 'reposition')),
  consignee_name text,
  truck_plate text,
  driver_name text,
  driver_id_number text,
  valid_from timestamp with time zone,
  valid_until timestamp with time zone,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'used', 'expired', 'cancelled')),
  notes text,
  source text NOT NULL DEFAULT 'portal' CHECK (source IN ('portal', 'whatsapp', 'manual')),
  created_by uuid,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.release_instructions ENABLE ROW LEVEL SECURITY;

-- Portal users can view their own releases
CREATE POLICY "Portal users can view own releases"
  ON public.release_instructions FOR SELECT
  TO authenticated
  USING (customer_id = get_portal_customer_id(auth.uid()));

-- Portal users can insert their own releases
CREATE POLICY "Portal users can insert own releases"
  ON public.release_instructions FOR INSERT
  TO authenticated
  WITH CHECK (customer_id = get_portal_customer_id(auth.uid()));

-- Staff can view all releases
CREATE POLICY "Staff can view all releases"
  ON public.release_instructions FOR SELECT
  TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'yard_operator'::app_role) OR has_role(auth.uid(), 'gate_clerk'::app_role));

-- Staff can insert releases
CREATE POLICY "Staff can insert releases"
  ON public.release_instructions FOR INSERT
  TO authenticated
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'yard_operator'::app_role) OR has_role(auth.uid(), 'gate_clerk'::app_role));

-- Staff can update releases
CREATE POLICY "Staff can update releases"
  ON public.release_instructions FOR UPDATE
  TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'yard_operator'::app_role) OR has_role(auth.uid(), 'gate_clerk'::app_role));

-- Trigger for updated_at
CREATE TRIGGER update_release_instructions_updated_at
  BEFORE UPDATE ON public.release_instructions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 5. Create whatsapp_messages table
CREATE TABLE public.whatsapp_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid REFERENCES public.customers(id),
  phone_number text NOT NULL,
  direction text NOT NULL DEFAULT 'inbound' CHECK (direction IN ('inbound', 'outbound')),
  message_body text,
  message_type text NOT NULL DEFAULT 'text' CHECK (message_type IN ('text', 'image', 'document')),
  parsed_intent text CHECK (parsed_intent IN ('release', 'appointment', 'query', 'unknown')),
  linked_instruction_id uuid REFERENCES public.release_instructions(id),
  processed boolean NOT NULL DEFAULT false,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.whatsapp_messages ENABLE ROW LEVEL SECURITY;

-- Staff can view all whatsapp messages
CREATE POLICY "Staff can view whatsapp messages"
  ON public.whatsapp_messages FOR SELECT
  TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'yard_operator'::app_role) OR has_role(auth.uid(), 'gate_clerk'::app_role));

-- Portal users can view their own whatsapp messages
CREATE POLICY "Portal users can view own whatsapp messages"
  ON public.whatsapp_messages FOR SELECT
  TO authenticated
  USING (customer_id = get_portal_customer_id(auth.uid()));

-- Service role inserts (edge functions) - staff can also insert
CREATE POLICY "Staff can insert whatsapp messages"
  ON public.whatsapp_messages FOR INSERT
  TO authenticated
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'yard_operator'::app_role));

-- 6. Add portal-specific SELECT policies to existing tables for portal users

-- Containers: portal users can see containers where owner or shipping_line matches their customer company_name
CREATE POLICY "Portal users can view own containers"
  ON public.containers FOR SELECT
  TO authenticated
  USING (
    owner = (SELECT company_name FROM public.customers WHERE id = get_portal_customer_id(auth.uid()))
    OR shipping_line = (SELECT company_name FROM public.customers WHERE id = get_portal_customer_id(auth.uid()))
  );

-- Container movements: portal users can view movements for their containers
CREATE POLICY "Portal users can view own movements"
  ON public.container_movements FOR SELECT
  TO authenticated
  USING (
    container_id IN (
      SELECT id FROM public.containers
      WHERE owner = (SELECT company_name FROM public.customers WHERE id = get_portal_customer_id(auth.uid()))
      OR shipping_line = (SELECT company_name FROM public.customers WHERE id = get_portal_customer_id(auth.uid()))
    )
  );

-- Gate appointments: portal users can view and create appointments
CREATE POLICY "Portal users can view own appointments"
  ON public.gate_appointments FOR SELECT
  TO authenticated
  USING (created_by = auth.uid() OR shipping_line = (SELECT company_name FROM public.customers WHERE id = get_portal_customer_id(auth.uid())));

CREATE POLICY "Portal users can create appointments"
  ON public.gate_appointments FOR INSERT
  TO authenticated
  WITH CHECK (get_portal_customer_id(auth.uid()) IS NOT NULL);

-- Invoices: portal users can view invoices addressed to their company
CREATE POLICY "Portal users can view own invoices"
  ON public.invoices FOR SELECT
  TO authenticated
  USING (customer_name = (SELECT company_name FROM public.customers WHERE id = get_portal_customer_id(auth.uid())));

-- Payments: portal users can view payments for their invoices
CREATE POLICY "Portal users can view own payments"
  ON public.payments FOR SELECT
  TO authenticated
  USING (
    invoice_id IN (
      SELECT id FROM public.invoices
      WHERE customer_name = (SELECT company_name FROM public.customers WHERE id = get_portal_customer_id(auth.uid()))
    )
  );

-- Notifications: portal users already have user_id-based RLS, no change needed

-- 7. Enable realtime on release_instructions
ALTER PUBLICATION supabase_realtime ADD TABLE public.release_instructions;

-- 8. Add customer role to new portal users automatically via trigger
CREATE OR REPLACE FUNCTION public.handle_portal_user_role()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.user_id, 'customer')
  ON CONFLICT (user_id, role) DO NOTHING;
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_portal_user_created
  AFTER INSERT ON public.customer_portal_users
  FOR EACH ROW EXECUTE FUNCTION public.handle_portal_user_role();
