DROP FUNCTION IF EXISTS public.issue_material_to_job(uuid, uuid, numeric, boolean);
DROP FUNCTION IF EXISTS public.return_material_from_job(uuid, uuid, numeric);

REVOKE ALL ON FUNCTION public.issue_material_to_job(uuid,uuid,numeric,boolean,text,text) FROM public, anon;
REVOKE ALL ON FUNCTION public.return_material_from_job(uuid,uuid,numeric,text,text) FROM public, anon;
REVOKE ALL ON FUNCTION public.raise_material_requisition(uuid,uuid,text,numeric,date,text,text) FROM public, anon;
REVOKE ALL ON FUNCTION public.decide_material_requisition(uuid,boolean,text) FROM public, anon;
REVOKE ALL ON FUNCTION public.convert_requisition_to_po(uuid,uuid,numeric) FROM public, anon;

GRANT EXECUTE ON FUNCTION public.issue_material_to_job(uuid,uuid,numeric,boolean,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.return_material_from_job(uuid,uuid,numeric,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.raise_material_requisition(uuid,uuid,text,numeric,date,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.decide_material_requisition(uuid,boolean,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.convert_requisition_to_po(uuid,uuid,numeric) TO authenticated;