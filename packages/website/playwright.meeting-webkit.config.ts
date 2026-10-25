import { defineConfig } from "@playwright/test";
import base from "./playwright.webkit.config";

export default defineConfig({
  ...base,
  testMatch: ["meeting-preparation.spec.ts", "assistance.spec.ts"],
  grep: /meeting|action preview is lazy|assistance expiry/,
});
