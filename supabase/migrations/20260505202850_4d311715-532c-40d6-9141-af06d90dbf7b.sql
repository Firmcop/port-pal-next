
-- New signups: create profile but DO NOT auto-attach to default organization or grant viewer role.
-- They go through /onboarding to create their own organization.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  INSERT INTO public.profiles (user_id, display_name)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'display_name', NEW.email))
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END;
$function$;
