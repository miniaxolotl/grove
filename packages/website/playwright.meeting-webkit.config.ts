import { defineConfig } from "@playwright/test";
import base from "./playwright.webkit.config";

export default defineConfig({
  ...base,
  testMatch: ["meeting-preparation.spec.ts", "assistance.spec.ts"],
  grep: /general brief|tool opt-in|brief source recovery|action preview is lazy|assistance expiry/,
});
