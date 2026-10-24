import { defineConfig, devices } from "@playwright/test";
import base from "./playwright.config";

// Same production/fixture servers as Chromium; only the browser and subset differ.
export default defineConfig({
  ...base,
  testMatch: ["hosted-chat.spec.ts", "connect.spec.ts"],
  use: { ...base.use, ...devices["iPhone 13"], browserName: "webkit" },
});
