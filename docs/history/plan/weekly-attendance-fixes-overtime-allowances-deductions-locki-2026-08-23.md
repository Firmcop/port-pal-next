# Weekly attendance fixes + overtime, allowances, deductions, locking and payslip PDFs

## Confirmed cause of the blank attendance sheet

The attendance page asks for a column that does not exist. `container_conversions` has `conversion_number`, not `job_number`. Two queries reference `job_number`:

- the conversion-job dropdown (`select id, job_number`) — errors, so the job list is always empty;
- the attendance lines query, which embeds `conversion:conversion_id(job_number)` — this error kills the whole lines query, so saved entries never appear.

Data is not the problem: there are 8 active weekly employees, 29 open conversion jobs, 32 active projects and 1 attendance week already in the database.

## What will change

### 1. Fix the sheet
Use `conversion_number` everywhere, so jobs load in the picker and saved entries render again. The lines list will also show the job/project it was booked to.

### 2. Overtime and allowances
Each attendance line gets explicit inputs for overtime hours and an allowance amount (with a short allowance label, e.g. site allowance, transport). The line total becomes base pay + overtime (rate x multiplier) + allowance, recomputed server-side on save so the displayed figure always matches what gets posted.

On approval, base and overtime post as direct labour to the assigned project/job or to COGS - direct labour when unassigned; allowances post to a separate wages/allowances expense account rather than being folded into labour cost.

### 3. Statutory and custom deductions
Employee pay setup gains a deductions list: each entry has a name, a type (statutory tax, pension, benefit, other), a calculation (percent of gross or fixed amount), and whether it applies weekly, monthly or both. Common Kenyan defaults (PAYE, NSSF, SHIF, housing levy) can be added with one click and then edited.

- Weekly approval computes deductions per employee for the week, posting gross to expense, deductions to their liability accounts and the net to wages payable.
- Paying the week pays only the net amount.
- Month-end summary payslips show each week's earnings plus the month's deductions, with the same gross/deduction/net figures already posted — no double posting.

### 4. Approval lock with reversal corrections
Once a week is approved, entries and project assignments are read-only. Corrections use a new "Correct entry" action which:
- writes a reversing line for the original amount and posting,
- writes the corrected line,
- records who, when and why in an attendance audit trail shown under the week.

Paid weeks allow the same correction path; the difference lands in the next unpaid week's payable rather than editing history.

### 5. Payslip PDFs and bulk month-end export
- Every payslip row and the payslip detail page get a Download PDF action using the existing payslip PDF generator, extended to show weekly earning lines, allowances and each deduction.
- Payslips gains "Export month" which generates all payslips for the selected month and downloads them as a single combined multi-page PDF, plus a CSV summary (employee, gross, deductions, net) for the payroll register.

## Technical notes

- Frontend: `src/pages/hrm/Attendance.tsx` (column fix, overtime/allowance inputs, lock + correction UI, audit panel), `src/components/hrm/EmployeeDialog.tsx` (deductions editor), `src/pages/hrm/Payslips.tsx` and `PayslipDetail` (per-row PDF, month export), `src/lib/payslip-pdf.ts` (deduction/allowance sections, multi-payslip document).
- Migration: add `allowance numeric default 0`, `allowance_label text`, `overtime_amount numeric`, `reverses_line_id uuid`, `correction_reason text` to `attendance_lines`; add `deductions jsonb default '[]'` to `employees`; add `gross_amount`/`deduction_amount`/`net_amount` to `attendance_weeks`; new `attendance_audit(id, organization_id, week_id, line_id, action, before, after, reason, actor, created_at)` with org-scoped RLS and GRANTs.
- RPCs: extend `upsert_attendance_line` with allowance/overtime args and hard-block on non-draft weeks; new `correct_attendance_line` (reversal + replacement + audit); extend `approve_attendance_week` to split labour/allowance/deduction postings; `pay_attendance_week` pays net; extend `generate_monthly_wage_payslips` to emit allowance and deduction payslip lines.
- All new money columns get the existing `set_currency_from_org` behaviour via the week's currency.
