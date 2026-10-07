# Make project material costs appear in the Profit & Loss

## What changes

Materials issued to a conversion job become a cost straight away, instead of staying hidden in stock until the container is sold.

- Issue materials to a job -> the value leaves Inventory and lands in Cost of Goods Sold on the P&L, dated the day of the issue.
- Return materials from a job -> the entry reverses, so the cost comes back out.
- Change a quantity or unit cost on a job's material line -> the difference is posted, so the P&L always matches the job's material total.
- All 569 existing issues (about 3.99M of material value) are posted as dated correction entries so the books catch up with reality.

## Avoiding double counting

Today, when a converted container is sold, the whole accumulated cost (materials + labour + container purchase) is posted as Cost of Goods Sold at that moment. If materials are also expensed at issue, the same money would be counted twice.

So the sale posting is adjusted: the portion of the sale cost that has already been expensed through job material issues is deducted, and only the remainder (container purchase price, and any cost not yet expensed) is posted at sale. The total cost charged over the life of a container stays exactly the same — only the timing moves earlier.

Labour is already expensed through payroll, so it is left as it is.

## Where you will see it

- **Profit & Loss** — a "Conversion Materials" line under Cost of Goods Sold, clickable through to the individual issues.
- **Conversion job Budget tab** — the posting status block confirms material cost is now in the ledger.
- **Balance sheet / Accounts** — Inventory drops by the same amount, so the books stay balanced.

## Technical detail

1. New SECURITY DEFINER function `post_material_consumption_to_ledger(_movement_id uuid)`:
   - For `material_movements` of type `issue` / `return` with a `conversion_id`, posts a balanced pair into `accounting_transactions`:
     Dr `cost_of_goods` / `cogs_conversion_materials` (GL 5020), Cr `asset` / `inventory`, amount `qty * unit_cost`, `reference_type = 'material_movement'`, `reference_id = movement id`, dated `created_at`.
   - Returns reverse the signs. Idempotent on `(reference_type, reference_id)`.
   - `SET search_path TO 'public'`, revoked from PUBLIC/anon, granted to authenticated.
2. AFTER INSERT trigger on `material_movements` calling the function, so the existing `post_conversion_material_consumption` -> `material_movements` chain feeds the ledger without changing conversion logic.
3. `post_container_sale_to_ledger` / the invoice-based sale COGS path: subtract already-posted `material_movement` cost for the container's originating conversion from `entry_price` before posting the COGS/inventory relief pair; skip the pair entirely when the remainder is zero.
4. Backfill script (`run_sql`, not a migration) posting all historical issue/return movements with `reference_type = 'material_movement'` and an `audit_correction_2026_09` marker in the description, dated to each movement's original date. History rows are not edited or deleted; every posting is logged to `finance_audit_log`.
5. Reconciliation query after backfill: total posted `cogs_conversion_materials` from movements must equal `sum(qty * unit_cost)` of issues net of returns, and Inventory must fall by the same figure.
6. No frontend changes are strictly required — P&L reads `v_account_balances`. The conversion Budget tab's `conversion_posting_status` RPC is extended to report material cost as posted.
