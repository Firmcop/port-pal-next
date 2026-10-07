# Finance module audit and implementation plan

## What the data actually shows today

Verified against the live database and code:

1. **Multi-currency is half-done.** Of 494 ledger entries, only 71 carry an FX rate and a base currency. 166 USD and 8 EUR entries have no `fx_rate` and no `base_currency` at all, so any total that mixes them is arithmetically wrong. Documents are already currency-aware (`supplier_invoices`, `purchase_orders`, `payments` all have `currency`).
2. **AP payments have no currency at all.** `vendor_payments` has no `currency` or `fx_rate` column. All 31 USD supplier invoices (USD 2.24m) sit at `paid_amount = 0`; the only settled invoices are the 20 KES ones. A USD supplier payment cannot currently be recorded correctly.
3. **Allocation engine exists but is thin.** `vendor_payment_allocations` holds 20 rows totalling 1.13m against 1.27m of vendor payments — roughly 141k of payments are unallocated, with nowhere in the UI showing that as supplier credit, and no cross-currency allocation.
4. **Project rollup only partially lands.** All 36 conversion jobs now have a `project_id` and the `project_pnl` / `project_job_costs` views exist, but only 17 ledger rows out of ~494 carry `project_id`, so most project P&Ls still read near zero. `trg_stamp_project_from_conversion` fires on new rows only; history was never fully tagged.
5. **No inventory reconciliation view.** Material stock lives in `materials.on_hand_qty` with a `material_movements` ledger (218 receipts, 271 issues, 2 adjustments), but there is no page to compare the two. RHS 100*50*2.5 currently reads 0 on hand — correct after the consumption fix, but unverifiable from the UI.

Other audit findings worth noting: there is no unallocated-credit / supplier-statement surface, and no exception report for documents whose ledger currency differs from the document currency.

## The plan

### A. Inventory reconciliation page (`/inventory/reconciliation`)
- Stock-by-material table: on-hand qty, computed movement balance (receipts − issues ± adjustments), variance, unit cost, stock value.
- Variance highlighting, filters (variance only, zero stock, search by name/code), and CSV/Excel export.
- Drill-down drawer per material: full movement ledger with source links (goods receipt, conversion job, adjustment) and running balance.
- "Re-run reconciliation backfill" action (admin/accountant only) that re-derives on-hand from movements, writes any correction as an audit-stamped adjustment movement with reason, and shows a before/after diff — so RHS 100*50*2.5 can be re-confirmed at 0 after conversions.

### B. Complete the conversion → project rollup
- Backfill `project_id` on all historical ledger rows traceable to a conversion job, invoice, container sale, PO or supplier invoice tied to a project.
- Extend the stamping trigger to the same set of sources (currently only conversion-derived paths reliably tag), so new postings self-tag.
- Projects list gains revenue / cost / margin / burn columns from `project_pnl` + `project_job_costs`, not just the detail page.
- Project detail gains an "Untagged but related" panel listing documents linked to the job whose ledger rows lack `project_id`, with a one-click tag action.

### C. Lock FX per document and per payment
- Add `currency`, `fx_rate` and `base_amount` to `vendor_payments`; the rate is resolved at payment date via `get_fx_rate` and **frozen** on the row.
- Supplier invoices freeze their rate at issue date; the payment keeps its own rate, and the difference posts as a realised FX gain/loss line rather than silently distorting the invoice balance.
- Backfill `fx_rate` + `base_currency` on the 423 ledger rows missing them, using the rate effective on each transaction date; rows with no available rate are listed in an exceptions report instead of being guessed.
- New **Currency Integrity** report: documents and ledger rows where document currency ≠ posted currency, or FX rate missing — the JJ MES DMCC USD/KES trail becomes verifiable end to end.
- All finance dashboards and reports total in base currency using the stored rate; document screens keep showing the original currency.

### D. AP auto-allocation with a visible rule trail
- Allocation rules, applied in order and shown to the user: (1) explicit invoice chosen by the user, (2) invoice for the payment's PO, (3) same supplier, same currency, oldest open invoice first (FIFO), (4) remainder held as unallocated supplier credit.
- Cross-currency guard: a payment only auto-allocates to invoices of the same currency; a different currency requires an explicit rate and posts the FX difference.
- Each allocation row records which rule matched, by whom, and when; the payment screen shows "Allocated by rule: PO match / FIFO / manual" plus any remaining credit.
- Re-allocate and un-allocate actions, both audited; `supplier_invoices.paid_amount` and status stay maintained by trigger.
- **Supplier statement** page per supplier: invoices, payments, allocations, running balance, unallocated credit, exportable.
- Backfill: allocate the ~141k of currently unallocated vendor payments using the same rules, producing a reviewable exception list rather than silent changes.

## Technical notes
- New page `src/pages/inventory/StockReconciliation.tsx` + route guarded by the inventory module; `reconcile_material_stock(_material_id, _reason)` SECURITY DEFINER RPC posting adjustment movements.
- Migrations: `vendor_payments.currency/fx_rate/base_amount`; `vendor_payment_allocations.rule_applied` + unallocated credit view; backfills for `accounting_transactions.fx_rate/base_currency` and `project_id`.
- Extend `trg_stamp_txn_currency_from_source` to always resolve a rate via `get_fx_rate` and fail loudly (exception row) when none exists.
- `auto_allocate_vendor_payment(_payment_id)` returns the rule chain it applied so the UI can display it.
- New views: `material_stock_reconciliation`, `supplier_statement`, `currency_integrity_exceptions`. All new tables/views get org-scoped RLS plus GRANTs, restricted to admin / org_owner / accountant for the finance surfaces.
