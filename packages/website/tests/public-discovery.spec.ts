import { expect, test } from "@playwright/test";

test.use({ javaScriptEnabled: false });

test("public AI guide is readable, linked and excludes private notebook content", async ({
  page,
  request,
}) => {
  const response = await request.get("/llms.txt");
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toContain("text/plain");
  const text = await response.text();
  expect(text).toMatch(/^# Grove/m);
  expect(text).toContain("/pricing");
  expect(text).toContain("/docs");
  expect(text).toContain("Private notes are not public documentation");
  expect(text).not.toMatch(/<html|api[_-]?key|secret|token=/i);
  await page.goto("/");
  await expect(
    page.locator('link[rel="alternate"][type="text/plain"]'),
  ).toHaveAttribute("href", "/llms.txt");
});
