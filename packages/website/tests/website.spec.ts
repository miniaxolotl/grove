import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const siteURL = new URL(process.env.SITE_URL || "http://localhost:3000").origin;

test("serves the product story, installation, and FAQ without JavaScript", async ({
  browser,
  baseURL,
}) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto(baseURL!);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "New session.Same context.",
  );
  await expect(page.getByLabel("Docker setup", { exact: true })).toContainText(
    "docker compose up -d",
  );
  await page.getByText("Where does my data go?", { exact: true }).click();
  await expect(
    page.getByText(
      "Memories are stored in the Qdrant instance you configure.",
      { exact: false },
    ),
  ).toBeVisible();
  await page.getByRole("link", { name: "Open the installation guide" }).click();
  await expect(page).toHaveURL(/\/install$/);
  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    "agent’s memory",
  );
  await context.close();
});

test("memory examples and comparison work with keyboard navigation", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("tab", { name: "Your decisions" }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(
    page.getByRole("tab", { name: "Your preferences" }),
  ).toBeFocused();
  await expect(
    page.getByRole("tab", { name: "Your preferences" }),
  ).toHaveAttribute("aria-selected", "true");
  await expect(
    page.getByRole("tabpanel", { name: "Your preferences" }),
  ).toContainText("I’ll use Vitest");
  await page.getByRole("button", { name: "Without", exact: true }).click();
  await expect(
    page.getByRole("tabpanel", { name: "Your preferences" }),
  ).toContainText("Which testing framework would you like?");
  await page.getByRole("button", { name: "With Grove", exact: true }).click();
  await expect(
    page.getByRole("tabpanel", { name: "Your preferences" }),
  ).toContainText("I’ll use Vitest");
});

test("installation switches methods and copies the complete setup", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/install");
  await page.getByRole("tab", { name: "npm", exact: true }).click();
  await expect(page.getByLabel("npm setup", { exact: true })).toContainText(
    "grove-qdrant:/qdrant/storage",
  );
  await page
    .getByRole("button", { name: "Copy npm setup", exact: true })
    .click();
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied).toContain("npm install -g @miniaxolotl/grove");
  expect(copied).toContain("grove serve");
  expect(copied).toContain("docker run");
  await page.getByRole("tab", { name: "Other MCP clients" }).click();
  await expect(
    page.getByLabel("Streamable HTTP endpoint", { exact: true }),
  ).toHaveText("http://localhost:26080/mcp");
  await page.getByRole("tab", { name: "OpenCode", exact: true }).click();
  const config = JSON.parse(
    (await page.getByLabel("opencode.json", { exact: true }).textContent())!,
  );
  expect(config.mcp.grove.url).toBe("http://localhost:26080/mcp");
  expect(config.plugin).toContain("@miniaxolotl/grove-opencode-plugin");
});

test("sharing copies the canonical URL and offers a fallback when clipboard is unavailable", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.addInitScript(() =>
    Object.defineProperty(navigator, "share", {
      value: undefined,
      configurable: true,
    }),
  );
  await page.goto("/");
  await page.getByRole("button", { name: "Share a little Grove" }).click();
  await expect(
    page.getByRole("button", { name: "Link copied. Let it grow." }),
  ).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    siteURL,
  );

  await page.evaluate(() =>
    Object.defineProperty(navigator, "clipboard", {
      value: undefined,
      configurable: true,
    }),
  );
  await page.getByRole("button", { name: "Link copied. Let it grow." }).click();
  await expect(
    page.getByRole("textbox", { name: "Grove link to share" }),
  ).toHaveValue(siteURL);

  for (const platform of ["X", "LinkedIn", "Bluesky"]) {
    const href = await page
      .getByRole("link", {
        name: `Share Grove on ${platform} (opens a new tab)`,
        exact: true,
      })
      .getAttribute("href");
    expect(decodeURIComponent(href!)).toContain(siteURL);
  }
});

test("native sharing cancellation is quiet and clipboard failure remains usable", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "share", {
      value: async () => {
        throw new DOMException("Cancelled", "AbortError");
      },
    });
    Object.defineProperty(navigator, "clipboard", { value: undefined });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Share a little Grove" }).click();
  await expect(
    page.getByRole("textbox", { name: "Grove link to share" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Share a little Grove" }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Copy npm install command" }).click();
  await expect(
    page.getByText("Select the text below to copy manually."),
  ).toBeVisible();
});

test("social metadata, crawler routes, and generated images are usable", async ({
  page,
  request,
}) => {
  await page.goto("/");
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
    "href",
    siteURL,
  );
  await expect(page.locator('meta[name="twitter:card"]')).toHaveAttribute(
    "content",
    "summary_large_image",
  );
  await expect(page.locator('meta[property="og:title"]')).toHaveAttribute(
    "content",
    "Grove — New session. Same context.",
  );
  const schema = JSON.parse(
    (await page.locator('script[type="application/ld+json"]').textContent())!,
  );
  expect(
    schema["@graph"].some(
      (item: { "@type": string }) => item["@type"] === "SoftwareApplication",
    ),
  ).toBe(true);

  const image = await request.get("/opengraph-image");
  expect(image.ok()).toBe(true);
  expect(image.headers()["content-type"]).toContain("image/png");
  const png = await image.body();
  expect(png.readUInt32BE(16)).toBe(1200);
  expect(png.readUInt32BE(20)).toBe(630);
  expect((await request.get("/apple-icon")).ok()).toBe(true);
  expect(await (await request.get("/sitemap.xml")).text()).toContain(
    `${siteURL}/install`,
  );
  expect(await (await request.get("/robots.txt")).text()).toContain(
    `${siteURL}/sitemap.xml`,
  );

  await page.goto("/install");
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
    "href",
    `${siteURL}/install`,
  );
  expect((await request.get("/a-page-that-does-not-exist")).status()).toBe(404);
});

test("mobile navigation and layouts work at narrow and wide widths", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByRole("button", { name: "Open navigation" }).click();
  await expect(
    page.getByRole("navigation", { name: "Mobile navigation" }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("button", { name: "Open navigation" }),
  ).toBeFocused();
  await page.getByRole("button", { name: "Open navigation" }).click();
  await page
    .getByRole("navigation", { name: "Mobile navigation" })
    .getByRole("link", { name: "Why Grove" })
    .click();
  await expect(
    page.getByRole("navigation", { name: "Mobile navigation" }),
  ).toBeHidden();
  await expect(page).toHaveURL(/#features$/);

  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
  }
});

test("key pages meet automated accessibility checks and render without browser errors", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  for (const path of ["/", "/install"]) {
    await page.goto(path);
    const result = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .analyze();
    expect(
      result.violations.map(({ id, nodes }) => ({
        id,
        nodes: nodes.map(({ target, failureSummary }) => ({
          target,
          failureSummary,
        })),
      })),
    ).toEqual([]);
  }
  expect(errors).toEqual([]);
});
