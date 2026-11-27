import { defineConfig, devices } from "@playwright/test";
import config from "./playwright.config";

export default defineConfig({
  ...config,
  testMatch: ["shared-reader.spec.ts", "sharing.spec.ts"],
  outputDir: "test-results/shared-reader",
  use: {
    ...config.use,
    ...(process.env.READER_WEBKIT ? devices["iPhone 13"] : {}),
    browserName: process.env.READER_WEBKIT ? "webkit" : "chromium",
  },
  webServer: Array.isArray(config.webServer)
    ? config.webServer.slice(0, 2).map((server) => ({
        ...server,
        ...(server.command.startsWith("pnpm start")
          ? {
              command: `node node_modules/next/dist/bin/next start --port ${process.env.WEBSITE_TEST_PORT || 4372}`,
            }
          : {}),
      }))
    : config.webServer,
});
