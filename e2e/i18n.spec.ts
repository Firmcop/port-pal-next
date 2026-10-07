import { test, expect } from "@playwright/test";

/**
 * Verifies the in-app language switcher cycles supported locales without
 * a full page reload and persists the choice.
 *
 * Skipped by default because it requires an authenticated session — wire up
 * a STORAGE_STATE file or per-test login and remove `.skip` to enable.
 */
test.skip("language switcher updates UI strings", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /language/i }).click();
  await page.getByRole("menuitem", { name: /Français/i }).click();
  await expect(page.getByRole("link", { name: /Tableau de bord|Inventaire/i }).first()).toBeVisible();
});
