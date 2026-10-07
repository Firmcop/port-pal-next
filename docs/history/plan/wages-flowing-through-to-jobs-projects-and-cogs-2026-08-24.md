# Wages flowing through to jobs, projects and COGS

## What I found

The paid week (17–23 Aug, KES 68,035.20) did post to the ledger: 63,035.20 to cost of goods (37,901.60 unassigned + 25,133.60 on projects), 5,000 allowances to expense, and the net cleared from wages payable when paid. So the general ledger and the project P&L are already receiving wages.

What is missing is the job side:

- Wage lines are written to `cost_entries` (48 lines, 66,835.20 against conversion jobs), but nothing in the app reads `cost_entries`. The conversion job cost card, the Conversions list totals and the `project_job_costs` view all read `conversion_labour` only — so a job's labour still shows only manually keyed labour entries.
- 30 of the wage lines carry a job but no project, even though the job itself belongs to a project. Those amounts land in the ledger as generic direct labour instead of on the project, so the project P&L understates cost.

## What will change

### 1. Wages become job labour
Approving a week writes a labour row on each assigned conversion job (worker name, hours, rate, amount), tagged as payroll-sourced and linked back to the attendance line. Job cost cards, the Conversions list and project job costs then include wages automatically. Payroll-sourced rows are read-only in the Labour tab (marked "From payroll — week of …") so nobody can edit or delete them out of sync; corrections go through the attendance correction flow, which posts a reversal plus the replacement on the job.

### 2. Project attribution derived from the job
When an attendance line has a job but no project, the project is taken from the job. That applies on save, on approval postings, and to the existing week — so wages on a job that belongs to a project hit that project's COGS instead of the generic bucket.

### 3. Backfill the week already paid
The approved/paid week is restated in place: job labour rows created for its 48 job-assigned lines, and the project-labour vs direct-labour split in the ledger corrected for the 30 derivable lines. Amounts, gross, deductions and net stay exactly as paid — only the attribution changes, and the restatement is recorded in the attendance audit trail.

### 4. Visibility
- Conversion job cost breakdown separates "Labour (payroll)" from "Labour (manual)".
- Project detail shows wages as part of job labour.
- Each payroll labour row links back to its attendance week.

## Technical notes

- Migration: add `source text default 'manual'`, `attendance_line_id uuid`, and a unique index on `attendance_line_id` to `conversion_labour`; block update/delete of `source='payroll'` rows via trigger.
- `approve_attendance_week`: after recomputing components, insert/upsert `conversion_labour` rows from lines with `conversion_id`; derive `project_id` from `container_conversions` when null before the grouped COGS journal.
- `correct_attendance_line`: mirror the reversal and replacement into `conversion_labour` (negative row for the reversal, new row for the replacement).
- `upsert_attendance_line`: default `project_id` from the chosen job when not supplied.
- One-off backfill in the same migration for week `2026-08-17`, plus reclassifying journal rows (reverse-and-repost the `WGE-DR-*` group so the ledger stays balanced and auditable).
- Frontend: `src/pages/ConversionDetail.tsx` (payroll rows read-only, split labour figure), `src/pages/Conversions.tsx` (no change needed once rows exist), `src/pages/finance/ProjectDetail.tsx` (label breakdown). No change to `project_job_costs` or `project_pnl` views — both pick the data up once the rows and tags exist.
