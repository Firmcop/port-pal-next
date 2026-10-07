# Count project-tagged expenses in the job's actual cost

## What the data shows

I checked before proposing anything:

- No operating expense is tagged to a conversion job — all 100 expense lines and every header have an empty job field.
- 31 expense lines are tagged to a **project** instead (this is the field being filled in on the expense form).
- Every project that has a job today has exactly **one** job, so a project's expenses belong unambiguously to that job.

Where does such an expense post today? Into the accounts by expense category (the ledger entry carries the project, never a job). The job page already lists project-tagged expenses in a "Charged to this job's project" section, but they are excluded from the job's cost figures — which is why the actual cost of the project does not look right.

## What I'll change

**1. Project expenses count toward the job's actual cost**

On the job's Budget tab, the "Direct expenses" figure becomes the sum of expenses charged to the job **plus** approved and posted expenses charged to the job's project (when the project has a single job). The variance figure and the CSV export use the same total, so budget vs actual finally reflects the real spend.

**2. Clear labelling, no double counting**

- The summary shows two lines: "Charged to this job" and "Via this job's project", plus a combined total.
- Each expense is counted once: an expense attached to the job stops being counted as a project expense.
- If a project ever has more than one job, its expenses are listed on each job but **not** added to any job's total, with a short note explaining they must be attached to the right job first — the existing "Attach to this job" button does that.
- Only approved and posted expenses count; pending and reversed ones stay visible with their status but out of the totals.

**3. Same picture elsewhere on the job**

The job's cost summary/profitability figures that today use direct expenses only will use the same combined total, so the Budget tab and the job header agree.

## Technical notes

- `conversion_project_expenses` gains a `project_job_count` output (jobs on that project) so the UI knows whether project costs can be safely attributed. No other signature change.
- `DirectExpensesCard` exports a `useConversionCombinedExpenseTotal(conversionId)` hook returning `{ jobTotal, projectTotal, countable, total }`; `BudgetTab` consumes it for the summary tiles, variance and CSV rows, replacing the current `useConversionDirectExpenses`-only sum.
- `conversion_posting_status` adds the project-sourced expense amount to the job cost total so the Finance posting panel matches. Expenses already reach the ledger through `post_operating_expense`; no new journals are created.
- All RPC changes keep SECURITY DEFINER, `SET search_path TO 'public'`, revoked from PUBLIC/anon, granted to authenticated.
- `npx tsgo --noEmit -p tsconfig.app.json` stays clean; verify on CNV-EMMANUEL-0001 (about KES 60,300 of project expenses should appear in the job total).
