# Conversion jobs: align container costs with acquisition invoices

## What I found

Conversion jobs store each attached container's cost as a **snapshot** in `conversion_containers` (purchase + transport/offloading), captured at the moment the container is attached. Since the recent acquisition work (JJ MES DMCC purchase invoices, Gataru offloading, transport backfill, currency/supplier corrections), those snapshots no longer match the invoices.

Checked against the live purchase/transport/crane invoices: **all 29 container links on conversion jobs are out of step.** Examples:

- TGHU 8339174 — job holds 264,000 purchase / 0 transport; invoices say 222,360 purchase (USD 1,700 @ 130.8) + 44,000 transport & crane.
- TRKU 2030787 — job holds 0 / 0; invoices total 35,200.
- Several jobs carry the whole cost in "purchase" with transport at zero, so the purchase/transport split is also wrong even where totals are close.

Two more gaps:

1. Quotes converted into conversion jobs attach containers with **0 cost** (the quote→job path passes zeros instead of the acquisition figures), so those jobs start understated.
2. Nothing re-syncs a job when an acquisition invoice is later corrected — the job silently keeps the old number, and job cost, margin and the project P&L stay wrong.

New jobs created from the Conversions page and containers attached/swapped on the job page **do** pull the live acquisition figures correctly, so the intake path is fine — it's history and drift that are broken.

## Plan

### 1. Show the truth on the job page
For every attached container, display the stored cost next to the live acquisition total and flag a difference with an amber "out of date" badge, including the breakdown (seller / transport / crane, with currency and FX rate used).

### 2. "Refresh from acquisition invoices" action
- Per container row and a bulk "Refresh all" on the job header.
- Recomputes purchase and transport/offloading from the container's live invoices, writes the new split, and posts the ledger delta through the existing cost-adjustment path so WIP/COGS and the project P&L move with it.
- Requires a reason, admin-only, and logs to the finance audit trail like other cost corrections.
- Blocked on completed/cancelled jobs unless admin, matching current rules.

### 3. Fix the quote→job path
Attach containers using their live acquisition purchase and service totals instead of zeros.

### 4. One-off correction of the 29 existing links
An admin review screen (same shape as the acquisition backfill screen) listing every job container with stored vs live cost and the delta, with a preview before posting, then apply in one run so historical jobs and project margins are restated.

### 5. Overall conversion page improvements
- **Cost card**: show the four cost buckets (containers, materials, labour, services) with each as a share of total, and quoted price vs actual cost vs margin % in one line, currency-formatted from org settings rather than raw numbers.
- **Stale-cost warning strip** at the top when any attached container is out of date, so the margin shown isn't trusted blindly.
- **Currency consistency**: display every figure with the org currency symbol and show the source currency + rate on acquisition-derived amounts (some rows currently render bare numbers).
- **Container panel**: show owner, size, status and a link to the container's acquisition invoices, so the cost is traceable in one click.
- **Job list**: add a "cost out of date" indicator column so drift is visible without opening each job.

## Technical notes

- Reuse `container_acquisition_total` / the acquisition breakdown helper for the live figures; split by invoice `reason` (`purchase` vs `acquisition_transport` + `acquisition_crane_offloading`).
- New RPC `resync_conversion_container_costs(_conversion_id, _container_id, _reason)` (admin-only, SECURITY DEFINER) reusing `adjust_conversion_costs` internals for the ledger delta, plus a preview function returning stored vs live per link.
- `src/lib/quote-conversion.ts`: pass real costs to `attach_container_to_conversion`.
- UI touches: `src/pages/ConversionDetail.tsx`, `src/pages/Conversions.tsx`, `src/components/conversions/ConversionExtras.tsx`, plus a new resync review screen.
