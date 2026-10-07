# Acquisition costs: per-currency, bulk edits, preview, validation and audit

Four related improvements to how container acquisition costs are edited and reviewed.

## 1. Each cost component keeps its own currency

Today the edit dialog forces a single currency across all three components, so a container bought in USD with transport and crane billed in KES cannot be recorded correctly.

- The edit dialog gets a currency selector per component: seller, transport, crane/offloading (each pre-filled from its existing invoice, falling back to the vendor's registered currency, then the org currency).
- Each purchase invoice is raised and adjusted in its own currency — no forced conversion of the vendor's real bill.
- The acquisition total shows the per-currency subtotals (e.g. `USD 2,400 · KES 85,000`) plus a converted grand total in the org currency using the org FX rates. If a rate is missing for a date, the total says so and links to Finance → FX Rates instead of showing a wrong number.
- The same per-currency display is used on the container detail panel and wherever sale/conversion forms read the locked acquisition cost.

## 2. Bulk edit acquisition costs

- On Inventory, selecting containers reveals a new admin-only "Edit acquisition costs" bulk action.
- The bulk dialog takes transport and crane/offloading amounts + vendors + currency, an optional seller price, a mode (apply the same amount to every container, or leave a component untouched), and one mandatory reason applied to all.
- It shows how many containers will be affected and runs the same per-container preview and validation as the single edit; containers that fail validation are listed and skipped, not silently changed.
- Results report per container: created / adjusted / cancelled / skipped, with failures shown so they can be retried.

## 3. Acquisition audit panel on the container detail page

- New "Acquisition cost history" card below the acquisition panel, listing every edit and intake override for that container: who, when, which component, before and after amount + currency, the resulting outcome (created / adjusted / cancelled), and the reason.
- Rows deep-link to the affected purchase invoice.
- Entries come from the existing finance audit trail already written by the cost editor and the intake override logger; no new logging concept is introduced, only the missing read surface.

## 4. Preview and validation before saving

- The edit dialog gains a "Review changes" step. Before anything is written it lists exactly what will happen: for each component the invoice number (or "new invoice"), vendor, currency, old vs new amount, the ledger entry that will be posted (payable increase / decrease / reversal), and any PO whose total will follow.
- Save is blocked, with a specific fix suggestion, when:
  - an amount is set but no vendor is named (suggests picking the org default vendor or typing one);
  - the seller price is set but the container has no registered owner (suggests setting the owner on the container);
  - a component's currency has no FX rate to the org currency for today (suggests adding the rate);
  - an existing invoice is already paid or part-paid and the new amount is lower than the amount already paid (suggests raising a credit note instead);
  - the container is sold / converted and the edit would change a component already consumed into a job or sale (warns and requires explicit confirmation rather than blocking).
- Warnings that are not blocking (e.g. cancelling an invoice that has EDI already exported) are shown in the same review list.

## Technical notes

- Migration: replace `set_container_acquisition_costs` with per-component currency arguments (`_purchase_currency`, `_transport_currency`, `_offloading_currency`), keeping the existing `_currency` as the fallback so current callers keep working. `containers.acquisition_currency` continues to store the seller currency; add `transport_currency` and `offloading_currency` columns.
- New read-only `preview_container_acquisition_costs(...)` SECURITY DEFINER RPC returning the planned per-component action, current invoice snapshot, ledger effect and a list of blocking/warning codes — the dialog's review step and the bulk dialog both call it, so preview and save can never diverge.
- `src/lib/container-acquisition-edit.ts`: extend the args with per-component currency, add `previewAcquisitionCosts()` and `setAcquisitionCostsBulk()` (loops the RPC per container, aggregating outcomes). Extend `splitAcquisition` to return per-currency subtotals and an FX-converted total via the existing `getFxRate` helper.
- New `src/components/containers/AcquisitionAuditPanel.tsx` querying `finance_audit_log` for `action = 'container_acquisition_cost_edit'` (plus the intake override action) scoped to the container, mounted from `ContainerDetail.tsx`.
- New `src/components/containers/BulkEditAcquisitionDialog.tsx` wired into the existing `useRowSelection` bulk bar in `src/pages/Inventory.tsx`, gated on admin/owner like the current bulk backfill action.
- `EditAcquisitionCostDialog.tsx`: per-component currency selects, review step driven by the preview RPC, blocking validation list, confirm-to-save.
- Unit tests for the multi-currency split/total logic and for the validation rule set.
