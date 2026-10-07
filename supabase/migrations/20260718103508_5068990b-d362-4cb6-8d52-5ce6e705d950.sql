UPDATE public.organizations o
SET logo_url = d.logo_url
FROM public.depots d
WHERE d.organization_id = o.id
  AND d.is_hq = true
  AND d.logo_url IS NOT NULL
  AND (o.logo_url IS NULL OR o.logo_url = '');