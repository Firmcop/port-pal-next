# Finish job expense tagging, then feed gate-in costs into the job invoice

## 1. Bulk "Assign to job" on the Operating Expenses list

The dialog is already built but not reachable. Wire it in:

- Add a tick box on every expense row plus a "select all" box in the header.
- When one or more rows are ticked, a bar appears with the count, "Assign to job" and "Clear".
- "Assign to job" opens the existing picker; choosing a job tags every selected expense at once and refreshes the list.
- Only finance/admin users see the tick boxes (same rule the detail panel already uses).

Then tag the three untagged expenses (EXP-2026-0020 / 0021 / 0022) to their job with this action.

## 2. Live check on a real expense

Using your own account in the running app:

- Post a small test expense, approve and post it, assign it to a conversion job.
- Confirm it appears in the job's "Direct expenses charged to this job" block and in the Budget tab total.
- Confirm an unapproved expense shows in the "tagged but not yet counted" note instead.
- Report back with what was seen, then remove the test expense's job tag (or reverse it) so it doesn't distort figures.

## 3. Gate-in costs feed the job's customer invoice

Today the job's container cost comes from acquisition invoices only, and the approved gate-in record's costs sit to one side. Change:

- Every approved (finalised) gate-in record for a container on the job contributes its costs — purchase price plus handling, transport, offloading and repair lines — to that container's cost on the job.
- The Containers panel on the job shows, per container, the gate-in cost, the cost currently stored on the job, and the difference, with a "Refresh from gate-in" action alongside the existing "Refresh from invoices".
- The job's Invoice tab picks up the refreshed container cost, so the cost, margin and suggested price on the customer invoice reflect the finalised gate-in figures.
- Unapproved gate-in records are excluded and listed as pending, so nothing is silently missing.
- Costs in another currency are converted with the job's currency and the stored rate, as elsewhere.

## Technical notes

- `OperatingExpenses.tsx`: use `useRowSelection` over `filtered`, `SelectionCheckbox` per row, `BulkActionBar` for the action strip, opening the existing `AssignExpensesToJobDialog` with `selectedIds`; clear the selection in `onDone` and invalidate `operating-expenses`.
- New `conversion_eir_costs(_conversion_id uuid)` returning, per container on the job, the approved `eir_records` cost components (`purchase_price_snapshot` + repair/handling/gate lines with their currency), the stored `conversion_containers.container_cost`, and a pending flag for non-approved EIRs. SECURITY DEFINER, `SET search_path TO 'public'`, revoked from PUBLIC/anon, granted to authenticated, org-scoped like `conversion_direct_expenses`.
- New `resync_conversion_container_costs_from_eir(_conversion_id uuid, _container_id uuid, _reason text)` mirroring the existing invoice resync: restates `conversion_containers.container_cost`, writes `conversion_container_audit`, and on a completed job posts the adjusting journal through the same path the invoice resync uses. No edits to history.
- Frontend: `ContainerRateTable.tsx` / the Containers panel in `ConversionDetail.tsx` gain the gate-in column and refresh action; `InvoiceTab` needs no change once `costs.purchasePrice` is recomputed from the restated container costs.
- Keep `npx tsgo --noEmit -p tsconfig.app.json` clean.
