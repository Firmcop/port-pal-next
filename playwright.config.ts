import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright e2e suite.
 *
 * Run locally:
 *   npx playwright install chromium
 *   PLAYWRIGHT_BASE_URL="http://localhost:8080" npx playwright test
 *
 * Or against the deployed preview:
 *   PLAYWRIGHT_BASE_URL="https://<your-deployment-url>" npx playwright test
 */
export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  fullyParallel: true,
  reporter: [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]],
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:8080",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],
});
