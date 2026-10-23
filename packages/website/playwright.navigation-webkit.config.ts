import { defineConfig, devices } from "@playwright/test";

// Existing regressions for the shared navigation and modal-focus contracts.
export default defineConfig({
  testDir: "./tests",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 2,
  reporter: "list",
  grep: /sidebar remains|stable note tools at (320|390)px|viewer tasks keep|first autosave|autosave retries|focus mode switches|command selection survives|workspace shortcuts respect|note search shares|conversation history at (320|390)px/,
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
    timeout: 30000,
  },
});
