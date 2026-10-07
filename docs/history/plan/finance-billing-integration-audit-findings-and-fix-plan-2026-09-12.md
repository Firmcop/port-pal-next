# Finance & Billing integration audit — findings and fix plan

I queried the live ledger and each module's documents. Below is what the data actually shows, then what I propose to fix.

## What the audit found

### 1. The ledger does not balance (confirmed)
Total debits and credits differ in both currencies:

| Currency | Debits | Credits | Out by |
|---|---|---|---|
| KES | 61,759,909 | 66,874,057 | 5,114,148 |
| USD | 3,180,233 | 3,716,753 | 536,520 |

The imbalance comes from three sources that post only one side of the entry:
- Purchase invoices (480 entries): credit the supplier liability but never debit container stock — out by 9,534,600 KES and 536,520 USD.
- Container sales (122 entries): post revenue and cost of sale but no receivable/stock reduction — out by 2,240,706 KES.
- Conversion jobs (5 entries): out by 897,862 KES.

### 2. Container sales revenue is counted twice
All 18 sold containers post revenue once when the sale is recorded and again when the sale's invoice is raised: 8,426,020 from sales plus 4,522,825 from invoices. Reported income is overstated.

### 3. Two large "auto-balancing" journals are hiding the problem
7,378,170 and 180,310 were posted to "FX gain/loss" in July by the Data Health auto-balance button. They are not FX at all — they are the plug for the missing entries above, and they distort the profit and loss.

### 4. Customer balances don't tie out
Open invoices total 11,910,828 but the receivables control in the ledger reads 7,419,233 — a 4.49m gap. Supplier balances tie closely (53k difference), so payables are healthy.

### 5. Modules not feeding finance at all
- **Logistics**: 4 trip revenue records and 6 transport orders exist, none post revenue to the ledger. Trip costs (fuel, tolls, driver allowance) do post. So logistics shows cost with no income.
- **Goods receipts**: 74 of 90 receipts have no stock/accrual posting. Only 16 hit the ledger.
- **Fixed assets**: 3 assets registered, no depreciation ever run — no depreciation expense in the accounts.
- **Maintenance & repair**: no repair lines exist, and no repair billing path to invoices.
- **Gate operations**: no equipment receipt currently carries a gate fee, so gate income is effectively nil.
- **Leasing, expense claims, petty cash**: no records yet — nothing to reconcile, but also no posting path proven.

### 6. Modules that are correctly wired
Customer invoices, customer payments, supplier payments, operating expenses, payroll/payslips, weekly attendance to jobs and cost of goods, stock adjustments, loans and trip costs all post balanced entries. Payroll reaches jobs, projects and cost of goods correctly. Only 2 invoices are unposted.

### 7. Other data-quality gaps
- 24 purchase-invoice and 25 sale entries are not mapped to a chart-of-accounts code, so they fall outside the trial balance by account.
- 24 supplier payments, 20 invoices and 20 customer payments have no exchange rate stored, so base-currency totals are unreliable.
- Loan opening balances were charged to equity rather than to the bank/asset that received the money.

## The fix plan

### A. Make every posting two-sided
- Purchase invoices: add the stock/expense debit so each invoice posts in full. Correct all 480 historical entries.
- Container sales: post the receivable and the stock reduction so the sale balances.
- Conversion jobs: close the 897,862 one-sided gap.

### B. Remove the double-counted sale revenue
- Sale revenue becomes a single posting: the invoice is the revenue document; the sale record posts cost of sale and stock movement only. Reverse the 4.5m duplicate for the 18 affected units with an audited correction journal.

### C. Reverse the two fake balancing journals
- Reverse both "auto-balancing" entries once A and B are in place, and restrict the Data Health auto-balance button so it can only post a genuine, explained rounding difference — never a multi-million plug.

### D. Connect the missing modules
- Logistics: trip revenue and completed transport orders raise a customer invoice and post income, matched against the trip's costs so trip profitability is real.
- Goods receipts: every receipt posts stock in and a goods-received-not-invoiced accrual that clears when the supplier invoice arrives. Backfill the 74 unposted receipts.
- Fixed assets: monthly depreciation run posting depreciation expense and accumulated depreciation; disposal posts gain or loss.
- Maintenance & repair: completed repairs bill the container owner and post repair income and cost.
- Gate operations: gate fees on equipment receipts post income and flow into the owner's invoice.

### E. Reconciliation and control screens
- New **Finance Control Room** page: trial balance by currency, customer and supplier control accounts against their open documents, and a module-by-module feed status (documents raised vs documents posted) so a gap shows up the day it happens.
- Extend the existing Data Health card with the new checks: one-sided entries, duplicate revenue, unposted receipts, missing exchange rate, missing account code.
- Nightly check that flags any new unbalanced or unposted document.

### F. Data clean-up
- Map the 49 unmapped entries to chart-of-accounts codes.
- Fill missing exchange rates from the rate table on the document date; list anything with no rate available instead of guessing.
- Reclassify the loan opening balances from equity to the receiving bank account.

## Technical notes
- Corrections are posted as new audited journals (reference type `audit_correction_2026_09`), never by editing or deleting history; every correction carries a reason and the batch id.
- Changes to `acquire_container_from_owner`, `record_container_service_invoice`, container sale posting, `receive_po_with_variances` and the goods-receipt path to add the missing leg.
- New functions: `finance_trial_balance(_currency)`, `finance_module_feed_status()`, `post_goods_receipt_accrual(_receipt_id)`, `post_depreciation_run(_period)`, `post_trip_revenue(_trip_id)`, `reverse_duplicate_sale_revenue(_batch)` — all organization-scoped, security definer, granted to authenticated only.
- New page `src/pages/finance/ControlRoom.tsx` plus route guarded to org_owner / admin / accountant; extra findings added to `v_finance_data_health` and `DataHealthCard.tsx`.
- Backfills run in reviewable batches with a preview before commit, following the pattern already used for acquisition backfill.
