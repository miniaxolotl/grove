import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { fixture, handoff, note, project } from "./fixtures/workspace-fixture";

const base = `http://127.0.0.1:${process.env.DASHBOARD_TEST_PORT || 3101}`;
const href = `/app/memories/${handoff.id}#next`;
const content = `# Linked field notes

[Linked note](${href} "grove:title:v1") and [My own caption](${href}).

[Old source](/app/memories/${handoff.id}?revision=1#done "grove:title:v1")

[Notebook](/app/projects/${project.id} "grove:title:v1")

[Outside](https://outside.example/app/memories/${handoff.id})

\`[Code example](${href})\`
`;

for (const width of [1440, 390, 320]) {
  test(`internal links keep navigation separate from on-demand accessible previews at ${width}px`, async ({
    page,
  }, info) => {
    await page.setViewportSize({ width, height: width === 320 ? 480 : 900 });
    const state = await fixture(page, [{ ...note, content }, handoff]);
    const reads: string[] = [];
    await page.route("**/api/grove/link-previews/**", async (route) => {
      reads.push(route.request().url());
      const url = new URL(route.request().url());
      const notebook = url.pathname.includes("/notebook/");
      await route.fulfill({
        json: {
          success: true,
          data: {
            kind: notebook ? "notebook" : "note",
            id: notebook ? project.id : handoff.id,
            title: notebook
              ? project.name
              : url.searchParams.has("revision")
                ? "Original launch plan"
                : "Launch checklist",
            excerpt: notebook ? null : "Review keyboard access before launch.",
            version: 1,
            expiresAt: null,
          },
        },
      });
    });
    await page.goto(`${base}/app/memories/${note.id}`);
    await expect(
      page.getByRole("link", { name: "Linked note", exact: true }),
    ).toHaveAttribute("href", href);
    expect(reads).toHaveLength(0);
    const trigger = page
      .getByRole("button", { name: "Preview linked note", exact: true })
      .first();
    await trigger.focus();
    expect(reads).toHaveLength(0);
    await trigger.press("Enter");
    const popup = page.getByRole("group", {
      name: "Preview linked note",
      exact: true,
    });
    await expect(
      popup.getByText("Launch checklist", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Launch checklist", exact: true }).first(),
    ).toHaveAttribute("href", href);
    await expect(
      page.getByRole("link", { name: "My own caption", exact: true }),
    ).toBeVisible();
    expect(reads).toHaveLength(1);
    expect(new URL(page.url()).pathname).toBe(`/app/memories/${note.id}`);
    expect(await page.locator("p .action-menu").count()).toBe(0);
    const box = await popup.boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(width);
    expect(box!.y + box!.height).toBeLessThanOrEqual(width === 320 ? 480 : 900);
    expect(
      (await new AxeBuilder({ page }).include(".grove-link-preview").analyze())
        .violations,
    ).toEqual([]);
    await page.screenshot({
      path: info.outputPath(`link-preview-${width}.png`),
    });
    await page.keyboard.press("Escape");
    await expect(popup).not.toBeVisible();
    await expect(trigger).toBeFocused();
    expect(state.records.get(note.id)!.content).toBe(content);
    expect(
      state.calls.filter((call) => call.path === "/memories"),
    ).toHaveLength(0);
    // Custom captions never become title-following labels, even after a preview.
    await page
      .getByRole("button", { name: "Preview linked note", exact: true })
      .nth(1)
      .click();
    await expect(
      popup.getByText("Launch checklist", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "My own caption", exact: true }),
    ).toBeVisible();
    await page.keyboard.press("Escape");
    await page
      .getByRole("button", { name: "Preview linked note", exact: true })
      .nth(2)
      .click();
    await expect(
      popup.getByText("Original launch plan", { exact: true }),
    ).toBeVisible();
    await expect(
      popup.getByRole("link", { name: "Open revision 1" }),
    ).toHaveAttribute("href", `/app/memories/${handoff.id}?revision=1#done`);
    await page.keyboard.press("Escape");
    await page
      .getByRole("button", { name: "Preview linked notebook", exact: true })
      .click();
    await expect(
      page
        .getByRole("group", { name: "Preview linked notebook" })
        .getByText(project.name, { exact: true }),
    ).toBeVisible();
    expect(reads.some((url) => url.includes("outside.example"))).toBe(false);
    expect(reads).toHaveLength(4);
  });
}

test("denied preview refresh removes previously resolved labels and excerpts", async ({
  page,
}) => {
  await fixture(page, [{ ...note, content }, handoff]);
  let denied = false;
  await page.route("**/api/grove/link-previews/**", async (route) => {
    await route.fulfill(
      denied
        ? {
            status: 404,
            json: {
              success: false,
              error: { code: "not_found", message: "Unavailable" },
            },
          }
        : {
            json: {
              success: true,
              data: {
                kind: "note",
                id: handoff.id,
                title: "Private linked title",
                excerpt: "Private excerpt",
                version: 1,
                expiresAt: null,
              },
            },
          },
    );
  });
  await page.goto(`${base}/app/memories/${note.id}`);
  const trigger = page
    .getByRole("button", { name: "Preview linked note", exact: true })
    .first();
  await trigger.click();
  const popup = page.getByRole("group", {
    name: "Preview linked note",
    exact: true,
  });
  await expect(popup.getByText("Private excerpt")).toBeVisible();
  await page.keyboard.press("Escape");
  denied = true;
  await trigger.click();
  await expect(popup.getByText("This link is unavailable.")).toBeVisible();
  await expect(
    page.getByText("Private linked title", { exact: true }),
  ).toHaveCount(0);
  await expect(page.getByText("Private excerpt", { exact: true })).toHaveCount(
    0,
  );
  await expect(
    page.getByRole("link", { name: "Linked note", exact: true }),
  ).toBeVisible();
});

test("preview popovers stay inside a native quick-open dialog and Escape closes only the preview", async ({
  page,
}) => {
  await fixture(page, [{ ...note, content }, handoff]);
  await page.route("**/api/grove/link-previews/**", (route) =>
    route.fulfill({
      json: {
        success: true,
        data: {
          kind: "note",
          id: handoff.id,
          title: "Launch checklist",
          excerpt: "A compact linked note.",
          version: 1,
          expiresAt: null,
        },
      },
    }),
  );
  await page.goto(`${base}/app`);
  await page.locator(`[data-note-id="${note.id}"] .memory-open`).click();
  const dialog = page.locator("dialog[open]");
  await expect(dialog).toHaveCount(1);
  const trigger = dialog
    .getByRole("button", { name: "Preview linked note", exact: true })
    .first();
  await trigger.click();
  const popup = dialog.getByRole("group", {
    name: "Preview linked note",
    exact: true,
  });
  await expect(popup.getByText("A compact linked note.")).toBeVisible();
  await popup.getByRole("link", { name: "Open note", exact: true }).focus();
  await page.keyboard.press("Escape");
  await expect(popup).not.toBeVisible();
  await expect(dialog).toBeVisible();
  await expect(trigger).toBeFocused();
});

test("closing a loading preview cancels its read and a late reply cannot change the fallback label", async ({
  page,
}) => {
  await fixture(page, [{ ...note, content }, handoff]);
  const release = Promise.withResolvers<void>();
  let started = false,
    cancelled = false;
  page.on("requestfailed", (request) => {
    if (request.url().includes("/link-previews/")) cancelled = true;
  });
  await page.route("**/api/grove/link-previews/**", async (route) => {
    started = true;
    await release.promise;
    await route
      .fulfill({
        json: {
          success: true,
          data: {
            kind: "note",
            id: handoff.id,
            title: "Late private title",
            excerpt: "Late private excerpt",
            version: 1,
            expiresAt: null,
          },
        },
      })
      .catch(() => {});
  });
  await page.goto(`${base}/app/memories/${note.id}`);
  await page
    .getByRole("button", { name: "Preview linked note", exact: true })
    .first()
    .click();
  await expect.poll(() => started).toBe(true);
  await page.keyboard.press("Escape");
  await expect.poll(() => cancelled).toBe(true);
  release.resolve();
  await expect(
    page.getByText("Late private title", { exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: "Linked note", exact: true }),
  ).toBeVisible();
});

test("retrying a temporary preview failure keeps the anchored popover open", async ({
  page,
}) => {
  await fixture(page, [{ ...note, content }, handoff]);
  let unavailable = true;
  await page.route("**/api/grove/link-previews/**", (route) =>
    route.fulfill(
      unavailable
        ? {
            status: 503,
            json: {
              success: false,
              error: { code: "unavailable", message: "Try again" },
            },
          }
        : {
            json: {
              success: true,
              data: {
                kind: "note",
                id: handoff.id,
                title: "Recovered linked note",
                excerpt: "Recovered excerpt",
                version: 1,
                expiresAt: null,
              },
            },
          },
    ),
  );
  await page.goto(`${base}/app/memories/${note.id}`);
  await page
    .getByRole("button", { name: "Preview linked note", exact: true })
    .first()
    .click();
  const popup = page.getByRole("group", {
    name: "Preview linked note",
    exact: true,
  });
  await expect(
    popup.getByRole("button", { name: "Retry preview" }),
  ).toBeVisible();
  unavailable = false;
  await popup.getByRole("button", { name: "Retry preview" }).click();
  await expect(popup.getByText("Recovered excerpt")).toBeVisible();
});
