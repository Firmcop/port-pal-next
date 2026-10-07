import { test, expect, type Page } from "@playwright/test";

/**
 * End-to-end RBAC test — Gloria (non-admin Manager) at organization FCL.
 *
 * Gloria's assigned manager roles (Yard Operator, Gate Clerk, Sales Manager,
 * M&R Supervisor) should expose ONLY the following sidebar groups:
 *   - CDMS                 (Inventory, Yard Map, Movements)
 *   - Gate Operations      (Gate Dashboard, EIR, Trucks, etc.)
 *   - M&R                  (Inspections, Estimates, Work Orders)
 *   - CRM & Sales          (Customers, Leads, Quotes, Templates, etc.)
 *
 * Everything else (Finance, HR, Procurement, Logistics, Manufacturing,
 * Leasing, Admin, Vendor) MUST be hidden, and direct URL navigation to
 * those modules MUST redirect away from the page.
 *
 * Required env:
 *   GLORIA_EMAIL=gloria@firmcop.com
 *   GLORIA_PASSWORD=<password>
 *
 * Run:
 *   GLORIA_EMAIL=... GLORIA_PASSWORD=... npx playwright test gloria-manager-access
 */

const EMAIL = process.env.GLORIA_EMAIL ?? "gloria@firmcop.com";
const PASSWORD = process.env.GLORIA_PASSWORD ?? "";

// Sidebar groups Gloria SHOULD see.
const ALLOWED_GROUPS = ["CDMS", "Gate Operations", "M&R", "CRM & Sales"];

// Sidebar groups Gloria MUST NOT see.
const FORBIDDEN_GROUPS = [
  "Billing & Finance",
  "Accounting",
  "HR & Payroll",
  "Procurement",
  "Manufacturing",
  "Logistics",
  "Leasing",
  "Administration",
  "Vendor Console",
  "Settings",
];

// Routes Gloria SHOULD be able to load (URL stays put).
const ALLOWED_ROUTES = [
  "/inventory",
  "/yard-map",
  "/gate/eir",
  "/gate/dashboard",
  "/mr/inspections",
  "/quotes",
  "/customers",
];

// Routes Gloria MUST be redirected away from (paywall or home).
const FORBIDDEN_ROUTES = [
  "/finance/dashboard",
  "/accounting/transactions",
  "/hrm/employees",
  "/procurement",
  "/conversions",
  "/logistics/trips",
  "/leasing/agreements",
  "/settings",
  "/settings/subscription",
  "/vendor/organizations",
];

// Specific action buttons / nav links that MUST NOT appear in the sidebar.
const FORBIDDEN_NAV_LINKS = [
  "Finance Dashboard",
  "Chart of Accounts",
  "Payroll",
  "Employees",
  "Purchase Orders",
  "Suppliers",
  "Trips",
  "Conversions",
  "Leases",
];

async function login(page: Page) {
  test.skip(!PASSWORD, "GLORIA_PASSWORD env var not provided — skipping RBAC e2e.");
  await page.goto("/login");
  await page.locator('input[type="email"]').first().fill(EMAIL);
  await page.locator('input[type="password"]').first().fill(PASSWORD);
  await page.getByRole("button", { name: /sign in/i }).click();
  // Wait for app shell to finish hydrating (sidebar mounts).
  await page.waitForURL((u) => !/\/login/.test(u.pathname), { timeout: 20_000 });
  await page.waitForSelector('[data-sidebar="sidebar"], aside, nav', { timeout: 15_000 });
  // Give org context + module query a beat to resolve.
  await page.waitForTimeout(3_000);
}

test.describe("Gloria — non-admin Manager RBAC", () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test("sidebar shows only the allowed groups", async ({ page }) => {
    const sidebarText = (await page
      .locator('[data-sidebar="sidebar"], aside')
      .first()
      .innerText()
      .catch(() => "")) || (await page.locator("body").innerText());

    for (const group of ALLOWED_GROUPS) {
      expect(sidebarText, `expected sidebar to include "${group}"`).toContain(group);
    }
    for (const group of FORBIDDEN_GROUPS) {
      expect(sidebarText, `sidebar must NOT include "${group}"`).not.toContain(group);
    }
  });

  test("forbidden nav links are not rendered", async ({ page }) => {
    for (const label of FORBIDDEN_NAV_LINKS) {
      const link = page.getByRole("link", { name: new RegExp(`^${label}$`, "i") });
      await expect(link, `nav link "${label}" must be hidden`).toHaveCount(0);
    }
  });

  test("settings is hidden for non-admins", async ({ page }) => {
    await expect(
      page.getByRole("link", { name: /^settings$/i }),
      "Settings link must not appear for managers"
    ).toHaveCount(0);
  });

  for (const path of ALLOWED_ROUTES) {
    test(`allowed route loads: ${path}`, async ({ page }) => {
      await page.goto(path);
      await page.waitForLoadState("networkidle");
      await page.waitForTimeout(1_500);
      expect(
        new URL(page.url()).pathname,
        `expected to stay on ${path}, got ${page.url()}`
      ).toBe(path);
      // Page must not render the generic 404 NotFound screen.
      const body = await page.locator("body").innerText();
      expect(body).not.toMatch(/oops! page not found/i);
    });
  }

  for (const path of FORBIDDEN_ROUTES) {
    test(`forbidden route is blocked: ${path}`, async ({ page }) => {
      await page.goto(path);
      await page.waitForLoadState("networkidle");
      await page.waitForTimeout(1_500);
      const finalPath = new URL(page.url()).pathname;
      expect(
        finalPath,
        `expected to be redirected away from ${path}, still on ${finalPath}`
      ).not.toBe(path);
    });
  }
});
