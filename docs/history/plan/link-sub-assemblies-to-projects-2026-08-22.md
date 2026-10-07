# Link sub-assemblies to projects

Today sub-assemblies (SKUs, builds, lots, movements) have no project link at all, so a build's cost never lands on a project's P&L.

## What to build

1. **Default project on the SKU** — the "New Sub-assembly SKU" dialog gets an optional Project picker (active projects). Shown in the SKU table and editable later.
2. **Project on each build run** — the Build dialog gets a Project selector, pre-filled from the SKU's default project, overridable per build (or cleared for stock builds not tied to a project).
3. **Costs post to the project P&L** — when a build has a project, its labour and overhead journal entries carry that project, so the build cost shows under the project's Costs/Margin on the project detail page. Builds with no project behave exactly as now.
4. **Traceability** — the build lot and stock movement record the project; the Movements/Lots view shows a Project column, and the project detail page gets the sub-assembly builds listed alongside conversion jobs.

## Technical notes

- Migration: add nullable `project_id uuid references public.projects(id)` to `sub_assembly_stock`, `sub_assembly_lots`, and `sub_assembly_movements`. No RLS change (existing org-scoped policies apply); indexes on `project_id`.
- `build_sub_assembly(_assembly_stock_id, _qty, _notes)` gains a `_project_id uuid default null` argument: resolves to the SKU's default when null, writes it onto the lot and movement rows, and sets `project_id` on the `SA-LAB-*` / `SA-OVH-*` `accounting_transactions` inserts. `project_pnl` already aggregates by `accounting_transactions.project_id`, so no view change is needed for P&L.
- `add_sub_assembly_stock` (production output path) also stamps the project from the linked conversion job's `project_id` when present.
- Frontend `src/pages/SubAssemblyStock.tsx`: add an active-projects query, project Select in the New SKU and Build dialogs, project column in the stock table, and pass `_project_id` to the RPC.
- `src/pages/finance/ProjectDetail.tsx`: add a "Sub-assembly builds" list (lots for the project) so the cost is traceable to its source.
