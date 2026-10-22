import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 2,
  reporter: "list",
  grep: /stable library|global search and command|preferences retain|combined project|shared dropdowns|filtered empty/,
  use: {
    ...devices["iPhone 13"],
    browserName: "webkit",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "node tests/fixtures/dashboard-server.mjs",
    url: `http://127.0.0.1:${process.env.DASHBOARD_TEST_PORT || 3101}`,
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
