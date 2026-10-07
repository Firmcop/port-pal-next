
-- Fix 1: Revoke EXECUTE on bill_gate_in from anon (SECURITY DEFINER must not be public)
REVOKE EXECUTE ON FUNCTION public.bill_gate_in(uuid, text, numeric, text, uuid, uuid, text) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.bill_gate_in(uuid, text, numeric, text, uuid, uuid, text) TO authenticated;

-- Fix 2: Add DELETE policy for container-photos so staff can remove photos
CREATE POLICY "Staff can delete container photos"
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'container-photos'
  AND (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'yard_operator'::app_role))
);
