# Manual FX rate entry + supplier picker for acquisition costs

Two changes to how container acquisition costs are captured.

## 1. Enter the actual FX rate yourself

Today the rate used to convert a foreign-currency component (e.g. seller in USD) into the depot's base currency is always looked up from the FX Rates table. You will be able to type the real rate you actually got.

Where it appears:
- Container intake (Add container): when transport / crane / seller currency differs from the base currency, an "Exchange rate" field appears next to the amount, pre-filled with the stored rate (editable).
- Edit acquisition cost dialog: each of the three components (seller, transport, crane) gets its own optional rate field, pre-filled with the current rate.
- Bulk edit acquisition costs: one rate field per component, applied to every selected container.

Behaviour:
- Leave it blank to keep using the table rate.
- A manually entered rate is used for the base-currency valuation, shown in the review/preview step as "USD 3,000.00 x 132.50 = KES 397,500.00 (manual rate)", and stored on the invoice.
- Every manual rate is written to the acquisition audit trail (who, when, rate, reason), so it shows on the container's audit panel and in the CSV/PDF export.
- Automatic FX revaluation skips invoices whose rate was entered manually, so your rate is never silently overwritten.
- A missing table rate is no longer a blocker when you supply a rate yourself.

## 2. Pick transporter and crane vendor from Suppliers

The two vendor fields become searchable supplier pickers instead of free text:
- Search the existing supplier register by name.
- If the vendor is not there, "＋ Create supplier …" opens a small popup (name, optional phone / email / tax number) that saves a new supplier and selects it immediately, without leaving the container form.
- Applies to container intake, the edit acquisition cost dialog, the bulk edit dialog, and the org-level acquisition defaults in Depot Settings.
- Existing containers that hold a free-text vendor name keep working: the name is matched to a supplier where possible, otherwise shown as-is with a hint to pick a registered supplier.

## Technical notes

Database:
- Widen `set_container_acquisition_costs` and `preview_container_acquisition_costs` with optional `_purchase_fx`, `_transport_fx`, `_offloading_fx` numeric args; when supplied, use that rate for `base_amount` instead of `get_fx_rate_detail`, and mark the source as manual.
- Add `fx_rate_source` (`auto` | `manual`) to `supplier_invoices`; `revalue_acquisition_fx` filters to `fx_rate_source = 'auto'`.
- Preview components gain `fx_rate_source` so the review list can label manual rates; the missing-rate blocker is suppressed when a manual rate is present.
- Optional `_transport_supplier_id` / `_offloading_supplier_id` args resolve the vendor by id first, falling back to the existing name-based `find_or_create` path.
- Log manual rates through the existing acquisition audit action so `AcquisitionAuditPanel` picks them up with no schema change there.

Frontend:
- New `src/components/suppliers/SupplierCombobox.tsx` (command-style search + inline create dialog, inserts into `suppliers`, invalidates the suppliers query).
- New shared `FxRateInput` used by the three cost forms; only rendered when component currency differs from base currency.
- Extend `SetAcquisitionCostsArgs` / `PreviewArgs` in `src/lib/container-acquisition-edit.ts` with per-component fx rate and supplier id, and thread them through `EditAcquisitionCostDialog`, `BulkEditAcquisitionDialog`, `Inventory.tsx` intake, and the CSV import columns in `src/lib/acquisition-csv.ts`.
- `AcquisitionPreviewList` and `AcquisitionCostPanel` show a "manual rate" tag when applicable.
