CREATE UNIQUE INDEX IF NOT EXISTS customers_org_company_uniq ON public.customers (organization_id, company_name);
CREATE UNIQUE INDEX IF NOT EXISTS suppliers_org_name_uniq ON public.suppliers (organization_id, name);
CREATE UNIQUE INDEX IF NOT EXISTS materials_org_name_uniq ON public.materials (organization_id, name);
CREATE UNIQUE INDEX IF NOT EXISTS trucks_drivers_org_plate_uniq ON public.trucks_drivers (organization_id, truck_plate);