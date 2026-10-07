# Correct Sharon’s Weekly Attendance access on the live portal

## Confirmed cause

- `portal.firmcop.com` is serving an older application bundle that does not contain the new `hrm_attendance` permission scope or the “Weekly Attendance only” control.
- Sharon’s current backend permissions are already correct: `hrm_attendance` view/create/edit are granted, while her existing sales, production, and procurement roles explicitly deny broad HR access.
- HRM is enabled for Sharon’s organization.
- The current source has the attendance route guard and restricted attendance form, but the sidebar item metadata still labels Attendance as `hrm`; this should be corrected so the item’s declared permission and its filter cannot diverge later.

## Implementation

1. **Harden the sidebar permission mapping**
   - Declare Weekly Attendance directly as `hrm_attendance:view`.
   - Filter every HR child by its own module/action pair, while full HR managers and administrators retain all HR items.
   - Keep the HR parent group visible when either full HR or attendance-only access exists.

2. **Keep strict route isolation**
   - Retain `/hrm/attendance` behind `hrm_attendance:view`.
   - Retain Employees behind `hrm:view` and payroll/payslip/reconciliation pages behind `hrm:approve`.
   - Ensure a direct bookmarked URL cannot render unauthorized HR content before redirecting.

3. **Keep Sharon’s clerk screen restricted**
   - Show only employee, day/hour, and job/project entry fields.
   - Keep overtime, allowances, rates, monetary totals, audit history, approval, payment, correction, and deletion unavailable.
   - Save through the attendance-specific backend authorization already in place.

4. **Add regression coverage**
   - Add an attendance-only sidebar scenario that expects only Weekly Attendance under HR.
   - Verify a full HR manager still sees all HR items.
   - Verify restricted and unrestricted route decisions independently.

5. **Publish and verify the custom domain**
   - Publish the corrected bundle so `portal.firmcop.com` receives the attendance-specific code.
   - Confirm the live JavaScript bundle contains the new permission scope.
   - Verify Sharon’s live navigation shows exactly **HR → Weekly Attendance** and that the entry form saves.
   - Verify direct access to every other `/hrm/*` page redirects without exposing content.

## Technical notes

- Frontend files: `src/components/AppSidebar.tsx`, sidebar/route permission tests, and only minimal guard/form changes if tests expose a gap.
- Backend schema changes are not expected; Sharon’s rows and the relevant permission functions are already present.
- Publishing is essential: changing preview/source alone will not update `portal.firmcop.com`.
