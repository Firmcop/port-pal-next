# Material line audit, cost snapshots, live BOM status and Budget CSV

## What exists today

- Issues/returns write a `material_movements` row (material, qty, unit cost, conversion, reason, created_by, created_at). There is no `note` column — the dialog note is currently folded into the reason text in some paths.
- There is no audit of direct edits to a job material line (planned qty, used qty, unit cost) — only conversion container/output/revenue audits exist.
- `conversion_budget_variance` computes variance live from current budget lines and current line costs, so editing a budget line later silently rewrites historical variance.
- Requisitions (`material_requests`) already carry material, urgency and `purchase_order_id`, but the job Materials/BOM table shows no requisition or PO progress.
- The Budget tab has no export; a shared `exportCSV` helper already exists.

## What will be built

### 1. Per-material audit log
- New audit table capturing every event on a job material line: issue, return, line created, planned qty changed, used qty changed, unit cost changed, line deleted.
- Each row records who, when, event type, quantity, reason, free-text note, and before/after values for the changed field.
- Issue/return RPCs write the audit entry (note now stored properly, not appended to the reason); a trigger on job material lines captures manual edits and deletions.
- The Materials tab gets a "History" action per line opening a timeline: date/time, actor name, event, before → after, qty, reason and note. Read-only, no deletes.

### 2. Cost snapshots on issue/return
- Every movement stores the unit cost applied at that moment plus the planned qty and planned unit cost in force at that moment (from the budget line, if any).
- Variance is recomputed from the snapshots: actual cost = sum of snapshot cost of net issued quantity; intended cost = snapshot planned figures at time of consumption. Later budget edits change the forward plan but do not restate history.
- The Budget tab variance table gains a "snapshot" indicator when a line's current budget differs from the budget in force when material was consumed, so an edited budget is visible rather than silent.

### 3. Live requisition / PO badges on the BOM table
- Each material row shows its current procurement state: no requisition, requisition pending, approved, rejected, PO raised (with PO status: draft / sent / partially received / received), or fulfilled.
- Badges are derived from the linked `material_requests` row and its `purchase_order_id` (PO status and received quantities), and refresh in real time via a Supabase realtime subscription on requests, purchase orders and goods receipts.
- Each badge links straight to the requisition drawer or the purchase order page.

### 4. Budget tab CSV export
- "Export CSV" button on the Budget tab producing one row per material: material, category, planned qty, issued qty, returned qty, net used, qty variance, planned unit cost, intended cost, actual cost, cost variance, variance %, requisition/PO status.
- Footer totals row; filename includes the job reference and date; export honours the current filters on the tab.

## Technical notes

- Migration: `conversion_material_audit` (organization_id, conversion_id, conversion_material_id, material_id, event, qty, unit_cost, field_changed, old_value, new_value, reason, note, created_by, created_at) with org-scoped RLS and the standard GRANT block; trigger `audit_conversion_material_change` on `conversion_materials` for INSERT/UPDATE/DELETE.
- `material_movements` gains `note`, `planned_qty_snapshot`, `planned_unit_cost_snapshot` (movement `unit_cost` already snapshots actual cost).
- `issue_material_to_job` / `return_material_from_job` extended to persist the note separately and resolve+store the planned snapshots from `conversion_budget_lines`; `conversion_budget_variance` reworked to use snapshot columns with fallback to current values for pre-existing movements.
- New `conversion_material_procurement_status(_conversion_id)` RPC returning per-material request/PO state for the badges.
- Frontend: `MaterialAuditDialog` in `src/components/conversions/`; badge column + realtime invalidation in `src/pages/ConversionDetail.tsx`; export button in `src/components/conversions/BudgetTab.tsx` using `exportCSV` from `src/lib/export-utils.ts`.
