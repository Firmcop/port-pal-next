# Container Sales: entry price from acquisition, editable selling price

Today the sale form splits cost into "Entry price" (seller invoice only) and "Transport & offloading", markup drives the selling price, and the Edit Costs dialog lets staff retype both costs — which can drift from the container's real acquisition invoices.

New behaviour:

- **Entry price** is always the container's **total acquisition cost** (seller + transport + crane/offloading) read live from its purchase invoices. Read-only everywhere, with the component breakdown shown underneath and a link to edit it on the container.
- **Selling price** is typed by the user.
- **Markup %** is calculated from the two ((selling / entry − 1) × 100) and shown read-only.

## List for Sale form

- Entry price field shows the fetched acquisition total, with a small breakdown line (seller / transport / crane) and a warning when nothing is recorded for that container.
- The separate "Transport & offloading" input is removed — it is part of the entry price now, so it is no longer added again to COGS.
- Selling price becomes an editable input; markup is derived and read-only.

## Edit dialog (per sale)

Renamed to **Edit Pricing**:

- Entry price is refreshed from the container's current acquisition invoices when the dialog opens, shown read-only with the breakdown and a "change on the container" link.
- Selling price is editable; markup recalculates live.
- Saving applies, for a sale already marked sold:
  - COGS adjustment for the difference between the old and the new entry price, in the sale's own currency.
  - Adjustment to the acquisition PO / purchase invoice to the container supplier when the entry price moved (the existing `adjust_container_acquisition` path, currency-correct).
  - The customer invoice is always updated to the new selling price — line amount, invoice total, tax and balance recomputed against payments already received.
- Every change writes an audit entry (who, when, old/new entry and selling price, reason).

## Technical notes

- New SECURITY DEFINER RPC `set_sale_pricing(_id, _selling_price, _reason)`:
  - Re-reads the container's live acquisition total via the existing acquisition invoice logic (excluding void/credited invoices) and writes it to `container_sales.entry_price`; `transport_offloading_cost` is set to 0 so it is not double-counted in COGS.
  - Recomputes `markup_percentage` from selling ÷ entry.
  - Posts the COGS delta to `accounting_transactions` using `container_sales.currency` (the current `adjust_sale_costs` hardcodes `'USD'` — fixed here) and calls `adjust_container_acquisition` for the entry-price delta.
  - Rewrites the linked `invoices` row (`invoice_id`) and its line item to the new selling price, recomputing total and balance; the revenue accounting entry is adjusted by the delta.
  - Writes a `finance_audit_log` row.
- `adjust_sale_costs` stays for backwards compatibility but the UI no longer calls it.
- `src/pages/ContainerSales.tsx`: form and `EditSaleCostsDialog` reworked as above, reusing `useContainerAcquisition` for the live breakdown; `markSold` COGS uses `entry_price` only.
- `src/lib/container-sale-pricing.ts`: single call site for the new RPC plus a pure `deriveMarkup(entry, selling)` helper, with unit tests (zero entry, negative markup, rounding).
