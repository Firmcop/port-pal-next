# Weekly wage reconciliation, ledger posting and tests

## What already exists (verified)

- `approve_attendance_week` already posts the week: COGS debit per project (`project_labour` / `direct_labour`), allowances to expense, statutory deductions to `payroll_*_payable`, and net to `wages_payable`. It also derives the project from the job and mirrors each job-assigned line into `conversion_labour` as a locked payroll row.
- `correct_attendance_line` already writes a full reversal line plus the replacement, mirrors both onto the job (negative + new `conversion_labour` rows and `cost_entries`), posts a delta journal pair, and records an `attendance_audit` entry.

So items 2 and 3 of the request are in place at the posting level. What is missing is proof: nothing shows the week's rows side by side with the postings, nothing checks the week actually balances, and there are no tests.

## What will be built

### 1. Wage Reconciliation screen (`/hrm/wage-reconciliation`)

Pick a week; the page shows three linked sections:

- **Summary** — gross, overtime, allowances, deductions, net, and a balance check: total debits vs total credits for that week's journal, with a clear "Balanced" / "Out by X" indicator.
- **By job and project** — one row per conversion job and per project: payroll labour amount from `conversion_labour`, the matching `cost_entries` total, and the COGS journal amount for that project. Any mismatch between the three is flagged in red with the difference.
- **Attendance lines and postings** — expandable per employee: each line (including reversals and corrections, shown as negative rows with their reason) and the journal entries it rolls into, with links to the job, the project and the unified ledger.

Corrections are visible as pairs (original reversed, replacement) so the net figure is always traceable.

### 2. Ledger hardening

- A `reconcile_attendance_week(_week_id)` function returning the per-job / per-project / per-account breakdown plus the debit-credit balance, used by the screen.
- Approval and correction gain a post-write balance assertion: if the journal for the week does not balance, the transaction is rejected rather than leaving a skewed ledger.
- Journal rows for deductions and net wages are tagged so the clearing side is queryable by week (they currently carry `reference_type='attendance_week'`; corrections use `attendance_correction` and will also carry the week id so the screen can group them).

### 3. Tests

- Unit tests for the reconciliation math helper (job vs project vs ledger comparison, correction netting).
- An end-to-end test that: creates a week, adds lines on a job that belongs to a project, approves it, then asserts job labour total, project COGS total and ledger debits/credits all agree; then corrects a line and re-asserts that all three move by exactly the delta and still balance.

## Technical notes

- Migration: `reconcile_attendance_week(uuid)` returning a JSON breakdown (job rows, project rows, account rows, totals, balance delta); add `week_id` to correction journal rows via a new column-free approach (store week id in `reference_id` of a companion row is avoided — instead the function joins corrections through `attendance_lines.week_id`). Add the balance assertion inside `approve_attendance_week` and `correct_attendance_line`.
- Frontend: new `src/pages/hrm/WageReconciliation.tsx`, route in `src/App.tsx` under the `hrm` module guard, sidebar entry next to Attendance in `AppSidebar.tsx`, CSV export via `exportCSV`.
- Money formatting through `src/lib/money.ts` with the week currency — no hardcoded currency.
- Tests: `src/lib/wage-reconciliation.test.ts` for the math, `e2e/payroll-week-costing.spec.ts` for the end-to-end run against a seeded draft week.
