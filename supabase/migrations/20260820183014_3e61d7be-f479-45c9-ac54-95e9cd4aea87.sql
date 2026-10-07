CREATE OR REPLACE VIEW public.project_job_costs AS
SELECT cc.project_id,
       cc.organization_id,
       COALESCE(sum(mat.total),0)   AS material_cost,
       COALESCE(sum(lab.total),0)   AS labour_cost,
       COALESCE(sum(svc.total),0)   AS service_cost,
       COALESCE(sum(cnt.total),0)   AS container_cost,
       COALESCE(sum(mat.total),0) + COALESCE(sum(lab.total),0)
         + COALESCE(sum(svc.total),0) + COALESCE(sum(cnt.total),0) AS job_cost_total
  FROM public.container_conversions cc
  LEFT JOIN LATERAL (SELECT sum(total_cost) total FROM public.conversion_materials x WHERE x.conversion_id = cc.id) mat ON true
  LEFT JOIN LATERAL (SELECT sum(total_cost) total FROM public.conversion_labour x WHERE x.conversion_id = cc.id) lab ON true
  LEFT JOIN LATERAL (SELECT sum(cost) total FROM public.conversion_services x WHERE x.conversion_id = cc.id) svc ON true
  LEFT JOIN LATERAL (SELECT sum(COALESCE(x.container_cost,0) + COALESCE(x.transport_offloading_cost,0)) total
                       FROM public.conversion_containers x WHERE x.conversion_id = cc.id) cnt ON true
 WHERE cc.project_id IS NOT NULL
 GROUP BY cc.project_id, cc.organization_id;

GRANT SELECT ON public.project_job_costs TO authenticated;
GRANT ALL ON public.project_job_costs TO service_role;
