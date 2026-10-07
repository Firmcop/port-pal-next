import { test } from "@playwright/test";
import {
  ALL_FORBIDDEN_GROUPS,
  assertSidebarGroups,
  expectNavLinkHidden,
  expectRouteBlocked,
  expectRouteLoads,
  login,
} from "./_helpers/rbac";

/**
 * Accountant RBAC e2e.
 *
 * Required env:
 *   ACCOUNTANT_EMAIL=...
 *   ACCOUNTANT_PASSWORD=...
 *
 * Run:
 *   ACCOUNTANT_EMAIL=... ACCOUNTANT_PASSWORD=... npx playwright test accountant-access
 */
const EMAIL = process.env.ACCOUNTANT_EMAIL ?? "accountant@firmcop.com";
const PASSWORD = process.env.ACCOUNTANT_PASSWORD ?? "";

const ALLOWED_GROUPS = ["Billing & Finance"];
const FORBIDDEN_GROUPS = ALL_FORBIDDEN_GROUPS.filter(
  (g) => !ALLOWED_GROUPS.includes(g) && g !== "Accounting",
);

const ALLOWED_ROUTES = [
  "/finance/dashboard",
  "/finance/chart-of-accounts",
  "/finance/journals",
  "/finance/aging",
  "/finance/supplier-invoices",
];

const FORBIDDEN_ROUTES = [
  "/gate/eir",
  "/mr/inspections",
  "/inventory",
  "/conversions",
  "/procurement",
  "/logistics/trips",
  "/leasing/agreements",
  "/quotes",
  "/customers",
  "/hrm/employees",
  "/settings",
  "/vendor/organizations",
];

const FORBIDDEN_NAV_LINKS = [
  "EIR Records",
  "Inspections",
  "Quotes",
  "Suppliers",
  "Conversion Jobs",
  "Trips",
  "Employees",
];

test.describe("Accountant — finance-only RBAC", () => {
  test.beforeEach(async ({ page }) => {
    await login(page, EMAIL, PASSWORD);
  });

  test("sidebar shows only finance groups", async ({ page }) => {
    await assertSidebarGroups(page, ALLOWED_GROUPS, FORBIDDEN_GROUPS);
  });

  test("forbidden nav links are not rendered", async ({ page }) => {
    for (const label of FORBIDDEN_NAV_LINKS) await expectNavLinkHidden(page, label);
  });

  for (const path of ALLOWED_ROUTES) {
    test(`allowed route loads: ${path}`, async ({ page }) => {
      await expectRouteLoads(page, path);
    });
  }

  for (const path of FORBIDDEN_ROUTES) {
    test(`forbidden route is blocked: ${path}`, async ({ page }) => {
      await expectRouteBlocked(page, path);
    });
  }
});
