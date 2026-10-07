# Expenses and purchases on the job page, and whether job costs reach Finance

## What the data actually shows

I checked before proposing anything:

- **No expense in the system is tagged to a job.** All 23 expense headers and all 100 expense lines have an empty job field. So the job page's "Direct expenses" block is correctly empty — it only lists expenses tagged to *that job*, approved and posted.
- **Expenses are being tagged to the project instead, on the line.** 31 expense lines carry a project; 9 of them (about KES 60,300) belong to the project behind CNV-EMMANUEL-0001 — the job you are looking at. The job page ignores project-tagged costs entirely, which is why nothing appears.
- **Purchases:** this job has 4 purchase orders linked directly and its project has 1 more (PO-MTMK9A6M, confirmed, nothing received yet). The job's purchases panel only lists *received* lines not yet costed, so an ordered-but-not-received PO is invisible, and project purchases only surface once goods arrive.
- **Finance posting:** job costs are only posted to the ledger when a job is completed. Of 43 jobs, 38 are open and have no ledger entries for their costs; of the 8 completed jobs, 6 posted correctly and **2 completed jobs posted nothing at all — CNV-NOCUST-0005 and CNV-NOCUST-0006**. Materials and services do hit Finance earlier through goods receipts and supplier invoices, but not attributed to the job; wages post through attendance. Accounting entries have no job field at all, so nothing in Finance can be traced back to a job.

## What I'll change

**1. Job page shows project-tagged costs as well**

The Direct expenses block gains a second section: "Charged to this job's project" — expenses tagged to the project (header or line level), marked so they are not confused with costs booked to the job itself. Each row gets an "Attach to this job" button to move it onto the job in one click.

**2. Expenses awaiting approval show up too**

The existing "tagged but not counted yet" note is extended to project-tagged expenses, so a submitted-but-unapproved expense is visible on the job with its status instead of silently missing.

**3. Purchases for the job and the project**

The purchases panel becomes a full picture rather than only uncosted receipts:
- Orders raised against the job or its project, with status (confirmed, received, paid) and value — including orders with nothing received yet.
- Received lines not yet costed keep their "Allocate" action, with project-sourced ones marked "via project".

**4. Finance posting status per job**

A line on the job's Budget tab states plainly whether the job's costs have reached the accounts: for open jobs, "costs are recorded on the job; they post to the accounts when the job is completed" with the running total; for completed jobs, the posted journal and amount, or a clear warning when nothing was posted.

**5. Fix the two completed jobs with no postings**

CNV-NOCUST-0005 and CNV-NOCUST-0006 get their cost-of-sales entries posted as dated correction journals, with reason and batch reference. Nothing existing is edited or deleted.

## Technical notes

- New `conversion_project_expenses(_conversion_id uuid)` — expense lines where `COALESCE(l.project_id, e.project_id)` equals the job's project and the job link is empty; returns approval/posted state so approved and pending can be split in the UI. SECURITY DEFINER, `SET search_path TO 'public'`, revoked from PUBLIC/anon, granted to authenticated, org-scoped like `conversion_direct_expenses`.
- New `conversion_purchase_orders(_conversion_id uuid)` — POs where `conversion_id = _conversion_id` or `project_id` = the job's project, with line totals, received quantity and allocation state.
- New `conversion_posting_status(_conversion_id uuid)` — job cost total (materials + labour + services + containers) versus `accounting_transactions` with `reference_type = 'container_conversions'` and `reference_id` = the job.
- Backfill migration: run the same posting path `complete_conversion` uses for CNV-NOCUST-0005 / 0006 under `reference_type = 'audit_correction_2026_09'` with an `AC2609-…` prefix.
- Frontend: `DirectExpensesCard.tsx` gains the project section and per-row attach (reusing `set_expense_conversion`); `PurchasedForJobPanel.tsx` gains the orders list; `BudgetTab.tsx` gains the posting-status line.
- Keep `npx tsgo --noEmit -p tsconfig.app.json` clean.
