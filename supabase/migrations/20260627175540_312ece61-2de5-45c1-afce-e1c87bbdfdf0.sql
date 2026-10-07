
-- 1. container-photos storage: scope by org folder
DROP POLICY IF EXISTS "Staff can upload container photos" ON storage.objects;
DROP POLICY IF EXISTS "Auth users can list container photos" ON storage.objects;
DROP POLICY IF EXISTS "Staff can update container photos" ON storage.objects;
DROP POLICY IF EXISTS "Staff can delete container photos" ON storage.objects;

CREATE POLICY "Staff can upload container photos"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'container-photos'
  AND (storage.foldername(name))[1] = (current_org_id())::text
  AND (has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'yard_operator'::app_role) OR has_role(auth.uid(),'gate_clerk'::app_role))
);

CREATE POLICY "Auth users can list container photos"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'container-photos'
  AND (
    is_platform_admin()
    OR (
      (storage.foldername(name))[1] = (current_org_id())::text
      AND (has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'yard_operator'::app_role) OR has_role(auth.uid(),'gate_clerk'::app_role) OR has_role(auth.uid(),'viewer'::app_role))
    )
  )
);

CREATE POLICY "Staff can update container photos"
ON storage.objects FOR UPDATE TO authenticated
USING (
  bucket_id = 'container-photos'
  AND (storage.foldername(name))[1] = (current_org_id())::text
  AND (has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'yard_operator'::app_role) OR has_role(auth.uid(),'gate_clerk'::app_role))
)
WITH CHECK (
  bucket_id = 'container-photos'
  AND (storage.foldername(name))[1] = (current_org_id())::text
  AND (has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'yard_operator'::app_role) OR has_role(auth.uid(),'gate_clerk'::app_role))
);

CREATE POLICY "Staff can delete container photos"
ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'container-photos'
  AND (storage.foldername(name))[1] = (current_org_id())::text
  AND (has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'yard_operator'::app_role))
);

-- 2. edi_exports INSERT
CREATE POLICY "edi_exports_insert_org" ON public.edi_exports
FOR INSERT TO authenticated
WITH CHECK (
  organization_id = current_org_id()
  AND (has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'accountant'::app_role) OR has_role(auth.uid(),'gate_clerk'::app_role))
);

-- 3. edi_interchange_seq INSERT + UPDATE
CREATE POLICY "edi_seq_insert" ON public.edi_interchange_seq
FOR INSERT TO authenticated
WITH CHECK (
  organization_id = current_org_id()
  AND (has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'accountant'::app_role) OR has_role(auth.uid(),'gate_clerk'::app_role))
);
CREATE POLICY "edi_seq_update" ON public.edi_interchange_seq
FOR UPDATE TO authenticated
USING (
  organization_id = current_org_id()
  AND (has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'accountant'::app_role) OR has_role(auth.uid(),'gate_clerk'::app_role))
)
WITH CHECK (
  organization_id = current_org_id()
);

-- 4. recurring_invoice_runs INSERT
CREATE POLICY "rir_insert_org" ON public.recurring_invoice_runs
FOR INSERT TO authenticated
WITH CHECK (
  organization_id = current_org_id()
  AND (has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'accountant'::app_role) OR has_role(auth.uid(),'gate_clerk'::app_role))
);

-- 5. repatriation_release_audit INSERT
CREATE POLICY "rel_audit_insert" ON public.repatriation_release_audit
FOR INSERT TO authenticated
WITH CHECK (
  organization_id = current_org_id()
  AND (has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'gate_clerk'::app_role))
);

-- 6. repatriation_ro_mismatches INSERT
CREATE POLICY "ro_mismatches_insert" ON public.repatriation_ro_mismatches
FOR INSERT TO authenticated
WITH CHECK (
  organization_id = current_org_id()
  AND (has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'gate_clerk'::app_role))
);

-- 7. staff_invitations INSERT/UPDATE/DELETE
CREATE POLICY "staff_invitations_insert" ON public.staff_invitations
FOR INSERT TO authenticated
WITH CHECK (is_org_admin(organization_id) OR is_platform_admin());
CREATE POLICY "staff_invitations_update" ON public.staff_invitations
FOR UPDATE TO authenticated
USING (is_org_admin(organization_id) OR is_platform_admin())
WITH CHECK (is_org_admin(organization_id) OR is_platform_admin());
CREATE POLICY "staff_invitations_delete" ON public.staff_invitations
FOR DELETE TO authenticated
USING (is_org_admin(organization_id) OR is_platform_admin());
