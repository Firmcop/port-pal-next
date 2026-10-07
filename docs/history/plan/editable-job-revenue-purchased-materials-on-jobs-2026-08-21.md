# Editable job revenue + purchased materials on jobs

## 1. Edit quoted price from more places

The admin-only revenue editor exists today only on the job's Overview tab, which is why it looks unavailable. No revenue override has ever been saved (audit table is empty).

- Add an **Edit revenue** row action on the Conversions (Jobs) list, opening the same dialog.
- Add the same action on Project Detail next to the project's revenue figure, targeting the project's linked conversion job.
- Keep the existing rules: admin / org owner only, reason of at least 10 characters, cancelled jobs blocked, change history recorded, balancing journal entry posted when revenue was already booked.
- Make the dialog prefill reliably from the current quoted price each time it opens, and refresh the list, project P&L and job costs after saving.

## 2. Purchased materials flow onto the job

Purchase orders can already be tagged to a conversion job, and carry an unused project field. Receiving a PO currently only adds stock — nothing appears on the job.

- **PO form:** add a **Project** selector alongside the existing **Conversion Job** selector. Picking a project filters the job list to that project's jobs; picking a job auto-fills its project. Both are saved on the PO.
- **Jobs page:** new "Purchased for this job" panel on the Materials tab listing received PO lines linked to the job (or to the job's project) that have not yet been allocated as job cost — material, quantity received, unit cost, PO number, receipt date.
- Each line (and a select-all bulk action) has **Allocate to job**, which creates the `conversion_materials` cost line at the received unit cost, marks the receipt line allocated, and issues the stock so on-hand quantity drops. Allocation is idempotent — a line can only be allocated once — and can be reversed by deleting the resulting material line.
- Job cost, margin and the project P&L rollup update immediately after allocation.

## Technical notes

- Frontend: reuse `src/components/conversions/EditConversionRevenueDialog.tsx` from `src/pages/Conversions.tsx` and `src/pages/finance/ProjectDetail.tsx`; gate with `useUserStaffRole().isOwnerOrAdmin`. Reset local state on `open`.
- `purchase_orders.project_id` already exists; wire it into the PO create/edit form and mutations in `src/pages/PurchaseOrders.tsx`, defaulting from the selected job's `project_id`.
- Add `allocated_conversion_material_id uuid` (nullable) to `goods_receipt_items` to mark allocated lines, with GRANTs unchanged (existing table).
- New RPC `allocate_receipt_line_to_conversion(_receipt_item_id uuid, _conversion_id uuid)`, `SECURITY DEFINER`, pinned `search_path`, `REVOKE EXECUTE FROM PUBLIC/anon`, granted to `authenticated`. It validates org + role (admin, production manager, procurement officer), rejects already-allocated lines, inserts the `conversion_materials` row at the received unit cost, writes a `material_movements` issue row so `materials.on_hand_qty` is reduced by the existing consumption trigger, and stamps the receipt line.
- Query keys to invalidate after allocation: conversion materials, `project-pnl`, `project-job-costs`, materials stock.
