import { defineConfig, devices } from "@playwright/test";
import config from "./playwright.config";

export default defineConfig({
  ...config,
  outputDir: "test-results/relationships-webkit",
  testMatch: "workspace.spec.ts",
  grep: /connection evidence|notebook context and graph|connections recover from failed/,
  use: { ...config.use, ...devices["iPhone 13"], browserName: "webkit" },
  webServer: Array.isArray(config.webServer)
    ? config.webServer.map((server, index) => ({
        ...server,
        ...(index === 0
          ? {
              command: `node node_modules/next/dist/bin/next start --port ${process.env.WEBSITE_TEST_PORT || 4372}`,
            }
          : {}),
      }))
    : config.webServer,
});
