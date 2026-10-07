# Container Sales: bulk repricing, guardrails, cost transparency and audit export

Four additions to the Container Sales page, all built on the existing `set_sale_pricing` flow (entry price always refreshed from the container's live acquisition invoices, selling price typed, markup derived).

## 1. Bulk repricing

- Checkbox column on the sales table plus a selection bar (reuse the existing bulk selection pattern).
- "Reprice selected" opens a review dialog listing each selected sale: container, currency, live entry price (fetched per container), current selling price, new selling price, resulting markup.
- Two modes, combinable: enter one **markup %** to prefill every row's new selling price from its own entry price, then edit any row individually.
- One shared **reason** field (required) applies to all rows; per-row blockers are shown inline.
- Apply runs each row through the same pricing RPC sequentially, then reports "X updated, Y skipped" with the failing rows and their errors still on screen.

## 2. Validation and clear errors

Checked in the edit dialog and in every bulk row before saving:

- Selling price must be a number and not negative.
- Entry price of 0 / no acquisition invoice: markup cannot be derived — warn, and require the reason to acknowledge it.
- **Negative markup** (selling below entry): a red warning showing the loss amount plus a "sell at a loss — confirm" checkbox that must be ticked before Save enables. Same gate applies in bulk, once for the whole batch.
- **Currency rules**: block the save when the container's acquisition invoices span currencies with no reliable conversion (`mixed`), or when the acquisition currency differs from the sale currency and no FX rate exists for today — the error names the missing pair and links to Finance → FX Rates.
- Server errors (`not_authorized`, `reason_required`, `invalid_selling_price`, `sale_not_found`) are mapped to plain-language messages instead of raw codes.

## 3. Pricing breakdown / impact preview

A collapsible section in both the List-for-Sale form and the Edit Pricing dialog:

- **How the entry price is built**: seller (purchase price), transport / delivery, crane / offloading — each with amount, currency, supplier and invoice number, and a note for any excluded void/credited invoice; total at the bottom, with a link to the container to change it.
- **What will change on save** (before posting): old vs new entry price, old vs new selling price, old vs new markup, the COGS delta, the revenue delta, and whether the customer invoice will be restated (with its new total and remaining balance). For sales not yet marked sold the preview states that no ledger entry is posted.

## 4. Audit trail export

New "Repricing audit" panel on the Container Sales page (admin only):

- Filters: date range, depot (via the container's depot), container number / sale number search.
- Columns: date, actor, sale number, container, reason, old vs new entry price, old vs new selling price, old vs new markup, COGS delta, revenue delta, currency, invoice updated, journal reference.
- Download as CSV and XLSX for the filtered set.

## Technical notes

- Rows come from `finance_audit_log` where `entity_type = 'container_sales'` and `action = 'pricing_update'`, unpacking `before_data` / `after_data` / `summary`; joined to `container_sales` → `containers` for container number and depot (`container_sales` itself has no depot column). Journal reference resolved from `accounting_transactions` on `reference_type = 'container_sale'` / `reference_id`.
- New `src/lib/sale-repricing-audit.ts`: query + row-flattening + CSV/XLSX export, using the existing `exportCSV` / excel-io helpers.
- New `src/lib/sale-pricing-validation.ts`: pure `validateRepricing({ entry, selling, acqMixed, acqCurrency, saleCurrency, confirmLoss })` returning blockers/warnings, with unit tests (zero entry, loss, mixed currency, FX missing).
- New components under `src/components/sales/`: `BulkRepriceDialog.tsx`, `PricingBreakdown.tsx`, `RepricingAuditPanel.tsx`; `ContainerSales.tsx` wires them in and adds row selection via `useRowSelection`.
- Breakdown data reuses `useContainerAcquisition` / `getContainerAcquisitionBreakdown`; the bulk dialog fetches breakdowns for the selected containers in one batched query rather than one hook per row.
- No change to `set_sale_pricing` behaviour; only additional client-side gating and a read-only audit query. FX availability checked with the existing `getFxRate` helper.
