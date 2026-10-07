
-- Phase 2: Security Hardening

-- 1. Replace broad SELECT on customers with staff-only + portal scoped
DROP POLICY IF EXISTS "Authenticated users can view customers" ON public.customers;
CREATE POLICY "Staff can view all customers" ON public.customers FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'yard_operator'::app_role) OR has_role(auth.uid(), 'gate_clerk'::app_role) OR has_role(auth.uid(), 'viewer'::app_role));
CREATE POLICY "Portal users can view own customer" ON public.customers FOR SELECT TO authenticated
  USING (id = get_portal_customer_id(auth.uid()));

-- 2. Replace broad SELECT on leads
DROP POLICY IF EXISTS "Authenticated users can view leads" ON public.leads;
CREATE POLICY "Staff can view leads" ON public.leads FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'yard_operator'::app_role) OR has_role(auth.uid(), 'viewer'::app_role));

-- 3. Replace broad SELECT on trucks_drivers
DROP POLICY IF EXISTS "Authenticated users can view trucks_drivers" ON public.trucks_drivers;
CREATE POLICY "Staff can view trucks_drivers" ON public.trucks_drivers FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'yard_operator'::app_role) OR has_role(auth.uid(), 'gate_clerk'::app_role) OR has_role(auth.uid(), 'viewer'::app_role));

-- 4. Replace broad SELECT on notification_log
DROP POLICY IF EXISTS "Authenticated users can view notification logs" ON public.notification_log;
CREATE POLICY "Staff can view notification logs" ON public.notification_log FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'yard_operator'::app_role) OR has_role(auth.uid(), 'gate_clerk'::app_role) OR has_role(auth.uid(), 'viewer'::app_role));

-- 5. Replace broad SELECT on suppliers
DROP POLICY IF EXISTS "Authenticated users can view suppliers" ON public.suppliers;
CREATE POLICY "Staff can view suppliers" ON public.suppliers FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'yard_operator'::app_role) OR has_role(auth.uid(), 'viewer'::app_role));

-- 6. Replace broad SELECT on accounting_transactions (admin only)
DROP POLICY IF EXISTS "Authenticated users can view transactions" ON public.accounting_transactions;
CREATE POLICY "Admins can view transactions" ON public.accounting_transactions FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));

-- 7. Replace broad SELECT on gate_appointments with staff check (portal policy already exists)
DROP POLICY IF EXISTS "Authenticated users can view appointments" ON public.gate_appointments;
CREATE POLICY "Staff can view all appointments" ON public.gate_appointments FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'yard_operator'::app_role) OR has_role(auth.uid(), 'gate_clerk'::app_role) OR has_role(auth.uid(), 'viewer'::app_role));

-- 8. Replace broad SELECT on invoices with staff check (portal policy already exists)
DROP POLICY IF EXISTS "Authenticated users can view invoices" ON public.invoices;
CREATE POLICY "Staff can view all invoices" ON public.invoices FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'yard_operator'::app_role) OR has_role(auth.uid(), 'gate_clerk'::app_role) OR has_role(auth.uid(), 'viewer'::app_role));

-- 9. Replace broad SELECT on payments with staff check (portal policy already exists)
DROP POLICY IF EXISTS "Authenticated users can view payments" ON public.payments;
CREATE POLICY "Staff can view all payments" ON public.payments FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'yard_operator'::app_role) OR has_role(auth.uid(), 'gate_clerk'::app_role) OR has_role(auth.uid(), 'viewer'::app_role));

-- 10. Add gate_clerk to containers INSERT and UPDATE policies
DROP POLICY IF EXISTS "Operators and admins can insert containers" ON public.containers;
CREATE POLICY "Staff can insert containers" ON public.containers FOR INSERT TO authenticated
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'yard_operator'::app_role) OR has_role(auth.uid(), 'gate_clerk'::app_role));

DROP POLICY IF EXISTS "Operators and admins can update containers" ON public.containers;
CREATE POLICY "Staff can update containers" ON public.containers FOR UPDATE TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'yard_operator'::app_role) OR has_role(auth.uid(), 'gate_clerk'::app_role));

-- 11. Add gate_clerk to container_movements INSERT policy
DROP POLICY IF EXISTS "Operators and admins can insert movements" ON public.container_movements;
CREATE POLICY "Staff can insert movements" ON public.container_movements FOR INSERT TO authenticated
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'yard_operator'::app_role) OR has_role(auth.uid(), 'gate_clerk'::app_role));

-- 12. Add staff role check to storage uploads for container-photos
DROP POLICY IF EXISTS "Authenticated users can upload container photos" ON storage.objects;
CREATE POLICY "Staff can upload container photos" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'container-photos' AND (
    has_role(auth.uid(), 'admin'::app_role) OR 
    has_role(auth.uid(), 'yard_operator'::app_role) OR 
    has_role(auth.uid(), 'gate_clerk'::app_role)
  ));
