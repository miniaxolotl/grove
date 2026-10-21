import AxeBuilder from "@axe-core/playwright";
import { test, expect } from "@playwright/test";

const token = (letter: string) => `gsh_${letter.repeat(43)}`;
const fixture = `http://127.0.0.1:${process.env.SHARING_TEST_PORT || 4378}`;
const one = "00000000-0000-4000-a000-000000000011";
const two = "00000000-0000-4000-a000-000000000012";
const hidden = "00000000-0000-4000-a000-000000000099";

test("public note is readable signed out, safe, responsive and not indexed", async ({
  page,
}, info) => {
  const privateRequests: string[] = [];
  page.on("request", (request) => {
    if (/\/api\/grove|images\.example\.test/.test(request.url()))
      privateRequests.push(request.url());
  });
  const response = await page.goto(`/s/${token("A")}`);
  expect(response!.status()).toBe(200);
  expect(response!.headers()["cache-control"]).toContain("no-store");
  expect(response!.headers()["referrer-policy"]).toBe("no-referrer");
  expect(response!.headers()["x-robots-tag"]).toContain("noindex");
  await expect(
    page.getByRole("heading", { name: "A shared idea", level: 1 }),
  ).toBeVisible();
  await expect(page.getByText("Keep the useful details.")).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Private note", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: "Another shared note", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: "Image: Reference" }),
  ).toHaveAttribute("rel", "noreferrer noopener nofollow");
  await expect(
    page.locator(
      ".memory-markdown script, .memory-markdown input, .memory-markdown img",
    ),
  ).toHaveCount(0);
  await expect(page.locator('a[href^="javascript:"]')).toHaveCount(0);
  await expect(page.getByRole("textbox")).toHaveCount(0);
  expect(await page.title()).toBe("Shared with you · Grove");
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
    "content",
    /noindex/,
  );
  expect(privateRequests).toEqual([]);
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    expect(
      (
        await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
          .analyze()
      ).violations,
    ).toEqual([]);
    await page.screenshot({
      path: info.outputPath(`shared-note-${width}.png`),
      fullPage: true,
    });
  }
});

test("shared notebook supports bounded navigation and protects outside references", async ({
  page,
}) => {
  const root = `/s/${token("B")}`;
  await page.goto(root);
  await expect(
    page.getByRole("heading", { name: "Ideas for autumn" }),
  ).toBeVisible();
  await page.getByRole("link", { name: "A shared idea" }).click();
  await expect(page).toHaveURL(new RegExp(`/notes/${one}$`));
  await page
    .getByRole("link", { name: "Another shared note", exact: true })
    .click();
  await expect(page).toHaveURL(new RegExp(`/notes/${two}$`));
  await page.getByRole("link", { name: "Ideas for autumn" }).click();
  await page.getByRole("link", { name: "More notes" }).click();
  await expect(
    page.getByRole("link", { name: "Another shared note" }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "More notes" })).toHaveCount(0);
  await page.goto(root);
  await page.getByRole("link", { name: "Reading list" }).click();
  await expect(
    page.getByText("No notes to read in this notebook yet."),
  ).toBeVisible();
  const outside = await page.goto(`${root}/notes/${hidden}`);
  expect(outside!.status()).toBe(404);
  await expect(
    page.getByRole("heading", { name: "This link is unavailable" }),
  ).toBeVisible();
});

test("saved edits are live and revoked links cannot be revived by reload or history", async ({
  page,
  request,
}) => {
  const key = token("C");
  await request.post(`${fixture}/_fixture/${key}`, { data: {} });
  await page.goto(`/s/${key}`);
  await expect(page.getByText("Keep the useful details.")).toBeVisible();
  await request.post(`${fixture}/_fixture/${key}`, {
    data: {
      title: "A newer idea",
      content: "# A newer idea\n\nSaved changes are visible.",
    },
  });
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "A newer idea" }),
  ).toBeVisible();
  await page.goto(`/s/${token("A")}`);
  await request.post(`${fixture}/_fixture/${key}`, { data: { revoked: true } });
  await page.goBack();
  await expect(
    page.getByRole("heading", { name: "This link is unavailable" }),
  ).toBeVisible();
  expect((await page.reload())!.status()).toBe(404);
  await expect(page.getByText("Saved changes are visible.")).toHaveCount(0);
});

test("missing links and temporary upstream failures have distinct recoverable states", async ({
  page,
  request,
}) => {
  expect((await page.goto(`/s/${token("Z")}`))!.status()).toBe(404);
  await expect(
    page.getByRole("heading", { name: "This link is unavailable" }),
  ).toBeVisible();
  const key = token("D");
  await request.post(`${fixture}/_fixture/${key}`, { data: { failed: true } });
  await page.goto(`/s/${key}`);
  await expect(
    page.getByRole("heading", { name: "Could not open this link" }),
  ).toBeVisible();
  await request.post(`${fixture}/_fixture/${key}`, { data: {} });
  await page.getByRole("link", { name: "Try again" }).click();
  await expect(
    page.getByRole("heading", { name: "A shared idea" }),
  ).toBeVisible();
  expect(await (await request.get("/sitemap.xml")).text()).not.toContain("/s/");
  expect(await (await request.get("/robots.txt")).text()).toContain(
    "Disallow: /s/",
  );
});
