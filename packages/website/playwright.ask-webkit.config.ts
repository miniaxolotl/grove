import { defineConfig } from "@playwright/test";
import base from "./playwright.webkit.config";

// Real Ask components, with the same production CSS and iPhone/WebKit fixture.
export default defineConfig({
  ...base,
  testMatch: "workspace.spec.ts",
  grep: /Ask tools|conversation history/,
});
