import { defineConfig } from "@playwright/test";
import base from "./playwright.webkit.config";

export default defineConfig({
  ...base,
  grep: /conversation history|history switches|conversations reopen|history search is a read/,
});
