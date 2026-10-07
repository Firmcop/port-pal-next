# Expenses visible on conversion jobs, by category

## What you get

1. **A cost grid on each conversion job page**, grouped by expense category (fuel, materials, transport, labour...), showing approved and posted expenses per category with totals, so the real cost of the job is clear at a glance.
2. **Your untagged expenses tagged to their jobs.** Right now every expense line in the system has no job link; several carry only a project. Examples found: EXP-2026-0020, EXP-2026-0021 and EXP-2026-0022 have lines pointing at the projects for CNV-EMMANUEL-0001, CNV-KIMANI-0001, CNV-DAVID-0001 and CNV-MR-0001.
3. **A review screen for older untagged postings**, listing every expense line with no job (and no project), so you can assign them in bulk or confirm they are general overheads.

## How the tagging works

- Where an expense line already names a project and that project has exactly one conversion job, the line is linked to that job automatically (a one-off backfill), and the link is recorded as an assignment, not a new ledger entry — amounts and accounts are untouched.
- Where a project has several jobs, or a line has no project at all, it stays in the review list for you to assign.
- Lines still in draft stay visible but are shown as "not yet approved" and are excluded from the job's actual cost until approved and posted.

## The category grid

On the job page (Budget area), a table with one row per expense category:

```text
Category            Charged to job   Via project   Pending approval   Total
Materials              16,172           3,053            22,408      41,633
Transport                 763               0                 0         763
...
Total                  ...
```

Each row expands to the individual expense lines with number, date, supplier/description, status and amount. A CSV export mirrors the grid.

## Technical notes

- New read RPC `conversion_expense_categories(conversion_id)` (SECURITY DEFINER, `SET search_path TO 'public'`, authenticated grant) returning category, source (job / project), approval-posting state and totals; built on the existing `conversion_project_expenses` and `conversion_pending_expenses` logic so no double counting.
- New component `ConversionExpenseGrid.tsx` rendered inside `BudgetTab.tsx`; `DirectExpensesCard.tsx` keeps the line-level list and the existing "Attach to this job" action.
- Backfill migration sets `operating_expense_lines.conversion_id` for project-tagged lines whose project has exactly one non-cancelled conversion job, writing an audit row per change; no ledger, journal or amount is modified.
- Review screen added as a filter ("Untagged") plus the existing bulk "Assign to job" action on the Operating Expenses list.
- Verification: after the backfill, check CNV-EMMANUEL-0001 shows its lines in Direct expenses and the Budget variance moves by the same amount; typecheck with `npx tsgo --noEmit -p tsconfig.app.json`.
