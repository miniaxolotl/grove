import { test, expect } from "@playwright/test";
import { campaignUrl } from "../src/lib/campaign-url";
import { errorSummary } from "../src/lib/error-summary";

test("campaign reporting keeps only unambiguous public dimensions", () => {
  const base = "https://example.test";
  const paths = new Set(["/support"]);
  expect(
    campaignUrl(
      "/support?utm_source=news&utm_content=blue&utm_term=a&utm_term=b&token=secret#private",
      base,
      paths,
    ),
  ).toBe(base + "/support?utm_source=news&utm_content=blue");
  expect(
    campaignUrl("/private/secret?utm_source=news", base, paths),
  ).toBeNull();
  expect(campaignUrl("https://external.test/support", base, paths)).toBeNull();
});

test("internal errors distinguish causes without copying private exception data", () => {
  expect(
    errorSummary(
      "Failed to fetch dynamically imported module: https://example.test/token",
      "/support",
    ),
  ).toBe("JavaScript chunk failed to load on /support");
  expect(errorSummary("Failed to fetch", "/support")).toBe(
    "Network request failed on /support",
  );
  expect(errorSummary("customer private text", "/support")).not.toContain(
    "private text",
  );
});
