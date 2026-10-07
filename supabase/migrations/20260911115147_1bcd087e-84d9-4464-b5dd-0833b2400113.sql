DROP FUNCTION IF EXISTS public.post_operating_expense(date,text,jsonb,uuid,text,uuid,date,text,numeric,uuid,uuid,text,text,text,boolean);

REVOKE ALL ON FUNCTION public.post_operating_expense(date,jsonb,text,uuid,text,uuid,date,text,numeric,uuid,uuid,text,text,text,boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.post_operating_expense(date,jsonb,text,uuid,text,uuid,date,text,numeric,uuid,uuid,text,text,text,boolean) TO authenticated;