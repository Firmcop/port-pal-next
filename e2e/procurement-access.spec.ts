import { expect, test } from "@playwright/test";
import {
  ALL_FORBIDDEN_GROUPS,
  assertSidebarGroups,
  expectNavLinkHidden,
  expectRouteBlocked,
  expectRouteLoads,
  login,
} from "./_helpers/rbac";

/**
 * Procurement / supply-chain manager RBAC e2e.
 *
 * Required env:
 *   PROCUREMENT_EMAIL=...  (defaults to romadenx@gmail.com)
 *   PROCUREMENT_PASSWORD=...
 *
 * Run:
 *   PROCUREMENT_EMAIL=... PROCUREMENT_PASSWORD=... npx playwright test procurement-access
 */
const EMAIL = process.env.PROCUREMENT_EMAIL ?? "romadenx@gmail.com";
const PASSWORD = process.env.PROCUREMENT_PASSWORD ?? "";

const ALLOWED_GROUPS = ["Manufacturing", "Procurement", "Logistics"];
const FORBIDDEN_GROUPS = ALL_FORBIDDEN_GROUPS.filter(
  (g) => !ALLOWED_GROUPS.includes(g),
);

const ALLOWED_ROUTES = [
  "/inventory",
  "/procurement",
  "/suppliers",
  "/conversions",
  "/logistics/trips",
];

const FORBIDDEN_ROUTES = [
  "/gate/eir",
  "/mr/inspections",
  "/mr/work-orders",
  "/mr/estimates",
  "/quotes",
  "/customers",
  "/finance/dashboard",
  "/hrm/employees",
  "/leasing/agreements",
  "/settings",
  "/vendor/organizations",
];

test.describe("Procurement — Suppliers visible, EIR/M&R hidden", () => {
  test.beforeEach(async ({ page }) => {
    await login(page, EMAIL, PASSWORD);
  });

  test("sidebar shows procurement / mfg / logistics groups only", async ({ page }) => {
    await assertSidebarGroups(page, ALLOWED_GROUPS, FORBIDDEN_GROUPS);
  });

  test("Suppliers link is visible", async ({ page }) => {
    await expect(
      page.getByRole("link", { name: /^Suppliers$/i }),
    ).toHaveCount(1);
  });

  test("Quotes link is hidden (CRM not granted)", async ({ page }) => {
    await expectNavLinkHidden(page, "Quotes");
  });

  test("EIR Records and Inspections links are hidden", async ({ page }) => {
    await expectNavLinkHidden(page, "EIR Records");
    await expectNavLinkHidden(page, "Inspections");
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
