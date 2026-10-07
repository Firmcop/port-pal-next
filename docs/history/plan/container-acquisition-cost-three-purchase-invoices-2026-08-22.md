# Container acquisition cost — three purchase invoices

Today, receiving a container only raises one purchase invoice (to the seller, and only when the depot bought it). This adds two more optional purchase invoices — transport and crane/offloading — so the full acquisition cost of a container is visible in one place.

## What changes

**On "Add container"**
- New "Acquisition costs" section, shown for every container (depot-owned and shipper-owned):
  - Transport cost + currency, billed to the transporter already captured in the Transport / Delivery section (a vendor override field is available if the payee differs).
  - Crane / offloading cost + currency, billed to a crane vendor selected from suppliers or typed in.
- Both are optional: no invoice is created when the amount is blank/zero or no vendor is named.
- The existing seller invoice keeps working unchanged for depot-purchased containers.

**Invoices generated**
Each non-zero cost creates its own acquisition PO + purchase invoice (PINV) payable to that vendor, plus the accounts-payable ledger entry — same mechanics as today's seller invoice. Vendors that don't exist yet are auto-created as suppliers.

**Container record**
The container stores its transport cost and crane/offloading cost so the acquisition total (purchase + transport + crane) can be shown on the container detail page, alongside links to the three invoices.

**Backfill for existing containers**
The existing backfill dialog gains the same transport and crane fields, so containers already in inventory can have their missing acquisition invoices raised. It stays idempotent — a cost that already has an invoice is skipped.

## Technical notes

- New columns on `containers`: `transport_cost`, `transport_vendor`, `offloading_cost`, `offloading_vendor`, `acquisition_currency` (currency auto-filled by the existing `set_currency_from_org` trigger pattern).
- New SECURITY DEFINER RPC `record_container_service_invoice(_container_id, _vendor_name, _amount, _currency, _service_kind, _reference)` where `_service_kind` is `transport` or `crane_offloading`. It mirrors `acquire_container_from_owner`: resolve/create supplier, FX-convert to supplier currency, insert `purchase_orders` + `po_items` + `supplier_invoices` + `supplier_invoice_lines` + the `container_acquisition_payable` accounting transaction, and log to `finance_audit_log`. Returns the PO id, or NULL when vendor is blank, amount ≤ 0, vendor is the depot itself, or an invoice for that container + service kind already exists (idempotency guard on `supplier_invoices.reason` + `reference`).
- New client helper `src/lib/container-service-costs.ts` wrapping the RPC, as the single call site (same pattern and test guardrails as `container-acquisition.ts`).
- `src/pages/Inventory.tsx`: extend the zod schema and `AddContainerDialog` with the new fields; call the helper twice after the container insert. `src/lib/container-backfill.ts`: accept transport/crane inputs and report their status in `BackfillResult`.
- `ContainerDetail.tsx`: an "Acquisition cost" card breaking down purchase / transport / crane with the total and links to each PINV.
- Unit tests for the new helper's guard conditions and single-RPC invariant.
