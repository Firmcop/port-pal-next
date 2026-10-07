# Repatriation currency, rate history, invoices and trip actuals

## What I verified first

- `repat_rate_cards` already has `currency`, `effective_from` and `effective_to`, and `lookup_repat_rate` already filters by an as-of date. So historical rate handling is half-built: what is missing is the *snapshot* on the repatriation and the date the lookup is asked for (it always uses today).
- `repatriations` has **no currency column**. Every screen therefore falls back to the org currency (KES), which is why USD 550 routes display as KES 550.
- `bill_repatriation_to_owner` already creates a draft invoice with gate-in / storage / handling / repat-fee lines, but it prices in the customer's or org currency and the repatriation row keeps no link back to the invoice.
- Trip costs already exist end to end: `logistics_trip_costs` (fuel with litres/unit price/odometer, tolls, driver allowance, parking, repairs, permits), an `AddTripCostDialog` on the trip page that posts each cost to the ledger, and `trip_cost_allocation` which splits those actuals between cargo and repat revenue. `repat_profitability` already consumes that allocation.

## 1. Currency per repatriation

- Add `currency` to `repatriations`, defaulted from the applied rate card (falling back to the org currency).
- The new-repatriation form and the execution dialog show and allow overriding the currency; applying a rate card sets it from the card.
- Rate Cards page keeps currency per route, so Nairobi→Kampala and Mombasa→Nairobi can be saved as USD.
- Every repat screen (list, cost dialog, execution dialog, profitability) formats using the repatriation's own currency instead of the org currency.
- Backfill: existing repats get the currency of the rate card that matches their route/size; unmatched ones stay on the org currency and are flagged in the profitability table so you can correct them.

## 2. Rate history by execution date

- Repatriations store the rate card used plus a snapshot of the rate and handling fee at the moment it was applied (`rate_amount_applied`, `handling_amount`, `rate_applied_at`).
- `apply_repat_rate_card` asks `lookup_repat_rate` for the rate effective on the repatriation's dispatch date (or request date when not yet dispatched), not today's date.
- Rate Cards page gets explicit "Effective from / Effective to" editing plus a "supersede" action that closes the current card and opens a new one from a chosen date, so editing a price never rewrites history.
- Completed repats are never repriced by a new card; the profitability view reads the snapshot.

## 3. Invoice per repatriated container

- Repatriations store `invoice_id`, populated by `bill_repatriation_to_owner`.
- Billing prices in the repatriation's currency and always emits two clearly-labelled lines: **Repatriation transport** (route shown, e.g. "Nairobi → Multiple Depot Kampala, 40ft") and **Handling**, in addition to any gate-in/storage lines.
- The repatriation list and the execution dialog show the invoice number, status and outstanding balance with a deep link to the invoice.
- Profitability revenue comes from the invoice when one exists (so credits and revisions are reflected) and from the charge/handling fields otherwise; a column shows Invoiced vs Not invoiced.
- Backfill: link the already-issued repat invoices to their repatriations by container + repat number.

## 4. Trip shared costs and actual margin

- Extend the trip cost form with the categories still missing for this workflow — **driver salary/wages** and **mileage-based cost** (distance x rate, prefilled from odometer readings) — alongside the existing fuel, tolls, allowance and repair entries.
- Add a "Shared costs" summary on the trip page: total actual cost, split between cargo and repat, with the allocation basis (pro-rata by revenue or equal) selectable and saved on the trip.
- Repat margin recalculates from those actuals: revenue (invoice) − direct repat costs − allocated share of trip costs. The profitability page gains a "Cost basis" indicator (estimated vs actual trip costs) so you can tell which repats have real trip data behind them.
- Cross-currency safety: when a trip's costs are in KES and the repat bills in USD, the allocation converts using the FX rate on the trip date and refuses silently mixing currencies.

## Technical notes

- Database migrations: new columns on `repatriations` (`currency`, `invoice_id`, `rate_amount_applied`, `rate_applied_at`), a `cost_allocation_basis` column on `logistics_trips`, updates to `apply_repat_rate_card`, `bill_repatriation_to_owner`, `preview_repatriation_bill`, `trip_cost_allocation` and `repat_profitability`, plus data backfills for currency and invoice links.
- Frontend: `src/pages/Repatriation.tsx`, `src/pages/repatriation/RateCards.tsx`, `src/pages/repatriation/Profitability.tsx`, `src/components/repatriation/RepatriationExecutionDialog.tsx`, `src/components/logistics/AddTripCostDialog.tsx`, `src/components/logistics/TripCostAllocationCard.tsx`, `src/pages/logistics/TripDetail.tsx`.
- Verification: apply a USD Nairobi→Kampala card to a test repat, complete it, confirm the invoice shows USD transport + handling lines, add fuel/tolls/driver costs to its trip, and confirm the margin moves accordingly — checked in the browser before hand-off.
