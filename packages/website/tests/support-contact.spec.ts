import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

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

for (const route of ["support", "contact"]) {
  test(`${route} is public with correct metadata, navigation and accessibility`, async ({
    page,
    request,
  }) => {
    const origin = new URL(
      process.env.SITE_URL ||
        (process.env.VERCEL_PROJECT_PRODUCTION_URL &&
          `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`) ||
        "http://localhost:3000",
    ).origin;
    expect((await page.goto(`/${route}`))?.status()).toBe(200);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      route === "support" ? "Support for Grove." : "Contact Grove.",
    );
    await expect(
      page.locator('main a[href="mailto:support@usegrove.cloud"]').first(),
    ).toBeVisible();
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
      "href",
      `${origin}/${route}`,
    );
    await expect(page).toHaveTitle(
      `${route === "support" ? "Support" : "Contact"} | Grove`,
    );
    const footer = page.getByRole("contentinfo");
    await expect(
      footer.getByRole("link", { name: "Support", exact: true }),
    ).toHaveAttribute("href", "/support");
    await expect(
      footer.getByRole("link", { name: "Contact", exact: true }),
    ).toHaveAttribute("href", "/contact");
    expect(await (await request.get("/sitemap.xml")).text()).toContain(
      `${origin}/${route}`,
    );
    for (const width of [320, 1440]) {
      await page.setViewportSize({ width, height: 950 });
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      expect(
        (
          await new AxeBuilder({ page })
            .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
            .analyze()
        ).violations,
      ).toEqual([]);
    }
  });
}

test("help stays public without JavaScript and account assistance opens support", async ({
  page,
  browser,
  baseURL,
}) => {
  await page.goto("/sign-in");
  await expect(page.locator(".auth-help a")).toHaveAttribute(
    "href",
    "/support",
  );
  const context = await browser.newContext({
    baseURL,
    javaScriptEnabled: false,
  });
  try {
    const plain = await context.newPage();
    for (const route of ["support", "contact"]) {
      expect((await plain.goto(`/${route}`))?.status()).toBe(200);
      await expect(
        plain.locator('main a[href="mailto:support@usegrove.cloud"]').first(),
      ).toBeVisible();
    }
    await plain
      .getByRole("contentinfo")
      .getByRole("link", { name: "Support", exact: true })
      .focus();
    await plain.keyboard.press("Enter");
    await expect(plain).toHaveURL(/\/support$/);
  } finally {
    await context.close();
  }
});
