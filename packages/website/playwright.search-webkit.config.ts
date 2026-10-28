import { defineConfig } from "@playwright/test";
import workspace from "./playwright.webkit.config";

export default defineConfig({
  ...workspace,
  grep: /search quality|note search shares|search debounces|global search and command/,
});
