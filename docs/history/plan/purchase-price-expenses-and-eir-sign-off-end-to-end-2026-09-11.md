# Purchase price, expenses and EIR sign-off, end to end

Four connected pieces so a container's real cost is visible from purchase through the job, the EIR and the sale, and so approved expenses count as real job cost.

## 1. Approved expenses become job and project actual cost

- The expense form gains an optional **job** field next to the project. Picking a project filters the job list to that project's jobs.
- Only expenses that are approved and posted count as actual cost; drafts and rejected ones are ignored.
- The job's Budget tab gains a **Direct expenses** block listing each approved expense (date, payee, category, amount, link to the expense) and rolls that total into the job's actual figures, next to materials, labour and containers.
- Project totals show expenses tagged to a job plus project-level expenses that were never tagged to a job, so nothing is double counted and nothing goes missing.
- Editing, reversing or rejecting an expense updates the job figures automatically.

## 2. Per-container cost breakdown on the EIR

The EIR printout gains a small cost block per container:

- purchase price actually paid (with currency)
- standard (EIR) rate for that size
- conversion rate applied when the amount is in another currency
- difference against the standard rate, labelled discount or over-rate
- gate fee where one applies

Multi-container EIRs list one row per unit with a total line. Values are the snapshot stored on the EIR, so a reprint always shows the figures as at issue.

## 3. EIR approval by the new owner

- Each EIR gets a status: awaiting approval, approved, or rejected with a reason.
- Owners with portal access see their pending EIRs and approve or reject each one; staff with approval rights can approve on the owner's behalf, and that is recorded as such.
- Pending items appear in the existing Approvals screen alongside quotes and purchase orders, using the approval rules already configured for EIRs.
- Gate movement and stock behaviour stay as they are today; an unapproved EIR prints with an "Awaiting owner approval" mark, and the approver's name and time appear once approved.
- Every decision is written to the approval history with who, when and any note.

## 4. Purchase price visible from purchase to sale

- The container's live purchase price flows into: the job's container rate table, the gate-in EIR snapshot, the sale/customer invoice, and the container's cost journey.
- The container rate table gains a **conversion rate** column and shows amounts in both the source currency and the job currency.
- Sale and lease invoices for a container show its acquisition cost and the resulting margin on the internal view (not on the customer's copy).
- A single variance strip on the container page: purchase vs standard rate, cost added, revenue, margin.

## Technical notes

- Database: add `conversion_id` to `operating_expenses` and `operating_expense_lines` (nullable, org scoped, indexed); extend `post_operating_expense` and the expense edit path to accept it. Add a read-only `conversion_direct_expenses(_conversion_id)` returning approved, posted expense lines, and include its total in `conversion_budget_variance` consumers and `project_job_costs`.
- EIR: reuse the existing `purchase_price_snapshot`, `purchase_price_currency` and `reference_rate` columns; add `fx_rate_snapshot`. Approval reuses `approval_status`, `approval_request_id`, `approved_by`, `approved_at`, `rejection_reason` on `eir_records` plus the existing `submit_for_approval` / `decide_approval_request` functions with `doc_type = 'eir'`; a trigger stamps `pending` on create when the policy for `eir` is enabled. Portal approval goes through a security-definer RPC scoped to `customer_portal_users` for that owner.
- Frontend: `ExpenseDialog.tsx` job picker; new `DirectExpensesCard` used by `BudgetTab.tsx`; `ContainerRateTable.tsx` gains conversion-rate and currency columns; `eir-templates.ts` gains the per-container cost block and approval stamp; `EIRRecords.tsx` gains status badge, submit and decide actions; a pending-EIR list in the customer portal; `ContainerDetail.tsx` gains the variance strip.
- All new reads are organization-scoped security-definer functions consistent with existing finance functions; no pricing rule is enforced, the standard rate stays a benchmark.
