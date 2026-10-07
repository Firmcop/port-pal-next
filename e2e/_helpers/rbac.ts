import { expect, type Page, test } from "@playwright/test";

export const ALL_FORBIDDEN_GROUPS = [
  "Billing & Finance",
  "Accounting",
  "Human Resources",
  "HR & Payroll",
  "Procurement",
  "Manufacturing",
  "Logistics",
  "Leasing",
  "Gate Operations",
  "M&R",
  "CRM & Sales",
  "Administration",
  "Admin",
  "Vendor Console",
  "Vendor",
  "Settings",
];

export async function login(page: Page, email: string, password: string) {
  test.skip(!password, `password env var not provided — skipping spec.`);
  await page.goto("/login");
  await page.locator('input[type="email"]').first().fill(email);
  await page.locator('input[type="password"]').first().fill(password);
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL((u) => !/\/login/.test(u.pathname), { timeout: 20_000 });
  await page.waitForSelector('[data-sidebar="sidebar"], aside, nav', { timeout: 15_000 });
  await page.waitForTimeout(3_000);
}

async function sidebarText(page: Page) {
  return (
    (await page
      .locator('[data-sidebar="sidebar"], aside')
      .first()
      .innerText()
      .catch(() => "")) || (await page.locator("body").innerText())
  );
}

export async function assertSidebarGroups(
  page: Page,
  allowed: string[],
  forbidden: string[],
) {
  const text = await sidebarText(page);
  for (const g of allowed) {
    expect(text, `expected sidebar to include "${g}"`).toContain(g);
  }
  for (const g of forbidden) {
    expect(text, `sidebar must NOT include "${g}"`).not.toContain(g);
  }
}

export async function expectRouteLoads(page: Page, path: string) {
  await page.goto(path);
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(1_500);
  expect(
    new URL(page.url()).pathname,
    `expected to stay on ${path}, got ${page.url()}`,
  ).toBe(path);
  const body = await page.locator("body").innerText();
  expect(body).not.toMatch(/oops! page not found/i);
}

export async function expectRouteBlocked(
  page: Page,
  path: string,
  opts: { mustMatch?: RegExp } = {},
) {
  await page.goto(path);
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(1_500);
  const finalPath = new URL(page.url()).pathname;
  expect(
    finalPath,
    `expected to be redirected away from ${path}, still on ${finalPath}`,
  ).not.toBe(path);
  if (opts.mustMatch) {
    expect(page.url()).toMatch(opts.mustMatch);
  }
}

export async function expectNavLinkHidden(page: Page, label: string) {
  const link = page.getByRole("link", { name: new RegExp(`^${label}$`, "i") });
  await expect(link, `nav link "${label}" must be hidden`).toHaveCount(0);
}
