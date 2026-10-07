UPDATE public.organizations
SET status = 'active', trial_ends_at = now() + interval '5 years'
WHERE id = '6b29b65b-fa63-4dcf-9854-ede5c9a8320b';