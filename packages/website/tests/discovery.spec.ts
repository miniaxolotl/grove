import { expect, test } from "@playwright/test";

const references = [
  ["client", "Agent installation", "npx @miniaxolotl/grove connect"],
  ["server", "Memory tools and API", "memory_history"],
  ["models", "Models", "embedding"],
  ["ask-tools", "Ask", "Apply"],
  ["hosted-chat", "ChatGPT", "OAuth"],
] as const;

test.describe("public reference documents", () => {
  test.use({ javaScriptEnabled: false });
  for (const [slug, heading, content] of references) {
    test(`${slug} is served as canonical readable HTML`, async ({ page }) => {
      expect((await page.goto(`/docs/${slug}`))?.status()).toBe(200);
      await expect(page.locator("main h1")).toHaveCount(1);
      await expect(page.locator("main h1")).toContainText(heading);
      await expect(page.locator("article")).toContainText(content);
      await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
        "href",
        `http://localhost:3000/docs/${slug}`,
      );
      await expect(page.locator('meta[name="description"]')).toHaveAttribute(
        "content",
        /\S.{30}/,
      );
      await expect(
        page
          .getByRole("navigation", { name: "Documentation" })
          .getByRole("link", { name: "Agent installation", exact: true }),
      ).toHaveAttribute("href", "/docs/client");
      const sitemap = await page.request.get("/sitemap.xml");
      expect(await sitemap.text()).toContain(`/docs/${slug}</loc>`);
    });
  }

  test("documentation hub is linked, and approved relative references stay on the site", async ({
    page,
  }) => {
    await page.goto("/");
    await page
      .getByRole("contentinfo")
      .getByRole("link", { name: "Documentation", exact: true })
      .click();
    await expect(page).toHaveURL(/\/docs$/);
    await page
      .getByRole("article")
      .getByRole("link", { name: "Agent installation", exact: true })
      .click();
    await expect(
      page.locator('article a[href="/docs/hosted-chat"]'),
    ).toBeVisible();
    await expect(
      page.locator(
        'article a[href="https://github.com/miniaxolotl/grove/blob/production/documentation/cloud-onboarding.md"]',
      ),
    ).toBeVisible();
    await page.goto("/docs/server");
    await expect(page.locator("#memory-and-notebook-tools")).toHaveCount(1);
    await expect(page.locator('article a[href="/docs/models"]')).toBeVisible();
  });

  test("public document allowlist never exposes arbitrary repository files", async ({
    request,
  }) => {
    for (const path of [
      "/docs/secrets",
      "/docs/delivery",
      "/docs/not-a-document",
    ]) {
      expect((await request.get(path)).status()).toBe(404);
    }
    const robots = await (await request.get("/robots.txt")).text();
    for (const path of ["/app", "/api", "/sign-in", "/sign-up", "/s/"]) {
      expect(robots).toContain(`Disallow: ${path}`);
    }
    const sitemap = await (await request.get("/sitemap.xml")).text();
    expect(sitemap).not.toMatch(/<loc>[^<]*\/(?:app|api|sign-in|sign-up|s)\b/);
  });
});

test("reference tables and commands stay within narrow viewports", async ({
  page,
}) => {
  expect((await page.goto("/docs/server"))?.status()).toBe(200);
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 950 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
});

test("documentation social-image dimensions match the served PNG", async ({
  page,
  request,
}) => {
  await page.goto("/docs/client");
  const url = new URL(
    (await page
      .locator('meta[property="og:image"]')
      .first()
      .getAttribute("content"))!,
  );
  const response = await request.get(url.pathname + url.search);
  expect(response.status()).toBe(200);
  const png = await response.body();
  expect(png.subarray(1, 4).toString()).toBe("PNG");
  await expect(page.locator('meta[property="og:image:width"]')).toHaveAttribute(
    "content",
    String(png.readUInt32BE(16)),
  );
  await expect(
    page.locator('meta[property="og:image:height"]'),
  ).toHaveAttribute("content", String(png.readUInt32BE(20)));
});
