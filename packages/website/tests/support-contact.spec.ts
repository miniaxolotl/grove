import { expect, test } from "@playwright/test";

test("current public contacts use the Grove support mailbox", async ({
  page,
}) => {
  for (const path of [
    "/",
    "/privacy",
    "/terms",
    "/sign-in",
    "/missing-help-page",
  ]) {
    await page.goto(path);
    await expect(
      page.locator('a[href^="mailto:"][href*="@mawa.dev"]'),
    ).toHaveCount(0);
  }
  await page.goto("/privacy");
  await expect(
    page.locator('main a[href="mailto:support@usegrove.cloud"]').first(),
  ).toBeVisible();
});
