# Cancel JJ gate-in fees and bill repatriation handling

## Verified scope

- JJ MES DMCC has **4 active, unpaid gate-in/inbound transport invoices**, all sent in USD at USD 320 each: total **USD 1,280**. None has a payment allocation.
- There are **19 JJ MES DMCC repatriations**: 8 completed with draft transport invoices and 11 dispatched without invoices.
- None of the 19 repatriations currently has the USD 30 handling fee stored or invoiced.
- Existing repatriation billing combines transport and handling; this will be separated so handling is never silently mixed into transport billing.

## Changes

### 1. Cancel and archive gate-in fees
- Cancel the 4 active JJ MES DMCC gate-in invoices through an auditable bulk operation.
- Record the reason, cancellation timestamp, actor, affected container/EIR, and original USD amount.
- Keep the records and lines for history, but exclude cancelled invoices from active receivables and normal invoice views unless the cancelled filter is selected.

### 2. Create the current handling-fee invoice
- Create **one bundled JJ MES DMCC handling invoice for USD 570**: 19 repatriations × USD 30.
- Add one USD 30 line per repatriation, showing both the repatriation number and container number so JJ MES DMCC can reconcile every unit.
- Link each line to its repatriation and link the bundled invoice back to all 19 repatriation records without replacing their separate transport-invoice links.
- Make generation idempotent: a repatriation already included in an active handling invoice cannot be billed again.

### 3. Separate future repatriation billing
- Remove gate-in fees from repatriation invoices.
- Keep transport invoices limited to the route/repatriation transport charge.
- Add a dedicated “Generate handling invoice” action that batches eligible repatriations for one owner into a separate invoice at **USD 30 per container**, with container and repatriation details on every line.
- Default JJ MES DMCC handling to USD 30 while retaining explicit stored snapshots so historical invoices do not change if the future rate changes.

### 4. Repatriation and invoice UI
- Show separate Transport invoice and Handling invoice references/statuses on each repatriation.
- Add a batch preview listing eligible units, excluded/already-billed units, line count, and USD total before creating the handling invoice.
- Label handling invoices clearly in the invoice list and detail view; cancelled gate-in invoices remain accessible through the cancelled filter.

### 5. Reconciliation and validation
- Extend reconciliation to flag repatriations with no USD 30 handling line, duplicate handling lines, non-USD handling fees, or handling mixed into transport invoices.
- Verify after correction: 4 gate-in invoices cancelled, active JJ gate-in receivable USD 0, 19 handling lines, bundled handling invoice USD 570, and no duplicate repatriation handling billing.

## Technical notes

- Use a schema migration for dedicated handling-invoice linkage and an idempotent batch billing RPC; preserve the existing transport `invoice_id` relationship.
- Use a data operation for the 4 cancellations and the initial 19-repatriation USD 570 handling invoice.
- Preserve immutable audit history; no invoice, line, EIR, or repatriation record is deleted.
