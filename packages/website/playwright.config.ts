import { defineConfig, devices } from "@playwright/test";

const port = Number(process.env.WEBSITE_TEST_PORT || 4372);
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: "./tests",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 2,
  reporter: "list",
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    ...devices["Desktop Chrome"],
  },
  webServer: [
    {
      command: "node tests/fixtures/sharing-server.mjs",
      url: `http://127.0.0.1:${process.env.SHARING_TEST_PORT || 4378}/health`,
      reuseExistingServer: false,
      timeout: 30000,
    },
    {
      command: `pnpm start --port ${port}`,
      env: {
        GROVE_API_URL: `http://127.0.0.1:${process.env.SHARING_TEST_PORT || 4378}`,
      },
      url: baseURL,
      reuseExistingServer: false,
      timeout: 30_000,
    },
    {
      command: "node tests/fixtures/dashboard-server.mjs",
      url: `http://127.0.0.1:${process.env.DASHBOARD_TEST_PORT || 3101}`,
      reuseExistingServer: false,
      timeout: 30000,
    },
  ],
});
