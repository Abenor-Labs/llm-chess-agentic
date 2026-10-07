import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end tests run against a real server and database. Locally this reuses
 * a running `pnpm dev`; in CI it builds and starts production. The database
 * comes from DATABASE_URL (.env.local locally, the CI service in CI).
 * Set PLAYWRIGHT_CHROMIUM_PATH to use a preinstalled Chromium.
 */
const port = Number(process.env.PORT ?? 3000);

export default defineConfig({
  testDir: "./e2e",
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : [["list"]],
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL || `http://localhost:${port}`,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH } : {},
  },
  webServer: process.env.PLAYWRIGHT_BASE_URL
    ? undefined
    : {
        command: process.env.CI ? `pnpm build && pnpm start --port ${port}` : `pnpm dev --port ${port}`,
        url: `http://localhost:${port}`,
        reuseExistingServer: !process.env.CI,
        timeout: 240_000,
      },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
