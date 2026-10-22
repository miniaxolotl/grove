import { defineConfig, devices } from "@playwright/test";
import config from "./playwright.config";

export default defineConfig({
  ...config,
  outputDir: "test-results/sharing-webkit",
  testMatch: ["sharing.spec.ts", "workspace.spec.ts"],
  grep: /configured authentication|public note|shared notebook|saved edits are live|missing links|timed sharing|an open sharing dialog/,
  use: { ...config.use, ...devices["iPhone 13"], browserName: "webkit" },
  webServer: Array.isArray(config.webServer)
    ? config.webServer.map((server) => ({
        ...server,
        ...(server.command.startsWith("pnpm start")
          ? {
              command: `node node_modules/next/dist/bin/next start --port ${process.env.WEBSITE_TEST_PORT || 4372}`,
            }
          : {}),
      }))
    : config.webServer,
});
