# Fix container cost on conversion jobs (CNV-PETER-0001)

## What is wrong

Container BSIU9315346 has three live acquisition invoices:

| Invoice | Type | Amount | FX to KES | KES value |
|---|---|---|---|---|
| PINV-20260807-b11f36 | Seller purchase | USD 1,700.00 | 130.8 | 222,360.00 |
| PINV-20260823-f0e777 | Transport | KES 40,000 | 1 | 40,000.00 |
| PINV-20260823-27e6a5 | Crane / offloading | KES 4,000 | 1 | 4,000.00 |

True acquisition cost in job currency (KES) = **266,360.00**, not 45,700.

Two separate defects produce the numbers on screen:

1. **No FX conversion in the purchase/services split.** `splitAcquisition` in `src/lib/container-acquisition-edit.ts` adds up raw `total_amount` values regardless of the invoice currency, so USD 1,700 was treated as KES 1,700. The attach dialog wrote those raw values into the job, giving "Purchase KES 1,700.00 / Transport & crane KES 44,000.00" and a Container KPI of 45,700. (The database function `container_acquisition_split` already converts correctly — only the frontend path does not.)
2. **Stale legacy header fields.** `attach_container_to_conversion` only mirrors costs onto `container_conversions.container_cost` / `transport_offloading_cost` when the job had no container at all. That job still holds the old 0 / 40,000 values, which is why the Overview panel shows "Container Cost 40,000.00 — Purchase 0.00 + Transport 40,000.00" while the KPI strip shows 45,700.

## The fix

**1. Convert currencies when splitting acquisition costs**
- Make `splitAcquisition` FX-convert each invoice into the requested base currency (reuse the same rate logic already used by `computeAcquisitionTotal` / `base_amount`), so `purchase + services` always equals `total`.
- Surface the source currency and applied rate in the breakdown so the attach dialog and cost panel can show "USD 1,700 @ 130.8 = KES 222,360".
- If an invoice's currency has no usable rate, return it as unconverted and flag it rather than silently understating cost.

**2. Keep the job header in sync with attached containers**
- Update `attach_container_to_conversion` (and the detach counterpart) to always recompute `container_conversions.container_cost` and `transport_offloading_cost` as the sum over `conversion_containers` for that job, instead of only writing them on first attach.
- Overview's "Container Cost" then always matches the "Container" KPI.

**3. Compute attach costs server-side**
- In the attach dialog, pass the converted values from `container_acquisition_split(container_id, job_currency)` rather than raw client sums, so the stored snapshot is authoritative and currency-correct.

**4. Repair the existing job**
- Re-run the cost refresh for CNV-PETER-0001 so the link row becomes purchase 222,360.00 / transport & crane 44,000.00 (total KES 266,360.00) and the header matches. The existing "Refresh from invoices" / Cost alignment tooling will then also report correct drift for any other job affected by the same USD-as-KES bug.

## Technical notes

- Files: `src/lib/container-acquisition-edit.ts` (splitAcquisition + breakdown type), `src/pages/ConversionDetail.tsx` (attach dialog, cost card labels), plus a migration updating `attach_container_to_conversion` and a header-resync helper.
- No schema changes required; `conversion_containers` and `supplier_invoices` already carry everything needed (`fx_rate`, `base_amount`).
- Grants/RLS unchanged: `container_acquisition_split` is already `SECURITY DEFINER`; it needs an execute grant to `authenticated` so the client can call it from the attach dialog.
