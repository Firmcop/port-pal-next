# Choose which Finance items appear in the sidebar

Add an organization-wide setting so admins can pick exactly which items show under the "Billing & Finance" sidebar group. Hidden items disappear from the sidebar for everyone in the organization; their pages stay reachable by direct URL and permissions/subscription rules are unchanged.

## What the user sees

- Settings gets a new **Sidebar** tab (visible to org owners/admins only).
- The tab lists all ~42 Finance/Billing entries grouped into readable sections (Dashboard & Ledger, Invoicing & Receivables, Payables & Expenses, Banking, Reports, Tax, Budgets, Period Close, Assets).
- Each entry has a toggle. Bulk helpers: "Select all", "Clear all", "Reset to default" (default = everything visible).
- Saving updates the sidebar immediately for the current user and, via the existing realtime organization sync, for other signed-in users.

## Behaviour rules

- Default when nothing has been configured: all Finance items visible (no change from today).
- Hiding is a display filter only — it is applied on top of the existing subscription (`billing` / `accounting` module) and RBAC checks, never instead of them.
- If every Finance item is hidden, the whole "Billing & Finance" group is omitted from the sidebar.
- Non-admins see the resulting sidebar but cannot change the selection.

## Technical notes

- Storage: a `finance_nav` key inside the existing `organizations.config` JSONB (e.g. `config.finance_nav = { hidden: ["dunning", "petty_cash"] }`). Storing hidden keys means new Finance pages added later default to visible. No schema migration needed.
- Read path: extend `src/lib/app-settings.ts` `AppSettings` with `hiddenFinanceNav: string[]`, populate it in `useAppSettingsBootstrap` (`src/hooks/use-app-settings.ts`) from `config.finance_nav.hidden`. The existing realtime subscription on the `organizations` row already propagates changes.
- Sidebar: in `src/components/AppSidebar.tsx`, filter `billingItems` by the hidden set via `useAppSettings()` before rendering, and skip the group when the filtered list is empty.
- Settings UI: new component `src/components/settings/FinanceNavSection.tsx` mounted as a new tab in `src/pages/DepotSettings.tsx`. It writes `config.finance_nav` with a merge-preserving update to `organizations.config` (read current config, patch the key, update) so other config keys are not lost.
- Item labels come from the existing `nav:` i18n keys already used by the sidebar, so no new translation strings are required beyond the tab/section headings.
