# Acquisition costs: FX transparency, revaluation, CSV bulk edit, audit export

Four additions to the container acquisition-cost workflow.

## 1. FX breakdown per invoice line

Today the acquisition panel shows each invoice in its own currency (USD seller, KES transport) and a combined total, but never says which rate produced the converted figure. Each supplier invoice already stores `fx_rate` and `base_amount`; the rate date is the invoice issue date.

- Show under every non-base-currency line: `USD 3,000 x 132.50 = KES 397,500 (rate of 12 Aug 2026)`.
- Show the same detail in the totals row, listing each contributing rate.
- Flag lines with no stored rate as "not converted — add an FX rate" and link to Finance > FX Rates.
- Include the same rate/date columns in the edit dialog's confirmation preview.

## 2. Automatic revaluation when FX rates change

When a rate for a currency pair is added or corrected in Finance > FX Rates, containers whose acquisition invoices used the old rate silently keep stale base-currency totals.

- New database routine recalculates `base_amount` (and the linked base-currency ledger entries) for open acquisition invoices affected by the changed pair and effective date. Invoice face amounts in the vendor's own currency never change — only the base-currency valuation.
- Fully paid or cancelled invoices are left alone; they are reported as skipped.
- Each recalculation writes a finance audit entry (old rate, new rate, old/new base total, trigger = "FX revaluation", plus who saved the rate) so it appears in the container's acquisition history alongside manual edits.
- Runs automatically on rate save, with a "Revalue now" button and a result summary (revalued / skipped / failed) on the FX Rates page.

## 3. CSV import for bulk acquisition edits

Extends the existing bulk-edit dialog with an "Import from CSV" path for cases where each container needs different amounts.

- Downloadable template: container number, purchase amount + currency, transport amount + currency + vendor, crane amount + currency + vendor.
- Upload parses and matches rows to containers; unknown or duplicate container numbers are listed as errors.
- Every matched row is previewed through the same validation used by the manual dialog (missing FX rate, paid amount exceeding the new total, missing vendor). Rows with blockers are shown with the suggested fix and skipped.
- One reason applies to the whole import and is recorded on each container's audit trail.
- Result screen shows applied / skipped / failed per container with a downloadable error report.

## 4. Export of the acquisition audit panel

- "Export" menu on the acquisition history card: CSV and PDF.
- Columns: date/time, user, component, action, before amount + currency, after amount + currency, base-currency delta, FX rate used, invoice number, ledger reference, reason.
- PDF uses the existing branded print layout with the container number in the header; CSV uses the shared export helper.

## Technical notes

- Frontend: `AcquisitionCostPanel.tsx`, `AcquisitionPreviewList.tsx`, `AcquisitionAuditPanel.tsx`, `BulkEditAcquisitionDialog.tsx` (new CSV step), plus a small `acquisition-fx.ts` helper for rate/date formatting; exports reuse `exportCSV` / `exportPDF` and `parseUpload` from `excel-io`.
- Backend: new `revalue_acquisition_fx(...)` SECURITY DEFINER function (admin/owner only) writing to `finance_audit_log`, invoked from the FX rate save path; `preview_container_acquisition_costs` extended to return the rate and rate date per component so the preview and CSV import share one validation source.
- No change to how face-value invoices are raised, and no schema change to `supplier_invoices` beyond reusing `fx_rate` / `base_amount`.
