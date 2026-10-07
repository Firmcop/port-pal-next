# Port Pal — Container Depot Management System (CDMS)

Port Pal is a multi-tenant SaaS for container terminals and depots. A single deployment serves many customer organizations, each with their own users, depots, inventory, billing, and accounting — all isolated by Postgres Row-Level Security.

- **Preview:** https://id-preview--21b7fa4b-0d75-4b34-afea-b469534f29b8.lovable.app
- **Published:** https://depot-zenith.lovable.app
- **Custom domain:** https://portal.firmcop.com

## Tech stack

- **Frontend:** Next.js 16 (App Router) on React 19, TypeScript 5, Tailwind CSS v3, shadcn/ui, TanStack Query, Recharts, Motion.
- **Backend:** Supabase — Postgres, Auth (incl. OAuth 2.1 server for AI clients), Realtime, Edge Functions, Storage.
- **AI:** MCP server at `/api/mcp` (official `@modelcontextprotocol/sdk`, 19 read-only tools). See `public/docs/ai-connector.md`.
- **Comms:** WhatsApp Cloud API + Google Gemini Flash (intent parsing), W3C Web Push (VAPID) via a custom Service Worker.

## Multi-tenancy model

- Tenants live in `public.organizations`; users join via `public.organization_members`.
- Every business table carries `organization_id` and is scoped by RLS using `current_org_id()` and `is_platform_admin()` helpers.
- Legacy/pre-migration rows live in the default org `00000000-0000-0000-0000-000000000001`. The `adopt_legacy_org_data` RPC (UI at Finance → Adopt Legacy Data) migrates them into an active tenant with a dry-run preview.
- A separate **Vendor Console** (`/vendor`) lets platform admins manage organizations, modules, invoices, lifecycle events, and security findings.

## Module architecture

ERP modules are toggled per depot in `depots.config.enabled_modules`. Core modules: Yard, Gate, M&R, Billing. Optional: CRM, Manufacturing (`conversions` in the DB), Procurement, Accounting, Logistics, Leasing, HRM, WhatsApp, Portal.

## Subscriptions, seats, and module gating

- Per-org module licensing lives in `subscription_modules`; the sidebar intersects user role permissions with this list via `get_user_view_modules()`, so non-subscribed modules are hidden automatically.
- `check_seat_capacity(org)` returns `used / seat_limit / can_add` (counting active members + open invitations). The `invite-staff-user` and `create-staff-user` edge functions return `402 seat_limit_reached` when full, and the Invite/Add User wizard shows a live seat chip.

## Roles & permissions

- **Coarse RBAC:** Admin, Yard Operator, Gate Clerk, Viewer, Customer, plus the functional roles Accountant, HR Manager, Production Manager, Procurement Officer, Supply Chain Manager, Sales Manager, Leasing Manager, M&R Supervisor.
- **Granular matrix:** `app_action` enum + `role_permission_defaults` + per-user `role_permission_overrides`, checked through the `has_permission()` RPC. The check is scoped to the user's *current* organization so cross-org role rows don't leak in or out. Managed in Settings → Permissions.
- New users are auto-assigned the `viewer` role via DB trigger.

## Key subsystems

- **Yard:** 2D grid map with stacking rules (weight, reefer power, hazardous segregation).
- **Gate & EIR:** truck registry, appointments, auto-generated EIR with condition grading. Unified numbering via `next_eir_number()` (gate / sales / repatriation share the sequence). Gate-in photos are mandatory, gate fees are stamped automatically from active tariffs, and admins can edit or delete EIR rows.
- **M&R:** estimates → work orders → completion; container availability syncs automatically.
- **HRM & Payroll:** employee registry, payroll runs, payslip approval workflow, configurable payslip PDF template, reconciliation.
- **Billing:** dwell-time storage charges from tariff rate cards, recurring invoices, multi-currency.
- **Procurement:** purchase orders, goods receipts with mandatory variance reasons, a full audit trail (`goods_receipt_audit`), and a manager-approval workflow (`approval_requests`) that automatically posts inventory and raises a supplementary PO for over-receipts or a supplier credit note for under-receipts on approval.
- **Supplier Invoices:** `PINV-…` purchase invoices auto-generated on container acquisition and on third-party sale (via `acquire_container_from_owner`); a DB trigger links them back to `container_sales`, with deep-links in the Sales list and an auto-opening drawer on Finance → Supplier Invoices.
- **Container cost model:** acquisition cost split into `purchase_price` and `transport_offloading_cost`; retroactive edits go through `adjust_conversion_costs`, `adjust_sale_costs`, and `adjust_container_acquisition`, which post the offsetting ledger entries atomically.
- **Accounting:** double-entry ledger with automatic transactions for revenue, expenses, and COGS; full job-costing engine across Procurement and Manufacturing.
- **Multi-currency:** per-customer and per-supplier `currency` override, `container_sales.currency` propagated to acquisition POs and ledger entries, an `fx_rates` table with `get_fx_rate` RPC, `fx_rate` stamped on every `accounting_transactions` row, plus Finance → FX Rates, Currency Backfill, and Sales Currency Reconciliation pages.
- **Repatriation:** return/export workflow with per-trip costing and auto EIR + ledger entries.
- **Customer Portal (`/portal`):** self-service inventory, billing, and release instructions; portal users invited via Edge Function (Admin API) to avoid terminating staff sessions.
- **Document generation:** HTML-to-print with SHA-256 hash, QR verification, watermarks, and captured issuer.
- **Notifications:** `push_notification_queue` table fanned out to Web Push and WhatsApp via an Edge Function worker.
- **Auth:** email/password sign-in plus a Supabase-backed password recovery flow (`/forgot-password` → `/reset-password`).
- **Security Findings (Vendor Console):** scan results tracker with KPI cards, filters, and per-finding remediation SQL.
- **Currency auto-fill:** a `set_currency_from_org()` BEFORE INSERT trigger sets `currency` from the owning organization on all money-bearing tables — never hardcode `'USD'` / `'EUR'` defaults.

## Local development

```bash
cp .env.example .env.local   # fill in the Supabase URL, publishable key and project id
npm install
npm run dev                  # http://localhost:8080
```

| Command | What it does |
|---|---|
| `npm run build` / `npm start` | Production build and server |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | Vitest unit suite (150 tests) |
| `npm run e2e` | Playwright smoke tests |
| `npm run db:types` | Regenerate `src/integrations/supabase/types.ts` |

## Code layout (v2.0)

- `src/app/` — Next.js routes. `(app)/` is the staff workspace, `portal/` the customer portal, `vendor/` the platform console, `api/mcp` the AI connector. Each `page.tsx` lazy-loads one screen and wraps it in the same module / role / permission guards as before.
- `src/views/` — the screens (formerly `src/pages`, renamed because Next.js reserves that folder name).
- `src/components/shell/` — session, onboarding and paywall gates for each area.
- `src/proxy.ts` — refreshes the Supabase session cookie and redirects signed-out visitors on the server.
- `src/lib/router.tsx` — small react-router compatibility layer so existing screens run unchanged; new code should use `next/link` and `next/navigation`.
- `src/server/mcp/` — AI tool definitions.
- `docs/MIGRATION.md` — what changed from the Vite/Lovable build and the cut-over checklist.

## Further reading

- `public/llms.txt` — LLM-readable site map and capability summary.
- `docs/history/` — feature plans from the Lovable era.
- `docs/route-manifest.json` — every route, its screen and its guards.
