
-- 1. Extend enum (must be committed before values are used in seed/inserts)
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'accountant';
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'hr_manager';
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'production_manager';
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'procurement_officer';
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'supply_chain_manager';
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'sales_manager';
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'leasing_manager';
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'mr_supervisor';

-- 2. Track invited role set (legacy `role` column kept for backwards compatibility)
ALTER TABLE public.staff_invitations
  ADD COLUMN IF NOT EXISTS roles public.app_role[];
