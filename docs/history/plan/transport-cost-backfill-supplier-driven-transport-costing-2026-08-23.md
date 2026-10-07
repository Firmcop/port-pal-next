# Transport Cost Backfill & Supplier-Driven Transport Costing

## What we found

- 121 of 128 containers have no transport purchase invoice and a zero `transport_cost`; every container already has its crane/offloading invoice.
- Only 7 transport invoices exist so far (Speedy Haulers, KENMONT LOGISTICS, Munju Transporters), all in KES.
- The existing `record_container_service_invoice` RPC raises the purchase invoice + PO + AP ledger entry and is idempotent per container/service, but it does not write back the cost onto the container or restate downstream sale/conversion costs.

## What will be built

### 1. Standard transport rates (going forward)

- Add per-size transport rate defaults to the Acquisition Defaults settings: 20ft and 40ft rates (seeded with KES 32,500 and KES 40,000).
- Container intake pre-fills the transport cost from the size-matched rate and requires the transport vendor to be chosen from **registered suppliers** (supplier picker with inline "create supplier"), instead of free text. Offloading vendor keeps its current behaviour.

### 2. One-off backfill of the current inventory

- Backfill target: every container without a transport purchase invoice — all statuses, including repatriation-bound, sold, converted and in-conversion units.
- Rates applied: 40ft = KES 40,000, 20ft = KES 32,500 (other sizes prorated from the 20ft rate only if any exist; today there are none).
- Vendor: a single placeholder supplier, `Transport (Historic)`, created if absent, so the cost posts now and each invoice can be re-assigned to the real transporter later.
- For each container the backfill will:
  - raise a transport purchase invoice + PO + AP liability entry (idempotent, skips anything already invoiced),
  - write `transport_cost`, `transport_currency` and `transport_vendor` back onto the container,
  - restate margins downstream: sold units get their `container_sales` transport component updated (COGS and profit recompute), conversion/in-conversion units get their `container_conversions` transport component updated,
  - write an audit entry per container with the reason "Historic transport cost backfill".

### 3. Backfill screen

- Extend the existing admin-only Acquisition Backfill page (`/inventory/acquisition-backfill`) with a "Transport costs" section: editable 20ft/40ft rates and vendor, a preview table of affected containers (number, size, status, cost to post, whether a sale/conversion will be restated), and a Run button showing per-container results.
- Re-running is safe: already-invoiced containers are skipped.

## Technical notes

- New RPC `backfill_container_transport_costs(_vendor text, _rate_20 numeric, _rate_40 numeric, _currency text, _dry_run boolean)`, `SECURITY DEFINER`, admin/org-owner only, org-scoped through `current_org_id()`. It loops candidates, calls `record_container_service_invoice(..., 'transport', ...)`, updates the container row, then calls `adjust_sale_costs` / `adjust_conversion_costs` for linked sales and conversions, and returns a JSON summary (processed, skipped, sales restated, conversions restated, total posted).
- Rate defaults stored in `organizations.config.acquisition_defaults` as `transport_rate_20` / `transport_rate_40`, surfaced via the existing app-settings resolver.
- Frontend: settings section update, supplier picker in the container intake and Edit Acquisition Cost dialogs, and the new backfill section reusing the existing helpers in `src/lib/container-backfill.ts`.
