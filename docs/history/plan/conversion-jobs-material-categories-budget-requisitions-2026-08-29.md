# Conversion jobs: material categories, budget & requisitions

## What I verified in the live system

- Material categories are a free-text field and badly fragmented: `STEEL`/`Steel`/`steel`, `PLUMBING`/`Plumbing`/`plumbing`, `Interior`/`Interior `/`INTERIOR`/`interior`, `ELECTRICAL`/`ELECTICAL`/`Electricals `, etc. — 42 distinct spellings over ~280 active materials, plus 23 with no category. The job material picker is one flat alphabetical list of all of them, which is why it is unusable.
- Issue/Return do work at the stock level: `issue_material_to_job` / `return_material_from_job` write a `material_movements` row and a trigger updates `materials.on_hand_qty` and `conversion_materials.qty_used`. Two real defects: the "reason / note" typed in the dialog is never saved (the follow-up update uses `.order()/.limit()`, which Postgrest rejects on an UPDATE), and issuing does not change the line's `total_cost`, which stays at planned qty x unit cost.
- Nothing blocks out-of-stock usage today: the Add Material form only prints a warning ("stock will go negative") and inserts anyway. 58 materials are currently at a negative on-hand balance as a result.
- Conversion jobs have no budget: `container_conversions` has an unused `estimated_cost` column and no planned BOM, so "planned qty" on a material line is just typed by hand and variance is meaningless.
- Material requests exist (`material_requests`) but are description-only — no material link, no quantity shortfall context, and no route into Procurement (no PO/RFQ link).

## What will be built

### 1. Filterable, tidy material lists
- Normalise categories: a one-off data cleanup mapping all case/spacing variants onto a canonical set (Steel, Plumbing, Electrical, Paint, Interior, Fabrication, Hardware, Flooring, Cladding, Insulation, Roofing, Container Parts, Other), plus a normalising trigger so new spellings can't fragment again.
- Replace the plain dropdown in the job Materials tab with a searchable picker: type-ahead on name, a category filter, and an "In stock only" toggle. Each row shows unit, unit cost and live available quantity, with out-of-stock items visibly greyed.
- The materials table on the job gets a category column and a category/search filter bar, so a job with 40 lines can be inspected by trade.

### 2. Issue / Return fixed
- The reason and note typed in the dialog are saved on the movement (passed into the RPC instead of a follow-up update).
- Returns are capped at the quantity actually issued for that job and material.
- Issuing/returning refreshes the line's used quantity, cost and the job cost summary immediately.
- A per-line movement history (date, in/out, qty, reason, who) is viewable from the material row.

### 3. No use of material that is not in stock
- The RPC hard-blocks an issue beyond available stock for everyone (no admin bypass), with a clear "insufficient stock" message naming the shortfall.
- Adding a material line with a used quantity above available is blocked in the form; the button switches to "Raise requisition", pre-filled with material, shortfall quantity and the job.
- Out-of-stock catalogue items can still be added as planned BOM lines (planned qty), just not consumed.

### 4. Job budget and planned quantities
- The New Job dialog gains a required Budget step: a total intended cost, plus an optional planned material list (material, planned qty, estimated unit cost) that can be typed, pulled from the linked quote, or loaded from a saved BOM template.
- The budget is stored as job budget lines; the job header shows Budget vs Actual with burn %.
- When adding a material to the job, the planned quantity auto-fills from the budget line for that material (read-only unless overridden with a reason), so used-vs-planned variance is real.
- The existing Variance tab is extended to show, per material: planned qty, issued qty, returned qty, net used, qty variance, cost variance — plus unbudgeted lines flagged as "not in budget".

### 5. Requisition route when stock is short
- `material_requests` is extended with material link, required quantity, available-at-request quantity, needed-by date, urgency and a link to the resulting purchase order.
- Raising a requisition from the Materials tab creates the request against the job/project.
- Procurement gets a Requisitions queue: approve/reject with reason, then "Convert to PO" (or attach to an RFQ), which opens the PO form pre-filled with the material, quantity and the job/project cost link. On goods receipt the request is marked fulfilled and the job is notified that the material is now issuable.

## Technical notes

- Migration: `canonical_material_category()` + normalising trigger on `materials`; new `conversion_budget_lines` table (conversion_id, material_id, description, planned_qty, est_unit_cost, est_total, source) with org-scoped RLS and the standard GRANT block; `container_conversions.budget_amount`; `material_requests` gains `material_id`, `qty_available_at_request`, `needed_by`, `urgency`, `purchase_order_id`, `decided_by/at`, `decision_reason`.
- RPCs: `issue_material_to_job` / `return_material_from_job` gain `_reason`/`_note`, drop the admin negative-stock bypass, and returns validate against net issued; `raise_material_requisition`; `convert_requisition_to_po`; `conversion_budget_variance(conversion_id)` view/RPC for the Variance tab.
- Frontend: new `MaterialPicker` component (command palette style, category + in-stock filters) reused by the Materials tab, Procurement tab and requisition dialog; `ConversionDetail.tsx` Materials/Variance tabs updated; `Conversions.tsx` New Job dialog gains the budget step; new Requisitions screen under Procurement.
- Data cleanup runs as a separate data script after the migration; negative on-hand balances are listed in a short report rather than silently zeroed.
