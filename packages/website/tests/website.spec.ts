import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "./telemetry-fixtures";

const siteURL = new URL(process.env.SITE_URL || "http://localhost:3000").origin;

test("serves the notebook story, signup links, and FAQ without JavaScript", async ({
  browser,
  baseURL,
}) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto(baseURL!);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Good ideas.Room to grow.",
  );
  await expect(
    page.getByRole("link", { name: "Start your notebook" }).first(),
  ).toHaveAttribute("href", "/sign-up");
  await expect(
    page.getByRole("heading", { name: "Saturday", exact: true }),
  ).toBeVisible();
  await page.getByText("Is my notebook private?", { exact: true }).click();
  await expect(
    page.getByText("Your notes belong to your account.", { exact: false }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Connect your AI tools" }).click();
  await expect(page).toHaveURL(/\/install$/);
  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    "AI tools.",
  );
  await expect(
    page.getByLabel("OpenCode connection command", { exact: true }),
  ).toContainText("grove connect opencode");
  await page.goto(baseURL!);
  await page.getByRole("link", { name: "Start your notebook" }).first().click();
  await expect(page).toHaveURL(/\/sign-up$/);
  await context.close();
});

test("Ask Grove examples, comparison and source notes work with keyboard navigation", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("tab", { name: "Travel plans" }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(
    page.getByRole("tab", { name: "Everyday preferences" }),
  ).toBeFocused();
  await expect(
    page.getByRole("tab", { name: "Everyday preferences" }),
  ).toHaveAttribute("aria-selected", "true");
  await expect(
    page.getByRole("tabpanel", { name: "Everyday preferences" }),
  ).toContainText("Something vegetarian, made in one pan");
  await page
    .getByRole("button", { name: "No saved note", exact: true })
    .click();
  await expect(
    page.getByRole("tabpanel", { name: "Everyday preferences" }),
  ).toContainText("No saved note about your dinner preferences yet.");
  await page.getByRole("button", { name: "With a note", exact: true }).click();
  await expect(
    page.getByRole("tabpanel", { name: "Everyday preferences" }),
  ).toContainText("Something vegetarian, made in one pan");
  await page
    .getByRole("link", { name: "View note: Weeknight dinners" })
    .focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/#example-note-preferences$/);
  await expect(page.locator("#example-note-preferences")).toBeInViewport();
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
  await page.goto("/install");
  await page.getByRole("tab", { name: "Claude Code", exact: true }).click();
  await page.goto("/");
  await page
    .getByRole("main")
    .getByRole("link", { name: "Connect your AI tools", exact: true })
    .click();
  await expect(page).toHaveURL(/\/install$/);
  await expect(
    page.getByRole("tab", { name: "Claude Code", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await expect(
    page.getByLabel("Claude Code connection command", { exact: true }),
  ).toContainText("grove connect claude");
  await page.evaluate(() => {
    Storage.prototype.setItem = () => {
      throw new DOMException("Storage full", "QuotaExceededError");
    };
  });
  await page.getByRole("tab", { name: "Codex", exact: true }).click();
  await expect(
    page.getByLabel("Codex connection command", { exact: true }),
  ).toContainText("grove connect codex");
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
  await page.getByRole("tab", { name: "Notes", exact: true }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(
    page.getByRole("tab", { name: "By date", exact: true }),
  ).toBeFocused();
  await expect(
    page.getByRole("tabpanel", { name: "By date", exact: true }),
  ).toContainText("A small win");
  await page.keyboard.press("End");
  await expect(
    page.getByRole("tabpanel", { name: "Graph", exact: true }).getByRole("img"),
  ).toHaveAccessibleName(/connections between a balcony garden/);
  await page.keyboard.press("Home");
  await expect(
    page.getByRole("tabpanel", { name: "Notes", exact: true }),
  ).toContainText("A tiny balcony garden");
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
  await page.getByRole("button", { name: "Share Grove" }).click();
  await expect(page.getByRole("button", { name: "Link copied" })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    siteURL,
  );

  await page.evaluate(() =>
    Object.defineProperty(navigator, "clipboard", {
      value: undefined,
      configurable: true,
    }),
  );
  await page.getByRole("button", { name: "Link copied" }).click();
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
  await page.getByRole("button", { name: "Share Grove" }).click();
  await expect(
    page.getByRole("textbox", { name: "Grove link to share" }),
  ).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Share Grove" })).toBeEnabled();
  await page.goto("/install");
  await page
    .getByRole("button", {
      name: "Copy OpenCode connection command",
      exact: true,
    })
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
    "Grove | Good ideas. Room to grow.",
  );
  const schema = JSON.parse(
    (await page.locator('script[type="application/ld+json"]').textContent())!,
  );
  const application = schema["@graph"].find(
    (item: { "@type": string }) => item["@type"] === "SoftwareApplication",
  );
  expect(application.applicationCategory).toBe("ProductivityApplication");
  expect(application.installUrl).toBe(`${siteURL}/sign-up`);
  await expect(page.locator('meta[name="description"]')).toHaveAttribute(
    "content",
    /private notebook/,
  );

  const image = await request.get("/opengraph-image");
  expect(image.ok()).toBe(true);
  expect(image.headers()["content-type"]).toContain("image/png");
  const png = await image.body();
  expect(png.readUInt32BE(16)).toBe(1200);
  expect(png.readUInt32BE(20)).toBe(628);
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
