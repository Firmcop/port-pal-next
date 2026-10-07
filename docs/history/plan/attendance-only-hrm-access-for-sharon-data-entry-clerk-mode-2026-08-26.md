# Attendance-only HRM access for Sharon (data-entry clerk mode)

Sharon (`user_id e3b7c483…`) currently has `sales_manager`, `production_manager`, and `procurement_officer` — none include HRM. Permissions today are purely role-based (`role_permission_defaults` + per-role `role_permission_overrides`), so the only existing way to give her attendance would be the full `hr_manager` role, which also unlocks payslips, payroll runs, approvals and pay actions. This plan adds **per-user permission overrides** so she gets exactly: weekly attendance entry with employee, days/hours, and job/project — nothing else.

## 1. Per-user permission overrides (database)

- New table `user_permission_overrides` (`organization_id`, `user_id`, `module`, `action`, `allowed`, `updated_by`, `updated_at`), with GRANTs, RLS (admins/org owners manage; everyone can read own rows), and a unique key on (org, user, module, action).
- Update `has_permission(_user_id, _module, _action)`: a matching user override row wins; otherwise fall back to the existing role-based logic. Admins/org owners/platform admins still pass.
- Update `get_user_view_modules(_user_id)` to union in modules where the user has a `view` override — this is what makes "HRM" appear in Sharon's sidebar.
- Seed Sharon's row: `hrm` → `view`, `create`, `edit` = true (edit is needed because the existing `upsert_attendance_line` RPC validates the caller; approval/pay actions stay denied).
- Verify the `upsert_attendance_line`, `approve_attendance_week`, and pay RPCs: approve/pay must require `hrm` `approve`/`post` (not just edit) so Sharon cannot approve or pay a week. Adjust checks only if they are currently weaker.

## 2. Sidebar: granular HRM items

- Add a per-item required action to `hrmItems` in `AppSidebar.tsx`:
  - Employees → `view`, **Attendance → `view`**, Payslips → `approve`, Payroll Runs → `approve`, Payroll/Wage Reconciliation → `export`, Payslip Template → `approve`.
- New hook `useModulePermissions(module)` that batch-resolves `has_permission` for the actions above (admins/owners short-circuit true). HRM group renders per item instead of "all or nothing".
- Result for Sharon: sidebar shows only **HRM → Weekly Attendance**. Her other modules (CRM, manufacturing, procurement) stay exactly as they are.

## 3. Route guards

- Add a `RequirePermission` wrapper (module + action) around the payroll/payslip/reconciliation HRM routes in `App.tsx` so a bookmarked URL can't open pages Sharon shouldn't see. `/hrm/attendance` stays under `RequireModule("hrm")`.

## 4. Simplified "clerk" timesheet form

In `src/pages/hrm/Attendance.tsx`:

- Detect clerk mode: has `hrm` `create` but **not** `hrm` `approve`.
- In clerk mode:
  - The Weekly Timesheet dialog shows only: **employee picker, Mon–Sun days/hours grid, job/project picker per row** (+ "apply to all days" and quick-fill, which are just convenience for the same fields). Overtime, allowance, and any rate/amount display are hidden.
  - Page hides: Pay week button, Approve button, corrections, delete-line, amounts/totals columns (she sees days/hours and job only, not money).
- Full users (admins, hr_manager) see the existing page unchanged.

## 5. Admin UI to manage this

- Extend the Users page (or Settings → Permissions) with a per-user override editor: pick a user, then toggle module/action grants stored in `user_permission_overrides`. Sharon's HRM grant is seeded by migration, but future clerks can be set up from the UI.

## Technical notes

- Files: new migration; `supabase` functions `has_permission`, `get_user_view_modules`; `src/hooks/use-permissions.ts` (new `useModulePermissions`); new `src/components/RequirePermission.tsx`; `src/components/AppSidebar.tsx`; `src/App.tsx`; `src/pages/hrm/Attendance.tsx`; `src/pages/Users.tsx` (override editor).
- No changes to `attendance_lines` schema — the simplified form saves through the existing `upsert_attendance_line` RPC.
- Sharon keeps her existing three roles; nothing is removed.
- Verify with a quick e2e/manual pass signed in as Sharon: sidebar shows only Weekly Attendance under HRM; timesheet saves; payslip/payroll URLs redirect with a toast.
