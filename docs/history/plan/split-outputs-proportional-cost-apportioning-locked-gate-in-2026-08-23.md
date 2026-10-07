# Split outputs: proportional cost apportioning, locked gate-in costs, verifiable breakdown

Building on the split-cost work already in place (children inherit from the mother unit, child acquisition invoices are blocked, `recompute_split_output_costs` restates completed jobs), this adds proportional apportioning, hard server-side validation, and a visible explanation of the math.

## 1. Proportional apportioning

- The mother's total split cost = purchase + transport & crane + materials + labour + services + sub-assemblies on the job.
- Allocation weight per child = its size (length in feet), so 2 x 10ft from a 20ft split evenly, while a 20ft + 10ft pair from a 30ft splits 2:1.
- Rounding: shares are rounded to the currency's minor units and the residual cent is added to the largest child so the parts always sum exactly to the mother total.
- Each child's `acquisition_cost` is set to its share; `conversion_output_costs` keeps the per-component snapshot (purchase / transport & crane / materials / labour) so the breakdown stays inspectable.
- Applies both at job completion and when an admin restates shares on an existing job.

## 2. No gate-in costs on split children

- Acquisition cost editing is disabled for any container with a parent: the edit dialog on Container Detail, Inventory and the Acquisition Backfill screen show a read-only notice ("Cost inherited from split of <mother number>") instead of the purchase / transport / crane fields.
- The child's cost panel shows only the inherited share — no gate fee, transport or crane lines.
- The existing database guard that blocks acquisition invoices for children stays; the UI now matches it instead of letting a user try and fail.

## 3. Server-side allocation validation

- Before writing allocations, the completion and restate routines check that the sum of child shares equals the mother total to the cent, and that every produced child has a size and belongs to the job. A mismatch aborts the whole operation with a clear message rather than saving a partial allocation.
- Editing a planned output (size, height class, count) revalidates: the edit is rejected when the resulting output mix cannot be allocated (zero children, missing size, planned count below what was already produced).
- Every rejection message names the discrepancy (expected total vs allocated total) so it can be acted on.

## 4. Cost breakdown explanation panel

On the split job's Outputs tab, the cost share card gains an expandable "How this was calculated" section showing:

- Mother container number, its purchase and transport & crane amounts, plus job materials / labour / services — with the source currency, the rate used and the converted base amount for any component billed in a foreign currency.
- The allocation method in words ("size-weighted, 3 units, weights 10/10/20") and the weight and share for each child in a small table.
- The reconciliation line: sum of shares vs mother total, with a green tick when they match and a warning with the difference when they drift, plus the Restate cost shares action.

Each child's own card repeats a one-line provenance note: "Share of CNV-… split of <mother number> — X% of <total>".

## Technical notes

- Migration updates `complete_conversion` (split branch) and `recompute_split_output_costs` to use size-weighted allocation with residual assignment, and adds the sum-equals-total assertion in both; `update_conversion_output` / `delete_conversion_output` gain the mix validation.
- `container_acquisition_split` already reads `conversion_output_costs` for children; the snapshot gains the fields the panel needs (mother number, weights, per-component base amounts, fx rate used).
- Frontend: `SplitCostShareCard` and `OutputCard` in `src/components/conversions/ConversionExtras.tsx` for the breakdown panel; `EditAcquisitionCostDialog.tsx`, `AcquisitionCostPanel.tsx`, `Inventory.tsx` and `AcquisitionBackfill.tsx` for the child lock-out, driven by `parent_container_id`.
