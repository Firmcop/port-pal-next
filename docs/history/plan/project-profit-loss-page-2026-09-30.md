# Project Profit & Loss page

## What you get
A new **Project P&L** page under Finance > Reports: one row per project showing
- Revenue
- Materials (materials issued to the project's jobs)
- Labour / other cost of sales
- Operating expenses
- Gross profit, net profit, margin %
- Budget and variance (actual cost vs budget, and vs quoted price when no budget exists)

Filters: date range, status (active / completed / all), customer. Totals row at the bottom, CSV/PDF export. Click a project to open a breakdown drawer listing the individual entries behind each figure, with a link to the full project page.

## Fix needed first
The 1,176 material cost entries posted last time are not linked to any project, so project figures would show zero materials today. They will be linked to their project (via the job they were issued to) — link only, amounts and dates unchanged, recorded in the finance audit log. New material issues will be linked automatically.

## Technical details
- Migration: extend the material posting function to set `project_id` from `container_conversions.project_id`; backfill `project_id` on existing `reference_type='material_movement'` rows (link-only, logged to `finance_audit_log`).
- New SECURITY DEFINER RPC `project_pnl_report(_from date, _to date)` (org-scoped via `current_org_id()`), aggregating `accounting_transactions` by `project_id`: revenue, COGS split into `cogs_conversion_materials` vs other, expense; joined with `budgets` totals and job `quoted_price`; returns variance and margin.
- New page `src/pages/finance/ProjectPnL.tsx`, route `/finance/reports/project-pnl` (same roles as P&L plus accountant), sidebar entry beside Profit & Loss, drawer reusing `v_expense_journal_lines` filtered by project.
- Add a "Project P&L" link from the main P&L page header.
