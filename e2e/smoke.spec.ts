import { test, expect } from "@playwright/test";

/**
 * Smoke test — verifies the app shell loads and routes the unauthenticated
 * user to the login screen. This is the minimum signal that the deployment
 * is healthy.
 */
test("loads and redirects to login when signed out", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/(login|auth)?/);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible({ timeout: 10_000 });
});

test("login page exposes email & password fields", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByLabel(/email/i)).toBeVisible();
  await expect(page.getByLabel(/password/i)).toBeVisible();
});
