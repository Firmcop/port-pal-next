import { expect, test } from "@playwright/test";
import { assertSidebarGroups, expectRouteBlocked, expectRouteLoads, login } from "./_helpers/rbac";

/**
 * Subscription-gate e2e — signs in to an org that has selected modules disabled
 * and verifies sidebar groups, routes, and direct nav all hit the paywall.
 *
 * Required env:
 *   DISABLED_ORG_EMAIL=...
 *   DISABLED_ORG_PASSWORD=...
 *   DISABLED_ORG_MODULES=logistics,manufacturing,leasing  (comma-separated module codes)
 *   DISABLED_ORG_CONTROL_ROUTE=/inventory                  (optional sanity-check route)
 *
 * Run:
 *   DISABLED_ORG_EMAIL=... DISABLED_ORG_PASSWORD=... \
 *   DISABLED_ORG_MODULES=logistics,manufacturing npx playwright test org-modules-disabled
 */

const EMAIL = process.env.DISABLED_ORG_EMAIL ?? "";
const PASSWORD = process.env.DISABLED_ORG_PASSWORD ?? "";
const DISABLED = (process.env.DISABLED_ORG_MODULES ?? "logistics,manufacturing,leasing")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const CONTROL_ROUTE = process.env.DISABLED_ORG_CONTROL_ROUTE ?? "/inventory";

const MODULE_ROUTES: Record<string, string[]> = {
  logistics: ["/logistics/trips", "/logistics/dashboard"],
  manufacturing: ["/conversions", "/finished-products"],
  leasing: ["/leasing/agreements", "/leasing/units"],
  procurement: ["/procurement", "/suppliers"],
  hrm: ["/hrm/employees"],
  crm: ["/quotes", "/customers"],
  mr: ["/mr/inspections", "/mr/work-orders"],
  gate: ["/gate/eir", "/gate/dashboard"],
  billing: ["/finance/dashboard"],
  accounting: ["/finance/chart-of-accounts"],
};

const MODULE_GROUP: Record<string, string> = {
  logistics: "Logistics",
  manufacturing: "Manufacturing",
  leasing: "Leasing",
  procurement: "Procurement",
  hrm: "Human Resources",
  crm: "CRM & Sales",
  mr: "M&R",
  gate: "Gate Operations",
  billing: "Billing & Finance",
  accounting: "Accounting",
};

test.describe("Org with disabled modules — subscription gating", () => {
  test.beforeEach(async ({ page }) => {
    test.skip(!EMAIL || !PASSWORD, "DISABLED_ORG_EMAIL/PASSWORD not provided — skipping spec.");
    await login(page, EMAIL, PASSWORD);
  });

  test("disabled module groups are hidden in the sidebar", async ({ page }) => {
    const forbiddenGroups = DISABLED.map((m) => MODULE_GROUP[m]).filter(Boolean);
    await assertSidebarGroups(page, [], forbiddenGroups);
  });

  for (const mod of DISABLED) {
    const routes = MODULE_ROUTES[mod] ?? [];
    for (const path of routes) {
      test(`disabled module "${mod}" → ${path} redirects to paywall`, async ({ page }) => {
        await expectRouteBlocked(page, path, { mustMatch: /\/paywall(\?|$)/ });
        expect(page.url()).toContain(`module=${mod}`);
      });
    }
  }

  test(`control route still loads: ${CONTROL_ROUTE}`, async ({ page }) => {
    await expectRouteLoads(page, CONTROL_ROUTE);
  });
});
