import { expect, test } from "@playwright/test";
import { expectRouteLoads, login } from "./_helpers/rbac";

/**
 * Platform-admin RBAC e2e — verifies Vendor Console links + admin-only actions.
 *
 * Required env:
 *   PLATFORM_ADMIN_EMAIL=...
 *   PLATFORM_ADMIN_PASSWORD=...
 *
 * Run:
 *   PLATFORM_ADMIN_EMAIL=... PLATFORM_ADMIN_PASSWORD=... npx playwright test platform-admin-access
 */
const EMAIL = process.env.PLATFORM_ADMIN_EMAIL ?? "";
const PASSWORD = process.env.PLATFORM_ADMIN_PASSWORD ?? "";

const VENDOR_ROUTES = [
  "/vendor/organizations",
  "/vendor/modules",
  "/vendor/invoices",
  "/vendor/lifecycle-events",
  "/vendor/security-findings",
  "/vendor/db-load",
];

const SPOT_CHECK_ROUTES = ["/inventory", "/finance/dashboard", "/settings", "/settings/subscription"];

test.describe("Platform admin — Vendor Console + admin actions", () => {
  test.beforeEach(async ({ page }) => {
    test.skip(!EMAIL || !PASSWORD, "PLATFORM_ADMIN_EMAIL/PASSWORD not provided — skipping spec.");
    await login(page, EMAIL, PASSWORD);
  });

  test("Vendor group is visible in sidebar", async ({ page }) => {
    const text = await page.locator('[data-sidebar="sidebar"], aside').first().innerText();
    expect(text).toMatch(/Vendor/i);
  });

  for (const path of VENDOR_ROUTES) {
    test(`vendor route loads: ${path}`, async ({ page }) => {
      await expectRouteLoads(page, path);
    });
  }

  for (const path of SPOT_CHECK_ROUTES) {
    test(`platform admin can also reach ${path}`, async ({ page }) => {
      await expectRouteLoads(page, path);
    });
  }

  test("vendor organizations page exposes a create / add action", async ({ page }) => {
    await page.goto("/vendor/organizations");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(1_500);
    const action = page.getByRole("button", {
      name: /new organization|create organization|add organization|new org|create org/i,
    });
    // Best-effort: count > 0. Some shells render this as a link.
    const count = (await action.count()) + (await page
      .getByRole("link", { name: /new organization|create organization|add organization/i })
      .count());
    expect(count, "expected an admin-only create-organization action").toBeGreaterThan(0);
  });
});
