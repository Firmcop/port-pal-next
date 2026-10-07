
-- Tighten role_permission_defaults so each functional role only sees modules
-- that match its actual responsibilities. Removes cross-module leakage that
-- was previously being masked by per-org overrides.

-- 1) VIEWER: pure read-only, dashboard + inventory read only (nothing else).
DELETE FROM public.role_permission_defaults WHERE role = 'viewer';
INSERT INTO public.role_permission_defaults (role, module, action, allowed) VALUES
  ('viewer','inventory','view',true),
  ('viewer','gate','view',true);

-- 2) YARD_OPERATOR: no accounting / billing.
DELETE FROM public.role_permission_defaults
 WHERE role = 'yard_operator' AND module IN ('accounting','billing');

-- 3) SALES_MANAGER: drop manufacturing.
DELETE FROM public.role_permission_defaults
 WHERE role = 'sales_manager' AND module = 'manufacturing';

-- 4) SUPPLY_CHAIN_MANAGER: drop accounting, billing, crm.
DELETE FROM public.role_permission_defaults
 WHERE role = 'supply_chain_manager' AND module IN ('accounting','billing','crm');

-- 5) PRODUCTION_MANAGER: drop gate, sale_automation.
DELETE FROM public.role_permission_defaults
 WHERE role = 'production_manager' AND module IN ('gate','sale_automation');

-- 6) PROCUREMENT_OFFICER: drop accounting.
DELETE FROM public.role_permission_defaults
 WHERE role = 'procurement_officer' AND module = 'accounting';

-- 7) MR_SUPERVISOR: drop billing.
DELETE FROM public.role_permission_defaults
 WHERE role = 'mr_supervisor' AND module = 'billing';

-- 8) ACCOUNTANT: drop cross-module reads that aren't finance-adjacent
--    (crm, inventory, leasing, logistics, manufacturing, procurement,
--    repatriation, sale_automation, sync_audit). Keep hrm view for payroll journals.
DELETE FROM public.role_permission_defaults
 WHERE role = 'accountant'
   AND module IN ('crm','inventory','leasing','logistics','manufacturing',
                  'procurement','repatriation','sale_automation','sync_audit');

-- 9) LEASING_MANAGER: drop accounting read.
DELETE FROM public.role_permission_defaults
 WHERE role = 'leasing_manager' AND module = 'accounting';

-- 10) HR_MANAGER: drop accounting/billing reads (they belong to accountant).
DELETE FROM public.role_permission_defaults
 WHERE role = 'hr_manager' AND module IN ('accounting','billing');
