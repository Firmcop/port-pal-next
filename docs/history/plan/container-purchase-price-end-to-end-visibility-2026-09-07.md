# Container purchase price: end-to-end visibility

Make the real purchase price of every container follow it from intake to the job, the EIR and the supplier report, so lower-than-usual prices are visible everywhere instead of hidden.

## 1. Purchase price on the EIR and in job variance

- The reference rate (20ft = USD 700, 40ft = USD 1,700) becomes the "EIR rate" benchmark, read from one shared place instead of being hard-coded in a backfill helper.
- Gate-in EIR records store the container's actual purchase price and the reference rate that applied, so a reprint always shows what was really paid alongside the expected figure.
- The EIR printout gains a small cost line: purchase price, reference rate, and the difference (labelled discount or over-rate).
- Conversion jobs already snapshot each attached container's cost; that snapshot keeps using the actual purchase price, and the job's budget vs actual figures include container cost variance, not just materials.

## 2. Container rate table on the job page

A new card on the conversion job page listing, per attached container:

- container number and size
- actual purchase price (live from its acquisition invoices)
- EIR/reference rate for that size
- variance amount and percentage
- totals row for the whole job, plus the same figures rolled into the project the job belongs to

Rows flag drift when the stored job snapshot differs from the live acquisition cost, reusing the existing re-sync action.

## 3. Cost journey on the container page

Added as new sections on the existing container detail page (no separate page):

- Purchase: supplier, purchase invoice(s), amount, currency, FX rate, any correction history with reasons
- Transport and offloading invoices
- Gate events: each EIR with type, date, owner at issue / new owner, gate fee
- Conversion: job(s) the container fed, the cost carried in, split children and their apportioned share
- Sale/lease: sale price, customer invoice, margin against total acquisition cost
- A single summary strip: total acquisition cost, cost added, revenue, margin

## 4. Supplier purchase-price dashboard (Finance)

New Finance screen "Supplier purchase pricing":

- grouped by supplier, then by container size (20ft / 40ft and variants)
- per group: number of containers, average price, min/max, reference rate, total variance vs reference
- expandable list of individual containers with their price, variance and invoice link
- filters by date range, supplier, size and currency; CSV export
- currency handled per invoice; mixed currencies converted using existing FX rates, with the source currency shown

## Technical notes

- Shared reference rates move from `src/lib/acquisition-backfill.ts` into a small config module used by intake validation, EIR, the job rate table and the dashboard.
- Database work: add `purchase_price_snapshot`, `reference_rate` and currency columns to `eir_records`, populated on gate-in creation; a read-only reporting function `supplier_purchase_price_variance()` for the dashboard; and `container_cost_journey(_container_id)` returning the grouped history for the container page. All read functions are security-definer with organization scoping consistent with existing finance functions.
- Frontend: new `ContainerRateTable` component on `ConversionDetail.tsx`, new sections on `ContainerDetail.tsx`, new page `src/pages/finance/SupplierPurchasePricing.tsx` with a route under `/finance/supplier-pricing` restricted to org owner, admin and accountant.
- Existing acquisition-cost editing, drift re-sync and duplicate-invoice logic are reused unchanged; no pricing rules are enforced, the reference rate stays a benchmark only.
