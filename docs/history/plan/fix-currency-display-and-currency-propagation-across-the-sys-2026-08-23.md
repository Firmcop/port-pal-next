# Fix currency display and currency propagation across the system

## What is actually wrong

The data is correct — the display is not.

Verified in the database: the acquisition purchase orders shown in your screenshot (`PO-ACQ-TCNU9465154-…`, `PO-ACQ-WEDU3042065-…`) are stored as **USD 1,700 / USD 700**, and their supplier invoices are USD with FX rate 130.8 and a KES base amount. No PO in the system has a missing currency (0 of 386).

The screen is rendering them as KES because the "Purchase orders awaiting payment" table calls the money formatter without passing the row's currency, so it silently falls back to the organisation currency (KES). The same currency-blind pattern exists in a handful of other places.

A second, real data risk: every vendor payment recorded so far is stamped KES, because the payment routine never copies the purchase order's currency onto the payment. Paying a USD purchase order today would record a KES payment.

## Changes

### 1. Purchase orders awaiting payment (Payments page)
- Load `currency` with each purchase order and render Total / Paid / Balance in that currency.
- When the list mixes currencies, subtotal per currency instead of one blended number.

### 2. Pay supplier dialog
- Load and display the purchase order currency; show amounts in it.
- Warn when the selected bank/cash account is in a different currency, and capture the FX rate used for that payment (same manual-or-auto rate control already used on acquisition costs).

### 3. Vendor payment recording
- Update the payment routine so a payment inherits the purchase order's currency, and stores the FX rate plus base-currency amount when they differ, so the ledger and bank balance stay truthful.
- Backfill check for the 37 existing vendor payments: all are against KES purchase orders, so no value changes — only confirm and leave an audit note.

### 4. Purchase Orders page
- The list and detail currently label amounts with the *supplier's* currency (or the org default) rather than the purchase order's own `currency` column. Switch both to the purchase order currency, which is the value the invoices and ledger were built from.

### 5. System-wide sweep
Fix the remaining currency-blind money renders found in the audit:
- `Payments` (3 cells), `PayPoDialog` (3), `PurchaseOrders` list/detail, `PortalDashboard` outstanding balance, `Reports` KPI cards and charts, `FinancialSummary` chart tooltips.

For reporting screens that intentionally aggregate (Reports, Financial Summary, portal outstanding balance), amounts stay in the organisation base currency but get an explicit "in KES (base)" label so a USD-sourced figure is never read as a raw USD number.

### 6. Currency consistency check in Finance Data Health
Add three findings so drift is caught automatically in future:
- vendor payment currency different from its purchase order currency
- supplier invoice currency different from its purchase order currency
- foreign-currency documents with no FX rate or base amount recorded

## Technical notes
- Formatter: `formatMoney(amount, currency)` in `src/lib/app-settings.ts` falls back to `_state.currency` when the second argument is omitted — that fallback is the root cause. Callers get the explicit currency; no change to the formatter itself.
- Database: one migration updating `record_vendor_payment` to set `currency`, `fx_rate`, `base_amount` from the purchase order, and one view update for the `v_finance_data_health` findings.
- No existing amounts are rewritten; this is display plus forward-looking stamping.
