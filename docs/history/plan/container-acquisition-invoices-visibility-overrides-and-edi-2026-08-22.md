# Container acquisition invoices: visibility, overrides, and EDI

Make the three acquisition purchase invoices (seller, transporter, crane/offloading) visible and live on intake and container pages, allow vendor/cost overrides with an audit trail, and extend EDI generation to all three.

## 1. Acquisition cost panel on intake and container detail

- Build one shared `AcquisitionCostPanel` component used by both the container detail page and the Add Container dialog (after save / when editing an existing container).
- Each row shows: service (Seller / Transport / Crane), vendor name, invoice number (deep link to Supplier Invoices), status badge (draft, issued, part-paid, paid), and amount.
- Rows for services with no invoice yet show as "Not raised" so the gap is obvious.
- Read-only total row: sums the three invoices' current `total_amount`. Mixed currencies are converted using the stored FX rate where available; otherwise the total is split per currency instead of showing a single wrong number.
- The total is always derived from the invoices, never from the values typed at intake, so corrections to an invoice flow straight through.

## 2. Real-time updates

- Subscribe to `supplier_invoices` changes filtered to the container and invalidate the panel query on insert/update/delete, so edits, credits, or status changes made anywhere in Finance update the total without a refresh.

## 3. Vendor and cost overrides at intake

- Add org-level defaults in Depot Settings (new fields in the organization config): default transporter vendor, default crane/offloading vendor, and optional default cost amounts.
- Intake pre-fills the transport and offloading vendor + cost fields from those defaults; both remain editable (vendor picker from existing suppliers plus free text, as today).
- Whenever the saved values differ from the org defaults, write an audit entry (vendor/cost before and after, container, user, timestamp) to the container audit trail and finance audit log. An optional reason field is captured and stored with the entry.
- Overrides are also shown in the acquisition panel ("overridden from default") so the deviation is visible on the container.

## 4. EDI for all three purchase invoices

Currently EDI exists only for customer invoices; purchase invoices have none. Extend it:

- Allow `edi_exports` to reference a supplier invoice (nullable AR invoice id + new supplier invoice id, exactly one required).
- New generator that builds an EDIFACT INVOIC D96A message for a supplier invoice, mirroring the existing gate-in generator: same interchange sequence, same segment structure, depot as buyer and vendor as supplier, container number as reference, same failure handling (a failed generation is recorded with the error rather than blocking the invoice).
- Same validation rules as the seller path: skipped when the invoice is voided/zero, vendor identifiers fall back to tax id then normalised name.
- Auto-generate at the same moment the invoice is created — inside the acquisition and service-invoice routines — for seller, transporter and crane invoices alike.
- Surface the generated EDI file per invoice on the Supplier Invoices page with download + "mark downloaded", matching the customer invoice UX.

## Technical notes

- DB: extend `edi_exports` (nullable `invoice_id`, new `supplier_invoice_id`, check constraint, RLS/grants unchanged in shape); add `generate_supplier_invoice_edi(uuid)`; call it from `acquire_container_from_owner` and `record_container_service_invoice`; add an override-audit insert path.
- Frontend: new `src/components/containers/AcquisitionCostPanel.tsx`; wire into `ContainerDetail.tsx` (replacing the current inline card) and `Inventory.tsx` intake; extend `DepotSettings.tsx` with an Acquisition defaults section; extend the Supplier Invoices page with the EDI column.
- Tests: extend `src/lib/container-service-costs.test.ts` for override logging and add coverage for the acquisition total computation (mixed currency, missing invoice, credited invoice).
