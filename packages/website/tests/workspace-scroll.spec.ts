import { expect, test, type Locator, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { fixture, note, project } from "./fixtures/workspace-fixture";

const base = `http://127.0.0.1:${process.env.DASHBOARD_TEST_PORT || 3101}`;
const title = (i: number) => `Field note ${String(i).padStart(2, "0")}`;
const fieldNote = (i: number) => ({
  ...note,
  id: `43210000-1000-4000-a000-${String(i).padStart(12, "0")}`,
  content: `# ${title(i)}\n\nSynthetic observations from a garden survey.`,
  enrichment: undefined,
});

async function paint(page: Page) {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
}

const edge = (list: Locator) => list.locator(".note-continuation-edge");

for (const { label, path, width, height, status, projectId } of [
  {
    label: "Notes",
    path: "/app",
    width: 1440,
    height: 760,
    status: "active",
    projectId: undefined,
  },
  {
    label: "Archive",
    path: "/app/archive",
    width: 390,
    height: 760,
    status: "archived",
    projectId: undefined,
  },
  {
    label: "scoped notebook",
    path: `/app/projects/${project.id}`,
    width: 320,
    height: 740,
    status: "active",
    projectId: project.id,
  },
] as const) {
  test(`${label} appends at the scroll edge without replacing focused rows`, async ({
    page,
  }, info) => {
    await fixture(page);
    const reads: unknown[] = [];
    const pending = Promise.withResolvers<void>();
    const items = Array.from({ length: 24 }, (_, i) => ({
      ...fieldNote(i + 1),
      status,
      projectId: projectId ?? null,
    }));
    await page.route("**/api/grove/memories/search", async (route) => {
      const input = route.request().postDataJSON();
      if (input.limit === 8) return route.fallback();
      expect(input).toMatchObject({ status });
      expect(input.projectId).toBe(projectId);
      reads.push(input.cursor ?? null);
      if (input.cursor) await pending.promise;
      await route.fulfill({
        json: {
          success: true,
          data: {
            items: input.cursor ? items.slice(19) : items.slice(0, 20),
            nextCursor: input.cursor ? null : "next",
          },
        },
      });
    });

    await page.setViewportSize({ width, height });
    await page.goto(`${base}${path}`);
    const list = page.locator(".library-list");
    const rows = list.locator(".memory-open");
    await expect(rows).toHaveCount(20);
    await expect(edge(list)).not.toBeInViewport();
    await expect(
      list.getByRole("button", { name: "Load more notes" }),
    ).toHaveCSS("clip-path", "inset(50%)");
    await paint(page);
    expect(reads).toEqual([null]);
    await list.getByRole("checkbox", { name: `Select ${title(1)}` }).check();
    const last = rows.nth(19);
    await last.evaluate((node) =>
      (node as HTMLElement).focus({ preventScroll: true }),
    );
    await page.mouse.move(width - 35, height / 2);
    await page.mouse.wheel(0, 8000);
    await expect(
      list.getByRole("status").filter({ hasText: "Loading more notes…" }),
    ).toBeVisible();
    await expect(last).toBeFocused();
    await page.mouse.wheel(0, -8000);
    await expect(edge(list)).not.toBeInViewport();
    await page.mouse.wheel(0, 8000);
    await expect(edge(list)).toBeInViewport();
    expect(reads).toEqual([null, "next"]);
    pending.resolve();
    await expect(rows).toHaveText(items.map((_, i) => title(i + 1)));
    await expect(last).toBeFocused();
    await expect(
      list.getByRole("checkbox", { name: `Select ${title(1)}` }),
    ).toBeChecked();
    await expect(edge(list)).toHaveCount(0);
    await last.press("ArrowDown");
    await expect(rows.nth(20)).toBeFocused();
    expect(
      await page.evaluate(() => {
        const root = document.documentElement;
        return root.scrollWidth - root.clientWidth;
      }),
    ).toBeLessThanOrEqual(0);
    await page.screenshot({ path: info.outputPath(`append-${width}.png`) });
  });
}

for (const width of [1440, 390]) {
  test(`expanded notebook pages honor the nested scroll clipping at ${width}px`, async ({
    page,
  }, info) => {
    const records = Array.from({ length: 19 }, (_, i) => ({
      ...fieldNote(i + 1),
      projectId: project.id,
    }));
    await fixture(page, records);
    const reads: unknown[] = [];
    await page.route("**/api/grove/memories/search", async (route) => {
      const input = route.request().postDataJSON();
      if (input.limit !== 8) {
        await route.fulfill({
          json: { success: true, data: { items: [], nextCursor: null } },
        });
        return;
      }
      expect(input.projectId).toBe(project.id);
      const offset = Number(input.cursor ?? 0);
      reads.push(offset);
      await route.fulfill({
        json: {
          success: true,
          data: {
            items: records.slice(offset, offset + 8),
            nextCursor: offset + 8 < records.length ? String(offset + 8) : null,
          },
        },
      });
    });
    await page.setViewportSize({ width, height: 640 });
    if (width === 1440) {
      await page.addInitScript(() =>
        localStorage.setItem("grove.sidebar.notebooks", "1"),
      );
    }
    await page.goto(`${base}/app/projects/${project.id}`);
    const explorer = page.locator(".notebook-explorer");
    if (width === 390) {
      await expect(explorer).toBeHidden();
      await expect(page.locator(".notebook-pages")).toHaveCount(0);
      expect(reads).toEqual([]);
      await page.locator(".notebook-browser-toggle").click();
    } else {
      const body = explorer.locator(".notebook-explorer-body");
      await expect(body).toBeHidden();
      await expect(explorer.locator(".note-continuation-edge")).toHaveCount(0);
      await paint(page);
      expect(reads).toEqual([]);
      await explorer.locator(".notebook-collapse-toggle").click();
    }
    const list = explorer.locator(".notebook-pages");
    const links = list.locator("[data-note-page-link]");
    await expect(links).toHaveCount(8);
    await expect(edge(list)).not.toBeInViewport();
    await paint(page);
    expect(reads).toEqual([0]);
    await edge(list).scrollIntoViewIfNeeded();
    await expect(links).toHaveCount(16);
    await expect(edge(list)).not.toBeInViewport();
    await edge(list).scrollIntoViewIfNeeded();
    await expect(links).toHaveText(records.map((_, i) => title(i + 1)));
    await expect(list.getByRole("link", { name: "All notes" })).toHaveCount(0);
    await expect(list.getByRole("link", { name: "New note" })).toHaveAttribute(
      "href",
      `/app/notes/new?notebook=${project.id}`,
    );
    expect(reads).toEqual([0, 8, 16]);
    await links.last().scrollIntoViewIfNeeded();
    await expect(links.last()).toBeInViewport();
    await page.screenshot({ path: info.outputPath(`tree-${width}.png`) });
  });
}

test("keyboard continuation is exposed to AT and reveals only on focus", async ({
  page,
}, info) => {
  await page.addInitScript(() =>
    Object.defineProperty(window, "IntersectionObserver", { value: undefined }),
  );
  await fixture(page);
  await page.route("**/api/grove/memories/search", async (route) => {
    const { cursor } = route.request().postDataJSON();
    await route.fulfill({
      json: {
        success: true,
        data: {
          items: [fieldNote(cursor ? 2 : 1)],
          nextCursor: cursor ? null : "next",
        },
      },
    });
  });
  await page.goto(`${base}/app`);
  const list = page.locator(".library-list");
  const more = list.getByRole("button", { name: "Load more notes" });
  await expect(more).toHaveCSS("clip-path", "inset(50%)");
  await expect(list.ariaSnapshot()).resolves.toContain(
    'button "Load more notes"',
  );
  const actions = list.getByRole("button", { name: `Actions for ${title(1)}` });
  await actions.focus();
  await expect(actions).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(more).toBeFocused();
  await expect(more).toHaveCSS("clip-path", "none");
  const accessibility = await new AxeBuilder({ page })
    .include(".library-list")
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(accessibility.violations).toEqual([]);
  await page.screenshot({ path: info.outputPath("keyboard-continuation.png") });
  await page.keyboard.press("Enter");
  await expect(list.locator(".memory-open")).toHaveText([title(1), title(2)]);
  await expect(list.locator(".memory-open").first()).toBeFocused();
});

for (const repeated of [true, false]) {
  test(`pagination stops automatically when ${repeated ? "a cursor repeats" : "a page adds no new rows"}`, async ({
    page,
  }) => {
    await fixture(page);
    const reads: unknown[] = [];
    await page.route("**/api/grove/memories/search", async (route) => {
      const { cursor } = route.request().postDataJSON();
      reads.push(cursor ?? null);
      await route.fulfill({
        json: {
          success: true,
          data: {
            items: [fieldNote(cursor === "last" ? 2 : 1)],
            nextCursor:
              !cursor || repeated ? "next" : cursor === "next" ? "last" : null,
          },
        },
      });
    });
    await page.goto(`${base}/app`);
    const list = page.locator(".library-list");
    const recover = list.getByRole("button", {
      name: repeated ? "Refresh notes" : "Continue loading notes",
    });
    await expect(recover).toBeVisible();
    await expect(list.locator(".memory-open")).toHaveText([title(1)]);
    await paint(page);
    expect(reads).toEqual([null, "next"]);
    if (!repeated) {
      await recover.click();
      await expect(list.locator(".memory-open")).toHaveText([
        title(1),
        title(2),
      ]);
      expect(reads).toEqual([null, "next", "last"]);
    }
  });
}

test("the Graph route only requests the next page on demand", async ({
  page,
}) => {
  await fixture(page, [fieldNote(1), fieldNote(2), fieldNote(3)]);
  await page.goto(`${base}/app/graph`);
  const graphPaging = page
    .locator(".library-main > div")
    .getByRole("button", {
      name: "Expand graph",
      exact: true,
    })
    .last();
  const nodes = page.locator(".react-flow__node");
  await expect(nodes).toHaveCount(2);
  await expect(page.locator(".note-continuation-edge")).toHaveCount(0);
  await graphPaging.scrollIntoViewIfNeeded();
  await paint(page);
  await expect(nodes).toHaveCount(2);
  await graphPaging.click();
  await expect(nodes).toHaveCount(3);
});
