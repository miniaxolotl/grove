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
  await expect(
    page.getByLabel("OpenCode connection command", { exact: true }),
  ).toContainText("grove connect opencode");
  await page.getByText("Where does my data go?", { exact: true }).click();
  await expect(
    page.getByText(
      "Memories are stored in private PostgreSQL behind Grove’s authenticated API.",
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

test("Cloud setup selects the right agent and keeps self-hosting on its own page", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/install");
  for (const [label, client] of [
    ["OpenCode", "opencode"],
    ["Claude Code", "claude"],
    ["Codex", "codex"],
  ]) {
    await page.getByRole("tab", { name: label, exact: true }).click();
    await expect(
      page.getByLabel(`${label} connection command`, { exact: true }),
    ).toHaveText(`npx @miniaxolotl/grove connect ${client}`);
    await page
      .getByRole("button", {
        name: `Copy ${label} connection command`,
        exact: true,
      })
      .click();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
      `npx @miniaxolotl/grove connect ${client}`,
    );
  }
  await expect(
    page.getByText("docker compose up -d", { exact: false }),
  ).toHaveCount(0);
  await page.getByRole("tab", { name: "Other MCP clients" }).click();
  await expect(
    page.getByLabel("Streamable HTTP endpoint", { exact: true }),
  ).toHaveText("https://api.usegrove.cloud/mcp");
  await page.getByRole("link", { name: "Install Grove Open Source" }).click();
  await expect(page).toHaveURL(/\/self-host$/);
  await expect(
    page.getByLabel("Self-hosted Docker setup", { exact: true }),
  ).toContainText("docker compose up -d");
  await expect(
    page.getByLabel("Connect to your server", { exact: true }),
  ).toContainText("--url https://grove-api.example.com");
});

test("the public library preview supports keyboard exploration without account mutations", async ({
  page,
}) => {
  const writes: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/api/grove/") && request.method() !== "GET")
      writes.push(request.url());
  });
  await page.goto("/");
  await page.getByRole("tab", { name: "Memories", exact: true }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(
    page.getByRole("tab", { name: "Connections", exact: true }),
  ).toBeFocused();
  await expect(
    page.getByRole("tabpanel", { name: "Connections", exact: true }),
  ).toContainText("Project-scoped connection");
  await page.keyboard.press("End");
  await expect(
    page.getByRole("tabpanel", { name: "Archive", exact: true }),
  ).toContainText("Kept out of active recall");
  expect(writes).toEqual([]);
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
  await page
    .getByRole("button", { name: "Copy Cloud connection command" })
    .click();
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

test("mobile navigation keeps account access available and dismisses on focus exit and resize", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 900 });
  await page.goto("/privacy");
  const navigation = page.getByRole("navigation", {
    name: "Mobile navigation",
  });
  await page.getByRole("button", { name: "Open navigation" }).click();
  await expect(
    navigation.getByRole("link", { name: "Your Grove", exact: true }),
  ).toHaveAttribute("href", "/app");
  await page.keyboard.press("Shift+Tab");
  await expect(navigation).not.toBeVisible();
  await page.getByRole("button", { name: "Open navigation" }).click();
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.setViewportSize({ width: 320, height: 900 });
  await expect(navigation).not.toBeVisible();
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
