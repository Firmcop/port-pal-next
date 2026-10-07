# Raise missing acquisition purchase invoices (Gataru offloading + JJ MES DMCC)

Two backfills against real inventory, both run as reviewable batches with a single reason recorded in the acquisition audit trail.

## What the data shows now

- 63 containers still carry owner "JJ MES DMCC". 18 of them are linked to a repatriation, so **45 remain to be invoiced: 44 x 40ft and 1 x 20ft**. None of the 45 has a purchase invoice.
- 15 JJ MES purchase invoices already exist. One of them, **BSIU9315346 (40ft), was billed at the 20ft rate of USD 700**. Three 40ft invoices at USD 1,650 stay as they are.
- Only 5 offloading invoices exist in the whole system. **123 containers have none: 83 x 40ft and 40 x 20ft.**
- One JJ MES container is linked to a repatriation but still shows status `available` — it is excluded from invoicing and reported as a data inconsistency.

## Batch 1 — Gataru Enterprises, crane / offloading

- Vendor: Gataru Enterprises (existing supplier, KES).
- Rate: KES 4,000 per 40ft, KES 2,000 per 20ft.
- Applies to every container with no offloading invoice: 83 x 40ft + 40 x 20ft.
- Expected value: KES 332,000 + KES 80,000 = **KES 412,000** across 123 invoices.
- Currency is KES, the same as the home currency, so no exchange rate is involved.

## Batch 2 — JJ MES DMCC, container purchase

- Vendor: JJ MES DMCC (existing supplier, USD).
- Rate: USD 1,700 per 40ft, USD 700 per 20ft.
- Applies to the 45 non-repatriated JJ MES containers: 44 x 40ft + 1 x 20ft.
- Expected value: USD 74,800 + USD 700 = **USD 75,500**.
- Exchange rate: **130.8 USD to KES**, entered manually and stored on each invoice as a manual rate so later automatic revaluation leaves it untouched. Home-currency value: KES 9,875,400.

## Batch 3 — correction

- BSIU9315346: adjust its existing purchase invoice from USD 700 to USD 1,700 (40ft rate), with the reason recorded on the invoice and in the container's acquisition audit trail. If any payment is already allocated against it, the adjustment is reported instead of forced.

## How it runs

A one-off admin backfill screen (Inventory > bulk actions) with the three batches listed above. Each batch shows a dry-run table first — container number, size, vendor, amount, currency, rate — with a per-row status of "will create", "already invoiced", or "blocked", and a running total. Nothing is written until the batch is confirmed, and every write goes through the existing acquisition-cost RPCs so purchase orders, supplier invoices, payable ledger entries and the audit trail all stay in step.

## Inconsistency report

Shown on the same screen and downloadable as CSV:

- 1 JJ MES container linked to a repatriation but still `available` (excluded from Batch 2).
- BSIU9315346 mis-priced at the 20ft rate (fixed in Batch 3).
- 3 JJ MES 40ft invoices at USD 1,650 instead of 1,700 (left as-is, listed for the record).
- 1 offloading invoice against vendor "Crane Co" at KES 3,200 rather than Gataru at 4,000 (left as-is, listed).
- Owner-name drift on already-acquired containers: "Depot", "Firmcop Group ", "frd", "Firmcop Limited " and other variants, plus a supplier record named "Gataru Enterprises " with a trailing space.

## Technical notes

- Batches use `record_container_service_invoice` (offloading) and `acquire_container_from_owner` (purchase), both of which now accept an explicit exchange rate and mark it as manually set.
- Both RPCs are already idempotent per container and reason, so re-running a batch cannot double-invoice.
- The correction uses `set_container_acquisition_costs`, previewed through `preview_container_acquisition_costs` first.
- Repatriation exclusion is by presence of a row in `repatriations`, not by container status.
