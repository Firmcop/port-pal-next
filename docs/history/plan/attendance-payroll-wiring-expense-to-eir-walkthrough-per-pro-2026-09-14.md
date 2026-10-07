# Attendance → payroll wiring, expense-to-EIR walkthrough, per-project attendance view

## What I confirmed first

- Attendance entries have days, hours, overtime hours, allowance, job and project — but **no date column**. The day is currently written as a text prefix inside the notes field, so nothing can reliably total "Monday" or spot a holiday.
- Employees already carry a pay basis (daily/hourly), a daily rate, an hourly rate and an overtime multiplier.
- There is **no public holiday list** anywhere in the system.
- Monthly payslips are already built from the weekly attendance lines, so once the daily detail exists it flows through without a new payroll engine.

## 1. Hours per employee per day, with overtime and holidays

- Give each attendance entry a proper **work date** instead of a note prefix. Existing entries keep their day by reading the date already written in their notes; anything without one is dated to the week's Monday.
- The single-entry dialog, the weekly timesheet grid and the bulk-entry dialog all save the real day, so an employee can have one row per day per job.
- New **Public holidays** list (date + name, per organisation), maintained under HR settings. Days can be added one at a time or pasted for the year.
- Pay calculation per entry becomes: normal time at the person's rate, overtime hours at their overtime multiplier, and any time worked on a holiday date at a holiday multiplier (default 2.0, set per organisation and overridable per employee).
- Week totals, the approval postings, the wage ledger entries and the monthly payslip all pick this up automatically — holiday premium is shown as its own line on the payslip so it is visible separately from basic and overtime.
- Approved weeks stay locked; corrections keep using the existing correction/reversal flow.

## 2. Expense → approval → finalised EIR walkthrough

This is a live test run, not new code:

1. Post a real operating expense as Dennis, tagged to a project and a conversion job, and submit it for approval.
2. Approve it through the approvals screen and confirm it posts to the ledger.
3. Open the job's Budget tab and confirm it appears under Direct expenses and moves the variance.
4. Take an equipment receipt (EIR) for a container on that job through owner sign-off to approved, and confirm the finalised receipt shows purchase price, standard rate and difference.
5. Re-check the container variance figures on the job and the project.

Anything that does not update is fixed in the same pass, and the test records created for the walkthrough are removed afterwards.

## 3. Per-project attendance view

A new **By project** tab on the Weekly Attendance page:

- One block per project (and an "Unassigned" block), listing each employee with days, hours, overtime and — for non-clerk users — cost, split by job within the project.
- Project and job filters, a week total per project, and CSV export.
- Clerk-restricted users (attendance-only access) see days/hours only, no money, exactly as elsewhere on the page.

## Technical notes

- Migration: `attendance_lines.work_date date`; backfill from the notes prefix, else week start. New `public_holidays` table (org-scoped, RLS + grants). `organizations`-level `holiday_multiplier` default 2.0, optional per-employee override.
- `upsert_attendance_line` gains `_work_date`; `attendance_line_components` gains holiday detection and a `holiday_amount` output; `recalc_attendance_week`, `approve_attendance_week` and `generate_monthly_wage_payslips` extended to carry the holiday component through to the ledger and payslip lines.
- Frontend: `src/pages/hrm/Attendance.tsx` (work date on all three dialogs, By-project tab, CSV), a small holidays editor under HR settings, `src/lib/payslip-pdf.ts` for the holiday line.
- No change to the existing job/project cost sync — it reads the same lines.
