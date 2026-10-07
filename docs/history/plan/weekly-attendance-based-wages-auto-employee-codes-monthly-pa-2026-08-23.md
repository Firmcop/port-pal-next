# Weekly attendance-based wages, auto employee codes, monthly payslip summaries

## Current state

- `employees` has `code` (free text, typed by hand in the employee dialog), `daily_rate`, `division`, `status` — no pay frequency, no hourly rate, no monthly salary.
- There is no attendance or timesheet table anywhere in the database.
- Payslips post to the ledger via `post_payslip_to_ledger`: wages expense, deductions liability, and cash or net-pay-payable. Nothing links payroll to a project or to COGS.
- Project/job costs are captured in `cost_entries` (cost_type, amount, reference) and `conversion_labour` (free-text worker name).

## What to build

### 1. Automatic employee codes
Codes generate on creation using the employee's division as prefix (e.g. `PRD-0001`, `FIN-0001`), from a per-organization, per-prefix counter. Employees with no division fall back to `EMP-nnnn`. The code field in the employee form becomes read-only and shows "auto-generated" for new records; existing codes stay untouched.

### 2. Pay setup per employee
Each employee gets:
- Pay frequency: weekly (wage) or monthly (salary).
- Pay basis: daily rate x days, or hourly rate x hours (hourly rate defaults to daily rate / 8), with an overtime multiplier for hours beyond normal.
- Monthly salary amount for monthly-paid staff.

Only weekly staff appear in attendance. Monthly staff keep the existing fixed-salary payslip flow.

### 3. Weekly attendance sheet
New page: HR > Attendance (`/hrm/attendance`).
- Pick a week (Mon-Sun). The sheet lists every active weekly employee.
- Per employee, one or more lines: days or hours worked (per pay basis), overtime, optional project or conversion job assignment, optional notes. Multiple lines let one person's week be split across projects.
- Amount per line computes automatically from the employee's rate; the sheet shows week totals per employee and overall.
- States: draft -> approved -> paid. Only one sheet can exist per organization per week.

### 4. Approving and paying a week
- Approve locks the sheet and posts the wage cost: lines with a project/job assignment post to that job's cost entries as labour; unassigned lines post to COGS - direct labour. The credit side is a wages-payable liability.
- Pay records the disbursement from a chosen bank/cash account, clears wages payable, and stamps each line as paid.
- Everything is idempotent — re-approving or re-paying a week does not duplicate ledger entries.

### 5. Month-end payslip summary
- A "Generate monthly payslips" action for a chosen month creates one payslip per weekly employee, with a line for each week in the month (week dates, days/hours, amount) plus any deductions.
- Because the weeks were already expensed and paid, the summary payslip does not re-post wages to the ledger — it links to the source weeks and is marked as a summary. The existing PDF, approval and email flows work unchanged.
- Monthly-salary staff continue to be handled by the existing payroll run, so the month's payroll covers both groups.

## Technical notes

- Migration adds to `employees`: `pay_frequency` ('weekly'|'monthly', default 'monthly'), `pay_basis` ('daily'|'hourly'), `hourly_rate numeric`, `monthly_salary numeric`, `overtime_multiplier numeric default 1.5`. Plus `hrm_employee_code_seq(organization_id, prefix, next_number)` with a BEFORE INSERT trigger `set_employee_code()`; grants and org-scoped RLS as per existing tables.
- New tables (org-scoped RLS + GRANTs, `set_currency_from_org` trigger on the money-bearing one):
  - `attendance_weeks(id, organization_id, week_start, week_end, status, approved_by/at, paid_by/at, paid_from_account_id, total_amount, currency, notes)` with a unique index on (organization_id, week_start).
  - `attendance_lines(id, week_id, employee_id, project_id, conversion_id, days, hours, overtime_hours, rate, basis, amount, notes)`.
- RPCs (security definer, admin/hr_manager gated via `has_permission`):
  - `upsert_attendance_line`, `delete_attendance_line` — blocked once the week is approved.
  - `approve_attendance_week(_id)` — recomputes amounts server-side from employee rates, inserts `cost_entries` rows (cost_type `labour`) for assigned lines, inserts `accounting_transactions`: DR expense/`cogs_direct_labour` or project labour, CR liability `wages_payable`, guarded by `reference_type='attendance_week'`.
  - `pay_attendance_week(_id, _from_account_id)` — DR `wages_payable`, CR cash on the chosen `financial_accounts` row.
  - `generate_monthly_wage_payslips(_month_start)` — one payslip per weekly employee, `payslip_lines` per week, sets a new `payslips.posting_mode = 'summary'` flag so `post_payslip_to_ledger` returns early instead of double-posting; `attendance_weeks`/lines record the payslip id.
- Frontend: new `src/pages/hrm/Attendance.tsx` (week picker, editable grid, approve/pay actions) routed under `RequireModule code="hrm"`, sidebar entry next to Payslips; `EmployeeDialog.tsx` gains the pay-setup fields and a read-only auto code; `Payslips.tsx` gains the month-end generate action.
