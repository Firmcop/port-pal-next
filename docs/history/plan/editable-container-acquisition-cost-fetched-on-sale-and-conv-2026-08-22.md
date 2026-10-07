# Editable container acquisition cost, fetched on sale and conversion

Today only 6 of 128 containers carry any acquisition cost, and none have transport or crane values. Sales and conversion jobs ask staff to retype container cost by hand, so the numbers drift from the purchase invoices.

This makes the acquisition cost editable for every container (including ones already in inventory) and makes sales and conversion jobs read it instead of asking for it.

## Editing the acquisition cost

A new **Edit acquisition cost** action on the Acquisition cost card (container detail page and the intake/inventory panel), restricted to admin/owner.

The dialog edits the three components separately:

- Seller (purchase price) — vendor is the container's owner
- Transport / delivery — vendor editable
- Crane / offloading — vendor editable
- Shared currency, plus a mandatory reason for the change

Behaviour per component:

- No invoice yet and an amount is entered → the purchase invoice (PINV), PO and payable ledger entry are raised, exactly as at intake.
- Invoice exists and the amount changed → the invoice, its line and the ledger entry are adjusted to the new amount, with the old value kept in the audit trail.
- Amount cleared to zero on an existing invoice → the invoice is cancelled (credited), not deleted.
- Void / credited invoices stay excluded from the total.

Every change is written to the finance audit log with who, when, old value, new value and the reason. The card total keeps updating in real time from the live invoices.

## Sale and conversion fetch the cost

- **Container Sales** — picking a container fills "Entry price" and "Transport & offloading" from that container's live acquisition invoices, read-only, with a link back to the container to change them. Purchase invoice amount goes to entry price; transport + crane goes to transport & offloading.
- **Conversion jobs** (new job, and "Attach container" on an existing job) — the same two cost fields become read-only and are populated from the container.
- Both show a warning when the container has no acquisition cost recorded, linking to the edit dialog.
- Existing sales and jobs are untouched; the admin cost-adjust actions already on those records stay available for corrections.

## Technical notes

- New SECURITY DEFINER RPC `set_container_acquisition_costs(_container_id, _purchase, _transport, _transport_vendor, _offloading, _offloading_vendor, _currency, _reason)`. It is admin/owner-only, org-scoped, and per component either calls the existing intake paths (`acquire_container_from_owner`, `record_container_service_invoice`), adjusts the existing `supplier_invoices` row + `supplier_invoice_lines` + the `container_acquisition_payable` accounting transaction, or cancels it. It also syncs `containers.acquisition_cost / transport_cost / offloading_cost / *_vendor / acquisition_currency` and writes `finance_audit_log` rows. Idempotent when nothing changed.
- New client helper `src/lib/container-acquisition-edit.ts` as the single call site for the RPC (same guardrail pattern as `container-service-costs.ts`), plus `getContainerAcquisitionBreakdown(containerId)` returning `{ purchase, services, currency, mixed }` from the live invoices, reusing `src/lib/acquisition-costs.ts`.
- `AcquisitionCostPanel.tsx`: add the edit button + dialog (gated by the existing role hook), reusing the panel's realtime subscription to refresh after save.
- `src/pages/ContainerSales.tsx`, `src/pages/Conversions.tsx`, and the attach-container dialog in `src/pages/ConversionDetail.tsx`: fetch the breakdown on container select, render the two cost inputs as read-only, and submit the fetched values.
- Unit tests for the new helper: guard conditions, single-RPC invariant, and the breakdown split (void invoices excluded, mixed currency flagged).
