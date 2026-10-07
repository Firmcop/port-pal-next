# Expenses not showing on conversion jobs

## What I found

I checked the data before proposing anything:

- **No expense in the system has ever been linked to a job.** All 98 expense lines and every expense header have an empty job field — including the three posted today (EXP-2026-0020/0021/0022, all approved and paid). Most also have no project.
- The job page only lists expenses that are (a) linked to that job, (b) approved and (c) posted. With nothing linked, the "Direct expenses charged to this job" block is correctly empty.
- The expense form *does* have a "Job (conversion)" field and it does save correctly — but it is an optional dropdown tucked under "Project / job", and it is filtered by the project chosen above it, so if no project (or the wrong one) is picked the job list looks empty or wrong.
- Once an expense is saved there is **no way to attach it to a job afterwards** — the expense detail panel has no job field.

So this is not a broken link between finance and jobs; the expenses were simply never tagged, and there was no way to fix them after the fact.

## What I'll change

**1. Post an expense straight from the job**

A "Charge an expense to this job" button on the job's Budget tab opens the expense form already filled in with that job and its project, so the link can't be missed.

**2. Re-tag expenses that are already posted**

The expense detail panel gains an editable "Job" field (project and job), available to finance/admin users, including for approved and posted expenses. Changing it is recorded in the finance audit log with who changed it and when; ledger amounts are untouched — only the job it is reported against changes.

A bulk "Assign to job" action on the Operating Expenses list lets several selected expenses be tagged at once — this is how today's expenses get onto the right job.

**3. Make the job field harder to miss on the form**

- Searchable picker showing job number, customer and status instead of a plain dropdown.
- If a project is chosen that has no jobs, all jobs still remain selectable rather than showing an empty list.
- Picking a job auto-fills the project; changing the project clears a job that no longer belongs to it.

**4. Tell the user when an expense is tagged but not yet counted**

The job's Direct expenses block gains a small note listing expenses tagged to the job that are still awaiting approval or not yet posted, with their status — so an expense is never silently missing.

## Technical notes

- New `set_expense_conversion(_expense_id uuid, _conversion_id uuid, _project_id uuid)` — SECURITY DEFINER, `search_path = public`, revoked from PUBLIC/anon, granted to authenticated. Requires admin/org_owner/platform admin or `accounting.edit`; org-scoped; validates the job belongs to the org; updates `operating_expenses.conversion_id/project_id` and all its `operating_expense_lines` that have no explicit override; writes a `finance_audit_log` row. No journal changes.
- New `conversion_pending_expenses(_conversion_id uuid)` returning job-tagged expenses that are not yet approved/posted, same security pattern as `conversion_direct_expenses`.
- Frontend: `ExpenseDialog.tsx` gains `defaultConversionId`/`defaultProjectId` props and a combobox job picker; `BudgetTab.tsx` gets the "Charge an expense to this job" button; `ExpenseDetailSheet.tsx` gets the job/project editor; `OperatingExpenses.tsx` gets the bulk assign action; `DirectExpensesCard.tsx` gets the pending-expenses note.
- No change to `post_operating_expense` or to how expenses hit the ledger.
