import { defineConfig, devices } from "@playwright/test";

// Focused iPhone/WebKit checks; trusted CDP gesture cases run in the Chromium suite.
export default defineConfig({
  testDir: "./tests",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 2,
  reporter: "list",
  grep: /sidebar at (320|390)px|sidebar remains|row dropdown at (320|390)px|stable note tools at (320|390)px|viewer tasks at 390px|viewer tasks keep|viewer task save|viewer task conflicts|command palette at (320|390)px|command selection survives|workspace shortcuts respect|palettes keep|note search shares|action menus follow|touch hit areas|mobile note controls|first-save navigation|long notes scroll|settings share|categorized AI preferences|preferences retain|preference drafts|model settings|long notebook menus|reply and growing|Ask Grove cites|visible row deletion|export downloads|row export reads|PDF|export and delete remain|account export|notebook exports|compact export/,
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
