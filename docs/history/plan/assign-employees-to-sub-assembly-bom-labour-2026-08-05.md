# Assign employees to sub-assembly BOM labour

## What's happening now

The BOM dialog's Labour section has no employee picker at all — it only has a free-text "Role" box (e.g. type "welder"), plus hours and rate. Nothing fetches the employee registry there, so there is no list to choose from.

## What to build

Let labour lines be tied to an actual employee from the HR registry, while still allowing a generic role line when no specific person is assigned.

1. Database: add an optional `employee_id` reference on the sub-assembly BOM labour table (linked to the employee registry, kept optional so existing role-only lines stay valid).
2. BOM dialog labour row: replace the plain text field with an employee dropdown (active employees, showing name plus job title) and keep a free-text fallback for a generic role.
3. Selecting an employee auto-fills the role from their job title and the hourly rate from their daily rate (daily rate / 8), still editable before saving.
4. Labour table shows the assigned employee name (falling back to the role text for older lines).

## Technical notes

- Migration: `ALTER TABLE public.sub_assembly_bom_labor ADD COLUMN employee_id uuid REFERENCES public.employees(id)`; no RLS change needed (existing org-scoped policies apply).
- `src/pages/SubAssemblyStock.tsx` `BomDialog`: add a query for `employees` (`status = 'active'`, ordered by name) and use it in the new Select; include `employee:employee_id(name, role)` in the labour select so rows can render the name.
- Rate defaulting uses `employees.daily_rate / 8`; if daily rate is 0 the field stays at 0 for manual entry.
