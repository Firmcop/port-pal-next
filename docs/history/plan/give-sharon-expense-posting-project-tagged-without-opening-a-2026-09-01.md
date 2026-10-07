# Give Sharon expense posting (project-tagged), without opening all of Finance

## Current state (verified)

- Sharon is an org `viewer` with only three grants: `hrm_attendance` view/create/edit. She sees HR → Weekly Attendance only.
- Expense recording is blocked for her twice over:
  - The `/finance/operating-expenses` route is gated on roles `org_owner | admin | viewer` **plus** the whole `accounting` module, and the sidebar shows Finance items via `canView("accounting")` — granting `accounting` would expose ~40 finance screens (ledger, P&L, loans, payroll-adjacent reports).
  - The posting function requires admin/org_owner or `accounting:create`; expense edits/deletes are admin-only at the row-security level.

So the fix mirrors the pattern already used for attendance: a narrow, purpose-built permission scope instead of full accounting access.

## What Sharon will be able to do

- See a single Finance item: **Operating Expenses**.
- Record an expense as it occurs: date, payee/supplier, category, amount, tax, payment mode, reference, notes, receipt attachment.
- Assign each expense to a **project** (and depot) — project selection is required for her, so job costing stays clean.
- Submit the expense for approval. It lands as *submitted*, never auto-approved.
- See the list of expenses she has recorded, and open the detail view.

## What stays closed to her

- Approving, paying, reversing, or editing posted expenses.
- Recurring expense templates, payables settlement, expense categories/GL setup.
- Every other finance screen, ledger, and report.

## Implementation

1. **New narrow scope `opex_entry`**
   - Add it to the individual permission grants list in Settings (alongside "Weekly Attendance only") as "Expense posting only".
   - Grant Sharon `opex_entry` view + create.

2. **Backend authorization**
   - Allow `post_operating_expense` for holders of `opex_entry:create`, forcing the record to be *submitted* (never auto-approved) for that path.
   - Allow attachment upload for the same scope.
   - Restrict the expense list she can read to her own submissions; approval, payment and reversal functions remain admin/accounting-approve only.

3. **Routing and navigation**
   - Change the Operating Expenses route guard from role-based to permission-based: full accounting access **or** `opex_entry:view`.
   - Sidebar: surface only the Operating Expenses item for `opex_entry` holders, keeping the rest of Finance hidden.

4. **Clerk-restricted expense screen**
   - Hide KPI cards, exports, Recurring and Payables tabs, and the Reverse/Pay/Approve actions for clerk-scope users.
   - Show a simple "Record expense" form and a table of her own entries with approval status.
   - Make Project mandatory in the dialog when the user is clerk-scoped.

5. **Tests**
   - Sidebar test: `opex_entry`-only user sees exactly one Finance item.
   - Route test: clerk reaches Operating Expenses, is redirected from ledger/loans/reports.

## Technical notes

- Files: `src/components/AppSidebar.tsx`, `src/App.tsx`, `src/pages/finance/OperatingExpenses.tsx`, `src/components/finance/ExpenseDialog.tsx`, `src/components/settings/UserPermissionOverrides.tsx`, sidebar/route tests.
- Database: migration updating `post_operating_expense` authorization and the operating-expense read/attachment policies to recognise `opex_entry`; plus a data grant of `opex_entry` view/create to Sharon.
- Publishing is required for `portal.firmcop.com` to pick this up.
