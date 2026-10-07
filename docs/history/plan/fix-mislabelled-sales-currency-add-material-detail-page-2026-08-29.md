# Fix mislabelled sales currency + add Material Detail page

## 1. Currency relabelling (data correction)

Verified in the database: 21 customer invoices belonging to KES customers carry USD or EUR tags while the amounts are clearly KES magnitudes (e.g. 320,060 tagged USD; 540,000 tagged EUR). The same mislabelling exists on the source records and their ledger postings.

Confirmed scope:
- 18 invoices tagged USD, 3 tagged EUR, all for KES customers
- 15 container sales tagged USD (KES-sized selling prices)
- 13 conversion jobs tagged USD
- Related payments (2 EUR, part of the USD set) and their accounting transactions

Fix: relabel to KES, keeping every number exactly as recorded. No FX conversion, no value change.

Deliberately excluded (these are genuine foreign currency and stay untouched):
- JJ MES DMCC acquisition/supplier liabilities in USD
- Repatriation transfer/handling invoices in USD
- The two invoices for the customer whose own currency is USD

Approach:
- Scope the correction by an explicit list of the affected records (invoices, container sales, conversion jobs, payments) plus the accounting transactions linked to them, so nothing outside the audited set is touched.
- Log the before/after currency for each corrected row into the existing finance audit trail so the change is traceable.

Prevention: the container-sale and conversion invoicing paths will stamp the customer's currency (falling back to the organisation currency) instead of inheriting an unrelated currency, and a Finance Data Health check will flag any future invoice whose currency differs from its customer's currency.

## 2. Material Detail page

New route `/materials/:id`, opened by clicking a row on the Materials page. Read-only overview with tabs:

- **Overview** — name, category, unit, active state, current stock (available/reserved), average unit cost, reorder point, VAT flag, and last movement date.
- **Sources & supplier cost comparison** — every supplier that has quoted or supplied this material, from purchase order lines and goods receipts: supplier, last purchase date, quantity, unit price, landed unit cost, and a per-supplier average so the cheapest and dearest source are obvious.
- **Movements** — full movement history (receipt, issue, return, adjustment, scrap) with date, type, quantity, unit cost, reason/note, actor, and links to the source goods receipt or conversion job.
- **Project / job consumption** — net quantity and cost consumed per conversion job and per project, with links, plus a total consumed-to-date figure.
- **Procurement** — open material requests and purchase orders for this material with their status.

No insurer field.

## Technical notes

- One migration: the audited currency relabel, an update to the two invoice-generating functions to stamp the customer currency, and the new Data Health finding.
- New page `src/pages/inventory/MaterialDetail.tsx`, route registered in `src/App.tsx` under the existing procurement module guard; row click wired up in `src/pages/Materials.tsx`.
- Supplier comparison and consumption tabs read from `po_items` + `purchase_orders`, `goods_receipt_items`, `material_movements` and `conversion_materials`; a small aggregate view can back the supplier comparison if the client-side grouping gets heavy.
- All money rendered with an explicit currency argument via `formatMoney`.
