# Fix stock consumption, project P&L, currency and AP allocation

## What I verified in the live data

1. **Conversion material consumption never touches stock.** Every row in `conversion_materials` has `material_id` empty — the Materials tab on a conversion job lets you pick a catalogue item but then saves only the free-text description. There is also no trigger on `conversion_materials`, so even a linked row would not move stock. That is why RHS 100*50*2.5 still shows 93 on hand after two jobs consumed it.
2. **Projects are empty because nothing is tagged to them.** Most conversion jobs have no `project_id` at all (only 2 of the last 10 do), and no `accounting_transactions` row carries a `project_id`. The `project_pnl` view sums ledger rows by `project_id`, so it correctly returns zeros.
3. **Currency is stamped, not converted.** Supplier invoice PINV-20260820-a28505 is USD 1,650, but its ledger entry is "KES 1,650" — the org-currency trigger overwrites the document currency and no FX conversion happens. `purchase_orders` has no currency column at all, so POs silently inherit KES.
4. **Purchase invoices cannot be edited**, and **vendor payments are attached to a PO only** (`vendor_payments.po_id`), never to a supplier invoice. `supplier_invoices.paid_amount` is 0 on all 15 invoices, and `payment_allocations` only supports sales invoices.

## The fix

### A. Materials consumption moves stock
- Conversion Materials tab saves the selected `material_id` (custom free-text remains allowed and clearly marked "non-stock").
- Consumption posts through the existing `post_material_stock` path: adding/raising `qty_used` deducts stock and writes a `material_movements` row (source = conversion job); reducing or deleting reverses it.
- Warn when consumption exceeds available stock (block for stock-linked lines unless the job is explicitly allowed to go negative).
- One-off reconciliation: match existing free-text conversion lines to catalogue materials by name, show the proposed matches in a review screen, and post the backdated consumption once confirmed — so RHS 100*50*2.5 and the rest land on the right balances.

### B. Projects roll up conversion data
- Conversion jobs get a project either automatically (from the quote/customer job) or via a "Link to project" action; existing jobs can be linked in bulk.
- Every posting from a conversion (revenue, COGS, material/labour cost, expenses, invoices) carries the job's `project_id` into `accounting_transactions`, so `project_pnl` fills in.
- Project detail gains a Costs breakdown (materials, labour, container cost, other) sourced from the linked jobs, plus backfill of `project_id` on existing transactions traceable to a job.

### C. Currency held end-to-end
- Add `currency` to `purchase_orders`, defaulted from the supplier's registered currency (not the org currency).
- Ledger entries keep the **document** currency plus `fx_rate` and a base-currency amount, instead of relabelling the foreign amount as KES. The org-currency trigger stops overriding a currency that came from a customer/supplier document.
- Reports and dashboards total in base currency using the stored rate; document views show the original currency.
- Correct existing rows: the JJ MES acquisitions and their PINV invoices get their true USD currency and the matching FX rate, with an audit note.

### D. Admin edit of purchase invoices
- Admin/accountant-only edit on a supplier invoice (dates, reference, lines, amounts, currency) with a mandatory reason.
- Every edit writes an audit row (who, when, before → after, reason) shown on the invoice, and re-posts the linked ledger entries so the ledger stays in step. Fully paid/closed invoices require an explicit override.

### E. Payments allocated to purchase invoices
- Extend allocations to AP: a vendor payment can be split across one or more supplier invoices, with `paid_amount` and status (unpaid / part-paid / paid) maintained automatically.
- "Auto-allocate" applies the payment to that supplier's open invoices oldest-first, leaving any remainder as an unallocated credit on the supplier account; the allocation is editable before confirming.
- Supplier statement view per supplier: invoices, payments, allocations, running balance and unallocated credit — the trail you asked for.
- Backfill: existing vendor payments linked to a PO are allocated to that PO's purchase invoice where the amounts allow, and flagged for review where they do not.

## Technical notes
- New `post_conversion_material_consumption` path reusing `post_material_stock`; trigger on `conversion_materials` for insert/update/delete of `qty_used`.
- `purchase_orders.currency`, `accounting_transactions` base-amount column populated via `get_fx_rate`; `set_currency_from_org` skipped when a document currency is supplied.
- `supplier_invoice_audit` table (org-scoped RLS + GRANTs) and `edit_supplier_invoice(_id, _patch, _reason)` SECURITY DEFINER RPC restricted to admin/org_owner/accountant.
- `ap_payment_allocations` (payment_id, supplier_invoice_id, amount, org) with RLS/GRANTs, `allocate_vendor_payment()` and `auto_allocate_vendor_payment()` RPCs, trigger maintaining `supplier_invoices.paid_amount`/`status`.
- Backfill migrations for material consumption, `project_id` on transactions, JJ MES currency correction, and PO→invoice payment allocation, each producing a reviewable exception list rather than silent changes.
