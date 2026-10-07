# Sharon: Weekly Attendance only

## Goal
Sharon will see exactly one item under HR: **Weekly Attendance**. She will not see Employees, Payslips, Payroll Runs, reconciliations, payslip settings, pay amounts, approval, or payment actions.

## Confirmed issue
Sharon already has `hrm` view/create/edit grants and HRM is enabled for her organization. However, the sidebar currently assigns the same `hrm:view` permission to both **Employees** and **Weekly Attendance**, so the permission model cannot distinguish the requested submodule access.

## Changes
1. Add an attendance-specific permission scope (`hrm_attendance`) for view/create/edit and seed it for Sharon.
2. Remove Sharon’s broad `hrm` view/create/edit overrides so they cannot expose other HR pages.
3. Make the parent HR group appear when the user has attendance access, but render only **Weekly Attendance** for attendance-only users.
4. Guard `/hrm/attendance` with the attendance-specific permission and guard every other HR route independently so bookmarked URLs cannot bypass the sidebar.
5. Update attendance-entry authorization to accept the attendance-specific create/edit grants while leaving approve/pay/post permissions denied.
6. Keep Sharon’s attendance screen in clerk mode with only employee, days, hours, and job/project fields; remove overtime, allowance, rates, monetary totals, history, approval, payment, correction, and deletion controls from that mode.
7. Invalidate permission caches immediately after admin permission changes so users do not need to wait for stale access data.

## Verification
- Validate the permission functions and Sharon’s final rows in the database.
- Verify as an attendance-only user that HR contains only **Weekly Attendance** and that the form saves.
- Verify direct navigation to every other `/hrm/*` route redirects with no sensitive page content rendered.
- Verify an HR manager/admin retains the complete HR module unchanged.
