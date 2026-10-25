import AxeBuilder from "@axe-core/playwright";
import { test, expect, type Page, type Download } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { notebookLifecycleSchema } from "@lib/shared/notebook-lifecycle";
import { conversationHistorySchema } from "@lib/shared/conversation-history";
import { chooseOption } from "./fixtures/select";
import { openNoteAction } from "./fixtures/note-action";
import {
  listSchema,
  projectSchema,
  rememberSchema,
  versionSchema,
  type Memory,
} from "@lib/shared/contracts";
import { askSchema, briefRequestSchema } from "@lib/shared/models";
import {
  connectionQuerySchema,
  connectionReviewSchema,
  type NoteConnection,
} from "@lib/shared/relationships";
import {
  conversationCreateSchema,
  conversationTurnSchema,
  askToolsPatchSchema,
  toolSettingsSchema,
  type Conversation,
} from "@lib/shared/conversations";
import {
  shareEnableSchema,
  shareDurationSchema,
  shareScopeSchema,
  shareMutationSchema,
  type ShareState,
} from "@lib/shared/sharing";

const base = `http://127.0.0.1:${process.env.DASHBOARD_TEST_PORT || 3101}`;
async function readDownload(download: Download) {
  const path = test.info().outputPath(download.suggestedFilename());
  await download.saveAs(path);
  return readFile(path);
}
const project = {
  id: "00000000-0000-4000-a000-000000000010",
  name: "Website redesign",
  identity: "git:github.com/example/website",
  parentId: null as string | null,
  version: 1,
  status: "active" as "active" | "archived",
};
const note: Memory = {
  id: "00000000-0000-4000-a000-000000000011",
  projectId: null,
  content:
    "# Review preferences\n\nKeep feedback **specific** and include a working example.\n\n- [x] Read the change\n- [ ] Try the example\n\n```ts\nconst review = 'ready';\n```",
  kind: "preference",
  autoKind: false,
  status: "active",
  version: 1,
  source: {
    agent: "opencode",
    session: "source-session",
    verification: "Verified in the browser",
  },
  taskId: null,
  expiresAt: null,
  purgeAt: null,
  indexing: "ready",
  createdAt: "2026-10-18T10:00:00Z",
  updatedAt: "2026-10-19T10:00:00Z",
  enrichment: {
    title: "Review preferences",
    status: "ready",
    tags: ["workflow", "testing"],
    relationships: [],
    profiles: ["private-profile"],
  },
};
const handoff: Memory = {
  ...note,
  id: "00000000-0000-4000-a000-000000000012",
  projectId: project.id,
  content:
    "# Launch checklist\n\n## Done\nNavigation and layout are ready.\n\n## Next\n- [ ] Review keyboard access",
  kind: "handoff",
  taskId: "agent-launch-task",
  expiresAt: "2027-01-01T10:00:00Z",
  purgeAt: "2027-03-01T10:00:00Z",
  enrichment: {
    ...note.enrichment!,
    title: "Launch checklist",
    tags: ["frontend"],
  },
};

for (const width of [1440, 390, 320]) {
  test(`search quality shows server-backed prefix passages and title marks at ${width}px`, async ({
    page,
  }, info) => {
    const garden = {
      ...note,
      content:
        "# Garden design\n" +
        "Background writing. ".repeat(30) +
        "Plan garden design with native plants.",
    };
    await fixture(page, [garden]);
    let staleEvidence = false;
    await page.route("**/api/grove/ask", async (route) => {
      const query = route.request().postDataJSON().query;
      await route.fulfill({
        json: {
          success: true,
          data: {
            status: "search",
            sources: [garden],
            searchMode: "lexical",
            answer: null,
            matches: {
              [garden.id]: {
                query,
                version: staleEvidence ? garden.version + 1 : garden.version,
                kind: query === "gardn design" ? "fuzzy" : "prefix",
                title: {
                  text: "Garden design",
                  ranges:
                    query === "gardn design"
                      ? []
                      : [
                          [0, 6],
                          [7, 13],
                        ],
                },
                snippet: {
                  text: staleEvidence
                    ? "Old private preview"
                    : query === "gardn design"
                      ? "Background writing. ".repeat(5).trim()
                      : "Plan garden design with native plants.",
                  ranges:
                    query === "gardn design"
                      ? []
                      : [
                          [5, 11],
                          [12, 18],
                        ],
                },
              },
            },
          },
        },
      });
    });
    await page.setViewportSize({ width, height: 850 });
    await page.goto(`${base}/app`);
    await page.getByRole("button", { name: /Search anything/ }).click();
    const dialog = page.getByRole("dialog", { name: "Search your Grove" });
    const input = dialog.getByRole("textbox", { name: "Search your Grove" });
    await input.fill("garden des");
    await expect(
      dialog.locator(".quick-search-result strong mark"),
    ).toHaveCount(2);
    await expect(dialog.locator(".quick-search-result p")).toContainText(
      "native plants",
    );
    expect(
      await dialog.evaluate(
        (element) => element.scrollWidth <= element.clientWidth + 1,
      ),
    ).toBe(true);
    const accessibility = await new AxeBuilder({ page })
      .include(".quick-search")
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .analyze();
    expect(accessibility.violations).toEqual([]);
    await page.screenshot({
      path: info.outputPath(`search-prefix-${width}.png`),
    });
    await input.fill("gardn design");
    await expect(dialog.locator(".quick-search-result mark")).toHaveCount(0);
    await expect(dialog.locator(".quick-search-result p")).toContainText(
      "Background writing",
    );
    await page.screenshot({
      path: info.outputPath(`search-typo-${width}.png`),
    });
    staleEvidence = true;
    await input.fill("garden design");
    await expect(
      dialog.locator(".quick-search-result strong mark"),
    ).toHaveCount(0);
    await expect(dialog.locator(".quick-search-result p")).not.toContainText(
      "Old private preview",
    );
  });
}

test("search quality defaults to relevance and preserves an explicit date sort", async ({
  page,
}) => {
  const state = await fixture(page, [
    { ...note, content: "# Garden design\nA planting guide" },
  ]);
  await page.goto(`${base}/app`);
  const search = page.getByLabel("Search notes", { exact: true });
  await search.fill("garden");
  await expect
    .poll(
      () =>
        state.calls.filter((c) => c.path === "/memories/search").at(-1)?.body,
    )
    .toMatchObject({ query: "garden", sort: "relevance" });
  await page.getByRole("button", { name: /^Filters/ }).click();
  await chooseOption(
    page.getByRole("combobox", { name: "Sort notes" }),
    "updated_asc",
  );
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await search.fill("design");
  await expect
    .poll(
      () =>
        state.calls.filter((c) => c.path === "/memories/search").at(-1)?.body,
    )
    .toMatchObject({ query: "design", sort: "updated_asc" });
  await search.fill("");
  await expect
    .poll(
      () =>
        state.calls.filter((c) => c.path === "/memories/search").at(-1)?.body,
    )
    .toMatchObject({ sort: "updated_asc" });
});

test("search quality restarts a stale relevance cursor instead of retrying the old page", async ({
  page,
}) => {
  await fixture(page, [note]);
  let first = true;
  let restarted = false;
  await page.route("**/api/grove/memories/search", async (route) => {
    const input = route.request().postDataJSON();
    if (input.query && input.cursor) {
      first = false;
      await route.fulfill({
        status: 409,
        json: {
          success: false,
          error: {
            code: "stale_search",
            message: "Search results changed. Start this search again.",
          },
        },
      });
    } else {
      if (input.query && !first) restarted = true;
      await route.fulfill({
        json: {
          success: true,
          data: {
            items: [note],
            nextCursor: input.query && first ? "old-search-cursor" : null,
          },
        },
      });
    }
  });
  await page.goto(`${base}/app`);
  await page.getByLabel("Search notes", { exact: true }).fill("review");
  await page.getByRole("button", { name: "Load more", exact: true }).click();
  const refresh = page.getByRole("button", { name: "Refresh search results" });
  await expect(refresh).toBeVisible();
  await refresh.click();
  await expect.poll(() => restarted).toBe(true);
  await expect(page.locator(".memory-row")).toHaveCount(1);
});

async function notebookLifecycleFixture(page: Page) {
  const state = await fixture(page, [handoff]);
  const child = {
    ...project,
    id: crypto.randomUUID(),
    name: "Project research",
    parentId: project.id,
  };
  state.projects.push(child);
  const removed = new Set<string>();
  const operations = new Map<string, unknown>();
  let loseNext = false;
  const lifecycleCalls: unknown[] = [];
  const preview = (id: string) => {
    const current = state.projects.find((p) => p.id === id)!;
    const ids = new Set([id]);
    for (let i = 0; i < state.projects.length; i++)
      state.projects.forEach((p) => {
        if (p.parentId && ids.has(p.parentId)) ids.add(p.id);
      });
    const notes = [...state.records.values()].filter(
      (n) => n.projectId && ids.has(n.projectId),
    );
    return {
      project: current,
      projectIds: [...ids],
      notebooks: ids.size,
      notes: notes.length,
      fingerprint: createHash("sha256")
        .update(JSON.stringify([state.projects, [...state.records.values()]]))
        .digest("hex"),
      canRestore:
        current.status === "archived" &&
        (!current.parentId ||
          state.projects.find((p) => p.id === current.parentId)?.status ===
            "active"),
    };
  };
  await page.route("**/api/grove/projects**", async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace("/api/grove", "");
    let data: unknown;
    if (route.request().method() === "GET" && path === "/projects")
      data = state.projects.filter(
        (p) =>
          !removed.has(p.id) &&
          p.status === (url.searchParams.get("status") ?? "active"),
      );
    else if (path.endsWith("/lifecycle")) data = preview(path.split("/")[2]);
    else if (/\/(archive|restore|delete)$/.test(path)) {
      const input = notebookLifecycleSchema.parse(
        route.request().postDataJSON(),
      );
      lifecycleCalls.push(input);
      if (operations.has(input.operationId))
        data = operations.get(input.operationId);
      else {
        const current = preview(path.split("/")[2]);
        if (
          input.fingerprint !== current.fingerprint ||
          input.expectedVersion !== current.project.version
        ) {
          await route.fulfill({
            status: 409,
            json: {
              success: false,
              error: {
                code: "version_conflict",
                message:
                  "Your notebooks or notes changed. Review the affected contents again.",
              },
            },
          });
          return;
        }
        const action = path.split("/").at(-1)!;
        for (const p of state.projects.filter((p) =>
          current.projectIds.includes(p.id),
        )) {
          if (action === "delete") removed.add(p.id);
          else {
            p.status = action === "archive" ? "archived" : "active";
            p.version++;
          }
        }
        for (const [id, note] of state.records) {
          if (!note.projectId || !current.projectIds.includes(note.projectId))
            continue;
          if (action === "delete") state.records.delete(id);
          else
            state.records.set(id, {
              ...note,
              status: action === "archive" ? "archived" : "active",
              version: note.version + 1,
            });
        }
        data = { action, projectIds: current.projectIds };
        operations.set(input.operationId, data);
      }
    } else {
      await route.fallback();
      return;
    }
    if (loseNext && /\/(archive|restore|delete)$/.test(path)) {
      loseNext = false;
      await route.abort("failed");
      return;
    }
    await route.fulfill({ json: { success: true, data } });
  });
  return {
    ...state,
    child,
    removed,
    lifecycleCalls,
    loseNextResponse: () => {
      loseNext = true;
    },
  };
}

for (const width of [1440, 390, 320]) {
  test.describe(`notebook lifecycle at ${width}px`, () => {
    test.use({ viewport: { width, height: 900 }, hasTouch: width < 600 });
    test("confirms all contents, cancels safely, restores archives and soft-deletes through notebook actions", async ({
      page,
    }, info) => {
      const state = await notebookLifecycleFixture(page);
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.goto(`${base}/app/projects/${project.id}`);
      await page
        .getByRole("button", { name: "Notebook options", exact: true })
        .click();
      await page
        .getByRole("button", { name: "Archive notebook", exact: true })
        .click();
      let dialog = page.getByRole("dialog", {
        name: "Archive notebook",
        exact: true,
      });
      await expect(dialog).toContainText("2 notebooks and 1 note");
      await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
      expect(state.lifecycleCalls).toHaveLength(0);
      await page.goto(`${base}/app/projects`);
      await page
        .getByRole("button", {
          name: `More actions for ${project.name}`,
          exact: true,
        })
        .click();
      await page
        .getByRole("button", { name: "Archive notebook", exact: true })
        .click();
      dialog = page.getByRole("dialog", {
        name: "Archive notebook",
        exact: true,
      });
      await expect(
        dialog.getByRole("button", { name: "Archive notebooks", exact: true }),
      ).toBeEnabled();
      expect(
        (
          await new AxeBuilder({ page })
            .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
            .analyze()
        ).violations,
      ).toEqual([]);
      await page.screenshot({
        path: info.outputPath(`archive-notebook-${width}.png`),
        fullPage: true,
      });
      await dialog
        .getByRole("button", { name: "Archive notebooks", exact: true })
        .click();
      await expect(
        page.getByRole("heading", { name: "Archived notebooks", exact: true }),
      ).toBeVisible();
      await expect(
        page.getByRole("list", { name: "Archived notebooks" }),
      ).toContainText(state.child.name);
      await page.screenshot({
        path: info.outputPath(`archived-notebooks-${width}.png`),
        fullPage: true,
      });
      await page
        .getByRole("button", {
          name: `Notebook actions for ${project.name}`,
          exact: true,
        })
        .click();
      await page
        .getByRole("button", { name: "Restore notebook", exact: true })
        .click();
      dialog = page.getByRole("dialog", {
        name: "Restore notebook",
        exact: true,
      });
      await dialog
        .getByRole("button", { name: "Restore notebooks", exact: true })
        .click();
      await expect(
        page.getByRole("heading", { name: "Notebooks", exact: true }),
      ).toBeVisible();
      expect(state.records.get(handoff.id)?.status).toBe("active");
      // Sidebar uses the same confirmation, including on narrow/touch layouts.
      if (width < 1024)
        await page
          .getByRole("button", { name: "Notebooks", exact: true })
          .click();
      const sidebar = page.getByRole("complementary", {
        name: "Workspace sidebar",
      });
      await sidebar
        .getByRole("button", {
          name: `Notebook actions for ${project.name}`,
          exact: true,
        })
        .click();
      await page
        .getByRole("button", { name: "Delete notebook…", exact: true })
        .click();
      dialog = page.getByRole("dialog", {
        name: "Delete notebook",
        exact: true,
      });
      await expect(dialog).toContainText("soft deletion");
      await expect(dialog).toContainText("not permanently erased");
      await page.screenshot({
        path: info.outputPath(`delete-notebook-${width}.png`),
        fullPage: true,
      });
      const overflow = await page.evaluate(() =>
        [...document.querySelectorAll<HTMLElement>("body *")]
          .filter(
            (node) =>
              node.getClientRects().length &&
              node.getBoundingClientRect().right > innerWidth,
          )
          .map((node) => ({
            tag: node.tagName,
            class: node.className,
            right: node.getBoundingClientRect().right,
          }))
          .slice(0, 20),
      );
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        JSON.stringify(overflow),
      ).toBe(true);
      await dialog
        .getByRole("button", { name: "Delete notebooks", exact: true })
        .click();
      await expect(dialog).not.toBeVisible();
      expect(state.removed.size).toBe(2);
      expect(state.revisions.get(handoff.id)?.[0].content).toBe(
        handoff.content,
      );
    });
  });
}

test("notebook deletion freezes reviewed scope, re-reviews conflicts and retries an uncertain response with the same operation", async ({
  page,
}) => {
  const state = await notebookLifecycleFixture(page);
  await page.goto(`${base}/app/projects`);
  await page
    .getByRole("button", { name: `More actions for ${project.name}` })
    .click();
  await page
    .getByRole("button", { name: "Delete notebook…", exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "Delete notebook",
    exact: true,
  });
  await expect(dialog).toContainText("2 notebooks and 1 note");
  state.projects.push({
    ...project,
    id: crypto.randomUUID(),
    parentId: project.id,
    name: "Newly added",
  });
  await dialog
    .getByRole("button", { name: "Delete notebooks", exact: true })
    .click();
  await expect(dialog).toContainText("Review the affected contents again");
  await expect(
    dialog.getByRole("button", { name: "Delete notebooks", exact: true }),
  ).toBeDisabled();
  await dialog
    .getByRole("button", { name: "Review current contents", exact: true })
    .click();
  await expect(dialog).toContainText("3 notebooks and 1 note");
  state.loseNextResponse();
  await dialog
    .getByRole("button", { name: "Delete notebooks", exact: true })
    .click();
  await expect(dialog.getByRole("alert")).toBeVisible();
  await dialog
    .getByRole("button", { name: "Delete notebooks", exact: true })
    .click();
  await expect(dialog).not.toBeVisible();
  expect(state.lifecycleCalls).toHaveLength(3);
  expect(state.lifecycleCalls[2]).toEqual(state.lifecycleCalls[1]);
});

test("notebook archive never discards a retained local draft", async ({
  page,
}) => {
  await notebookLifecycleFixture(page);
  await page.goto(`${base}/app/memories/${handoff.id}?mode=edit`);
  const editor = page.getByRole("textbox", {
    name: "What should stay with you?",
  });
  await editor.fill("Unsaved writing ".repeat(450));
  const notebooksToggle = page.getByRole("button", {
    name: "Notebooks",
    exact: true,
  });
  if (await notebooksToggle.isVisible()) await notebooksToggle.click();
  await page
    .getByRole("link", { name: "Manage notebooks", exact: true })
    .click();
  await page
    .getByRole("button", { name: `More actions for ${project.name}` })
    .click();
  await page
    .getByRole("button", { name: "Archive notebook", exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "Archive notebook",
    exact: true,
  });
  await expect(dialog).toContainText(
    "Your local writing will not be discarded",
  );
  await expect(
    dialog.getByRole("button", { name: "Archive notebooks", exact: true }),
  ).toBeDisabled();
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.goBack();
  await expect(editor).toContainText("Unsaved writing");
});

test("sidebar remains reachable with long names, short height and enlarged text", async ({
  page,
}, info) => {
  const state = await fixture(page);
  state.projects[0] = { ...project, name: "Model preferences and research" };
  state.projects.push(
    ...Array.from({ length: 16 }, (_, index) => ({
      ...project,
      id: crypto.randomUUID(),
      name: `Notebook ${index}`,
    })),
  );
  await page.setViewportSize({ width: 1440, height: 480 });
  await page.goto(`${base}/app`);
  await page.addStyleTag({
    content:
      ".app-sidebar :is(.app-nav, .notebook-tree-link, .workspace-search-launcher, .workspace-command-launcher, .sidebar-create) { font-size: 24px; }",
  });
  const sidebar = page.getByRole("complementary", {
    name: "Workspace sidebar",
  });
  for (const width of [1440, 320]) {
    if (width === 320) {
      await page.setViewportSize({ width, height: 720 });
      await sidebar
        .getByRole("button", { name: "Notebooks", exact: true })
        .click();
    }
    await sidebar.getByRole("link", { name: "Notes", exact: true }).focus();
    expect(
      await sidebar.evaluate(
        (element) => element.scrollWidth <= element.clientWidth,
      ),
    ).toBe(true);
    expect(
      await sidebar
        .locator(
          ".app-nav, .sidebar-create, .workspace-search-launcher, .workspace-command-launcher",
        )
        .evaluateAll((elements) =>
          elements
            .filter(
              (element) =>
                element.getClientRects().length &&
                element.scrollWidth > element.clientWidth,
            )
            .map(
              (element) =>
                element.getAttribute("aria-label") || element.textContent,
            ),
        ),
    ).toEqual([]);
    await sidebar.screenshot({
      path: info.outputPath(`sidebar-large-text-${width}.png`),
    });
    const settings = sidebar.getByRole("link", {
      name: "Settings",
      exact: true,
    });
    await settings.focus();
    await expect(settings).toBeInViewport();
    const manage = sidebar.getByRole("link", { name: "Manage notebooks" });
    await manage.focus();
    await expect(manage).toBeInViewport();
    await manage.press("Enter");
    await expect(page).toHaveURL(`${base}/app/projects`);
    if (width === 1440)
      await sidebar.getByRole("link", { name: "Notes", exact: true }).click();
  }
});

for (const width of [1440, 390, 320]) {
  test.describe(`stable library at ${width}px`, () => {
    test.use({ viewport: { width, height: 900 }, hasTouch: width < 600 });

    test("selection stays in place through partial selection, bulk actions and clearing", async ({
      page,
    }, info) => {
      await fixture(page);
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.goto(`${base}/app?sort=created_desc`);
      const rows = page.locator(".memory-row");
      await expect(rows).toHaveCount(2);
      await page.evaluate(() => document.fonts.ready);
      const before = await rows.first().boundingBox();
      const header = page.locator(".library-selection-header");
      const headerBefore = await header.boundingBox();
      const all = page.getByRole("checkbox", {
        name: "Select these notes",
        exact: true,
      });
      await rows.first().getByRole("checkbox").check();
      await expect(all).toBeChecked({ indeterminate: true });
      expect(await rows.first().boundingBox()).toEqual(before);
      expect(await header.boundingBox()).toEqual(headerBefore);
      await all.check();
      await expect(header).toContainText("2 selected");
      const actions = page.getByRole("group", { name: "Selected notes" });
      await actions.getByRole("button", { name: "Move", exact: true }).click();
      await expect(
        page.getByRole("dialog", { name: "Move 2 notes" }),
      ).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(
        actions.getByRole("button", { name: "Move", exact: true }),
      ).toBeFocused();
      expect(await rows.first().boundingBox()).toEqual(before);
      expect(await header.boundingBox()).toEqual(headerBefore);
      await page.screenshot({
        path: info.outputPath(`selection-${width}.png`),
        fullPage: true,
      });
      await actions.getByRole("button", { name: "Clear selection" }).click();
      await expect(all).toBeFocused();
      await expect(all).not.toBeChecked();
      expect(await rows.first().boundingBox()).toEqual(before);
      await all.check();
      await page.keyboard.press("Escape");
      await expect(all).not.toBeChecked();
      await expect(actions).toHaveCount(0);
      expect(await rows.first().boundingBox()).toEqual(before);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
    });

    test("filters overlay the list and nested dropdowns dismiss independently", async ({
      page,
    }, info) => {
      await fixture(page);
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.goto(`${base}/app?sort=created_desc`);
      const rows = page.locator(".memory-row");
      await expect(rows).toHaveCount(2);
      await page.evaluate(() => document.fonts.ready);
      const before = await rows.first().boundingBox();
      const trigger = page.getByRole("button", {
        name: "Filters",
        exact: true,
      });
      const triggerBefore = await trigger.boundingBox();
      await trigger.click();
      const panel = page.getByRole("dialog", { name: "Filter notes" });
      await expect(panel).toBeVisible();
      expect(await rows.first().boundingBox()).toEqual(before);
      const source = panel.getByRole("combobox", {
        name: "Source",
        exact: true,
      });
      await source.click();
      await expect(page.getByRole("listbox")).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(panel).toBeVisible();
      await expect(source).toBeFocused();
      await chooseOption(source, "opencode");
      await expect(rows).toHaveCount(2);
      await expect(
        panel.getByRole("button", { name: "Remove source filter" }),
      ).toBeVisible();
      await panel.getByRole("button", { name: "Done", exact: true }).click();
      await expect(trigger).toBeFocused();
      expect(await trigger.boundingBox()).toEqual(triggerBefore);
      expect(await rows.first().boundingBox()).toEqual(before);
      await trigger.click();
      await panel
        .getByRole("button", { name: "Clear filters", exact: true })
        .click();
      await expect(
        panel.getByRole("button", { name: "Done", exact: true }),
      ).toBeFocused();
      await expect(
        page.getByRole("combobox", { name: "Sort notes" }),
      ).toHaveText("Date written");
      await expect(rows).toHaveCount(2);
      const bounds = (await panel.boundingBox())!;
      expect(bounds.x).toBeGreaterThanOrEqual(0);
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
      expect(bounds.y + bounds.height).toBeLessThanOrEqual(900);
      expect(
        (
          await new AxeBuilder({ page })
            .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
            .analyze()
        ).violations,
      ).toEqual([]);
      await page.screenshot({ path: info.outputPath(`filters-${width}.png`) });
      await page.keyboard.press("Escape");
      await expect(panel).toBeHidden();
      await expect(trigger).toBeFocused();
      expect(await rows.first().boundingBox()).toEqual(before);
      await trigger.click();
      await chooseOption(
        panel.getByRole("combobox", { name: "Sort notes" }),
        "updated_desc",
      );
      // Sorting may reorder rows and drop date headings; the page controls
      // around the list must keep their geometry.
      expect(await trigger.boundingBox()).toEqual(triggerBefore);
      await panel.getByRole("button", { name: "Done", exact: true }).click();
      const viewBefore = await page
        .getByRole("group", { name: "Note view" })
        .boundingBox();
      await page.getByRole("button", { name: "Graph", exact: true }).click();
      expect(
        await page.getByRole("group", { name: "Note view" }).boundingBox(),
      ).toEqual(viewBefore);
    });
  });
}

test("global search and command dialogs keep their inputs anchored through loading and empty results", async ({
  page,
}, info) => {
  await fixture(page);
  let release = Promise.withResolvers<void>();
  let started = Promise.withResolvers<void>();
  await page.route("**/api/grove/ask", async (route) => {
    started.resolve();
    await release.promise;
    await route.fulfill({
      json: { success: true, data: { sources: [], statements: [] } },
    });
  });
  await page.goto(`${base}/app`);
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 800 });
    await page.keyboard.press("Control+k");
    const dialog = page.getByRole("dialog", { name: "Search your Grove" });
    const input = dialog.getByRole("textbox", { name: "Search your Grove" });
    await expect(dialog.locator(".quick-search-result")).toHaveCount(2);
    const before = await dialog.boundingBox();
    const inputBefore = await input.boundingBox();
    expect(inputBefore!.height).toBeLessThanOrEqual(50);
    expect(
      (await dialog.locator(".app-search").boundingBox())!.height,
    ).toBeLessThanOrEqual(56);
    // Each viewport needs a cold query; a repeated phrase reuses the fresh cache.
    await input.fill(`Something missing at ${width}px`);
    await started.promise;
    await expect(dialog.getByRole("status")).toHaveText("Searching…");
    expect(await dialog.boundingBox()).toEqual(before);
    expect(await input.boundingBox()).toEqual(inputBefore);
    release.resolve();
    await expect(
      dialog.getByText("No notes found. Try another phrase or notebook."),
    ).toBeVisible();
    expect(await dialog.boundingBox()).toEqual(before);
    await dialog
      .getByRole("button", { name: "Clear search your grove" })
      .click();
    await expect(input).toBeFocused();
    await expect(input).toHaveValue("");
    expect(await input.boundingBox()).toEqual(inputBefore);
    await expect(dialog.locator(".quick-search-result")).toHaveCount(2);
    await page.screenshot({ path: info.outputPath(`search-${width}.png`) });
    await page.keyboard.press("Escape");
    await page.keyboard.press("Control+Shift+p");
    const commands = page.getByRole("dialog", { name: "Command menu" });
    const query = commands.getByRole("combobox", { name: "Search commands" });
    const commandBefore = await commands.boundingBox();
    const queryBefore = await query.boundingBox();
    await query.fill("No matching command here");
    await expect(commands.getByRole("status")).toHaveText(
      "No matching commands.",
    );
    expect(await commands.boundingBox()).toEqual(commandBefore);
    expect(await query.boundingBox()).toEqual(queryBefore);
    await query.fill("new note");
    await expect(commands.getByRole("option")).toHaveCount(1);
    expect(await commands.boundingBox()).toEqual(commandBefore);
    await page.keyboard.press("Escape");
    release = Promise.withResolvers<void>();
    started = Promise.withResolvers<void>();
  }
});

test("action menus follow the anchor and remain reachable in short resized viewports", async ({
  page,
}) => {
  await fixture(page);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${base}/app`);
  await page.locator(".memory-open").first().click();
  const trigger = page.getByRole("button", {
    name: "Note actions",
    exact: true,
  });
  await trigger.focus();
  await trigger.press("ArrowDown");
  const menu = page.locator(".action-menu:popover-open");
  await expect(menu.locator("button:visible, a:visible").first()).toBeFocused();
  await page.keyboard.press("End");
  await expect(
    menu.getByRole("button", { name: "Delete note…" }),
  ).toBeFocused();
  await page.setViewportSize({ width: 844, height: 260 });
  await expect
    .poll(async () => {
      const box = (await menu.boundingBox())!;
      return (
        box.x >= 8 &&
        box.y >= 8 &&
        box.x + box.width <= 836 &&
        box.y + box.height <= 252
      );
    })
    .toBe(true);
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await expect(
    page.getByRole("dialog", { name: "Note", exact: true }),
  ).toBeVisible();
});

test("touch hit areas are separate and menus scroll within a short viewport", async ({
  browser,
}) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  try {
    await fixture(page);
    await page.goto(`${base}/app`);
    await page.getByRole("button", { name: "Notebooks", exact: true }).tap();
    for (const selector of [
      ".row-checkbox",
      ".memory-row .drag-handle",
      ".notebook-disclosure",
      ".notebook-drag-handle",
      ".notebook-tree-actions .app-icon",
      ".workspace-command-launcher",
      ".workspace-search-launcher",
    ]) {
      const box = (await page.locator(selector).first().boundingBox())!;
      expect(box.width, selector).toBeGreaterThanOrEqual(44);
      expect(box.height, selector).toBeGreaterThanOrEqual(44);
    }
    const boxes = await page
      .locator(".notebook-tree-row")
      .first()
      .locator(":scope > button, :scope > a, :scope > .notebook-tree-actions")
      .evaluateAll((elements) =>
        elements.map((el) => {
          const rect = el.getBoundingClientRect();
          return { left: rect.left, right: rect.right };
        }),
      );
    for (let i = 1; i < boxes.length; i++)
      expect(boxes[i].left).toBeGreaterThanOrEqual(boxes[i - 1].right);
    await page.getByRole("button", { name: "Notebooks", exact: true }).tap();
    await page.locator(".memory-open").first().tap();
    await page.getByRole("button", { name: "Note actions", exact: true }).tap();
    await page.setViewportSize({ width: 844, height: 220 });
    const menu = page.locator(".action-menu:popover-open");
    await expect
      .poll(async () => {
        const box = (await menu.boundingBox())!;
        return (
          box.x >= 8 &&
          box.y >= 8 &&
          box.x + box.width <= 836 &&
          box.y + box.height <= 212
        );
      })
      .toBe(true);
    await menu.getByRole("button", { name: "Delete note…" }).tap();
    await expect(
      page.getByRole("dialog", { name: "Delete note?" }),
    ).toBeVisible();
  } finally {
    await context.close();
  }
});

test("open action menus stay inside the visual viewport at two-times browser pinch zoom", async ({
  browser,
}) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  try {
    await fixture(page, [note]);
    await page.goto(`${base}/app`);
    await page.locator(".memory-open").tap();
    await page.getByRole("button", { name: "Note actions", exact: true }).tap();
    const cdp = await context.newCDPSession(page);
    await cdp.send("Emulation.setPageScaleFactor", { pageScaleFactor: 2 });
    const menu = page.locator(".action-menu:popover-open");
    await expect
      .poll(() =>
        menu.evaluate((el) => {
          const box = el.getBoundingClientRect(),
            viewport = visualViewport!;
          return (
            viewport.scale === 2 &&
            box.left >= viewport.offsetLeft + 8 &&
            box.right <= viewport.offsetLeft + viewport.width - 8 &&
            box.top >= viewport.offsetTop + 8 &&
            box.bottom <= viewport.offsetTop + viewport.height - 8
          );
        }),
      )
      .toBe(true);
    await cdp.send("Emulation.setPageScaleFactor", { pageScaleFactor: 1 });
    await page.keyboard.press("Escape");
    await expect(
      page.getByRole("button", { name: "Note actions", exact: true }),
    ).toBeFocused();
  } finally {
    await context.close();
  }
});

for (const width of [1440, 768, 390, 320]) {
  test.describe(`sidebar at ${width}px`, () => {
    test.use({ viewport: { width, height: 900 }, hasTouch: width < 600 });
    test("keeps navigation, notebook names and contextual actions usable without shifting rows", async ({
      page,
    }, info) => {
      const state = await fixture(page, [
        { ...note, projectId: project.id },
        handoff,
      ]);
      state.projects[0] = { ...project, name: "Model preferences" };
      const child = {
        ...project,
        id: crypto.randomUUID(),
        parentId: project.id,
        name: "Working notes",
      };
      state.projects.push(
        child,
        ...Array.from({ length: 24 }, (_, index) => ({
          ...project,
          id: crypto.randomUUID(),
          name: `Notebook ${String(index).padStart(2, "0")}`,
        })),
      );
      await page.goto(`${base}/app`);
      const sidebar = page.getByRole("complementary", {
        name: "Workspace sidebar",
      });
      await page.evaluate(() => document.fonts.ready);
      const notes = sidebar.getByRole("link", { name: "Notes", exact: true });
      await notes.focus();
      await expect(notes).toHaveAttribute("aria-current", "page");
      await expect(notes).toBeInViewport();
      if (width < 1024) {
        expect((await sidebar.boundingBox())!.height).toBeLessThanOrEqual(220);
        for (const name of ["Notes", "Ask Grove", "Archive", "Settings"]) {
          const link = sidebar.getByRole("link", { name, exact: true });
          await expect(link).toBeInViewport();
          expect((await link.boundingBox())!.height).toBeGreaterThanOrEqual(44);
        }
      }
      await sidebar.screenshot({
        path: info.outputPath(`sidebar-${width}.png`),
      });
      await sidebar
        .getByRole("button", { name: "Commands", exact: true })
        .click();
      await expect(
        page.getByRole("dialog", { name: "Command menu", exact: true }),
      ).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(
        sidebar.getByRole("button", { name: "Commands", exact: true }),
      ).toBeFocused();
      if (width < 1024)
        await sidebar
          .getByRole("button", { name: "Notebooks", exact: true })
          .click();
      const notebooks = sidebar.getByRole("region", { name: "Your notebooks" });
      const book = notebooks.getByRole("link", {
        name: "Model preferences",
        exact: true,
      });
      expect(
        await book
          .locator("span")
          .evaluate(
            (element) =>
              element.scrollHeight <= element.clientHeight &&
              element.scrollWidth <= element.clientWidth,
          ),
      ).toBe(true);
      const before = await book.boundingBox();
      const actions = notebooks.getByRole("button", {
        name: "Notebook actions for Model preferences",
        exact: true,
      });
      await actions.focus();
      await actions.press("ArrowDown");
      const menu = notebooks.getByRole("group", {
        name: "Notebook actions for Model preferences",
        exact: true,
      });
      await expect(
        menu.getByRole("link", { name: "New note", exact: true }),
      ).toBeFocused();
      expect(await book.boundingBox()).toEqual(before);
      await page.keyboard.press("Escape");
      await expect(actions).toBeFocused();
      await book.click();
      await expect(page).toHaveURL(new RegExp(`/app/projects/${project.id}$`));
      await expect(sidebar.locator(".sidebar-create")).toHaveAttribute(
        "href",
        `/app/notes/new?notebook=${project.id}`,
      );
      if (width < 1024)
        await sidebar
          .getByRole("button", { name: "Notebooks", exact: true })
          .click();
      await expect(
        notebooks.getByRole("link", { name: "Working notes", exact: true }),
      ).toBeVisible();
      await expect(book).toHaveAttribute("aria-current", "page");
      await sidebar.screenshot({
        path: info.outputPath(`sidebar-expanded-${width}.png`),
      });
      const heading = await notebooks
        .locator(".notebook-explorer-heading")
        .boundingBox();
      await notebooks.evaluate((element) =>
        element.scrollTo(0, element.scrollHeight),
      );
      await expect
        .poll(() => notebooks.evaluate((element) => element.scrollTop))
        .toBeGreaterThan(0);
      expect(
        await notebooks.locator(".notebook-explorer-heading").boundingBox(),
      ).toEqual(heading);
      await expect(
        notebooks.getByRole("link", { name: "Manage notebooks" }),
      ).toBeInViewport();
      expect(
        await sidebar.evaluate(
          (element) => element.scrollWidth <= element.clientWidth,
        ),
      ).toBe(true);
      expect(
        (
          await new AxeBuilder({ page })
            .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
            .analyze()
        ).violations,
      ).toEqual([]);
      await sidebar.screenshot({
        path: info.outputPath(`sidebar-scrolled-${width}.png`),
      });
    });
  });
}

for (const width of [1440, 390, 320]) {
  test.describe(`row dropdown at ${width}px`, () => {
    test.use({ viewport: { width, height: 900 }, hasTouch: width < 600 });
    test("overlays the list with one menu, keyboard dismissal and dialog focus return", async ({
      page,
    }, info) => {
      await fixture(page);
      await page.goto(`${base}/app`);
      const row = page.locator(`[data-note-id="${note.id}"]`);
      const trigger = row.getByRole("button", {
        name: "Actions for Review preferences",
        exact: true,
      });
      await trigger.scrollIntoViewIfNeeded();
      await page.evaluate(() => document.fonts.ready);
      const bounds = () =>
        page
          .locator(".memory-list-item")
          .evaluateAll((elements) =>
            elements.map((element) => element.getBoundingClientRect().toJSON()),
          );
      const before = await bounds();
      await trigger.press("ArrowDown");
      const menu = row.getByRole("group", {
        name: "Actions for Review preferences",
        exact: true,
      });
      await expect(
        menu.getByRole("button", { name: "Move", exact: true }),
      ).toBeFocused();
      expect(await bounds()).toEqual(before);
      const box = (await menu.boundingBox())!;
      expect(box.x + box.width).toBeLessThanOrEqual(
        await page.evaluate(
          () => document.documentElement.getBoundingClientRect().right - 8,
        ),
      );
      await menu
        .getByRole("button", { name: "Move", exact: true })
        .press("End");
      await expect(
        menu.getByRole("button", { name: "Delete note…", exact: true }),
      ).toBeFocused();
      await page.screenshot({
        path: info.outputPath(`row-dropdown-${width}.png`),
      });
      await page.keyboard.press("Escape");
      await expect(menu).toBeHidden();
      await expect(trigger).toBeFocused();
      expect(await bounds()).toEqual(before);
      await trigger.click();
      await menu.getByRole("button", { name: "Export…", exact: true }).click();
      const exportDialog = page.getByRole("dialog", {
        name: "Export note",
        exact: true,
      });
      await expect(exportDialog).toBeVisible();
      await exportDialog
        .getByRole("button", { name: "Done", exact: true })
        .click();
      await expect(trigger).toBeFocused();
      await trigger.click();
      // The overlay may cover the other row's trigger; keyboard users can still
      // switch directly, and native auto-popover ownership dismisses the first.
      const other = page.getByRole("button", {
        name: "Actions for Launch checklist",
        exact: true,
      });
      await other.focus();
      await other.press("Enter");
      await expect(
        page.getByRole("group", { name: /^Actions for/ }),
      ).toHaveCount(1);
      await page.getByRole("heading", { name: "Notes", exact: true }).click();
      await expect(
        page.getByRole("group", { name: /^Actions for/ }),
      ).toHaveCount(0);
    });
  });
}

for (const width of [1440, 768, 390, 320]) {
  test.describe(`stable note tools at ${width}px`, () => {
    test.use({ viewport: { width, height: 900 }, hasTouch: width < 600 });
    test("modes and inspectors preserve document bounds and return reading position", async ({
      page,
    }, info) => {
      await fixture(page, [
        {
          ...note,
          content: `# A stable workspace\n\n${"A thought worth keeping.\n\n".repeat(60)}\n## Next steps\n\n- [ ] Keep the document steady`,
        },
      ]);
      await page.goto(`${base}/app`);
      await page.locator(".memory-open").click();
      const drawer = page.getByRole("dialog", { name: "Note", exact: true });
      const paper = drawer.locator(".writing-layout");
      const geometry = () =>
        drawer.evaluate((element) =>
          Object.fromEntries(
            [
              ".note-editor-bar",
              ".editor-heading",
              ".writing-layout",
              ".editor-footer",
              ".note-export-button",
              ".note-save-button",
            ].map((selector) => [
              selector,
              element.querySelector(selector)!.getBoundingClientRect().toJSON(),
            ]),
          ),
        );
      await page.evaluate(() => document.fonts.ready);
      await expect(
        drawer.getByRole("button", { name: "Preview", exact: true }),
      ).toHaveAttribute("aria-pressed", "true");
      const before = await geometry();
      await paper.evaluate((element) => element.scrollTo(0, 250));
      const position = await paper.evaluate((element) => element.scrollTop);
      await page.screenshot({
        path: info.outputPath(`note-read-${width}.png`),
      });
      for (const mode of ["Write", "Markdown", "Preview"]) {
        await drawer.getByRole("button", { name: mode, exact: true }).click();
        await expect(
          drawer.getByRole("button", { name: mode, exact: true }),
        ).toHaveAttribute("aria-pressed", "true");
        expect(await geometry()).toEqual(before);
      }
      await expect
        .poll(() => paper.evaluate((element) => element.scrollTop))
        .toBe(position);
      if (width <= 960)
        await drawer
          .getByRole("button", { name: "Note actions", exact: true })
          .click();
      await drawer
        .getByRole("button", { name: "Note properties", exact: true })
        .click();
      const properties = page.getByRole("dialog", {
        name: "Note properties",
        exact: true,
      });
      await expect(
        properties.getByRole("combobox", { name: "Notebook", exact: true }),
      ).toBeFocused();
      expect(await geometry()).toEqual(before);
      expect(await paper.evaluate((element) => element.scrollTop)).toBe(
        position,
      );
      await page.screenshot({
        path: info.outputPath(`note-properties-${width}.png`),
      });
      await page.keyboard.press("Escape");
      await expect(properties).toHaveCount(0);
      await drawer
        .getByRole("button", { name: "Note outline", exact: true })
        .click();
      const outline = page.getByRole("dialog", {
        name: "Note outline",
        exact: true,
      });
      await expect(outline).toBeVisible();
      expect(await geometry()).toEqual(before);
      await page.screenshot({
        path: info.outputPath(`note-outline-${width}.png`),
      });
      await outline
        .getByRole("button", { name: "Next steps", exact: true })
        .click();
      await expect(outline).toHaveCount(0);
      await expect(
        drawer.getByRole("button", { name: "Preview", exact: true }),
      ).toHaveAttribute("aria-pressed", "true");
      await expect(
        drawer
          .locator(".editor-preview")
          .getByRole("heading", { name: "Next steps" }),
      ).toBeFocused();
      const afterOutline = await paper.evaluate((element) => element.scrollTop);
      if (width <= 960)
        await drawer
          .getByRole("button", { name: "Note actions", exact: true })
          .click();
      await drawer
        .getByRole("button", { name: "Expand editor", exact: true })
        .click();
      await expect(drawer.locator(".note-editor-drawer")).toHaveCount(0);
      await drawer
        .getByRole("button", { name: "Return to compact editor", exact: true })
        .click();
      expect(await geometry()).toEqual(before);
      await expect
        .poll(() => paper.evaluate((element) => element.scrollTop))
        .toBe(afterOutline);
      await page.keyboard.press("Control+Shift+f");
      await expect(drawer.locator(".editor-focus")).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(drawer.locator(".editor-focus")).toHaveCount(0);
      expect(await geometry()).toEqual(before);
      await expect
        .poll(() => paper.evaluate((element) => element.scrollTop))
        .toBe(afterOutline);
      expect(
        await drawer.evaluate(
          (element) => element.scrollWidth <= element.clientWidth,
        ),
      ).toBe(true);
      expect(
        (
          await new AxeBuilder({ page })
            .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
            .analyze()
        ).violations,
      ).toEqual([]);
      await drawer.getByRole("button", { name: "Write", exact: true }).click();
      await page.screenshot({
        path: info.outputPath(`note-write-${width}.png`),
      });
    });
  });
}

const checklist =
  "# Checklists\n\n- [ ] Repeat\n  - [x] Repeat\n- [ ] Ship **the note**\n\n> - [ ] Quoted task\n\n1. [ ] Ordered task\n\n```md\n- [ ] Example only\n```\n\n\\- [ ] Escaped example";
test("viewer checkbox saves start immediately and drain newer toggles without a typing delay", async ({
  page,
}) => {
  const state = await fixture(page, [{ ...note, content: checklist }]);
  const started = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  let requests = 0;
  await page.route("**/api/grove/memories", async (route) => {
    requests++;
    if (requests === 1) {
      started.resolve();
      await release.promise;
    }
    await route.fallback();
  });
  await page.goto(`${base}/app/memories/${note.id}`);
  const task = page.getByRole("checkbox", { name: "Ship the note" });
  await expect(task).toBeVisible();
  // No app timer can elapse: task writes must bypass the typing debounce.
  await page.clock.install();
  await page.clock.pauseAt(new Date());
  await task.click();
  await expect.poll(() => requests).toBe(1);
  await started.promise;
  await task.click();
  await expect(task).not.toBeChecked();
  release.resolve();
  await expect.poll(() => requests).toBe(2);
  await expect.poll(() => state.records.get(note.id)?.version).toBe(3);
  expect(state.records.get(note.id)?.content).toBe(checklist);
  await expect(task).toBeFocused();
});

test("first autosave keeps the document, focus, scroll and undo history through routing", async ({
  page,
  browserName,
}) => {
  const state = await fixture(page, []);
  const release = Promise.withResolvers<void>();
  let started = false;
  await page.route("**/api/grove/memories", async (route) => {
    started = true;
    await release.promise;
    await route.fallback();
  });
  await page.goto(`${base}/app/notes/new`);
  const editor = page.getByRole("textbox", {
    name: "What should stay with you?",
  });
  await expect(editor).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  await page.clock.install();
  await page.clock.pauseAt(new Date());
  const original = await editor.elementHandle();
  const content = `# A continuous document\n\n${"A paragraph to keep the page scrolling.\n\n".repeat(45)}`;
  await editor.fill(content);
  await page.clock.runFor(500);
  await expect.poll(() => started).toBe(true);
  // Separate the next keystroke from the initial paste's undo group.
  await page.clock.runFor(100);
  await page.clock.resume();
  await editor.press("End");
  await editor.press("x");
  // Finish CodeMirror's cursor-reveal measurement before choosing a reading position.
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  const scroll = await page
    .locator(".writing-layout")
    .evaluate(async (node) => {
      node.scrollTop = 180;
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      );
      return node.scrollTop;
    });
  const before = await page.locator(".writing-layout").boundingBox();
  release.resolve();
  await expect(page).toHaveURL(/\/memories\/[^/]+\?mode=edit$/);
  expect(await editor.evaluate((node, prior) => node === prior, original)).toBe(
    true,
  );
  await expect(editor).toBeFocused();
  expect(await page.locator(".writing-layout").boundingBox()).toEqual(before);
  expect(
    await page.locator(".writing-layout").evaluate((node) => node.scrollTop),
  ).toBe(scroll);
  await editor.press(`${browserName === "webkit" ? "Meta" : "Control"}+z`);
  await expect(page.locator(".editor-footer")).toContainText(
    `${content.length.toLocaleString()} / 6,000`,
  );
  await editor.press(
    `${browserName === "webkit" ? "Meta" : "Control"}+Shift+Z`,
  );
  await expect(page.locator(".editor-footer")).toContainText(
    `${(content.length + 1).toLocaleString()} / 6,000`,
  );
  await expect(page.locator(".note-save-status")).toHaveText("Saved");
  expect(state.records.size).toBe(1);
  await page.getByRole("button", { name: "Note actions", exact: true }).click();
  await page
    .getByRole("button", { name: "Revision history", exact: true })
    .click();
  await expect(
    page.getByRole("dialog", { name: "Revision history" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Close dialog", exact: true }).click();
  await page.keyboard.press("Control+Alt+n");
  await expect(page.locator(".editor-footer")).toContainText(
    "0 words · 0 / 6,000",
  );
  await page.goBack();
  await expect(page.locator(".note-editor-location h1")).toHaveText(
    "A continuous document",
  );
  await page.reload();
  await expect(page.locator(".note-editor-location h1")).toHaveText(
    "A continuous document",
  );
  await expect(page.locator(".editor-footer")).toContainText(
    `${(content.length + 1).toLocaleString()} / 6,000`,
  );
});

test("focus mode switches reading and writing and the outline navigates normalized headings", async ({
  page,
}, info) => {
  await fixture(page, [
    {
      ...note,
      content: `# Outline\r\n\r\n${"Some context.\r\n\r\n".repeat(30)}## **A section**\r\n\r\n${"More context.\r\n\r\n".repeat(25)}Last section\r\n------------\r\n\r\n${"Last paragraph.\r\n\r\n".repeat(25)}`,
    },
  ]);
  await page.goto(`${base}/app/memories/${note.id}`);
  await page.getByRole("button", { name: "Note actions", exact: true }).click();
  const menuFocus = page
    .locator(".action-menu:popover-open")
    .getByRole("button", { name: "Focus mode", exact: true });
  if (await menuFocus.isVisible()) await menuFocus.click();
  else {
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Focus mode", exact: true }).click();
  }
  await expect(page.locator(".app-sidebar")).not.toBeVisible();
  for (const mode of ["Write", "Preview"]) {
    await page.getByRole("button", { name: mode, exact: true }).click();
    await expect(
      page.getByRole("button", { name: mode, exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await page
      .getByRole("button", { name: "Note outline", exact: true })
      .click();
    const outline = page.getByRole("dialog", { name: "Note outline" });
    await outline
      .getByRole("button", { name: "A section", exact: true })
      .click();
    await expect(outline).not.toBeVisible();
    if (mode === "Preview")
      await expect(
        page.getByRole("heading", { name: "A section", exact: true }),
      ).toBeFocused();
    else
      await expect(
        page.getByRole("textbox", { name: "What should stay with you?" }),
      ).toBeFocused();
    expect(
      await page.locator(".writing-layout").evaluate((node) => node.scrollTop),
    ).toBeGreaterThan(100);
  }
  await page.getByRole("button", { name: "Note outline", exact: true }).click();
  const outline = page.getByRole("dialog", { name: "Note outline" });
  await expect(
    outline.getByRole("button", { name: "A section", exact: true }),
  ).toHaveAttribute("aria-current", "location");
  await page.screenshot({ path: info.outputPath("focus-outline.png") });
  await outline
    .getByRole("button", { name: "Last section", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Last section", exact: true }),
  ).toBeFocused();
  await page
    .getByRole("button", { name: "Exit focus mode", exact: true })
    .click();
  await expect(page.locator(".editor-focus")).toHaveCount(0);
  if (page.viewportSize()!.width < 1024) {
    await expect(page.locator(".app-sidebar")).not.toBeVisible();
    await expect(
      page.getByRole("button", { name: "Back to notes", exact: true }),
    ).toBeVisible();
  } else await expect(page.locator(".app-sidebar")).toBeVisible();
});
for (const width of [1440, 390]) {
  test.describe(`viewer tasks at ${width}px`, () => {
    test.use({ viewport: { width, height: 900 }, hasTouch: width < 600 });
    test("toggle exact Markdown tasks with keyboard, touch and undo without moving the reader", async ({
      page,
      browserName,
    }, info) => {
      const state = await fixture(page, [
        {
          ...note,
          content:
            width === 1440 ? checklist.replaceAll("\n", "\r\n") : checklist,
        },
      ]);
      await page.goto(`${base}/app/memories/${note.id}`);
      const reader = page.locator(".editor-preview");
      await expect(reader.getByRole("checkbox")).toHaveCount(5);
      await page.evaluate(() => document.fonts.ready);
      const bounds = await page.locator(".writing-layout").boundingBox();
      const repeated = reader.getByRole("checkbox", {
        name: "Repeat",
        exact: true,
      });
      const nested = repeated.nth(1);
      await expect(nested).toBeChecked();
      if (width < 600) await nested.tap();
      else await nested.click();
      await expect(nested).not.toBeChecked();
      await expect(nested).toBeFocused();
      await expect
        .poll(() => state.records.get(note.id)?.content)
        .toBe(checklist.replace("  - [x]", "  - [ ]"));
      const first = repeated.first();
      await first.focus();
      await first.press("Space");
      await expect(first).toBeChecked();
      const mod = browserName === "webkit" ? "Meta" : "Control";
      await first.press(`${mod}+z`);
      await expect(first).not.toBeChecked();
      await expect(first).toBeFocused();
      await first.press(`${mod}+Shift+z`);
      await expect(first).toBeChecked();
      const ordered = reader.getByRole("checkbox", { name: "Ordered task" });
      await ordered.click();
      await expect(ordered).toBeChecked();
      await expect
        .poll(() => state.records.get(note.id)?.content)
        .toBe(
          checklist
            .replace("- [ ] Repeat", "- [x] Repeat")
            .replace("  - [x]", "  - [ ]")
            .replace("1. [ ]", "1. [x]"),
        );
      expect(await page.locator(".writing-layout").boundingBox()).toEqual(
        bounds,
      );
      await expect(
        page.getByRole("button", { name: "Preview", exact: true }),
      ).toHaveAttribute("aria-pressed", "true");
      await page.screenshot({
        path: info.outputPath(`viewer-checklist-${width}.png`),
      });
      await page.reload();
      await expect(
        reader.getByRole("checkbox", { name: "Ordered task" }),
      ).toBeChecked();
      await expect(
        reader.getByRole("checkbox", { name: "Repeat", exact: true }).first(),
      ).toBeChecked();
    });
  });
}

test("viewer tasks keep newer checks through a held save and leave revision previews read-only", async ({
  page,
}) => {
  const state = await fixture(page, [{ ...note, content: checklist }]);
  const started = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  await page.route("**/api/grove/memories", async (route) => {
    started.resolve();
    await release.promise;
    await route.fallback();
  });
  await page.goto(`${base}/app/memories/${note.id}`);
  const reader = page.locator(".editor-preview");
  await reader
    .getByRole("checkbox", { name: "Ship the note", exact: true })
    .click();
  await started.promise;
  await reader
    .getByRole("checkbox", { name: "Quoted task", exact: true })
    .click();
  release.resolve();
  await expect
    .poll(() => state.records.get(note.id)?.content)
    .toBe(
      checklist
        .replace("- [ ] Ship", "- [x] Ship")
        .replace("> - [ ]", "> - [x]"),
    );
  await expect(
    reader.getByRole("checkbox", { name: "Quoted task" }),
  ).toBeFocused();
  expect(
    state.calls
      .filter((call) => call.path === "/memories")
      .map((call) => call.body.expectedVersion),
  ).toEqual([1, 2]);
  await page.getByRole("button", { name: "Note actions", exact: true }).click();
  await page
    .getByRole("button", { name: "Revision history", exact: true })
    .click();
  const history = page.getByRole("dialog", { name: "Revision history" });
  await expect(history).toBeVisible();
  await expect(history.getByRole("checkbox")).toHaveCount(0);
});

test("viewer task save failures retain the checked draft and stable controls for retry", async ({
  page,
}) => {
  const state = await fixture(page, [{ ...note, content: checklist }]);
  let failed = true;
  await page.route("**/api/grove/memories", (route) =>
    failed
      ? route.fulfill({
          status: 503,
          json: {
            success: false,
            error: { code: "unavailable", message: "Please retry this save." },
          },
        })
      : route.fallback(),
  );
  await page.goto(`${base}/app/memories/${note.id}`);
  const task = page
    .locator(".editor-preview")
    .getByRole("checkbox", { name: "Ship the note" });
  await expect(task).toBeVisible();
  const geometry = () =>
    page
      .locator(".note-editor")
      .evaluate((element) =>
        [".writing-layout", ".note-save-status", ".note-save-button"].map(
          (selector) =>
            element.querySelector(selector)!.getBoundingClientRect().toJSON(),
        ),
      );
  const before = await geometry();
  await task.click();
  await expect(page.getByRole("alert")).toHaveText("Please retry this save.");
  await expect(task).toBeChecked();
  expect(await geometry()).toEqual(before);
  expect(state.records.get(note.id)?.content).toBe(checklist);
  failed = false;
  await page.getByRole("button", { name: "Save note", exact: true }).click();
  await expect
    .poll(() => state.records.get(note.id)?.content)
    .toBe(checklist.replace("- [ ] Ship", "- [x] Ship"));
  expect(await geometry()).toEqual(before);
});

test("viewer task conflicts retain the draft until the newer saved version is reviewed", async ({
  page,
}) => {
  const state = await fixture(page, [{ ...note, content: checklist }]);
  await page.goto(`${base}/app/memories/${note.id}`);
  const task = page
    .locator(".editor-preview")
    .getByRole("checkbox", { name: "Ship the note" });
  await expect(task).not.toBeChecked();
  const newer = `${checklist}\nAn agent added context.`;
  state.records.set(note.id, { ...note, content: newer, version: 2 });
  await task.click();
  const review = page.getByRole("region", { name: "Review newer version" });
  await expect(review).toContainText("An agent added context.");
  await expect(review.getByRole("checkbox")).toHaveCount(0);
  await expect(task).toBeChecked();
  await expect(
    page.getByRole("button", { name: "Save note", exact: true }),
  ).toBeDisabled();
  expect(state.records.get(note.id)?.content).toBe(newer);
  await review
    .getByRole("button", { name: "Use saved version", exact: true })
    .click();
  await expect(task).not.toBeChecked();
  await task.click();
  await expect
    .poll(() => state.records.get(note.id)?.content)
    .toBe(newer.replace("- [ ] Ship", "- [x] Ship"));
  expect(
    state.calls
      .filter((call) => call.path === "/memories")
      .map((call) => call.body.expectedVersion),
  ).toEqual([1, 2]);
});

test("mobile note controls leave room to read and retain selection for touch formatting", async ({
  browser,
}, info) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  try {
    await fixture(page, [note]);
    await page.goto(`${base}/app`);
    await page.locator(".memory-open").tap();
    const drawer = page.getByRole("dialog", { name: "Note", exact: true });
    await expect(
      drawer.getByRole("button", { name: "Close dialog", exact: true }),
    ).toHaveCount(1);
    expect(
      (await drawer.locator(".writing-layout").boundingBox())!.y,
    ).toBeLessThanOrEqual(176);
    expect(
      await page.evaluate(
        () => (document.activeElement as HTMLElement)?.isContentEditable,
      ),
    ).toBe(false);
    await page.screenshot({
      path: info.outputPath("compact-reader-mobile.png"),
    });
    await drawer.getByRole("button", { name: "Write", exact: true }).tap();
    const editor = drawer.getByRole("textbox", {
      name: "What should stay with you?",
    });
    await editor.fill("A soft landing");
    await editor.press("Home");
    for (let i = 0; i < 6; i++) await editor.press("Shift+ArrowRight");
    await drawer.getByRole("button", { name: "Formatting", exact: true }).tap();
    await drawer.getByRole("button", { name: "Bold", exact: true }).tap();
    await expect(editor).toHaveText("**A soft** landing");
    await drawer.getByRole("button", { name: "Formatting", exact: true }).tap();
    await drawer.getByRole("button", { name: "Undo", exact: true }).tap();
    await expect(editor).toHaveText("A soft landing");
    await page.setViewportSize({ width: 390, height: 480 });
    await expect(
      drawer.getByRole("button", { name: "Save note", exact: true }),
    ).toBeInViewport();
    await drawer.getByRole("button", { name: "Preview", exact: true }).tap();
    await drawer
      .getByRole("button", { name: "Note actions", exact: true })
      .tap();
    await page
      .getByRole("button", { name: "Note properties", exact: true })
      .tap();
    await expect(
      drawer.getByRole("combobox", { name: "Notebook", exact: true }),
    ).toBeVisible();
    expect(
      await drawer.evaluate((el) => el.scrollWidth <= el.clientWidth),
    ).toBe(true);
    await page
      .getByRole("dialog", { name: "Note properties", exact: true })
      .getByRole("button", { name: "Close dialog", exact: true })
      .tap();
    await page.setViewportSize({ width: 320, height: 750 });
    expect(
      await drawer.evaluate((el) => el.scrollWidth <= el.clientWidth),
    ).toBe(true);
    expect(
      (await drawer.locator(".writing-layout").boundingBox())!.height,
    ).toBeGreaterThan(400);
    await page.screenshot({ path: info.outputPath("compact-reader-320.png") });
    await page.goto(`${base}/app/memories/${note.id}`);
    const fullPageEditor = page.locator(".note-editor-full");
    await expect(fullPageEditor).toBeVisible();
    for (const viewport of [
      { width: 320, height: 750 },
      { width: 390, height: 844 },
      { width: 768, height: 844 },
      { width: 390, height: 480 },
    ]) {
      await page.setViewportSize(viewport);
      await expect(
        page.getByRole("complementary", { name: "Workspace sidebar" }),
      ).toBeHidden();
      const bounds = (await fullPageEditor.boundingBox())!;
      expect(bounds.y).toBe(0);
      expect(bounds.y + bounds.height).toBeCloseTo(viewport.height, 0);
    }
  } finally {
    await context.close();
  }
});

test("export and delete remain reachable across widths, focus mode and enlarged text", async ({
  page,
}, info) => {
  await fixture(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(`${base}/app/memories/${note.id}`);
  for (const width of [320, 390, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 844 });
    const target = await page.evaluate(() =>
      matchMedia("(any-pointer: coarse), (max-width: 600px)").matches ? 44 : 36,
    );
    for (const name of ["Export", "Delete note…"]) {
      const direct = page.getByRole("button", { name, exact: true });
      const compact = !(await direct.isVisible());
      if (compact)
        await page
          .getByRole("button", { name: "Note actions", exact: true })
          .click();
      const control = page.getByRole("button", {
        name: compact && name === "Export" ? "Export…" : name,
        exact: true,
      });
      await expect(control).toBeInViewport();
      const bounds = (await control.boundingBox())!;
      expect(bounds.width).toBeGreaterThanOrEqual(target);
      expect(bounds.height).toBeGreaterThanOrEqual(target);
      if (compact) await page.keyboard.press("Escape");
    }
    expect(
      await page
        .locator(".note-editor-bar")
        .evaluate((el) => el.scrollWidth <= el.clientWidth),
    ).toBe(true);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: info.outputPath("note-actions-390.png") });
  await page.getByRole("button", { name: "Note actions", exact: true }).click();
  const actions = page.getByRole("group", {
    name: "Note actions",
    exact: true,
  });
  const labels = await actions
    .locator("button, a")
    .filter({ visible: true })
    .allTextContents();
  expect(labels.indexOf("Move")).toBeLessThan(labels.indexOf("Export…"));
  expect(labels.at(-1)).toBe("Delete note…");
  await actions
    .getByRole("button", { name: "Focus mode", exact: true })
    .click();
  await openNoteAction(page, "Delete note…");
  const confirm = page.getByRole("dialog", { name: "Delete note?" });
  await confirm.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Note actions", exact: true }),
  ).toBeFocused();
  await openNoteAction(page, "Export");
  const dialog = page.getByRole("dialog", { name: "Export note", exact: true });
  await page.screenshot({ path: info.outputPath("export-390.png") });
  expect(
    (
      await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze()
    ).violations,
  ).toEqual([]);
  await dialog.getByRole("button", { name: "Done", exact: true }).click();
  await page
    .getByRole("button", { name: "Exit focus mode", exact: true })
    .click();
  await page.setViewportSize({ width: 320, height: 480 });
  await page.addStyleTag({
    content:
      ".note-editor-bar { font-size: 200%; } .note-editor-bar button { font-size: 1em; }",
  });
  await expect(
    page.getByRole("button", { name: "Note actions", exact: true }),
  ).toBeInViewport();
  expect(
    await page
      .locator(".note-editor-bar")
      .evaluate((el) => el.scrollWidth <= el.clientWidth),
  ).toBe(true);
});

test("one wide note workspace preserves editor history, toggles with shortcuts and gives non-reflowing feedback", async ({
  page,
}, info) => {
  const state = await fixture(page, [
    {
      ...note,
      projectId: project.id,
      enrichment: {
        ...note.enrichment!,
        relationships: [
          { id: handoff.id, version: 1, relationship: "complementary" },
        ],
      },
    },
    handoff,
  ]);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${base}/app`);
  await page
    .locator(".memory-open")
    .filter({ hasText: "Review preferences" })
    .click();
  const drawer = page.getByRole("dialog", { name: "Note", exact: true });
  expect((await drawer.boundingBox())!.width).toBeGreaterThan(900);
  await expect(drawer.locator(".linked-notes")).not.toHaveAttribute("open", "");
  await expect(drawer.getByText("Agent details", { exact: true })).toBeHidden();
  await drawer.locator(".linked-notes summary").click();
  await expect(
    drawer.getByRole("button", { name: "Connection: Launch checklist" }),
  ).toBeVisible();
  await drawer.locator(".linked-notes summary").click();
  await page.keyboard.press("Control+e");
  const editor = drawer.getByRole("textbox", {
    name: "What should stay with you?",
  });
  await expect(editor).toBeFocused();
  await editor.fill("First thought");
  await editor.press("End");
  await editor.press("ArrowLeft");
  await editor.press("Delete");
  await expect(editor).toHaveText("First though");
  await editor.press("Control+z");
  await expect(editor).toHaveText("First thought");
  await editor.press("Control+e");
  await expect(drawer.locator(".editor-preview")).toHaveText("First thought");
  await page.keyboard.press("Control+e");
  await expect(editor).toBeFocused();
  await editor.press("Control+Shift+Z");
  await expect(editor).toHaveText("First though");
  await editor.press("Control+s");
  await expect(drawer.locator(".note-save-status")).toHaveText("Saved");
  expect(state.records.get(note.id)?.content).toBe("First though");
  await editor.press("Control+e");
  const before = await drawer.locator(".writing-paper").boundingBox();
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await openNoteAction(drawer, "Export");
  await page
    .getByRole("button", { name: "Copy Markdown", exact: true })
    .click();
  await expect(drawer.locator(".workspace-toast")).toContainText(
    "Markdown copied",
  );
  expect(await drawer.locator(".writing-paper").boundingBox()).toEqual(before);
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    "First though",
  );
  await page.screenshot({
    path: info.outputPath("unified-note-toast-desktop.png"),
  });
  await page.setViewportSize({ width: 390, height: 844 });
  const mobileBounds = (await drawer.boundingBox())!;
  expect(mobileBounds.x).toBeGreaterThanOrEqual(0);
  expect(mobileBounds.x + mobileBounds.width).toBeLessThanOrEqual(390);
  await expect(
    drawer.getByRole("button", { name: "Write", exact: true }),
  ).toBeInViewport();
  expect(
    (
      await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze()
    ).violations,
  ).toEqual([]);
  expect(
    await drawer.evaluate(
      (element) => element.scrollWidth <= element.clientWidth,
    ),
  ).toBe(true);
  await page.screenshot({ path: info.outputPath("unified-note-mobile.png") });
});

test("visible row deletion confirms directly and rejects a stale revision", async ({
  page,
}) => {
  const state = await fixture(page);
  await page.goto(`${base}/app`);
  const row = page.locator(`[data-note-id="${note.id}"]`);
  await row
    .getByRole("button", { name: `Actions for Review preferences` })
    .click();
  await row.getByRole("button", { name: "Delete note…", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Delete note?" });
  await expect(page.locator(".note-editor")).toHaveCount(0);
  await expect(
    dialog.getByRole("button", { name: "Cancel", exact: true }),
  ).toBeFocused();
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  expect(
    state.calls.filter((call) => call.path === "/memories/delete"),
  ).toHaveLength(0);
  await row
    .getByRole("button", { name: "Actions for Review preferences" })
    .click();
  await row.getByRole("button", { name: "Delete note…", exact: true }).click();
  state.records.get(note.id)!.version++;
  await dialog.getByRole("button", { name: "Delete this note" }).click();
  await expect(dialog.getByRole("alert")).toContainText(
    "changed or is no longer available",
  );
  expect(state.records.has(note.id)).toBe(true);
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(
    row.getByRole("button", {
      name: "Actions for Review preferences",
      exact: true,
    }),
  ).toBeFocused();
});

test("direct delete can discard an invalid dirty draft without saving it", async ({
  page,
}) => {
  const state = await fixture(page);
  await page.goto(`${base}/app/memories/${note.id}?mode=edit`);
  const editor = page.getByRole("textbox", {
    name: "What should stay with you?",
  });
  await editor.fill("A draft that exceeds the save limit. ".repeat(200));
  await openNoteAction(page, "Delete note…");
  const dialog = page.getByRole("dialog", { name: "Delete note?" });
  await expect(dialog).toContainText("local draft");
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(editor).toContainText("exceeds the save limit");
  await openNoteAction(page, "Delete note…");
  await dialog
    .getByRole("button", { name: "Delete note and discard draft" })
    .click();
  await expect(page).toHaveURL(`${base}/app`);
  expect(state.records.has(note.id)).toBe(false);
  expect(state.calls.filter((call) => call.path === "/memories")).toHaveLength(
    0,
  );
});

test("deletion waits for a held save and uses the revision it produced", async ({
  page,
}) => {
  const state = await fixture(page);
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/grove/memories", async (route) => {
    await held;
    await route.fallback();
  });
  await page.goto(`${base}/app/memories/${note.id}?mode=edit`);
  await page
    .getByRole("textbox", { name: "What should stay with you?" })
    .fill("# Saved before deletion");
  await page.getByRole("button", { name: "Save note", exact: true }).click();
  await openNoteAction(page, "Delete note…");
  const dialog = page.getByRole("dialog", { name: "Delete note?" });
  await expect(dialog).toContainText("Finishing the pending save");
  await expect(
    dialog.getByRole("button", {
      name: /Delete (this note|note and discard draft)/,
    }),
  ).toBeDisabled();
  release();
  const confirm = dialog.getByRole("button", {
    name: /Delete (this note|note and discard draft)/,
  });
  await expect(confirm).toBeEnabled();
  await confirm.click();
  await expect(page).toHaveURL(`${base}/app`);
  const deletion = state.calls.find(
    (call) => call.path === "/memories/delete",
  )!;
  expect(deletion.body.items).toEqual([{ id: note.id, expectedVersion: 2 }]);
  expect(state.records.has(note.id)).toBe(false);
});

test("row deletion resolves a lost save with its original identity and keeps newer draft text", async ({
  page,
}) => {
  const state = await fixture(page);
  const attempts: Record<string, unknown>[] = [];
  await page.route("**/api/grove/memories", async (route) => {
    const input = route.request().postDataJSON();
    attempts.push(input);
    if (attempts.length === 1) {
      state.records.set(note.id, {
        ...note,
        content: input.content,
        version: 2,
      });
      return route.abort("failed");
    }
    return route.fulfill({
      json: { success: true, data: state.records.get(note.id) },
    });
  });
  await page.goto(`${base}/app/memories/${note.id}?mode=edit`);
  const editor = page.getByRole("textbox", {
    name: "What should stay with you?",
  });
  await editor.fill("Committed before the connection was lost");
  await page.getByRole("button", { name: "Save note", exact: true }).click();
  await expect(page.locator(".note-save-status")).toContainText("Not saved");
  await editor.fill("A newer unsavable draft. ".repeat(300));
  await page
    .getByRole("button", { name: "Back to notes", exact: true })
    .click();
  const row = page.locator(`[data-note-id="${note.id}"]`);
  await row
    .getByRole("button", { name: "Actions for Review preferences" })
    .click();
  await row.getByRole("button", { name: "Delete note…", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Delete note?" });
  await expect(
    dialog.getByRole("button", { name: "Delete note and discard draft" }),
  ).toBeDisabled();
  await dialog
    .getByRole("button", { name: "Retry pending save", exact: true })
    .click();
  await expect(
    dialog.getByRole("button", { name: "Delete note and discard draft" }),
  ).toBeEnabled();
  expect(attempts).toHaveLength(2);
  expect(attempts[1]).toEqual(attempts[0]);
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await row
    .getByRole("button", { name: "Actions for Review preferences" })
    .click();
  await row.getByRole("button", { name: "Export…", exact: true }).click();
  const download = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Markdown (.md)", exact: true })
    .click();
  expect((await readDownload(await download)).toString("utf8")).toBe(
    "A newer unsavable draft. ".repeat(300),
  );
});

test("export downloads exact unsaved Markdown and preserves a denied clipboard fallback", async ({
  page,
}) => {
  const state = await fixture(page);
  await page.goto(`${base}/app/memories/${note.id}?mode=edit`);
  const content =
    "# CON.pdf\n\nCafé 日本語 🌱\n\n```ts\n  const keep = true;\n```\n" +
    "Long draft. ".repeat(550);
  await page
    .getByRole("textbox", { name: "What should stay with you?" })
    .fill(content);
  await openNoteAction(page, "Export");
  const dialog = page.getByRole("dialog", { name: "Export note", exact: true });
  await expect(dialog).toContainText("Includes unsaved changes");
  const download = page.waitForEvent("download");
  await dialog
    .getByRole("button", { name: "Markdown (.md)", exact: true })
    .click();
  const file = await download;
  expect(file.suggestedFilename()).toBe("note-CON.md");
  expect((await readDownload(file)).toString("utf8")).toBe(content);
  await page.evaluate(() =>
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: () => Promise.reject(new Error("Denied")) },
    }),
  );
  await dialog
    .getByRole("button", { name: "Copy Markdown", exact: true })
    .click();
  await expect(dialog.getByRole("alert")).toContainText(
    "Clipboard access is unavailable",
  );
  await expect(dialog.getByLabel("Markdown source")).toHaveValue(content);
  expect(state.calls.filter((call) => call.path === "/memories")).toHaveLength(
    0,
  );
});

test("row export reads current content and first-save routing retains the export snapshot", async ({
  page,
}) => {
  const state = await fixture(page);
  await page.goto(`${base}/app`);
  const row = page.locator(`[data-note-id="${note.id}"]`);
  await expect(row).toBeVisible();
  state.records.set(note.id, {
    ...note,
    content: "# Newer saved text",
    version: 2,
  });
  await row
    .getByRole("button", { name: "Actions for Review preferences" })
    .click();
  await row.getByRole("button", { name: "Export…", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Export note", exact: true });
  await expect(dialog).toContainText("Newer saved text");
  await dialog.getByRole("button", { name: "Done", exact: true }).click();
  const gate = Promise.withResolvers<void>();
  await page.route("**/api/grove/memories", async (route) => {
    await gate.promise;
    await route.fallback();
  });
  await page.getByRole("link", { name: "New note", exact: true }).click();
  await page
    .getByRole("textbox", { name: "What should stay with you?" })
    .fill("# First save export");
  await page.getByRole("button", { name: "Save note", exact: true }).click();
  await openNoteAction(page, "Export");
  await expect(dialog).toContainText("Includes unsaved changes");
  gate.resolve();
  await expect(page).toHaveURL(/\/app\/memories\/[^/]+\?mode=edit$/);
  await expect(dialog).toBeVisible();
  const download = page.waitForEvent("download");
  await dialog
    .getByRole("button", { name: "Markdown (.md)", exact: true })
    .click();
  expect((await readDownload(await download)).toString("utf8")).toBe(
    "# First save export",
  );
  const pdfDownload = page.waitForEvent("download");
  await dialog.getByRole("button", { name: "PDF (.pdf)", exact: true }).click();
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const loading = getDocument({
    data: new Uint8Array(await readDownload(await pdfDownload)),
    verbosity: 0,
  });
  expect((await loading.promise).numPages).toBe(1);
  await loading.destroy();
  await dialog.getByRole("button", { name: "Done", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Export", exact: true }),
  ).toBeFocused();
});

test("PDF load failure keeps Markdown available and cancellation terminates pending work", async ({
  page,
}) => {
  await fixture(page);
  await page.addInitScript(() => {
    const terminate = Worker.prototype.terminate;
    Worker.prototype.terminate = function () {
      document.documentElement.dataset.workerTerminated = "true";
      terminate.call(this);
    };
  });
  await page.route("**/note-pdf.worker.ts", (route) => route.abort("failed"));
  await page.goto(`${base}/app/memories/${note.id}`);
  await openNoteAction(page, "Export");
  const dialog = page.getByRole("dialog", { name: "Export note", exact: true });
  await dialog.getByRole("button", { name: "PDF (.pdf)", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText(
    "Could not prepare the PDF",
  );
  const download = page.waitForEvent("download");
  await dialog
    .getByRole("button", { name: "Markdown (.md)", exact: true })
    .click();
  await download;
  await page.unroute("**/note-pdf.worker.ts");
  const gate = Promise.withResolvers<void>();
  await page.route("**/note-pdf.worker.ts", async (route) => {
    await gate.promise;
    await route.continue();
  });
  await page.evaluate(
    () => delete document.documentElement.dataset.workerTerminated,
  );
  const requested = page.waitForRequest("**/note-pdf.worker.ts");
  await dialog.getByRole("button", { name: "PDF (.pdf)", exact: true }).click();
  await requested;
  await dialog
    .getByRole("button", { name: "Cancel export", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  expect(
    await page.locator("html").getAttribute("data-worker-terminated"),
  ).toBe("true");
  gate.resolve();
});

test("PDF export contains paginated searchable Markdown with safe links and Unicode fallbacks", async ({
  page,
}, info) => {
  const content =
    "# Café review\n\n[Read the guide](https://example.com/guide)\n\n![Diagram](https://images.example.com/private.png)\n\n- [x] Reviewed\n- [ ] Follow up\n\n```ts\nconst ready = true;\n```\n\n" +
    Array.from(
      { length: 30 },
      (_, i) =>
        `## Section ${i + 1}\n\nKeep feedback specific and include a working example.\n\n`,
    ).join("") +
    "| Name | Result |\n| --- | --- |\n| Last row | Complete |\n\n日本語 🌱\n\nFinal paragraph.";
  await fixture(page, [{ ...note, content }]);
  const external: string[] = [];
  page.on("request", (request) => {
    if (/images\.example|example\.com/.test(request.url()))
      external.push(request.url());
  });
  await page.goto(`${base}/app/memories/${note.id}`);
  await openNoteAction(page, "Export");
  const dialog = page.getByRole("dialog", { name: "Export note", exact: true });
  const pending = page.waitForEvent("download");
  await dialog.getByRole("button", { name: "PDF (.pdf)", exact: true }).click();
  const download = await pending;
  // WebKit normalizes spaces in download filenames to underscores.
  expect(download.suggestedFilename()).toMatch(/^Café[ _]review\.pdf$/);
  await download.saveAs(info.outputPath("note.pdf"));
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const loading = getDocument({
    data: new Uint8Array(await readDownload(download)),
    verbosity: 0,
  });
  const pdf = await loading.promise;
  expect(pdf.numPages).toBeGreaterThan(1);
  let text = "";
  const links: string[] = [];
  for (let index = 1; index <= pdf.numPages; index++) {
    const page = await pdf.getPage(index);
    text += (await page.getTextContent()).items
      .map((item) => ("str" in item ? item.str : ""))
      .join(" ");
    links.push(
      ...(await page.getAnnotations())
        .map((annotation) => annotation.url)
        .filter(Boolean),
    );
  }
  expect(text).toContain("Café review");
  expect(text).toContain("Final paragraph");
  expect(text).toContain("Last row");
  expect(text).toContain("const ready = true;");
  expect(text.replace(/[\s\u200b]/g, "")).toContain("[U+1F331]");
  expect(text).not.toContain("source-session");
  expect(links).toContain("https://example.com/guide");
  expect(external).toEqual([]);
  await expect(dialog).toContainText("Unicode codes");
  await loading.destroy();
});

test("PDF produces a focused single-page note with embedded code and navigable headings", async ({
  page,
}, info) => {
  const content = `# A quieter launch

Make the first release easy to understand. **One useful workflow**, a clear next
step, and enough space for the important details.

## Keep the essentials

- [x] Make the primary action easy to find
- [ ] Review the copy at a narrow screen width
- [ ] Leave room for the next iteration

> The best interface gives the work room to breathe.

## Delivery notes

| Area | Decision |
| --- | --- |
| Writing | Keep the document at the center |
| Feedback | Confirm the result without interrupting |
| Export | Preserve the words and their structure |

## A small implementation

Use \`ready\` to keep the transition explicit.

\`\`\`ts
const release = {
  name: "A quieter launch",
  ready: true,
};

publish(release);
\`\`\`

Next: share the draft, gather a little feedback, and make one careful improvement.

[Read the release notes](https://example.com/releases)
`;
  await fixture(page, [{ ...note, content }]);
  const fonts: string[] = [];
  page.on("request", (request) => {
    if (request.url().endsWith("jetbrains-mono-regular.ttf"))
      fonts.push(request.url());
  });
  await page.goto(`${base}/app/memories/${note.id}`);
  await openNoteAction(page, "Export");
  expect(fonts).toEqual([]);
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "PDF (.pdf)", exact: true }).click();
  const file = await download;
  await file.saveAs(info.outputPath("focused-note.pdf"));
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const loading = getDocument({
    data: new Uint8Array(await readDownload(file)),
    verbosity: 0,
    fontExtraProperties: true,
  });
  const pdf = await loading.promise;
  expect(pdf.numPages).toBe(1);
  const sheet = await pdf.getPage(1);
  const items = (await sheet.getTextContent()).items.filter(
    (item) => "str" in item,
  );
  const text = items.map((item) => item.str).join(" ");
  expect(text).toContain("publish(release);");
  expect(text).not.toContain("\u200b");
  expect(text).not.toMatch(/\[x\]|\[ \]|1 \/ 1/);
  await sheet.getOperatorList();
  const code = items.find((item) => item.str.includes("publish(release)"))!;
  expect(sheet.commonObjs.get(code.fontName).name).toContain("JetBrainsMono");
  const headings = await pdf.getOutline();
  expect(headings?.[0].title).toBe("A quieter launch");
  expect(headings?.[0].items.map((item) => item.title)).toEqual([
    "Keep the essentials",
    "Delivery notes",
    "A small implementation",
  ]);
  expect(fonts).toHaveLength(1);
  await loading.destroy();
});

test("PDF code-font load failure leaves source downloads usable and supports retry", async ({
  page,
}) => {
  await fixture(page, [
    { ...note, content: "# Code sample\n\n```ts\nconst ready = true;\n```" },
  ]);
  await page.route("**/jetbrains-mono-regular.ttf", (route) =>
    route.abort("failed"),
  );
  await page.goto(`${base}/app/memories/${note.id}`);
  await openNoteAction(page, "Export");
  const dialog = page.getByRole("dialog", { name: "Export note", exact: true });
  await dialog.getByRole("button", { name: "PDF (.pdf)", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText(
    "Could not prepare the PDF",
  );
  const markdown = page.waitForEvent("download");
  await dialog
    .getByRole("button", { name: "Markdown (.md)", exact: true })
    .click();
  expect((await readDownload(await markdown)).toString("utf8")).toContain(
    "const ready = true;",
  );
  await page.unroute("**/jetbrains-mono-regular.ttf");
  const download = page.waitForEvent("download");
  await dialog.getByRole("button", { name: "PDF (.pdf)", exact: true }).click();
  expect((await download).suggestedFilename()).toMatch(/^Code[ _]sample\.pdf$/);
});

test("PDF layout wraps long code and wide tables without clipped or missing content", async ({
  page,
}, info) => {
  const headers = Array.from(
    { length: 8 },
    (_, index) => `Column ${index + 1}`,
  );
  const content =
    "# Layout review\n\n> A quoted **important** thought.\n\n---\n\n" +
    "```text\n" +
    "A_long_unbroken_line_".repeat(80) +
    "\n```\n\n## Detailed results\n\n" +
    headers.join(" | ") +
    "\n" +
    headers.map(() => "---").join(" | ") +
    "\n" +
    Array.from({ length: 35 }, (_, row) =>
      headers
        .map((_, col) => `Row${row + 1}Cell${col + 1}with_long_text`)
        .join(" | "),
    ).join("\n") +
    "\n\n## Large record\n\n| ID | Details |\n| --- | --- |\n| Record A | " +
    "A long record must continue onto the next page without losing any text. ".repeat(
      110,
    ) +
    "End of large record. |\n\nFinal layout marker.";
  await fixture(page, [{ ...note, content }]);
  await page.goto(`${base}/app/memories/${note.id}`);
  await openNoteAction(page, "Export");
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "PDF (.pdf)", exact: true }).click();
  const file = await download;
  await file.saveAs(info.outputPath("wide-table.pdf"));
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const loading = getDocument({
    data: new Uint8Array(await readDownload(file)),
    verbosity: 0,
  });
  const pdf = await loading.promise;
  let text = "";
  const orientations: boolean[] = [];
  for (let index = 1; index <= pdf.numPages; index++) {
    const sheet = await pdf.getPage(index);
    const viewport = sheet.getViewport({ scale: 1 });
    orientations.push(viewport.width > viewport.height);
    const items = (await sheet.getTextContent()).items.filter(
      (item) => "str" in item,
    );
    if (items.some((item) => item.str === "Detailed results")) {
      expect(viewport.width).toBeGreaterThan(viewport.height);
      expect(items.map((item) => item.str).join("")).toContain("Row1Cell1");
    }
    expect(items.filter((item) => item.str.trim()).length).toBeGreaterThan(1);
    for (const item of items) {
      expect(item.transform[4]).toBeGreaterThanOrEqual(39);
      expect(item.transform[4] + item.width).toBeLessThanOrEqual(
        viewport.width - 38,
      );
      expect(item.transform[5]).toBeGreaterThan(10);
      expect(item.transform[5]).toBeLessThan(viewport.height - 20);
    }
    text += items.map((item) => item.str).join("");
  }
  const normalized = text.replace(/[\s\u200b]/g, "");
  expect(orientations[0]).toBe(false);
  expect(orientations.at(-1)).toBe(false);
  expect(orientations).toContain(true);
  expect(text).not.toContain("\u200b");
  expect(normalized).toContain("Finallayoutmarker.");
  expect(normalized).toContain("Endoflargerecord.");
  for (let row = 1; row <= 35; row++)
    for (let col = 1; col <= 8; col++) {
      expect(normalized).toContain(`Row${row}Cell${col}with_long_text`);
    }
  await loading.destroy();
});

test("browsing arrows and delete are scoped to notes and deletion still requires confirmation", async ({
  page,
}) => {
  const state = await fixture(page);
  await page.goto(`${base}/app`);
  const rows = page.locator(".memory-open");
  await rows.first().focus();
  await page.keyboard.press("ArrowDown");
  await expect(rows.nth(1)).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await expect(page.locator(".note-editor-location")).toContainText(
    "Review preferences",
  );
  await page.keyboard.press("ArrowLeft");
  await expect(page.locator(".note-editor-location")).toContainText(
    "Launch checklist",
  );
  await page.keyboard.press("ArrowRight");
  await expect(page.locator(".note-editor-location")).toContainText(
    "Review preferences",
  );
  await page.keyboard.press("Delete");
  const confirmation = page.getByRole("dialog", { name: "Delete note?" });
  await expect(confirmation).toBeVisible();
  expect(state.records.size).toBe(2);
  await page.keyboard.press("Escape");
  await expect(confirmation).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(rows.nth(1)).toBeFocused();
  await page.keyboard.press("Delete");
  await expect(confirmation).toBeVisible();
  await confirmation.getByRole("button", { name: "Delete this note" }).click();
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toBeFocused();
  expect(
    await page.evaluate(() => document.documentElement.style.overflow),
  ).not.toBe("hidden");
  expect(state.records.has(note.id)).toBe(false);
  expect(
    state.calls.filter((call) => call.path === "/memories/delete"),
  ).toHaveLength(1);
  const search = page.getByLabel("Search notes", { exact: true });
  await search.fill("launch");
  await search.press("Home");
  await search.press("Delete");
  await expect(search).toHaveValue("aunch");
  await expect(confirmation).toHaveCount(0);
  await search.fill("");
  await rows.first().focus();
  await page.keyboard.press("Delete");
  await confirmation.getByRole("button", { name: "Delete this note" }).click();
  await expect(
    page.getByRole("heading", { name: "Good things start small." }),
  ).toBeFocused();
});

test("connection evidence compares current notes, preserves the editor, and supports dismissal and Undo", async ({
  page,
}, info) => {
  const a = {
    ...note,
    content:
      "# Review preferences\n\nKeep feedback **specific**. The launch review must happen on October 30.",
    projectId: project.id,
    enrichment: {
      ...note.enrichment!,
      relationships: [
        { id: handoff.id, version: 1, relationship: "conflicting" as const },
      ],
    },
  };
  const state = await fixture(page, [
    a,
    {
      ...handoff,
      content:
        "# Launch checklist\n\nThe launch review must happen on November 2.",
    },
  ]);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${base}/app/memories/${note.id}`);
  await page.locator(".linked-notes summary").click();
  await expect(page.locator(".connection-row")).toContainText("May conflict");
  await page.screenshot({
    path: info.outputPath("relationship-list-desktop.png"),
  });
  const trigger = page.getByRole("button", {
    name: "Connection: Launch checklist",
    exact: true,
  });
  await expect(trigger).toHaveAccessibleDescription(
    /May conflict.*October 30 and November 2/,
  );
  await trigger.click();
  const inspector = page.getByRole("dialog", {
    name: "Connection",
    exact: true,
  });
  await expect(inspector.locator("blockquote").first()).toBeHidden();
  await expect(inspector).toContainText("October 30 and November 2");
  await page.screenshot({
    path: info.outputPath("relationship-summary-desktop.png"),
  });
  await inspector.locator(".connection-support summary").focus();
  await page.keyboard.press("Enter");
  await expect(inspector.locator("blockquote").first()).toBeVisible();
  await expect(inspector.locator("blockquote")).toHaveCount(2);
  await inspector
    .getByRole("button", { name: "Compare notes", exact: true })
    .click();
  const comparison = page.getByRole("dialog", {
    name: "Compare notes",
    exact: true,
  });
  await expect(comparison).toContainText("Keep feedback");
  await page.keyboard.press("Escape");
  await expect(
    inspector.getByRole("button", { name: "Compare notes", exact: true }),
  ).toBeFocused();
  await inspector.getByRole("button", { name: "Dismiss suggestion" }).click();
  await expect(
    inspector.getByRole("button", { name: "Undo dismissal" }),
  ).toBeVisible();
  expect([...state.pairs.values()][0].dismissed).toBe(true);
  await inspector.getByRole("button", { name: "Undo dismissal" }).click();
  await expect(
    inspector.getByRole("button", { name: "Dismiss suggestion" }),
  ).toBeVisible();
  await expect(inspector.locator("blockquote").first()).toBeVisible();
  for (const width of [1440, 320]) {
    await page.setViewportSize({ width, height: 900 });
    expect(
      await inspector.evaluate(
        (element) => element.scrollWidth <= element.clientWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: info.outputPath(`relationship-evidence-${width}.png`),
    });
  }
  expect(
    (
      await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze()
    ).violations,
  ).toEqual([]);
  await page.keyboard.press("Escape");
  await expect(trigger).toBeFocused();
  expect(
    state.calls.filter((c) => c.path === "/memories" && c.body),
  ).toHaveLength(0);
  await page.getByRole("button", { name: "Write", exact: true }).click();
  await expect(
    page.getByRole("textbox", { name: "What should stay with you?" }),
  ).toContainText("Keep feedback");
});

test("notebook context and graph share evidence, show partial coverage and offer keyboard access", async ({
  page,
}, info) => {
  const state = await fixture(page, [
    {
      ...note,
      content:
        "# Accessibility review\n\nTest keyboard navigation before the website launch.",
      projectId: project.id,
      enrichment: {
        ...note.enrichment!,
        title: "Accessibility review",
        relationships: [
          { id: handoff.id, version: 1, relationship: "complementary" },
        ],
      },
    },
    {
      ...handoff,
      content:
        "# Accessibility testing budget\n\nSet aside $600 for keyboard accessibility testing before launch.",
      enrichment: {
        ...handoff.enrichment!,
        title: "Accessibility testing budget",
      },
    },
  ]);
  const budget = { ...project, id: crypto.randomUUID(), name: "Launch budget" };
  state.projects.push(budget);
  state.records.get(handoff.id)!.projectId = budget.id;
  const old = [...state.pairs.values()][0];
  state.pairs.clear();
  const pair: NoteConnection = {
    ...old,
    level: "notebook",
    type: "connected",
    from: { id: project.id, title: project.name },
    to: { id: budget.id, title: budget.name },
    reason:
      "The launch review and budget both cover keyboard accessibility testing.",
    basis: "shared_goal",
    evidence: old.evidence.map((e) => ({
      ...e,
      projectId: e.id === handoff.id ? budget.id : project.id,
    })),
    coverage: {
      from: { total: 40, examined: 8, supporting: 1 },
      to: { total: 3, examined: 3, supporting: 1 },
    },
  };
  state.pairs.set(pair.id, pair);
  await page.goto(`${base}/app/projects/${project.id}`);
  await page.getByRole("button", { name: "Notebook options" }).click();
  await page
    .getByRole("button", { name: "Connected notebooks", exact: true })
    .click();
  await page
    .getByRole("button", { name: `Connection: ${budget.name}`, exact: true })
    .click();
  const inspector = page.getByRole("dialog", {
    name: "Connection",
    exact: true,
  });
  await expect(inspector).toContainText("Shared thread · Partial coverage");
  await expect(inspector.getByText("8 of 40 notes checked")).toBeHidden();
  await expect(
    inspector.getByRole("link", { name: budget.name, exact: true }),
  ).toHaveAttribute("href", `/app/projects/${budget.id}`);
  await inspector.locator(".connection-support summary").click();
  await expect(inspector.getByText("8 of 40 notes checked")).toBeVisible();
  await expect(inspector.locator("blockquote")).toHaveCount(2);
  await page.keyboard.press("Escape");
  await page.goto(`${base}/app`);
  await page.getByRole("button", { name: "Graph", exact: true }).click();
  await page
    .getByRole("navigation", { name: "Connection level" })
    .getByRole("button", { name: "Notebooks", exact: true })
    .click();
  await expect(page.locator(".react-flow__node")).toHaveCount(2);
  await expect(page.locator(".react-flow__edge")).toHaveCount(1);
  await page.screenshot({
    path: info.outputPath("notebook-graph.png"),
    fullPage: true,
  });
  await page.locator(".react-flow__edge").focus();
  await page.keyboard.press("Enter");
  await expect(inspector).toContainText(pair.reason);
  await expect(inspector.locator("blockquote").first()).toBeHidden();
  await inspector.locator(".connection-support summary").click();
  await page.screenshot({
    path: info.outputPath("notebook-connection-graph.png"),
  });
  await page.keyboard.press("Escape");
  await page.locator(".graph-connection-list summary").click();
  const listTrigger = page.getByRole("button", {
    name: `Connection: ${project.name} and ${budget.name}`,
    exact: true,
  });
  await listTrigger.focus();
  await page.keyboard.press("Enter");
  await expect(inspector).toContainText(pair.reason);
  await page.keyboard.press("Escape");
  await expect(listTrigger).toBeFocused();
});

test("connections recover from failed processing, paginate, and reject stale review and comparison", async ({
  page,
}) => {
  const others = Array.from({ length: 32 }, (_, i) => ({
    ...handoff,
    id: crypto.randomUUID(),
    content: `Launch review detail ${i}.`,
    enrichment: { ...handoff.enrichment!, relationships: [] },
  }));
  const state = await fixture(page, [
    {
      ...note,
      projectId: project.id,
      enrichment: {
        ...note.enrichment!,
        relationships: others.map((n) => ({
          id: n.id,
          version: n.version,
          relationship: "duplicate" as const,
        })),
      },
    },
    ...others,
  ]);
  let failed = true;
  await page.route("**/api/grove/relationships/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/retry")) {
      failed = false;
      return route.fulfill({
        json: { success: true, data: { status: "pending" } },
      });
    }
    if (path.endsWith("/search") && failed)
      return route.fulfill({
        json: {
          success: true,
          data: { items: [], nextCursor: null, status: "failed" },
        },
      });
    await route.fallback();
  });
  await page.goto(`${base}/app/memories/${note.id}`);
  await page.locator(".linked-notes summary").click();
  await expect(page.locator(".connection-panel")).toContainText(
    "could not be checked",
  );
  await page.getByRole("button", { name: "Retry connections" }).click();
  await expect(page.locator(".connection-row")).toHaveCount(5);
  await expect(page.locator(".connection-row").first()).toContainText(
    "Possible duplicate",
  );
  await page.getByRole("button", { name: "More connections" }).click();
  await expect(page.locator(".connection-row")).toHaveCount(10);
  await page
    .getByRole("button", { name: "Connection: Launch checklist", exact: true })
    .first()
    .click();
  const inspector = page.getByRole("dialog", {
    name: "Connection",
    exact: true,
  });
  await expect(inspector.locator("blockquote")).toHaveCount(2);
  const pair = [...state.pairs.values()][0];
  pair.reviewVersion++;
  await inspector.getByRole("button", { name: "Dismiss suggestion" }).click();
  await expect(inspector.getByRole("alert")).toContainText("changed");
  expect(pair.dismissed).toBe(false);
  await expect(inspector.locator("blockquote")).toHaveCount(2);
  state.records.get(others[0].id)!.version++;
  await inspector
    .getByRole("button", { name: "Compare notes", exact: true })
    .click();
  await expect(
    page.getByRole("dialog", { name: "Compare notes", exact: true }),
  ).toHaveCount(0);
  await expect(inspector).toContainText("no longer available");
  await expect(inspector.locator("blockquote")).toHaveCount(0);
});

for (const width of [1440, 768, 390, 320]) {
  test.describe(`command palette at ${width}px`, () => {
    test.use({ viewport: { width, height: 850 }, hasTouch: width < 600 });
    test("groups actions in a stable, accessible desktop and touch surface", async ({
      page,
    }, info) => {
      await fixture(page);
      await page.goto(`${base}/app/memories/${note.id}`);
      await expect(
        page.getByRole("button", { name: "Write", exact: true }),
      ).toBeVisible();
      await openNoteAction(page, "Commands");
      const menu = page.getByRole("dialog", { name: "Command menu" });
      const input = menu.getByRole("combobox", { name: "Search commands" });
      await expect(input).toBeFocused();
      await page.evaluate(() => document.fonts.ready);
      await page.emulateMedia({ reducedMotion: "reduce" });
      await expect(
        menu.getByRole("group", { name: "This note", exact: true }),
      ).toBeVisible();
      await expect(menu.getByRole("option").first()).toContainText("Edit note");
      await expect(menu.locator(".palette-context")).toHaveText(
        "Review preferences",
      );
      const save = menu.getByRole("option", { name: /Save note/ });
      await expect(save).toHaveAttribute("aria-disabled", "true");
      await expect(save).toContainText("All changes saved");
      const saveBounds = (await save.boundingBox())!;
      await page.mouse.click(saveBounds.x + 30, saveBounds.y + 15);
      await expect(input).toBeFocused();
      await expect(menu).toBeVisible();
      expect(
        await menu
          .getByRole("group", { name: "Manage note" })
          .getByRole("option")
          .allTextContents(),
      ).toEqual(["Move note", "Archive note", "Delete note…"]);
      const before = await menu.boundingBox();
      const inputBefore = await input.boundingBox();
      expect(before!.width).toBeLessThanOrEqual(Math.min(560, width - 24));
      expect(before!.height).toBeLessThanOrEqual(480);
      expect(before!.x + before!.width).toBeLessThanOrEqual(
        await page.evaluate(
          () => document.documentElement.getBoundingClientRect().right - 12,
        ),
      );
      await page.screenshot({ path: info.outputPath(`palette-${width}.png`) });
      await input.fill("preferences");
      await expect(menu.getByRole("option")).toHaveCount(1);
      await expect(menu.getByRole("option")).toContainText("Open Settings");
      expect(await menu.boundingBox()).toEqual(before);
      expect(await input.boundingBox()).toEqual(inputBefore);
      await input.fill("no-such-action");
      await expect(menu.getByRole("status")).toHaveText(
        "No matching commands.",
      );
      expect(await menu.boundingBox()).toEqual(before);
      await page.screenshot({
        path: info.outputPath(`palette-empty-${width}.png`),
      });
      await menu.getByRole("button", { name: "Clear search commands" }).click();
      await expect(input).toBeFocused();
      await expect(input).toHaveValue("");
      if (width < 600) {
        expect(
          (await menu
            .getByRole("button", { name: "Close dialog" })
            .boundingBox())!.height,
        ).toBeGreaterThanOrEqual(44);
        expect(
          await input.evaluate((element) => getComputedStyle(element).fontSize),
        ).toBe("16px");
        await expect(menu.getByText("Tap a command to run it")).toBeVisible();
        await page.setViewportSize({ width, height: 400 });
        await expect(
          menu.getByRole("button", { name: "Close dialog" }),
        ).toBeInViewport();
        const bounds = (await menu.boundingBox())!;
        expect(bounds.y).toBeGreaterThanOrEqual(0);
        expect(bounds.y + bounds.height).toBeLessThanOrEqual(400);
        await input.fill("delete");
        await expect(
          menu.getByRole("option", { name: "Delete note…", exact: true }),
        ).toBeInViewport();
        await page.screenshot({
          path: info.outputPath(`palette-short-${width}.png`),
        });
      }
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
      await page.keyboard.press("Escape");
      await expect(
        page.getByRole("button", {
          name: width < 1024 ? "Note actions" : "Commands",
          exact: true,
        }),
      ).toBeFocused();
    });
  });
}

test("command search ranks aliases, preserves native text editing and follows notebook context", async ({
  page,
}) => {
  await fixture(page);
  await page.goto(`${base}/app/projects/${project.id}`);
  await expect(
    page.getByRole("heading", { name: project.name, exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Control+Shift+p");
  const menu = page.getByRole("dialog", { name: "Command menu" });
  const input = menu.getByRole("combobox", { name: "Search commands" });
  await input.fill("note");
  await input.press("ArrowDown");
  const selected = await input.getAttribute("aria-activedescendant");
  await input.press("Home");
  expect(
    await input.evaluate((element: HTMLInputElement) => element.selectionStart),
  ).toBe(0);
  await expect(input).toHaveAttribute("aria-activedescendant", selected!);
  await input.press("End");
  expect(
    await input.evaluate((element: HTMLInputElement) => element.selectionStart),
  ).toBe(4);
  await expect(input).toHaveAttribute("aria-activedescendant", selected!);
  await input.fill("new note");
  await expect(menu.locator("mark")).toHaveText(["New", "note"]);
  await input.fill("CREATE");
  await expect(menu.getByRole("option")).toHaveCount(1);
  await input.press("Enter");
  await expect(page).toHaveURL(`${base}/app/notes/new?notebook=${project.id}`);
  await page.keyboard.press("Control+Shift+p");
  await input.fill("journal");
  await input.press("Enter");
  await expect(page).toHaveURL(
    `${base}/app/notes/new?from=journal&notebook=${project.id}`,
  );
});

test("command selection survives first-save registration changes and skips unavailable actions", async ({
  page,
  browserName,
}) => {
  const mod = browserName === "webkit" ? "Meta" : "Control";
  const state = await fixture(page, []);
  const started = Promise.withResolvers<void>();
  const response = Promise.withResolvers<void>();
  await page.route("**/api/grove/memories", async (route) => {
    started.resolve();
    await response.promise;
    await route.fallback();
  });
  await page.goto(`${base}/app/notes/new`);
  const editor = page.getByRole("textbox", {
    name: "What should stay with you?",
  });
  await editor.fill("# An idea worth keeping\n\nA draft stays in place.");
  await editor.press(`${mod}+s`);
  await started.promise;
  await editor.press(`${mod}+Shift+p`);
  const menu = page.getByRole("dialog", { name: "Command menu" });
  const input = menu.getByRole("combobox", { name: "Search commands" });
  await expect(menu.getByRole("option", { name: /Save note/ })).toHaveAttribute(
    "aria-disabled",
    "true",
  );
  await input.press("ArrowDown");
  const focus = menu.getByRole("option", { name: /^Focus mode/ });
  await expect(focus).toHaveAttribute("aria-selected", "true");
  const selected = await input.getAttribute("aria-activedescendant");
  response.resolve();
  await expect(page).toHaveURL(/\/memories\/[^/]+\?mode=edit$/);
  await expect(input).toBeFocused();
  await expect(input).toHaveAttribute("aria-activedescendant", selected!);
  await expect(focus).toHaveAttribute("aria-selected", "true");
  await expect(menu.getByRole("option", { name: /Save note/ })).toContainText(
    "All changes saved",
  );
  await input.press("Enter");
  await expect(page.locator(".note-editor.editor-focus")).toBeVisible();
  await expect(editor).toBeFocused();
  expect(state.records.size).toBe(1);
});

test("workspace shortcuts respect composition, modifiers and nested dialog scope", async ({
  page,
}) => {
  await fixture(page);
  await page.goto(`${base}/app/memories/${note.id}`);
  await expect(
    page.getByRole("button", { name: "Write", exact: true }),
  ).toBeVisible();
  await page.evaluate(() => {
    for (const extra of [
      { isComposing: true },
      { altKey: true },
      { shiftKey: true },
      { repeat: true },
    ]) {
      document.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "k",
          code: "KeyK",
          ctrlKey: true,
          bubbles: true,
          cancelable: true,
          ...extra,
        }),
      );
    }
  });
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await openNoteAction(page, "Delete note…");
  const confirmation = page.getByRole("dialog", { name: /Delete/ });
  await expect(confirmation).toBeVisible();
  await page.keyboard.press("Control+Shift+p");
  const menu = page.getByRole("dialog", { name: "Command menu" });
  await expect(menu.getByRole("option")).toHaveCount(1);
  await expect(menu.getByRole("option")).toContainText("Keyboard shortcuts");
  await page.keyboard.press("Escape");
  await expect(confirmation).toBeVisible();
  await confirmation
    .getByRole("button", { name: "Cancel", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("palettes keep dismissal and results reachable in landscape, zoom and enlarged text", async ({
  page,
  browserName,
}, info) => {
  await fixture(page, [
    {
      ...note,
      content: `# ${"A long note title to keep in context ".repeat(4)}\n\nUseful words.`,
    },
  ]);
  await page.setViewportSize({ width: 844, height: 260 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(`${base}/app/memories/${note.id}`);
  await openNoteAction(page, "Commands");
  const menu = page.getByRole("dialog", { name: "Command menu" });
  const input = menu.getByRole("combobox", { name: "Search commands" });
  await expect(input).toBeFocused();
  await input.fill("show note properties");
  const option = menu.getByRole("option");
  await expect(option).toBeInViewport();
  await expect(
    menu.getByRole("button", { name: "Close dialog" }),
  ).toBeInViewport();
  await page.screenshot({ path: info.outputPath("palette-landscape.png") });
  await page.setViewportSize({ width: 320, height: 720 });
  await page.addStyleTag({
    content:
      ".palette-dialog :is(.palette-option, input) { font-size: 28px; } .palette-context, .palette-footer { font-size: 20px; }",
  });
  await expect(option).toBeInViewport();
  expect(
    await option.evaluate(
      (element) => element.scrollWidth <= element.clientWidth,
    ),
  ).toBe(true);
  const bounds = (await menu.boundingBox())!;
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(
    await page.evaluate(() => document.documentElement.clientWidth),
  );
  await page.screenshot({ path: info.outputPath("palette-large-text.png") });
  await page.keyboard.press("Escape");
  if (browserName === "chromium") {
    const session = await page.context().newCDPSession(page);
    await session.send("Emulation.setPageScaleFactor", { pageScaleFactor: 2 });
    // CDP pointer hit testing does not account for the panned pinch origin.
    // Native keyboard activation still exercises opening and closing at 2×.
    await page.keyboard.press("Control+Shift+p");
    await expect(input).toBeFocused();
    await expect
      .poll(async () =>
        menu.evaluate((element) => {
          const box = element.getBoundingClientRect();
          const viewport = window.visualViewport!;
          return (
            viewport.scale === 2 &&
            box.left >= viewport.offsetLeft &&
            box.right <= viewport.offsetLeft + viewport.width &&
            box.top >= viewport.offsetTop &&
            box.bottom <= viewport.offsetTop + viewport.height
          );
        }),
      )
      .toBe(true);
    await menu.getByRole("button", { name: "Close dialog" }).press("Enter");
    await expect(menu).toHaveCount(0);
    await session.send("Emulation.setPageScaleFactor", { pageScaleFactor: 1 });
    await session.detach();
  }
});

test("note search shares the palette shell through notebook filtering, errors and keyboard retry", async ({
  page,
}, info) => {
  await fixture(page);
  let failed = true;
  const searches: unknown[] = [];
  await page.route("**/api/grove/ask", async (route) => {
    searches.push(route.request().postDataJSON());
    await route.fulfill(
      failed
        ? {
            status: 503,
            json: {
              success: false,
              error: {
                code: "unavailable",
                message: "Search is temporarily unavailable",
              },
            },
          }
        : {
            json: {
              success: true,
              data: { sources: [handoff], statements: [] },
            },
          },
    );
  });
  await page.setViewportSize({ width: 390, height: 700 });
  await page.goto(`${base}/app`);
  await page.getByRole("button", { name: /Search anything/ }).click();
  const dialog = page.getByRole("dialog", { name: "Search your Grove" });
  const input = dialog.getByRole("textbox", { name: "Search your Grove" });
  await expect(input).toBeFocused();
  await chooseOption(
    dialog.getByRole("combobox", { name: "Search in notebook" }),
    project.id,
  );
  await input.fill("launch");
  const retry = dialog.getByRole("button", { name: "Try loading again" });
  await expect(retry).toBeVisible();
  const bounds = await dialog.boundingBox();
  failed = false;
  await retry.focus();
  await retry.press("Enter");
  const result = dialog.getByRole("link", { name: /Launch checklist/ });
  await expect(result).toBeVisible();
  expect(searches.at(-1)).toMatchObject({
    query: "launch",
    projectId: project.id,
    includePersonal: false,
  });
  expect(await dialog.boundingBox()).toEqual(bounds);
  await page.screenshot({ path: info.outputPath("note-search-mobile.png") });
  await result.focus();
  await result.press("Enter");
  await expect(dialog).toHaveCount(0);
  await expect(page).toHaveURL(`${base}/app/memories/${handoff.id}`);
});

test("commands and shortcut help work from notes, preserve focus, and create in the current notebook", async ({
  page,
}, info) => {
  await fixture(page);
  await page.goto(`${base}/app/projects/${project.id}`);
  await expect(
    page.getByRole("heading", { name: project.name, exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Control+Shift+p");
  const menu = page.getByRole("dialog", { name: "Command menu" });
  const query = menu.getByRole("combobox", { name: "Search commands" });
  await expect(query).toBeFocused();
  await query.press("ArrowDown");
  await expect(
    menu.getByRole("option", { name: "Today’s note", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await query.press("Home");
  await query.fill("new note");
  await query.press("Enter");
  await expect(page).toHaveURL(`${base}/app/notes/new?notebook=${project.id}`);
  const editor = page.getByRole("textbox", {
    name: "What should stay with you?",
  });
  await editor.fill("Keyboard first");
  await editor.press("Control+Shift+p");
  await query.fill("preview");
  await query.press("Enter");
  await expect(page.locator(".editor-preview")).toHaveText("Keyboard first");
  await page.keyboard.press("Control+/");
  const help = page.getByRole("dialog", { name: "Keyboard shortcuts" });
  await expect(help).toContainText("Delete note (with confirmation)");
  await expect(help).toContainText("Ctrl Shift P");
  await page.keyboard.press("Escape");
  await page.keyboard.press("Control+e");
  await expect(editor).toBeFocused();
  await editor.press("Control+Shift+p");
  await query.fill("focus");
  await expect(menu.getByRole("option")).toHaveCount(1);
  await page.screenshot({ path: info.outputPath("command-menu-desktop.png") });
  expect(
    (
      await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze()
    ).violations,
  ).toEqual([]);
  await page.keyboard.press("Escape");
  await expect(editor).toBeFocused();
  await editor.press("Control+k");
  await expect(editor).toContainText("https://example.com");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page
    .locator(".app-sidebar")
    .getByRole("link", { name: "Grove notes" })
    .click();
  await expect(page).toHaveURL(`${base}/app`);
  await page.keyboard.press("Control+Alt+n");
  await expect(page).toHaveURL(`${base}/app/notes/new`);
});

test("an open command menu follows the first save and restores focus to the current editor", async ({
  page,
}) => {
  const state = await fixture(page, []);
  const started = Promise.withResolvers<void>();
  const response = Promise.withResolvers<void>();
  await page.route("**/api/grove/memories", async (route) => {
    started.resolve();
    await response.promise;
    await route.fallback();
  });
  await page.goto(`${base}/app/notes/new`);
  // Apple editors reserve Ctrl+P for native Emacs-style cursor movement.
  const mod = await page.evaluate(() =>
    /Mac|iPhone|iPad/.test(navigator.platform + navigator.userAgent)
      ? "Meta"
      : "Control",
  );
  const editor = page.getByRole("textbox", {
    name: "What should stay with you?",
  });
  await editor.fill("A thought saved while choosing a command.");
  await editor.press(`${mod}+s`);
  await started.promise;
  await editor.press(`${mod}+Shift+p`);
  const menu = page.getByRole("dialog", { name: "Command menu" });
  const query = menu.getByRole("combobox", { name: "Search commands" });
  await query.fill("history");
  await expect(menu.getByRole("option")).toHaveCount(0);

  response.resolve();
  await expect(page).toHaveURL(/\/memories\/[^/]+\?mode=edit$/);
  await expect(query).toBeFocused();
  await expect(
    menu.getByRole("option", { name: "Revision history", exact: true }),
  ).toBeVisible();
  await query.fill("focus");
  await query.press("Enter");
  await expect(menu).toHaveCount(0);
  await expect(page.locator(".note-editor.editor-focus")).toBeVisible();
  await expect(editor).toBeFocused();
  await expect(editor).toHaveText("A thought saved while choosing a command.");
  expect(state.records.size).toBe(1);
  await editor.press("Escape");
  await expect(page.locator(".note-editor.editor-focus")).toHaveCount(0);
});

test("first-save navigation retains preview and returns shortcut help to the current mode button", async ({
  page,
}) => {
  await fixture(page, []);
  const started = Promise.withResolvers<void>();
  const response = Promise.withResolvers<void>();
  await page.route("**/api/grove/memories", async (route) => {
    started.resolve();
    await response.promise;
    await route.fallback();
  });
  await page.goto(`${base}/app/notes/new`);
  const mod = await page.evaluate(() =>
    /Mac|iPhone|iPad/.test(navigator.platform + navigator.userAgent)
      ? "Meta"
      : "Control",
  );
  const editor = page.getByRole("textbox", {
    name: "What should stay with you?",
  });
  await editor.fill("Reading while my first note saves.");
  await editor.press(`${mod}+s`);
  await started.promise;
  await page.getByRole("button", { name: "Preview", exact: true }).click();
  await page.keyboard.press(`${mod}+/`);
  const help = page.getByRole("dialog", { name: "Keyboard shortcuts" });
  await expect(help).toBeVisible();
  await expect(help).toContainText(`${mod === "Meta" ? "⌘" : "Ctrl"} Shift P`);

  response.resolve();
  await expect(page).toHaveURL(/\/memories\/[^/]+\?mode=preview$/);
  await expect(page.locator(".editor-preview")).toHaveText(
    "Reading while my first note saves.",
  );
  await page.keyboard.press("Escape");
  await expect(help).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Preview", exact: true }),
  ).toBeFocused();
  await page.keyboard.press(`${mod}+e`);
  await expect(editor).toBeFocused();
});

test("long notes scroll inside the workspace while the mode toggle and navigation stay reachable", async ({
  page,
}) => {
  await fixture(page, [
    {
      ...note,
      content: `# Long note\n\n${"A paragraph with a useful idea.\n\n".repeat(140)}`,
    },
  ]);
  await page.goto(`${base}/app/memories/${note.id}`);
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    const paper = page.locator(".writing-layout");
    expect(
      await paper.evaluate(
        (element) => element.scrollHeight > element.clientHeight,
      ),
    ).toBe(true);
    await paper.evaluate((element) =>
      element.scrollTo(0, element.scrollHeight),
    );
    await expect(
      page.getByRole("button", { name: "Write", exact: true }),
    ).toBeInViewport();
    await expect(
      page.getByRole("button", { name: "Back to notes", exact: true }),
    ).toBeInViewport();
    const position = await paper.evaluate((element) => element.scrollTop);
    await page.getByRole("button", { name: "Write", exact: true }).click();
    await page.getByRole("button", { name: "Preview", exact: true }).click();
    await expect
      .poll(() => paper.evaluate((element) => element.scrollTop))
      .toBe(position);
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
});

test("long project names remain inside destinations at every breakpoint", async ({
  page,
}, info) => {
  const state = await fixture(page);
  state.projects[0].name =
    "A long project name with architecture, research, and implementation notes that should never overlap the memory library";
  await page.goto(`${base}/app`);
  await expect(page.locator(".memory-row")).toHaveCount(2);
  for (const width of [320, 768, 1024, 1440, 2320]) {
    await page.setViewportSize({ width, height: 1000 });
    const geometry = await page.evaluate(() => {
      const places = document
        .querySelector(".app-sidebar")!
        .getBoundingClientRect();
      const main = document
        .querySelector(".library-main")!
        .getBoundingClientRect();
      return {
        overflow: document.documentElement.scrollWidth > innerWidth,
        separated: places.right <= main.left || places.bottom <= main.top,
        destinationsContained: Array.from(
          document.querySelectorAll(".notebook-explorer [data-destination]"),
        ).every(
          (element) =>
            element.getBoundingClientRect().right <= places.right + 1,
        ),
        font: getComputedStyle(document.querySelector("h1")!).fontFamily,
      };
    });
    expect(geometry.overflow).toBe(false);
    expect(geometry.separated).toBe(true);
    expect(geometry.destinationsContained).toBe(true);
    expect(geometry.font.toLowerCase()).toContain("space grotesk");
    await page.screenshot({
      path: info.outputPath(`memory-library-${width}.png`),
      fullPage: true,
    });
  }
  await page.setViewportSize({ width: 320, height: 900 });
  expect(
    (
      await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze()
    ).violations,
  ).toEqual([]);
  await expect(
    page
      .getByRole("navigation", { name: "Notebook navigation" })
      .getByRole("link", { name: "Archive" }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("navigation", { name: "Workspace help and policies" })
      .getByRole("link", { name: "Archive" }),
  ).toHaveCount(0);
});

test("search debounces automatically and source, date, and lifetime refine all results", async ({
  page,
}) => {
  const state = await fixture(page, [
    note,
    {
      ...handoff,
      source: { agent: "website" },
      updatedAt: new Date().toISOString(),
    },
  ]);
  await page.goto(`${base}/app`);
  await expect(page.locator(".memory-row")).toHaveCount(2);
  const count = state.calls.filter(
    (call) => call.path === "/memories/search",
  ).length;
  await page.getByLabel("Search notes", { exact: true }).fill("key");
  await page.getByLabel("Search notes", { exact: true }).fill("keyboard");
  expect(
    state.calls.filter((call) => call.path === "/memories/search"),
  ).toHaveLength(count);
  await expect(page.locator(".memory-open")).toHaveCount(1);
  await page.getByRole("button", { name: /^Filters/ }).click();
  await chooseOption(
    page.getByRole("combobox", { name: "Source", exact: true }),
    "website",
  );
  await chooseOption(page.getByLabel("Last updated"), "7");
  await chooseOption(
    page.getByRole("combobox", { name: "Keep for", exact: true }),
    "ephemeral",
  );
  await expect(page.locator(".memory-open")).toHaveCount(1);
  expect(
    state.calls.filter((call) => call.path === "/memories/search").at(-1)?.body,
  ).toMatchObject({
    query: "keyboard",
    sourceAgent: "website",
    lifetime: "ephemeral",
    updatedAfter: expect.any(String),
  });
  await page
    .getByRole("button", { name: "Clear filters", exact: true })
    .click();
  await expect(page.locator(".memory-open")).toHaveCount(2);
  expect(page.url()).toBe(`${base}/app`);
});

test("keyboard drag cancels safely and moves a memory to a chosen project", async ({
  page,
}) => {
  const state = await fixture(page, [note]);
  await page.goto(`${base}/app`);
  const handle = page.locator(".memory-row .drag-handle");
  await handle.focus();
  // dnd-kit's keyboard sensor attaches document listeners after the activation event.
  await page.keyboard.press("Space", { delay: 50 });
  await expect(page.locator(".memory-drag-preview")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator(".memory-drag-preview")).toHaveCount(0);
  await expect(handle).not.toHaveAttribute("aria-pressed", "true");
  expect(state.calls.filter((call) => call.path === "/memories")).toHaveLength(
    0,
  );
  await handle.focus();
  await page.keyboard.press("Space", { delay: 50 });
  await expect(page.locator(".memory-drag-preview")).toBeVisible();
  await page.keyboard.press("ArrowDown");
  await expect(
    page.locator(`.notebook-explorer [data-destination="${project.id}"]`),
  ).toHaveAttribute("data-drop-active", "true");
  await page.keyboard.press("Space");
  await expect(page.locator(".workspace-notice")).toContainText("1 note moved");
  expect(state.records.get(note.id)?.projectId).toBe(project.id);
});

test("sidebar pages and keyboard notebook nesting share destinations, cancellation and undo", async ({
  page,
}) => {
  const state = await fixture(page, [handoff]);
  const parent = {
    ...project,
    id: "00000000-0000-4000-a000-000000000030",
    name: "Garden",
  };
  const child = {
    ...project,
    id: "00000000-0000-4000-a000-000000000031",
    name: "Drafts",
    parentId: project.id,
  };
  state.projects.push(parent, child);
  await page.goto(`${base}/app`);
  const sidebar = page.getByRole("region", { name: "Your notebooks" });
  await sidebar
    .getByRole("button", { name: `Expand ${project.name}`, exact: true })
    .click();
  await expect(
    sidebar.getByRole("link", { name: "Launch checklist", exact: true }),
  ).toHaveAttribute("href", `/app/memories/${handoff.id}`);
  const handle = sidebar.getByRole("button", {
    name: `Move notebook ${project.name} with drag or keyboard`,
    exact: true,
  });
  await handle.focus();
  await page.keyboard.press("Space", { delay: 50 });
  await expect(
    sidebar.locator(`[data-destination="${child.id}"]`),
  ).toHaveAttribute("data-drop-disabled", "true");
  await page.keyboard.press("ArrowDown");
  await expect(
    sidebar.locator(`[data-destination="${parent.id}"]`),
  ).toHaveAttribute("data-drop-active", "true");
  await page.keyboard.press("Escape");
  await expect(page.locator(".memory-drag-preview")).toHaveCount(0);
  expect(state.projects[0].parentId).toBeNull();
  await handle.focus();
  await page.keyboard.press("Space", { delay: 50 });
  await page.keyboard.press("ArrowDown");
  await expect(
    sidebar.locator(`[data-destination="${parent.id}"]`),
  ).toHaveAttribute("data-drop-active", "true");
  await page.keyboard.press("Space");
  await expect(page.locator(".workspace-notice")).toContainText(
    "notebook moved to Garden",
  );
  expect(state.projects.find((p) => p.id === project.id)?.parentId).toBe(
    parent.id,
  );
  expect(state.records.get(handoff.id)?.projectId).toBe(project.id);
  await page
    .locator(".workspace-notice")
    .getByRole("button", { name: "Undo" })
    .click();
  await expect(page.locator(".workspace-notice")).toContainText(
    "Change undone",
  );
  expect(state.projects.find((p) => p.id === project.id)?.parentId).toBeNull();
});

test("personal prompts save explicit preferences and the editor exposes independent lifetimes", async ({
  page,
}, info) => {
  const state = await fixture(page);
  await page.goto(`${base}/app/profile`);
  await page.getByRole("button", { name: /^Communication/ }).click();
  const dialog = page.getByRole("dialog");
  await dialog
    .getByLabel("What should stay with you?")
    .fill(
      "# Communication\n\nStart with a short answer, then show an example.",
    );
  await dialog.getByText("Note options", { exact: true }).click();
  await expect(dialog.getByLabel("Keep this note")).toHaveText(
    "Until I remove it",
  );
  await expect(
    dialog.getByLabel("Let Grove choose the note type"),
  ).not.toBeChecked();
  await dialog.getByRole("button", { name: "Save note", exact: true }).click();
  expect(
    state.calls.filter((call) => call.path === "/memories").at(-1)?.body,
  ).toMatchObject({
    projectId: null,
    kind: "preference",
    autoKind: false,
    retentionDays: null,
  });
  await page
    .getByRole("navigation", { name: "Workspace views" })
    .getByRole("button", { name: "Preferences", exact: true })
    .click();
  await expect(
    page.locator(".memory-open").filter({ hasText: "Communication" }),
  ).toBeVisible();
  await page.getByRole("link", { name: "New note", exact: true }).click();
  await page
    .getByLabel("What should stay with you?")
    .fill("Temporary review context");
  await page.getByRole("button", { name: "Note properties" }).click();
  await page.getByText("Note options", { exact: true }).click();
  await chooseOption(page.getByLabel("Keep this note"), "ephemeral");
  await chooseOption(page.getByLabel("Expires after"), "7");
  await page
    .getByRole("dialog", { name: "Note properties", exact: true })
    .getByRole("button", { name: "Close dialog", exact: true })
    .click();
  await page.getByRole("button", { name: "Save note", exact: true }).click();
  expect(
    state.calls.filter((call) => call.path === "/memories").at(-1)?.body
      .retentionDays,
  ).toBe(7);
  await page.goto(`${base}/app/profile`);
  await page.screenshot({
    path: info.outputPath("personal-context.png"),
    fullPage: true,
  });
});

async function shareFixture(page: Page) {
  const workspace = await fixture(page);
  const states = new Map<string, ShareState>();
  const calls: { path: string; body: Record<string, unknown> }[] = [];
  const receipts = new Map<string, ShareState>();
  const controls = { loseResponse: false };
  const get = (id: string): ShareState => {
    if (!states.has(id))
      states.set(id, {
        available: true,
        canShare: true,
        target: {
          kind: id === project.id ? "notebook" : "note",
          id,
          version: 1,
          name: id === project.id ? project.name : "Review preferences",
        },
        direct: null,
        inherited:
          id === note.id
            ? [
                {
                  id: "00000000-0000-4000-a000-000000000020",
                  projectId: project.id,
                  name: project.name,
                },
              ]
            : [],
      });
    const value = states.get(id)!;
    value.target.version = workspace.records.get(id)?.version ?? 1;
    return value;
  };
  await page.route(
    /\/api\/grove\/(?:memories|projects)\/[^/]+\/share$|\/api\/grove\/shares\//,
    async (route) => {
      const request = route.request();
      const path = new URL(request.url()).pathname.replace("/api/grove", "");
      const body = request.postDataJSON();
      calls.push({ path, body });
      const state = path.startsWith("/shares/")
        ? [...states.values()].find(
            (value) => value.direct?.id === path.split("/")[2],
          )!
        : get(path.split("/")[2]);
      if (request.method() === "GET")
        return route.fulfill({ json: { success: true, data: state } });
      const input = (
        request.method() === "PATCH"
          ? shareScopeSchema
          : path.endsWith("/share")
            ? shareEnableSchema
            : shareMutationSchema
      ).parse(body);
      if (receipts.has(input.operationId))
        return route.fulfill({
          json: { success: true, data: receipts.get(input.operationId) },
        });
      if (input.expectedVersion !== (state.direct?.version ?? 0))
        return route.fulfill({
          status: 409,
          json: {
            success: false,
            error: { code: "version_conflict", message: "Sharing changed" },
          },
        });
      const version = (state.direct?.version ?? 0) + 1;
      const duration =
        "duration" in input && input.duration !== undefined
          ? shareDurationSchema.nullable().parse(input.duration)
          : (state.direct?.duration ?? null);
      const durations = {
        "1h": 3600,
        "4h": 14400,
        "1d": 86400,
        "1w": 604800,
        "2w": 1209600,
        "1mo": 2592000,
      };
      state.direct = {
        id: state.direct?.id ?? crypto.randomUUID(),
        version,
        active: request.method() !== "DELETE",
        duration,
        expiresAt:
          duration === state.direct?.duration && !path.endsWith("/share")
            ? state.direct.expiresAt
            : duration
              ? new Date(Date.now() + durations[duration] * 1000).toISOString()
              : null,
        includeDescendants:
          "includeDescendants" in input &&
          typeof input.includeDescendants === "boolean"
            ? input.includeDescendants
            : (state.direct?.includeDescendants ?? false),
        url:
          request.method() === "DELETE"
            ? null
            : request.method() === "PATCH"
              ? state.direct!.url
              : `https://grove.example.test/s/gsh_${String(version).repeat(43)}`,
      };
      receipts.set(input.operationId, structuredClone(state));
      if (controls.loseResponse) {
        controls.loseResponse = false;
        return route.fulfill({
          status: 503,
          json: {
            success: false,
            error: { code: "unavailable", message: "Please retry" },
          },
        });
      }
      return route.fulfill({ json: { success: true, data: state } });
    },
  );
  return { ...workspace, sharing: { get, calls, controls } };
}

test("sharing controls keep stable links, retry uncertain writes and show inherited access", async ({
  page,
  context,
}, info) => {
  const { sharing } = await shareFixture(page);
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto(`${base}/app/memories/${note.id}`);
  await page.getByRole("button", { name: "Share note", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Share note", exact: true });
  await chooseOption(
    dialog.getByRole("combobox", { name: "General access" }),
    "anyone",
  );
  await dialog.getByRole("button", { name: "Create link" }).click();
  await expect(dialog.getByRole("button", { name: "Copy link" })).toBeFocused();
  const first = await dialog.getByLabel("Current link").inputValue();
  const copyBounds = await dialog.locator(".share-primary").boundingBox();
  await dialog.getByRole("button", { name: "Copy link" }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(first);
  await expect(
    dialog.getByRole("status").filter({ hasText: "Share link copied." }),
  ).toBeAttached();
  expect(await dialog.locator(".share-primary").boundingBox()).toEqual(
    copyBounds,
  );
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("button", { name: "Share note", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Control+Shift+p");
  await page
    .getByRole("combobox", { name: "Search commands" })
    .fill("share note");
  await page.keyboard.press("Enter");
  await expect(dialog.getByLabel("Current link")).toHaveValue(first);
  sharing.controls.loseResponse = true;
  await dialog.getByRole("button", { name: "Replace link" }).click();
  await expect(dialog.getByRole("alert")).toContainText("Please retry");
  await dialog.getByRole("button", { name: "Replace link" }).click();
  await expect(dialog.getByLabel("Current link")).not.toHaveValue(first);
  const rotations = sharing.calls.filter((call) =>
    call.path.endsWith("/rotate"),
  );
  expect(rotations).toHaveLength(2);
  expect(rotations[0].body.operationId).toBe(rotations[1].body.operationId);
  await chooseOption(
    dialog.getByRole("combobox", { name: "General access" }),
    "restricted",
  );
  await dialog.getByRole("button", { name: "Turn off direct link" }).click();
  await expect(dialog.getByLabel("Current link")).toHaveCount(0);
  await expect(
    dialog.getByRole("heading", { name: "Also shared through notebooks" }),
  ).toBeVisible();
  await dialog
    .getByRole("button", { name: `${project.name} sharing settings` })
    .click();
  await expect(
    page.getByRole("dialog", { name: "Share notebook" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Back to note", exact: true }).click();
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    expect(
      await dialog.evaluate(
        (element) => element.scrollWidth <= element.clientWidth,
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
      path: info.outputPath(`share-dialog-${width}.png`),
    });
  }
});

test("timed sharing offers six durations, stages expiry edits and preserves retry deadlines", async ({
  page,
}, info) => {
  const { sharing } = await shareFixture(page);
  await page.goto(`${base}/app/memories/${note.id}`);
  if (
    !(await page
      .getByRole("button", { name: "Share note", exact: true })
      .isVisible())
  )
    await page
      .getByRole("button", { name: "Note actions", exact: true })
      .click();
  await page.getByRole("button", { name: "Share note", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Share note", exact: true });
  await chooseOption(
    dialog.getByRole("combobox", { name: "General access" }),
    "anyone",
  );
  const expiry = dialog.getByRole("combobox", { name: "Link expires" });
  await expiry.click();
  for (const label of [
    "No expiry",
    "1 hour",
    "4 hours",
    "1 day",
    "1 week",
    "2 weeks",
    "1 month",
  ])
    await expect(
      page.getByRole("option", { name: label, exact: true }),
    ).toBeVisible();
  await page.keyboard.press("Escape");
  await chooseOption(expiry, "1h");
  sharing.controls.loseResponse = true;
  await dialog.getByRole("button", { name: "Create link" }).click();
  await expect(dialog.getByRole("alert")).toContainText("Please retry");
  const deadline = sharing.get(note.id).direct!.expiresAt!;
  await dialog.getByRole("button", { name: "Create link" }).click();
  await expect(dialog.locator("time")).toHaveAttribute("datetime", deadline);
  const link = await dialog.getByLabel("Current link").inputValue();
  const creates = sharing.calls.filter((call) => call.body?.duration === "1h");
  expect(creates).toHaveLength(2);
  expect(creates[0].body.operationId).toBe(creates[1].body.operationId);
  await chooseOption(expiry, "1mo");
  await expect(
    dialog.getByText("Starts when you save. 1 month is 30 days."),
  ).toBeVisible();
  await expect(dialog.getByLabel("Current link")).toBeDisabled();
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(expiry).toContainText("1 hour");
  await expect(dialog.locator("time")).toHaveAttribute("datetime", deadline);
  await chooseOption(expiry, "4h");
  await dialog.getByRole("button", { name: "Save changes" }).click();
  await expect(dialog.getByLabel("Current link")).toHaveValue(link);
  const saved = sharing.get(note.id).direct!.expiresAt!;
  expect(Date.parse(saved)).toBeGreaterThan(Date.parse(deadline));
  await dialog.getByRole("button", { name: "Replace link" }).click();
  await expect(dialog.getByLabel("Current link")).not.toHaveValue(link);
  await expect(dialog.locator("time")).toHaveAttribute("datetime", saved);
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 800 });
    expect(
      await dialog.evaluate(
        (element) => element.scrollWidth <= element.clientWidth,
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
      path: info.outputPath(`timed-share-${width}.png`),
    });
  }
});

test("an open sharing dialog stops offering an expired URL and renews with a new link", async ({
  page,
}) => {
  const { sharing } = await shareFixture(page);
  const now = Date.now();
  await page.clock.install({ time: now });
  const old = `https://grove.example.test/s/gsh_${"x".repeat(43)}`;
  sharing.get(note.id).direct = {
    id: crypto.randomUUID(),
    version: 1,
    active: true,
    includeDescendants: false,
    duration: "1h",
    expiresAt: new Date(now + 60_000).toISOString(),
    url: old,
  };
  await page.goto(`${base}/app/memories/${note.id}`);
  if (
    !(await page
      .getByRole("button", { name: "Share note", exact: true })
      .isVisible())
  )
    await page
      .getByRole("button", { name: "Note actions", exact: true })
      .click();
  await page.getByRole("button", { name: "Share note", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Share note", exact: true });
  await expect(dialog.getByLabel("Current link")).toHaveValue(old);
  await page.clock.fastForward(61_000);
  await expect(
    dialog.getByText(
      "This link has expired. Create a new link to share again.",
    ),
  ).toBeVisible();
  await expect(dialog.getByLabel("Current link")).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: "Copy link" })).toHaveCount(
    0,
  );
  await dialog.getByRole("button", { name: "Create link" }).click();
  await expect(dialog.getByLabel("Current link")).not.toHaveValue(old);
  expect(sharing.calls.at(-1)!.path).toBe(`/memories/${note.id}/share`);
});

test("notebook sharing entry points preserve scope and refresh conflicting settings", async ({
  page,
}, info) => {
  const { sharing } = await shareFixture(page);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${base}/app/projects/${project.id}`);
  await page.getByRole("button", { name: "Notebook options" }).click();
  await page
    .getByRole("button", { name: "Share notebook", exact: true })
    .click();
  const dialog = page.getByRole("dialog", { name: "Share notebook" });
  await expect(
    dialog.getByRole("combobox", { name: "Notebook scope" }),
  ).toContainText("This notebook only");
  await chooseOption(
    dialog.getByRole("combobox", { name: "General access" }),
    "anyone",
  );
  await dialog.getByRole("button", { name: "Create link" }).click();
  const url = await dialog.getByLabel("Current link").inputValue();
  await chooseOption(
    dialog.getByRole("combobox", { name: "Notebook scope" }),
    "subtree",
  );
  sharing.get(project.id).direct!.version++;
  await dialog.getByRole("button", { name: "Save changes" }).click();
  await expect(dialog.getByRole("alert")).toContainText(
    "Current settings are shown",
  );
  await expect(
    dialog.getByRole("combobox", { name: "Notebook scope" }),
  ).toContainText("This notebook only");
  await chooseOption(
    dialog.getByRole("combobox", { name: "Notebook scope" }),
    "subtree",
  );
  await dialog.getByRole("button", { name: "Save changes" }).click();
  await expect(dialog.getByLabel("Current link")).toHaveValue(url);
  await expect(
    dialog.getByRole("button", { name: "Close dialog" }),
  ).toBeEnabled();
  await page.keyboard.press("Escape");
  await page
    .locator(".app-sidebar")
    .getByRole("button", { name: `Notebook actions for ${project.name}` })
    .click();
  await page
    .getByRole("button", { name: "Share notebook", exact: true })
    .click();
  await expect(
    dialog.getByRole("combobox", { name: "Notebook scope" }),
  ).toContainText("Include sub-notebooks");
  await page.keyboard.press("Escape");
  await page.goto(`${base}/app/projects`);
  await page.setViewportSize({ width: 320, height: 900 });
  await page
    .getByRole("button", { name: `Share ${project.name}`, exact: true })
    .click();
  await expect(dialog.getByLabel("Current link")).toHaveValue(url);
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 700 });
    expect(
      await dialog.evaluate(
        (element) => element.scrollWidth <= element.clientWidth,
      ),
    ).toBe(true);
    await dialog
      .getByRole("button", { name: "Copy link" })
      .scrollIntoViewIfNeeded();
    await expect(
      dialog.getByRole("button", { name: "Copy link" }),
    ).toBeInViewport();
    expect(
      (
        await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
          .analyze()
      ).violations,
    ).toEqual([]);
    await page.screenshot({
      path: info.outputPath(`notebook-share-${width}.png`),
    });
  }
});

test("staged sharing changes keep the published link clear and recover from blocked clipboard access", async ({
  page,
}) => {
  const { sharing } = await shareFixture(page);
  sharing.get(project.id).direct = {
    id: crypto.randomUUID(),
    version: 1,
    active: true,
    includeDescendants: true,
    duration: null,
    expiresAt: null,
    url: `https://grove.example.test/s/gsh_${"a".repeat(43)}`,
  };
  await page.goto(`${base}/app/projects/${project.id}`);
  await page.getByRole("button", { name: "Notebook options" }).click();
  await page
    .getByRole("button", { name: "Share notebook", exact: true })
    .click();
  const dialog = page.getByRole("dialog", { name: "Share notebook" });
  const scope = dialog.getByRole("combobox", { name: "Notebook scope" });
  const link = dialog.getByLabel("Current link");
  const copy = dialog.getByRole("button", { name: "Copy link" });
  await expect(link).toBeVisible();
  const original = await link.inputValue();
  const before = sharing.calls.length;
  await chooseOption(scope, "direct");
  await expect(copy).toHaveCount(0);
  await expect(link).toBeDisabled();
  await expect(dialog.getByLabel("Open link in a new tab")).toHaveAttribute(
    "aria-disabled",
    "true",
  );
  await expect(dialog.getByText("Changes not saved")).toBeVisible();
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(scope).toContainText("Include sub-notebooks");
  await expect(
    dialog.getByRole("combobox", { name: "General access" }),
  ).toBeFocused();
  await expect(copy).toBeEnabled();
  await expect(link).toHaveValue(original);
  expect(sharing.calls).toHaveLength(before);

  const started = Promise.withResolvers<void>();
  const response = Promise.withResolvers<void>();
  await page.route("**/api/grove/shares/*", async (route) => {
    if (route.request().method() === "PATCH") {
      started.resolve();
      await response.promise;
    }
    await route.fallback();
  });
  await chooseOption(scope, "direct");
  await dialog.getByRole("button", { name: "Save changes" }).click();
  await started.promise;
  await expect(dialog.getByRole("button", { name: "Saving…" })).toBeDisabled();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeVisible();
  response.resolve();
  await expect(copy).toBeEnabled();
  await expect(copy).toBeFocused();
  await expect(link).toHaveValue(original);
  await expect(dialog.getByRole("status")).toHaveText("Changes saved");

  await page.evaluate(() => {
    Object.defineProperty(navigator.clipboard, "writeText", {
      configurable: true,
      value: () =>
        Promise.reject(
          new DOMException("Clipboard blocked", "NotAllowedError"),
        ),
    });
  });
  await copy.click();
  await expect(dialog.getByRole("alert")).toContainText("copy it manually");
  await expect(link).toBeFocused();
  expect(
    await link.evaluate((element: HTMLInputElement) =>
      element.value.slice(
        element.selectionStart ?? 0,
        element.selectionEnd ?? 0,
      ),
    ),
  ).toBe(original);
  await chooseOption(
    dialog.getByRole("combobox", { name: "General access" }),
    "restricted",
  );
  await dialog.getByRole("button", { name: "Turn off direct link" }).click();
  await expect(link).toHaveCount(0);
  await expect(
    dialog.getByRole("button", { name: "Done", exact: true }),
  ).toBeFocused();
  await dialog.getByRole("button", { name: "Done", exact: true }).click();
  await expect(dialog).toHaveCount(0);
});

test("sharing an editing note permits revocation while retaining the pending draft", async ({
  page,
}) => {
  const { sharing } = await shareFixture(page);
  sharing.get(note.id).direct = {
    id: crypto.randomUUID(),
    version: 1,
    active: true,
    includeDescendants: false,
    duration: null,
    expiresAt: null,
    url: `https://grove.example.test/s/gsh_${"a".repeat(43)}`,
  };
  const started = Promise.withResolvers<void>();
  const response = Promise.withResolvers<void>();
  await page.route("**/api/grove/memories", async (route) => {
    started.resolve();
    await response.promise;
    await route.fallback();
  });
  await page.goto(`${base}/app`);
  await page
    .locator(".memory-open")
    .filter({ hasText: "Review preferences" })
    .click();
  const drawer = page.getByRole("dialog", { name: "Note", exact: true });
  await drawer.getByRole("button", { name: "Write", exact: true }).click();
  const editor = drawer.getByRole("textbox", {
    name: "What should stay with you?",
  });
  await editor.fill("An unsaved thought worth keeping");
  await editor.press("Control+s");
  await started.promise;
  if (
    !(await drawer
      .getByRole("button", { name: "Share note", exact: true })
      .isVisible())
  )
    await drawer
      .getByRole("button", { name: "Note actions", exact: true })
      .click();
  await drawer.getByRole("button", { name: "Share note", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Share note", exact: true });
  await expect(
    dialog.getByRole("button", { name: "Replace link" }),
  ).toBeDisabled();
  await chooseOption(
    dialog.getByRole("combobox", { name: "General access" }),
    "restricted",
  );
  await dialog.getByRole("button", { name: "Turn off direct link" }).click();
  await expect(dialog.getByLabel("Current link")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(drawer).toBeVisible();
  await expect(editor).toHaveText("An unsaved thought worth keeping");
  response.resolve();
  await expect(drawer.locator(".note-save-status")).toHaveText("Saved");
});

async function fixture(page: Page, initial = [note, handoff]) {
  const records = new Map(
    initial.map((memory) => [memory.id, structuredClone(memory)]),
  );
  const projects = [structuredClone(project)];
  const revisions = new Map(
    initial.map((memory) => [memory.id, [structuredClone(memory)]]),
  );
  const calls: { path: string; body: Record<string, unknown> }[] = [];
  const chats = new Map<string, Conversation>();
  let toolDefaults = { exa: true, tavily: false, organize: true };
  const pairs = new Map<string, NoteConnection>();
  for (const memory of initial)
    for (const ref of memory.enrichment?.relationships ?? []) {
      const other = records.get(ref.id);
      if (
        !other ||
        other.version !== ref.version ||
        other.projectId !== memory.projectId ||
        ref.relationship === "unrelated"
      )
        continue;
      const [left, right] = [memory, other].sort((a, b) =>
        a.id.localeCompare(b.id),
      );
      const pair: NoteConnection = {
        id: crypto.randomUUID(),
        level: "note",
        from: {
          id: left.id,
          title: left.enrichment?.title ?? left.content.split("\n")[0],
        },
        to: {
          id: right.id,
          title: right.enrichment?.title ?? right.content.split("\n")[0],
        },
        type: ref.relationship,
        reason:
          ref.relationship === "conflicting"
            ? "These notes give different dates for the same launch review: October 30 and November 2."
            : ref.relationship === "duplicate"
              ? "Both notes record the same launch review requirement."
              : "Both describe launch review; the checklist adds keyboard verification.",
        basis:
          ref.relationship === "conflicting"
            ? "incompatible_claims"
            : ref.relationship === "duplicate"
              ? "same_information"
              : "additional_context",
        direction: "both",
        evidence: [left, right].map((n) => {
          const headingEnd = n.content.indexOf("\n\n");
          const start = headingEnd < 0 ? 0 : headingEnd + 2;
          const end = Math.min(n.content.length, start + 150);
          return {
            id: n.id,
            version: n.version,
            quote: n.content.slice(start, end),
            start,
            end,
            title: n.enrichment?.title ?? "Note",
            projectId: n.projectId,
          };
        }),
        coverage: {
          from: { total: 1, examined: 1, supporting: 1 },
          to: { total: 1, examined: 1, supporting: 1 },
        },
        breadth: "thread",
        revision: "a".repeat(64),
        reviewVersion: 0,
        dismissed: false,
        updatedAt: note.updatedAt,
      };
      pairs.set(pair.id, pair);
    }
  await page.route("**/api/grove/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace("/api/grove", "");
    const body = request.postDataJSON();
    calls.push({ path, body });
    let data: unknown;
    const conflict = async () =>
      route.fulfill({
        status: 409,
        json: {
          success: false,
          error: {
            code: "version_conflict",
            message: "Memory changed; reload before continuing",
          },
        },
      });
    if (path === "/relationships/search") {
      const input = connectionQuerySchema.parse(body);
      const items = [...pairs.values()].filter(
        (p) =>
          p.level === input.level &&
          (!p.dismissed || input.includeDismissed) &&
          (!input.connectionId || input.connectionId === p.id) &&
          (!input.endpointId ||
            [p.from.id, p.to.id].includes(input.endpointId)) &&
          (!input.endpointIds ||
            [p.from.id, p.to.id].every((id) =>
              input.endpointIds!.includes(id),
            )) &&
          p.evidence.every((e) => records.get(e.id)?.version === e.version),
      );
      const offset = Number(input.cursor ?? 0);
      data = {
        items: items.slice(offset, offset + input.limit),
        nextCursor:
          items.length > offset + input.limit
            ? String(offset + input.limit)
            : null,
        status: "ready",
      };
    } else if (/^\/relationships\/(note|notebook)\/[^/]+\/review$/.test(path)) {
      const input = connectionReviewSchema.parse(body);
      const pair = pairs.get(path.split("/")[3])!;
      if (
        pair.revision !== input.expectedRevision ||
        pair.reviewVersion !== input.expectedReviewVersion
      )
        return conflict();
      pair.dismissed = input.dismissed;
      pair.reviewVersion++;
      data = { reviewVersion: pair.reviewVersion, dismissed: pair.dismissed };
    } else if (path === "/ask-tools") {
      if (request.method() === "PATCH")
        toolDefaults = { ...toolDefaults, ...askToolsPatchSchema.parse(body) };
      data = {
        defaults: toolDefaults,
        available: { exa: true, tavily: true, organize: true },
        dailyCalls: 20,
      };
    } else if (path === "/conversations/search") {
      const input = conversationHistorySchema.parse(body);
      const matching = [...chats.values()]
        .reverse()
        .filter((chat) =>
          `${chat.title} ${chat.turns.map((turn) => turn.question).join(" ")}`
            .toLowerCase()
            .includes(input.query.toLowerCase()),
        );
      const after = Number(input.after ?? 0);
      data = {
        items: matching.slice(after, after + 30).map((chat) => ({
          id: chat.id,
          title: chat.title,
          scope: chat.scope,
          updatedAt: chat.updatedAt,
          version: chat.version,
          preview:
            chat.turns.find((turn) =>
              turn.question.toLowerCase().includes(input.query.toLowerCase()),
            )?.question ?? "",
          turnCount: chat.turns.length,
        })),
        nextCursor: matching.length > after + 30 ? String(after + 30) : null,
      };
    } else if (path === "/conversations") {
      if (request.method() === "POST") {
        const { id, ...scope } = conversationCreateSchema.parse(body);
        if (!chats.has(id))
          chats.set(id, {
            id,
            scope,
            title: "New conversation",
            tools: { ...toolDefaults },
            toolsVersion: 0,
            version: 0,
            updatedAt: new Date().toISOString(),
            turns: [],
          });
        data = chats.get(id);
      } else data = { items: [...chats.values()].reverse(), nextCursor: null };
    } else if (path.startsWith("/conversations/")) {
      const chat = chats.get(path.split("/")[2])!;
      if (path.endsWith("/tools")) {
        const input = toolSettingsSchema.parse(body);
        if (chat.toolsVersion !== input.expectedVersion) return conflict();
        chat.tools = input.tools;
        chat.toolsVersion++;
        if (input.saveDefault)
          toolDefaults = {
            ...toolDefaults,
            ...(input.defaultPatch ?? input.tools),
          };
        data = { ...chat, defaults: toolDefaults };
      } else if (request.method() === "DELETE") {
        chats.delete(chat.id);
        data = { deleted: true };
      } else if (path.endsWith("/turns")) {
        const input = conversationTurnSchema.parse(body);
        const sources = [...records.values()].filter(
          (n) =>
            chat.scope.projectId === undefined ||
            n.projectId === chat.scope.projectId ||
            (chat.scope.includePersonal && n.projectId === null),
        );
        if (!chat.turns.some((t) => t.id === input.id)) {
          chat.version++;
          if (chat.version === 1) chat.title = input.query;
          chat.turns.push({
            id: input.id,
            question: input.query,
            format: input.format,
            expectedVersion: input.expectedVersion,
            status: "ready",
            error: null,
            createdAt: new Date().toISOString(),
            result: {
              message: "",
              webStatements: [],
              statements: sources.length
                ? [
                    {
                      text:
                        input.query === "Wait for this"
                          ? "Stale answer"
                          : "Keep feedback specific and include a working example.",
                      sources: [
                        { id: sources[0].id, version: sources[0].version },
                      ],
                    },
                  ]
                : [],
              sources,
              proposal: /shorten|merge/i.test(input.query)
                ? {
                    kind: /merge/i.test(input.query) ? "merge" : "edit",
                    target: { id: sources[0].id, version: sources[0].version },
                    sources: sources
                      .slice(0, /merge/i.test(input.query) ? 2 : 1)
                      .map(({ id, version }) => ({ id, version })),
                    content:
                      "# Review preferences\n\nBe specific. Show an example.",
                    status: "proposed",
                  }
                : null,
            },
          });
        }
        data = chat;
      } else if (/\/(apply|undo)$/.test(path)) {
        const proposal = chat.turns.find((t) => t.id === path.split("/")[4])!
          .result!.proposal!;
        const source = records.get(proposal.target!.id)!;
        const undo = path.endsWith("/undo");
        if (
          source.version !==
          (undo ? proposal.applied![0].version : proposal.target!.version)
        )
          return conflict();
        records.set(source.id, {
          ...source,
          version: source.version + 1,
          content: undo ? note.content : proposal.content,
        });
        proposal.applied = [{ id: source.id, version: source.version + 1 }];
        proposal.status = undo ? "undone" : "applied";
        data = chat;
      } else data = chat;
    } else if (path === "/projects") {
      if (request.method() === "POST") {
        const input = projectSchema.parse(body);
        const created = {
          id: crypto.randomUUID(),
          ...input,
          parentId: input.parentId ?? null,
          version: 1,
          status: "active" as const,
        };
        projects.push(created);
        data = created;
      } else data = projects;
    } else if (path.startsWith("/projects/")) {
      const input = projectSchema.parse(body);
      const current = projects.find((p) => p.id === path.split("/")[2]);
      if (current) {
        if (
          input.expectedVersion !== undefined &&
          input.expectedVersion !== current.version
        )
          return conflict();
        current.name = input.name;
        if (input.parentId !== undefined) current.parentId = input.parentId;
        current.version++;
      }
      data = current;
    } else if (path === "/memories/search") {
      const input = listSchema.parse(body);
      const matching = [...records.values()].filter(
        (m) =>
          (input.projectId === undefined || m.projectId === input.projectId) &&
          (!input.kind || m.kind === input.kind) &&
          (!input.tag || m.enrichment?.tags.includes(input.tag)) &&
          (!input.sourceAgent || m.source.agent === input.sourceAgent) &&
          (!input.updatedAfter || m.updatedAt >= input.updatedAfter) &&
          (!input.lifetime ||
            (input.lifetime === "ephemeral") === !!m.expiresAt) &&
          m.status === input.status &&
          (!input.query ||
            m.content.toLowerCase().includes(input.query.toLowerCase())),
      );
      if (input.sort)
        matching.sort(
          (a, b) =>
            ((input.sort === "created_desc"
              ? a.createdAt.localeCompare(b.createdAt)
              : a.updatedAt.localeCompare(b.updatedAt)) ||
              a.id.localeCompare(b.id)) *
            (input.sort === "updated_asc" ? 1 : -1),
        );
      // Small pages make scope changes and pagination observable in the browser.
      const offset = Number(input.cursor || 0);
      data = {
        items: matching.slice(offset, offset + 2),
        nextCursor: matching.length > offset + 2 ? String(offset + 2) : null,
        searchMode: "hybrid",
      };
    } else if (path === "/memories/delete") {
      const items = body.items as { id: string; expectedVersion: number }[];
      data = {
        results: items.map((item) => {
          if (records.get(item.id)?.version !== item.expectedVersion)
            return { id: item.id, outcome: "conflict" };
          records.delete(item.id);
          revisions.delete(item.id);
          return { id: item.id, outcome: "deleted" };
        }),
      };
    } else if (path === "/memories") {
      const input = rememberSchema.parse(body);
      const previous = input.id ? records.get(input.id) : undefined;
      if (input.id && previous?.version !== input.expectedVersion)
        return conflict();
      const saved: Memory = {
        ...note,
        ...previous,
        id: input.id ?? crypto.randomUUID(),
        content: input.content,
        kind: input.kind,
        retentionDays: input.retentionDays ?? null,
        expiresAt: input.retentionDays
          ? new Date(Date.now() + input.retentionDays * 86400000).toISOString()
          : null,
        autoKind: input.autoKind,
        taskId: input.taskId ?? null,
        projectId: input.projectId,
        source: input.source,
        version: (previous?.version ?? 0) + 1,
        createdAt: previous?.createdAt ?? new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        enrichment: undefined,
      };
      records.set(saved.id, saved);
      const history = revisions.get(saved.id) ?? [];
      if (previous && !history.some((row) => row.version === previous.version))
        history.push(previous);
      history.push(saved);
      revisions.set(saved.id, history);
      data = saved;
    } else if (/\/(archive|restore)$/.test(path)) {
      const input = versionSchema.parse(body);
      const previous = records.get(path.split("/")[2])!;
      if (previous.version !== input.expectedVersion) return conflict();
      const saved: Memory = {
        ...previous,
        version: previous.version + 1,
        status: path.endsWith("/archive") ? "archived" : "active",
        content: input.revision
          ? revisions
              .get(previous.id)!
              .find((row) => row.version === input.revision)!.content
          : previous.content,
      };
      records.set(saved.id, saved);
      revisions.set(saved.id, [...(revisions.get(saved.id) ?? []), saved]);
      data = saved;
    } else if (path.startsWith("/briefs")) {
      const scope = briefRequestSchema.parse(body);
      data = {
        scope,
        status: "ready",
        sourceCount: 1,
        profile: "private-profile",
        truncated: false,
        updatedAt: note.updatedAt,
        content: {
          title: scope.taskId
            ? "Ready for the next session"
            : "A simpler website",
          sections: [
            {
              heading: "Next steps",
              statements: [
                {
                  text: "Review keyboard access before launch.",
                  sources: [{ id: handoff.id, version: 1 }],
                },
              ],
            },
          ],
        },
      };
    } else if (path.endsWith("/revisions"))
      data = revisions.get(path.split("/")[2]) ?? [];
    else if (path.startsWith("/memories/"))
      data = records.get(path.split("/")[2]);
    else throw new Error(`Unexpected fixture request: ${path}`);
    await route.fulfill({ json: { success: true, data } });
  });
  return { records, calls, projects, chats, pairs, revisions };
}

function savedHistory(
  title: string,
  question: string,
  updatedAt = new Date().toISOString(),
): Conversation {
  return {
    id: crypto.randomUUID(),
    title,
    scope: { includePersonal: false },
    version: 1,
    tools: { exa: true, tavily: false, organize: true },
    toolsVersion: 0,
    updatedAt,
    turns: [
      {
        id: crypto.randomUUID(),
        question,
        format: "plain",
        expectedVersion: 0,
        status: "ready",
        error: null,
        createdAt: updatedAt,
        result: {
          message: "A saved conversation to revisit. ".repeat(80),
          webStatements: [],
          statements: [],
          sources: [],
          proposal: null,
        },
      },
    ],
  };
}

test("Ask tools remember changes without creating empty chats across reload and fresh sessions", async ({
  page,
}) => {
  const state = await fixture(page, []);
  await page.goto(`${base}/app/ask`);
  const menu = page.getByRole("button", {
    name: "Ask Grove tools",
    exact: true,
  });
  await menu.click();
  await page.getByRole("switch", { name: /Web search/ }).click();
  await expect(
    page.getByRole("switch", { name: /Web search/ }),
  ).not.toBeChecked();
  await expect
    .poll(
      () =>
        state.calls.filter((call) => call.path === "/ask-tools" && call.body)
          .length,
    )
    .toBe(1);
  expect(state.chats.size).toBe(0);
  await page.reload();
  await menu.click();
  await expect(
    page.getByRole("switch", { name: /Web search/ }),
  ).not.toBeChecked();
  await page.keyboard.press("Escape");
  await page.evaluate(() =>
    (
      window as unknown as {
        switchWorkspaceAccount: (user: string, session: string) => void;
      }
    ).switchWorkspaceAccount("fixture-user", "new-session"),
  );
  await menu.click();
  await expect(
    page.getByRole("switch", { name: /Web search/ }),
  ).not.toBeChecked();
  await page.keyboard.press("Escape");
  await page
    .getByRole("textbox", { name: "Ask about your notes" })
    .fill("Find my garden notes");
  await page
    .getByRole("button", { name: "Send question", exact: true })
    .click();
  await expect.poll(() => state.chats.size).toBe(1);
  expect([...state.chats.values()][0].tools.exa).toBe(false);
});

test("Ask tools preserve drafts through held and uncertain saves and keep old chats independent", async ({
  page,
}, info) => {
  const state = await fixture(page, []);
  const old = savedHistory(
    "A saved garden conversation",
    "Which plants need shade?",
  );
  state.chats.set(old.id, old);
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  let hold = true;
  let fail = false;
  await page.route("**/api/grove/ask-tools", async (route) => {
    if (route.request().method() !== "PATCH") return route.fallback();
    if (hold) {
      entered.resolve();
      await release.promise;
    }
    if (fail)
      return route.fulfill({
        status: 503,
        json: {
          success: false,
          error: { code: "unavailable", message: "Tools could not be saved." },
        },
      });
    return route.fallback();
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${base}/app/ask`);
  const composer = page.getByRole("textbox", { name: "Ask about your notes" });
  await composer.fill("Keep this unsent question");
  const tools = page.getByRole("button", {
    name: "Ask Grove tools",
    exact: true,
  });
  await tools.click();
  const web = page.getByRole("switch", { name: /Web search/ });
  await web.click();
  await entered.promise;
  await expect(
    page.getByRole("button", { name: "Send question", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "New conversation", exact: true }),
  ).toBeDisabled();
  await expect(web).toBeDisabled();
  await expect(composer).toHaveValue("Keep this unsent question");
  release.resolve();
  hold = false;
  await expect(page.locator(".ask-tools-status")).toHaveText(
    "Saved for new chats.",
  );
  expect(state.chats.size).toBe(1);
  await page.screenshot({
    path: info.outputPath("tools-saved-phone.png"),
    fullPage: true,
  });
  fail = true;
  await web.click();
  await expect(page.locator(".ask-tools-control [role=alert]")).toContainText(
    "Refresh to confirm",
  );
  await expect(web).not.toBeChecked();
  await expect(composer).toHaveValue("Keep this unsent question");
  await expect(
    page.getByRole("button", { name: "Send question", exact: true }),
  ).toBeDisabled();
  await page.screenshot({
    path: info.outputPath("tools-failure-phone.png"),
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Refresh tools", exact: true })
    .click();
  await expect(page.locator(".ask-tools-control [role=alert]")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "History", exact: true }).click();
  await page.locator(".ask-history-open").click();
  await tools.click();
  await expect(web).toBeChecked();
  await page.getByRole("switch", { name: /Research/ }).click();
  await expect(page.locator(".ask-tools-status")).toHaveText(
    "Saved for new chats.",
  );
  await page.keyboard.press("Escape");
  await page
    .getByRole("button", { name: "New conversation", exact: true })
    .click();
  await tools.click();
  await expect(web).not.toBeChecked();
  await expect(page.getByRole("switch", { name: /Research/ })).toBeChecked();
  expect(state.chats.get(old.id)?.tools).toEqual({
    exa: true,
    tavily: true,
    organize: true,
  });
  expect(
    (
      await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze()
    ).violations,
  ).toEqual([]);
});

for (const width of [1440, 390, 320]) {
  test.describe(`conversation history at ${width}px`, () => {
    test.use({ viewport: { width, height: 900 }, hasTouch: width < 600 });
    test("searches saved questions, groups readable rows, reviews from the start and confirms deletion", async ({
      page,
    }, info) => {
      const state = await fixture(page, []);
      const trip = savedHistory(
        "Planning a slow weekend in Kyoto",
        "Which garden should we visit after lunch?",
      );
      const recipes = savedHistory(
        "Cocktails to make with friends",
        "Keep the recipe for a Negroni",
        "2026-09-01T10:00:00Z",
      );
      const work = savedHistory(
        "Website launch checklist and the remaining accessibility improvements",
        "Website launch checklist and the remaining accessibility improvements",
      );
      state.chats.set(recipes.id, recipes);
      state.chats.set(trip.id, trip);
      state.chats.set(work.id, work);
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.goto(`${base}/app/ask`);
      await page.getByRole("button", { name: "History", exact: true }).click();
      const history = page.getByRole("dialog", {
        name: "Conversations",
        exact: true,
      });
      const search = history.getByRole("textbox", {
        name: "Find a conversation",
      });
      await expect(search).toBeFocused();
      await expect(history.locator(".ask-history-open")).toHaveCount(3);
      await expect(
        history.getByRole("heading", { name: "Today", exact: true }),
      ).toBeVisible();
      await expect(history).toContainText("Which garden should we visit");
      await expect(history.locator(".ask-history-preview")).toHaveCount(2);
      expect(
        (
          await new AxeBuilder({ page })
            .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
            .analyze()
        ).violations,
      ).toEqual([]);
      await page.screenshot({
        path: info.outputPath(`history-${width}.png`),
        fullPage: true,
      });
      const before = await search.boundingBox();
      await search.fill("garden");
      await expect(history.locator(".ask-history-open")).toHaveCount(1);
      await expect(history).toContainText(trip.title);
      expect(await search.boundingBox()).toEqual(before);
      await page.screenshot({
        path: info.outputPath(`history-search-${width}.png`),
        fullPage: true,
      });
      await history.locator(".ask-history-open").click();
      await expect(history).not.toBeVisible();
      await expect(page.locator(".ask-current-conversation")).toContainText(
        trip.title,
      );
      await expect(
        page.getByRole("log", { name: "Conversation" }),
      ).toBeFocused();
      expect(
        await page
          .locator(".ask-conversation")
          .evaluate((node) => node.scrollTop),
      ).toBe(0);
      await page
        .getByRole("button", { name: "Latest reply", exact: true })
        .click();
      expect(
        await page
          .locator(".ask-conversation")
          .evaluate((node) => node.scrollTop),
      ).toBeGreaterThan(0);
      await page.getByRole("button", { name: "History", exact: true }).click();
      await expect(history.locator('[aria-current="true"]')).toContainText(
        trip.title,
      );
      await history
        .getByRole("button", {
          name: `Delete conversation ${trip.title}`,
          exact: true,
        })
        .click();
      const confirmation = page.getByRole("dialog", {
        name: "Delete conversation",
        exact: true,
      });
      await expect(confirmation).toContainText(trip.title);
      await expect(
        confirmation.getByRole("button", { name: "Cancel", exact: true }),
      ).toBeFocused();
      await page.screenshot({
        path: info.outputPath(`history-delete-${width}.png`),
        fullPage: true,
      });
      await confirmation
        .getByRole("button", { name: "Cancel", exact: true })
        .click();
      expect(state.chats.has(trip.id)).toBe(true);
      await history
        .getByRole("button", {
          name: `Delete conversation ${trip.title}`,
          exact: true,
        })
        .click();
      await confirmation
        .getByRole("button", { name: "Delete", exact: true })
        .click();
      await expect(history.locator(".ask-history-open")).toHaveCount(2);
      await expect(search).toBeFocused();
      expect(state.chats.has(trip.id)).toBe(false);
      await search.fill("no matching subject");
      await expect(
        history.getByRole("heading", { name: "No matching conversations" }),
      ).toBeVisible();
      expect(await search.boundingBox()).toEqual(before);
      if (width === 320) {
        await page.setViewportSize({ width, height: 400 });
        await expect(search).toBeInViewport();
        await expect(
          history.getByRole("button", { name: "Close dialog", exact: true }),
        ).toBeInViewport();
        await history
          .getByRole("button", { name: "Clear search", exact: true })
          .scrollIntoViewIfNeeded();
        await expect(
          history.getByRole("button", { name: "Clear search", exact: true }),
        ).toBeInViewport();
      }
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
    });
  });
}

test("conversation history keeps failed deletions retryable and removes old empty chats without losing notes", async ({
  page,
}) => {
  const state = await fixture(page);
  const empty = { ...savedHistory("New conversation", "unused"), turns: [] };
  state.chats.set(empty.id, empty);
  let fail = true;
  await page.route(`**/api/grove/conversations/${empty.id}`, async (route) => {
    if (route.request().method() !== "DELETE" || !fail) return route.fallback();
    return route.fulfill({
      status: 503,
      json: {
        success: false,
        error: {
          code: "unavailable",
          message: "Could not delete this conversation.",
        },
      },
    });
  });
  await page.goto(`${base}/app/ask`);
  await page.getByRole("button", { name: "History", exact: true }).click();
  const history = page.getByRole("dialog", {
    name: "Conversations",
    exact: true,
  });
  await expect(history).toContainText("No messages yet");
  await history
    .getByRole("button", {
      name: "Delete conversation New conversation",
      exact: true,
    })
    .click();
  const confirm = page.getByRole("dialog", {
    name: "Delete conversation",
    exact: true,
  });
  await confirm.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(confirm.getByRole("alert")).toHaveText(
    "Could not delete this conversation.",
  );
  expect(state.chats.has(empty.id)).toBe(true);
  fail = false;
  await confirm.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(confirm).toHaveCount(0);
  await expect(
    history.getByRole("heading", {
      name: "Your conversations will appear here.",
    }),
  ).toBeVisible();
  expect(state.records.size).toBe(2);
  await page.reload();
  await page.getByRole("button", { name: "History", exact: true }).click();
  await expect(history.locator(".ask-history-open")).toHaveCount(0);
  expect(state.records.size).toBe(2);
});

test("conversation history retries the failed next page and keeps open failures inside the dialog", async ({
  page,
}) => {
  const state = await fixture(page, []);
  const chats = Array.from({ length: 34 }, (_, index) =>
    savedHistory(`Saved conversation ${index}`, `Question ${index}`),
  );
  chats.forEach((chat) => state.chats.set(chat.id, chat));
  let failedPage = true,
    failedOpen = true;
  const cursors: unknown[] = [];
  await page.route("**/api/grove/conversations/search", async (route) => {
    const body = route.request().postDataJSON();
    cursors.push(body.after);
    if (body.after && failedPage) {
      failedPage = false;
      await route.fulfill({
        status: 503,
        json: {
          success: false,
          error: {
            code: "unavailable",
            message: "History is temporarily unavailable",
          },
        },
      });
    } else await route.fallback();
  });
  await page.route(
    `**/api/grove/conversations/${chats[0].id}`,
    async (route) => {
      if (failedOpen)
        await route.fulfill({
          status: 503,
          json: {
            success: false,
            error: {
              code: "unavailable",
              message: "This conversation could not open",
            },
          },
        });
      else await route.fallback();
    },
  );
  await page.goto(`${base}/app/ask`);
  await page.getByRole("button", { name: "History", exact: true }).click();
  const history = page.getByRole("dialog", {
    name: "Conversations",
    exact: true,
  });
  await expect(history.locator(".ask-history-open")).toHaveCount(30);
  await history
    .getByRole("button", { name: "More conversations", exact: true })
    .click();
  await expect(history.getByRole("alert")).toContainText(
    "History is temporarily unavailable",
  );
  await history.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(history.locator(".ask-history-open")).toHaveCount(34);
  expect(cursors.slice(-2)).toEqual(["30", "30"]);
  await history
    .locator(".ask-history-open")
    .filter({ hasText: chats[0].title })
    .click();
  await expect(history.getByRole("alert")).toContainText(
    "This conversation could not open",
  );
  failedOpen = false;
  await history
    .locator(".ask-history-open")
    .filter({ hasText: chats[0].title })
    .click();
  await expect(history).not.toBeVisible();
  await expect(page.locator(".ask-current-conversation")).toContainText(
    chats[0].title,
  );
});

test("history switches retain each conversation's unsent draft and closing a held open keeps the current reader", async ({
  page,
}) => {
  const state = await fixture(page, []);
  const first = savedHistory("First discussion", "First question"),
    second = savedHistory("Second discussion", "Second question");
  first.scope = { projectId: project.id, includePersonal: false };
  state.chats.set(first.id, first);
  state.chats.set(second.id, second);
  await page.goto(`${base}/app/ask`);
  const input = page.getByLabel("Ask about your notes");
  await input.fill("An unsent new conversation");
  const open = async (title: string) => {
    await page.getByRole("button", { name: "History", exact: true }).click();
    await page
      .getByRole("dialog", { name: "Conversations", exact: true })
      .locator(".ask-history-open")
      .filter({ hasText: title })
      .click();
    await expect(page.locator(".ask-current-conversation")).toContainText(
      title,
    );
  };
  await open(first.title);
  await expect(input).toHaveValue("");
  await input.fill("First unsent thought");
  await open(second.title);
  await expect(input).toHaveValue("");
  await input.fill("Second unsent thought");
  await open(first.title);
  await expect(input).toHaveValue("First unsent thought");
  await page
    .getByRole("button", { name: "New conversation", exact: true })
    .click();
  await expect(input).toHaveValue("An unsent new conversation");
  await expect(
    page.getByRole("combobox", { name: "Look in notebook" }),
  ).toContainText("All notes");
  const release = Promise.withResolvers<void>();
  const held = savedHistory("Held discussion", "A held question");
  state.chats.set(held.id, held);
  await page.route(`**/api/grove/conversations/${held.id}`, async (route) => {
    await release.promise;
    await route.fallback();
  });
  await page.getByRole("button", { name: "History", exact: true }).click();
  await page
    .getByRole("dialog", { name: "Conversations", exact: true })
    .locator(".ask-history-open")
    .filter({ hasText: held.title })
    .click();
  await expect(
    page
      .getByRole("dialog", { name: "Conversations", exact: true })
      .getByRole("status"),
  ).toContainText("Opening conversation");
  await page
    .getByRole("dialog", { name: "Conversations", exact: true })
    .getByRole("button", { name: "Close dialog" })
    .click();
  release.resolve();
  await expect(input).toHaveValue("An unsent new conversation");
  await page
    .getByRole("button", { name: "Send question", exact: true })
    .click();
  await expect(page.locator(".ask-current-conversation")).toContainText(
    "An unsent new conversation",
  );
  await page
    .getByRole("button", { name: "New conversation", exact: true })
    .click();
  await expect(input).toHaveValue("");
});

test("the graph shows current scoped connections, supports zoom and keyboard reading, and stays usable on mobile", async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const personal = { ...note, id: crypto.randomUUID() };
  const revised = {
    ...handoff,
    id: crypto.randomUUID(),
    version: 2,
    content: "# Revised plan\n\nThe current plan has changed.",
  };
  await fixture(page, [
    {
      ...note,
      projectId: project.id,
      enrichment: {
        ...note.enrichment!,
        relationships: [
          {
            id: handoff.id,
            version: handoff.version,
            relationship: "complementary",
          },
          { id: crypto.randomUUID(), version: 1, relationship: "duplicate" },
          { id: personal.id, version: 1, relationship: "duplicate" },
          { id: revised.id, version: 1, relationship: "conflicting" },
        ],
      },
    },
    handoff,
    personal,
    revised,
  ]);
  await page.goto(`${base}/app`);
  await page.getByRole("button", { name: "Load more", exact: true }).click();
  await page.getByRole("button", { name: "Graph", exact: true }).click();
  await expect(page.locator(".react-flow__node")).toHaveCount(4);
  await expect(page.locator(".react-flow__edge")).toHaveCount(1);
  await expect(page.locator(".graph-legend")).toHaveText("Related");
  const controls = page.getByRole("button", { name: "Controls", exact: true });
  await expect(controls).toHaveAttribute("aria-expanded", "false");
  await controls.focus();
  await page.keyboard.press("Enter");
  await expect(page.locator(".graph-help")).toBeVisible();
  await expect(page.locator(".graph-help")).toContainText("Enter to read");
  await page.keyboard.press("Space");
  await expect(page.locator(".graph-help")).toBeHidden();
  const first = page.locator(`.react-flow__node[data-id="${note.id}"]`);
  const unrelated = page.locator(`.react-flow__node[data-id="${personal.id}"]`);
  const titles = page.getByRole("button", { name: "Show note titles" });
  await titles.click();
  await expect(titles).toHaveAttribute("aria-pressed", "false");
  await expect(first.locator(".graph-node-label")).toHaveCSS("opacity", "0");
  await first.hover();
  await expect(first.locator(".graph-node-label")).toHaveCSS("opacity", "1");
  await expect(unrelated).toHaveCSS("opacity", "0.2");
  await expect(page.locator(".graph-connection.is-emphasized")).toHaveCount(1);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(page.locator(".graph-connection-spark")).toHaveCSS(
    "animation-name",
    "none",
  );
  await titles.click();
  await expect(unrelated).toHaveCSS("opacity", "1");
  const viewport = page.locator(".react-flow__viewport");
  const before = await viewport.getAttribute("style");
  await page.getByRole("button", { name: "Zoom In", exact: true }).click();
  await expect(viewport).not.toHaveAttribute("style", before!);
  await first.focus();
  await page.keyboard.press("Space");
  await expect(
    page.getByRole("complementary", { name: "Selected note" }),
  ).toContainText("Launch checklist");
  await page.getByRole("button", { name: "Expand graph", exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => document.fullscreenElement?.className))
    .toBe("memory-graph");
  const edge = page.locator(".react-flow__edge");
  await edge.focus();
  await expect(edge).toBeFocused();
  await page.keyboard.press("Enter");
  const connection = page.getByRole("dialog", {
    name: "Connection",
    exact: true,
  });
  await expect(connection).toBeInViewport();
  await expect(connection).toContainText(
    "the checklist adds keyboard verification",
  );
  await page.keyboard.press("Escape");
  await expect(edge).toBeFocused();
  await expect(page.locator(".memory-graph")).toHaveAttribute(
    "data-expanded",
    "true",
  );
  await page.getByRole("button", { name: "Read note", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("Review preferences");
  await expect(page.getByRole("dialog")).toBeInViewport();
  await page.keyboard.press("Escape");
  await page
    .getByRole("button", { name: "Done exploring graph", exact: true })
    .click();
  await expect
    .poll(() => page.evaluate(() => document.fullscreenElement))
    .toBeNull();
  await page.locator(`.react-flow__node[data-id="${handoff.id}"]`).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog")).toContainText("Launch checklist");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Clear graph selection" }).click();
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    // Resizing preserves the user's zoom. Fit is an intentional action.
    await page.getByRole("button", { name: "Fit View", exact: true }).click();
    await expect
      .poll(() =>
        page.locator(".graph-node-core").evaluateAll(
          (nodes) =>
            nodes.length > 0 &&
            nodes.every((node) => {
              const bounds = node.getBoundingClientRect();
              const canvas = node
                .closest(".graph-canvas")!
                .getBoundingClientRect();
              const x = bounds.x + bounds.width / 2,
                y = bounds.y + bounds.height / 2;
              return (
                x >= canvas.left &&
                x <= canvas.right &&
                y >= canvas.top &&
                y <= canvas.bottom
              );
            }),
        ),
      )
      .toBe(true);
    await page.screenshot({
      path: info.outputPath(`note-graph-${width}.png`),
      fullPage: true,
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
  expect(
    (
      await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze()
    ).violations,
  ).toEqual([]);
  await chooseOption(
    page.getByRole("combobox", { name: "Graph relationships" }),
    "duplicate",
  );
  await expect(page.locator(".react-flow__node")).toHaveCount(0);
  await expect(page.getByText("No matching connections here.")).toBeVisible();
  await expect(page.locator(".graph-legend")).toHaveCount(0);
  await chooseOption(
    page.getByRole("combobox", { name: "Graph relationships" }),
    "conflicting",
  );
  await expect(page.locator(".react-flow__edge")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("graph selection and note revisions retain zoom while ordinary wheel input scrolls the page", async ({
  page,
}) => {
  await fixture(page, [{ ...note, projectId: project.id }, handoff]);
  await page.setViewportSize({ width: 1280, height: 650 });
  await page.goto(`${base}/app`);
  await page.getByRole("button", { name: "Graph", exact: true }).click();
  const viewport = page.locator(".react-flow__viewport");
  await expect(page.locator(".react-flow__node")).toHaveCount(2);
  const zoom = () =>
    viewport.evaluate((el) => new DOMMatrix(getComputedStyle(el).transform).a);
  const initial = await zoom();
  await page.getByRole("button", { name: "Zoom In", exact: true }).click();
  await expect.poll(zoom).toBeGreaterThan(initial);
  const zoomed = await zoom();
  await page.locator(`.react-flow__node[data-id="${note.id}"]`).click();
  await expect(
    page.getByRole("complementary", { name: "Selected note" }),
  ).toBeVisible();
  expect(await zoom()).toBeCloseTo(zoomed, 4);
  await viewport.evaluate((el) => el.setAttribute("data-retained", "yes"));
  await page.getByRole("button", { name: "Read note", exact: true }).click();
  const drawer = page.getByRole("dialog", { name: "Note", exact: true });
  await drawer.getByRole("button", { name: "Write", exact: true }).click();
  await drawer
    .getByRole("textbox", { name: "What should stay with you?" })
    .fill("# A revised idea\n\nThe same graph position.");
  await page.keyboard.press("Control+s");
  await expect(drawer.locator(".note-save-status")).toHaveText("Saved");
  await page.keyboard.press("Escape");
  await expect(viewport).toHaveAttribute("data-retained", "yes");
  expect(await zoom()).toBeCloseTo(zoomed, 4);
  const bounds = (await page.locator(".graph-canvas").boundingBox())!;
  await page.mouse.move(bounds.x + 40, bounds.y + 80);
  const before = await page.evaluate(() => scrollY);
  await page.mouse.wheel(0, 200);
  await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(before);
  expect(await zoom()).toBeCloseTo(zoomed, 4);
  await page.locator(".graph-canvas").scrollIntoViewIfNeeded();
  const currentBounds = (await page.locator(".graph-canvas").boundingBox())!;
  await page.mouse.move(currentBounds.x + 40, currentBounds.y + 80);
  const pagePosition = await page.evaluate(() => scrollY);
  await page.keyboard.down("Control");
  await page.mouse.wheel(0, -90);
  await page.keyboard.up("Control");
  await expect.poll(zoom).toBeGreaterThan(zoomed);
  expect(await page.evaluate(() => scrollY)).toBe(pagePosition);
});

test("embedded touch graph yields to page scrolling and expanded fallback supports pan and focus return", async ({
  browser,
}, info) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  try {
    await page.addInitScript(() =>
      Object.defineProperty(document, "fullscreenEnabled", { value: false }),
    );
    await fixture(page, [note, handoff]);
    await page.goto(`${base}/app`);
    await page.getByRole("button", { name: "Graph", exact: true }).tap();
    const canvas = page.locator(".graph-canvas");
    await canvas.scrollIntoViewIfNeeded();
    await expect(page.locator(".react-flow__node")).toHaveCount(2);
    const cdp = await context.newCDPSession(page);
    const touch = (
      type: "touchStart" | "touchMove" | "touchEnd",
      x = 0,
      y = 0,
    ) =>
      cdp.send("Input.dispatchTouchEvent", {
        type,
        touchPoints: type === "touchEnd" ? [] : [{ x, y }],
      });
    const bounds = (await canvas.boundingBox())!;
    const beforeScroll = await page.evaluate(() => scrollY);
    const view = page.locator(".react-flow__viewport");
    const beforeView = await view.getAttribute("style");
    await touch("touchStart", bounds.x + 40, bounds.y + 220);
    await touch("touchMove", bounds.x + 40, bounds.y + 100);
    await touch("touchEnd");
    await expect
      .poll(() => page.evaluate(() => scrollY))
      .toBeGreaterThan(beforeScroll);
    await expect(view).toHaveAttribute("style", beforeView!);
    const expand = page.getByRole("button", {
      name: "Expand graph",
      exact: true,
    });
    await expand.tap();
    const expanded = page.getByRole("dialog", { name: "Linked notes graph" });
    await expect(expanded).toBeInViewport();
    await expect(
      page.getByRole("combobox", { name: "Graph relationships" }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Done exploring graph", exact: true }),
    ).toBeFocused();
    const area = (await canvas.boundingBox())!;
    const beforePan = await view.getAttribute("style");
    await touch("touchStart", area.x + 30, area.y + 60);
    await touch("touchMove", area.x + 120, area.y + 100);
    await touch("touchEnd");
    await expect(view).not.toHaveAttribute("style", beforePan!);
    const scale = () =>
      view.evaluate((el) => new DOMMatrix(getComputedStyle(el).transform).a);
    const beforePinch = await scale();
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [
        { id: 1, x: 160, y: 260 },
        { id: 2, x: 230, y: 260 },
      ],
    });
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [
        { id: 1, x: 100, y: 260 },
        { id: 2, x: 290, y: 260 },
      ],
    });
    await touch("touchEnd");
    await expect.poll(scale).toBeGreaterThan(beforePinch);
    expect(await page.evaluate(() => visualViewport?.scale)).toBe(1);
    const magnified = await scale();
    await page.getByRole("button", { name: "Fit View", exact: true }).tap();
    await expect.poll(scale).toBeLessThan(magnified);
    const center = () =>
      view.evaluate((el) => {
        const transform = new DOMMatrix(getComputedStyle(el).transform);
        const box = el.closest(".graph-flow")!.getBoundingClientRect();
        return {
          x: (box.width / 2 - transform.e) / transform.a,
          y: (box.height / 2 - transform.f) / transform.a,
        };
      });
    const focalPoint = await center();
    await page.locator(`.react-flow__node[data-id="${note.id}"]`).tap();
    await expect
      .poll(async () => {
        const current = await center();
        return Math.hypot(current.x - focalPoint.x, current.y - focalPoint.y);
      })
      .toBeLessThan(2);
    const controls = page.getByRole("button", {
      name: "Controls",
      exact: true,
    });
    await controls.tap();
    await expect(page.locator(".graph-help-touch")).toBeVisible();
    await expect(page.locator(".graph-help-touch")).toContainText(
      "Pinch to zoom",
    );
    await page.keyboard.press("Tab");
    await expect(page.locator(".graph-connection-list summary")).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(
      page.getByRole("button", { name: "Show note titles" }),
    ).toBeFocused();
    await controls.tap();
    await expect(page.locator(".graph-help")).toBeHidden();
    await expect
      .poll(async () => {
        const current = await center();
        return Math.hypot(current.x - focalPoint.x, current.y - focalPoint.y);
      })
      .toBeLessThan(2);
    await page.screenshot({
      path: info.outputPath("graph-touch-expanded.png"),
    });
    const read = page.getByRole("button", { name: "Read note", exact: true });
    await read.tap();
    await expect(
      page.getByRole("dialog", { name: "Note", exact: true }),
    ).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(expanded).toBeVisible();
    await expect(read).toBeFocused();
    await page.getByRole("button", { name: "Clear graph selection" }).tap();
    await page.keyboard.press("Escape");
    await expect(expand).toBeFocused();
    await expect(page.locator("[inert]")).toHaveCount(0);
    expect(
      await page.evaluate(() => document.documentElement.style.overflow),
    ).not.toBe("hidden");
  } finally {
    await context.close();
  }
});

test("a reply and growing composer preserve older reading position until Latest reply is chosen", async ({
  page,
}) => {
  const state = await fixture(page);
  const id = crypto.randomUUID();
  state.chats.set(id, {
    id,
    title: "Reading thread",
    tools: { exa: true, tavily: false, organize: true },
    toolsVersion: 0,
    scope: { includePersonal: true },
    version: 12,
    updatedAt: note.updatedAt,
    turns: Array.from({ length: 12 }, (_, index) => ({
      id: crypto.randomUUID(),
      question: `Earlier question ${index}. Keep my place while I read.`,
      format: "plain",
      expectedVersion: index,
      status: "ready",
      error: null,
      createdAt: note.createdAt,
      result: {
        message:
          `Earlier answer ${index}. This is a useful saved explanation. `.repeat(
            12,
          ),
        statements: [],
        sources: [],
        proposal: null,
        webStatements: [],
      },
    })),
  });
  await page.goto(`${base}/app/ask`);
  await page.getByRole("button", { name: "History", exact: true }).click();
  await page.getByRole("button", { name: /^Reading thread/ }).click();
  const log = page.getByRole("log", { name: "Conversation" });
  await expect(
    page.getByRole("dialog", { name: "Conversations", exact: true }),
  ).not.toBeVisible();
  await expect(log).toBeFocused();
  const input = page.getByRole("textbox", { name: "Ask about your notes" });
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/grove/conversations/*/turns", async (route) => {
    await held;
    await route.fallback();
  });
  await input.fill("A new question");
  await page
    .getByRole("button", { name: "Send question", exact: true })
    .click();
  await expect(
    page.getByText("Looking through your notes…", { exact: true }),
  ).toBeVisible();
  await log.evaluate((el) => {
    el.scrollTop = 20;
  });
  await expect(
    page.getByRole("button", { name: "Latest reply" }),
  ).toBeVisible();
  const position = await log.evaluate((el) => el.scrollTop);
  await log
    .locator(".ask-question p")
    .first()
    .evaluate((el) => {
      const range = document.createRange();
      range.selectNodeContents(el);
      const selection = getSelection()!;
      selection.removeAllRanges();
      selection.addRange(range);
    });
  release();
  await expect(log.locator(".ask-turn").last()).toContainText(
    "Keep feedback specific",
  );
  expect(await log.evaluate((el) => el.scrollTop)).toBeCloseTo(position, 0);
  expect(await page.evaluate(() => getSelection()?.toString())).toContain(
    "Earlier question 0",
  );
  await input.fill("Another thought\n".repeat(8));
  expect(await log.evaluate((el) => el.scrollTop)).toBeCloseTo(position, 0);
  await page.getByRole("button", { name: "Latest reply" }).click();
  await expect
    .poll(() =>
      log.evaluate((el) => el.scrollHeight - el.scrollTop - el.clientHeight),
    )
    .toBeLessThan(2);
  await expect(log).toBeFocused();
  await expect(page.getByRole("button", { name: "Latest reply" })).toHaveCount(
    0,
  );
});

test("copy feedback shares the active dialog stack without replacing a version-fenced move Undo", async ({
  page,
  context,
}, info) => {
  const state = await fixture(page, [note]);
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto(`${base}/app`);
  await page.locator(".memory-row .drag-handle").focus();
  await page.keyboard.press("Space", { delay: 50 });
  await expect(page.locator(".memory-drag-preview")).toBeVisible();
  await page.keyboard.press("ArrowDown");
  await expect(
    page.locator(`.notebook-explorer [data-destination="${project.id}"]`),
  ).toHaveAttribute("data-drop-active", "true");
  await page.keyboard.press("Space");
  await expect(page.locator(".workspace-notice")).toContainText("1 note moved");
  await page.locator(".memory-open").click();
  const drawer = page.getByRole("dialog", { name: "Note", exact: true });
  await openNoteAction(drawer, "Export");
  await page.getByRole("button", { name: "Copy Markdown" }).click();
  const notifications = drawer.getByRole("region", { name: "Notifications" });
  await expect(notifications.locator(".workspace-toast")).toContainText(
    "Markdown copied",
  );
  await expect(notifications.locator(".workspace-notice")).toContainText(
    "1 note moved",
  );
  const a = (await notifications.locator(".workspace-toast").boundingBox())!;
  const b = (await notifications.locator(".workspace-notice").boundingBox())!;
  expect(a.y + a.height <= b.y || b.y + b.height <= a.y).toBe(true);
  await page.screenshot({
    path: info.outputPath("feedback-stack-desktop.png"),
  });
  await notifications
    .getByRole("button", { name: "Undo", exact: true })
    .click();
  await expect(notifications).toContainText("Change undone");
  expect(state.records.get(note.id)?.projectId).toBeNull();
});

for (const width of [1440, 390, 320]) {
  test.describe(`search console at ${width}px`, () => {
    test.use({ viewport: { width, height: 900 }, hasTouch: width < 600 });
    test("keeps aligned controls and stable pending, empty, retry and clear states", async ({
      page,
    }, info) => {
      await fixture(page, [note]);
      const release = Promise.withResolvers<void>();
      let fail = true;
      await page.route("**/api/grove/ask", async (route) => {
        const { query } = askSchema.parse(route.request().postDataJSON());
        if (query === "waiting") await release.promise;
        if (query === "retry" && fail) {
          await route.fulfill({
            status: 503,
            json: {
              success: false,
              error: {
                code: "unavailable",
                message: "Search is temporarily unavailable.",
              },
            },
          });
          return;
        }
        await route.fulfill({
          json: {
            success: true,
            data: {
              status: "search",
              searchMode: "hybrid",
              sources: query === "missing" ? [] : [note],
              answer: null,
            },
          },
        });
      });
      await page.goto(`${base}/app/ask`);
      await page.getByRole("button", { name: "Search", exact: true }).click();
      const input = page.getByRole("textbox", {
        name: "Search saved notes",
        exact: true,
      });
      const status = page.locator(".ask-result-count");
      await expect(status).toHaveText("Search by words or meaning.");
      const modes = (await page
        .getByRole("group", { name: "Console mode" })
        .boundingBox())!;
      const scope = (await page
        .getByRole("combobox", { name: "Look in notebook" })
        .boundingBox())!;
      expect(Math.abs(modes.height - scope.height)).toBeLessThanOrEqual(1);
      const field = await input.boundingBox();
      await input.fill("waiting");
      await expect(status).toHaveText("Searching…");
      await page.screenshot({
        path: info.outputPath(`search-pending-${width}.png`),
        fullPage: true,
      });
      await page
        .getByRole("button", { name: "Clear search saved notes" })
        .click();
      await expect(input).toBeFocused();
      release.resolve();
      await expect(status).toHaveText("Search by words or meaning.");
      await expect(page.locator(".ask-source-list")).toHaveCount(0);
      await input.fill("missing");
      await expect(status).toHaveText("0 notes found");
      await expect(page.locator(".ask-search-empty")).toBeVisible();
      await input.fill("retry");
      await expect(page.locator(".ask-search-results")).toContainText(
        "Search is temporarily unavailable.",
      );
      fail = false;
      await page.getByRole("button", { name: "Try loading again" }).click();
      await expect(status).toHaveText("1 note found");
      expect(await input.boundingBox()).toEqual(field);
      await page.screenshot({
        path: info.outputPath(`search-results-${width}.png`),
        fullPage: true,
      });
      expect(
        (
          await new AxeBuilder({ page })
            .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
            .analyze()
        ).violations,
      ).toEqual([]);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await page.locator(".ask-source-list button").click();
      await expect(page.getByRole("dialog")).toContainText(
        "Review preferences",
      );
    });
  });
}

test("Ask Grove cites saved notes, scopes follow-ups, searches automatically and discards cancelled answers", async ({
  page,
}, info) => {
  const state = await fixture(page, [{ ...note, projectId: project.id }]);
  const calls: ReturnType<typeof askSchema.parse>[] = [];
  const started = Promise.withResolvers<void>();
  const gate = Promise.withResolvers<void>();
  await page.route("**/api/grove/conversations/*/turns", async (route) => {
    if (route.request().postDataJSON().query === "Wait for this") {
      started.resolve();
      await gate.promise;
    }
    await route.fallback();
  });
  await page.route("**/api/grove/ask", async (route) => {
    const input = askSchema.parse(route.request().postDataJSON());
    calls.push(input);
    await route.fulfill({
      json: {
        success: true,
        data: {
          status: input.mode === "search" ? "search" : "ready",
          searchMode: "hybrid",
          sources: [note],
          answer:
            input.mode === "search"
              ? null
              : {
                  insufficient: false,
                  statements: [
                    {
                      text:
                        input.query === "Wait for this"
                          ? "Stale answer"
                          : "Keep feedback specific and include a working example.",
                      sources: [{ id: note.id, version: note.version }],
                    },
                  ],
                },
        },
      },
    });
  });
  await page.goto(`${base}/app/ask`);
  await chooseOption(
    page.getByRole("combobox", { name: "Look in notebook" }),
    project.id,
  );
  await page.getByLabel("Include unfiled notes").uncheck();
  const question = page.getByLabel("Ask about your notes");
  // Touch Enter inserts a newline; modified Enter submits on either layout.
  const submitKey = (await page.evaluate(
    () => window.matchMedia("(pointer: coarse)").matches,
  ))
    ? "Control+Enter"
    : "Enter";
  await question.fill("How should I give feedback?");
  await page.getByRole("button", { name: "Send question" }).click();
  await expect(page.locator(".ask-statement")).toContainText("working example");
  expect([...state.chats.values()][0].scope).toMatchObject({
    projectId: project.id,
    includePersonal: false,
  });
  state.records.set(note.id, { ...note, projectId: project.id, version: 2 });
  await page
    .getByRole("button", { name: "Read source 1", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toContainText("Review preferences");
  await expect(page.getByRole("dialog")).toContainText(
    "This note has changed since the answer",
  );
  await page.keyboard.press("Escape");
  await question.fill("Tell me more about that");
  await question.press(submitKey);
  await expect(page.locator(".ask-statement")).toHaveCount(2);
  expect(
    [...state.chats.values()][0].turns.map((turn) => turn.question),
  ).toEqual(["How should I give feedback?", "Tell me more about that"]);
  for (const width of [1440, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await page.evaluate(() => window.scrollTo(0, 0));
    await expect(
      page.getByRole("button", { name: "Send question", exact: true }),
    ).toBeInViewport({ ratio: 1 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: info.outputPath(`ask-grove-${width}.png`),
      fullPage: true,
    });
  }
  expect(
    (
      await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze()
    ).violations,
  ).toEqual([]);
  await question.fill("Wait for this");
  await question.press(submitKey);
  await started.promise;
  await page
    .getByRole("button", { name: "New conversation", exact: true })
    .click();
  gate.resolve();
  await expect(page.locator(".ask-turn")).toHaveCount(0);
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await page.getByLabel("Search saved notes", { exact: true }).fill("feedback");
  await expect(page.locator(".ask-source-list li")).toHaveCount(1);
  expect(calls.at(-1)).toMatchObject({
    mode: "search",
    query: "feedback",
    projectId: project.id,
    includePersonal: false,
  });
  expect(state.calls.filter((call) => call.path === "/memories")).toHaveLength(
    0,
  );
  expect(page.url()).toBe(`${base}/app/ask`);
});

test("chat composer grows, preserves selections between modes, formats and submits Markdown", async ({
  page,
}, info) => {
  const state = await fixture(page, [note]);
  await page.goto(`${base}/app/ask`);
  const input = page.getByLabel("Ask about your notes");
  const height = (await input.boundingBox())!.height;
  await input.fill(
    "First line\nSecond line\nThird line\nFourth line\nFifth line",
  );
  expect((await input.boundingBox())!.height).toBeGreaterThan(height + 30);
  await input.fill("Keep feedback specific");
  await input.evaluate((element: HTMLTextAreaElement) => {
    element.focus();
    element.setSelectionRange(5, 13);
    element.dispatchEvent(new Event("select", { bubbles: true }));
  });
  await page
    .getByRole("button", { name: "Markdown input", exact: true })
    .click();
  await expect(input).toBeFocused();
  expect(
    await input.evaluate((element: HTMLTextAreaElement) => [
      element.selectionStart,
      element.selectionEnd,
    ]),
  ).toEqual([5, 13]);
  await page.getByRole("button", { name: "Bold", exact: true }).click();
  await expect(input).toHaveValue("Keep **feedback** specific");
  await input.press("Control+z");
  await expect(input).toHaveValue("Keep feedback specific");
  await input.press("Control+Shift+z");
  await expect(input).toHaveValue("Keep **feedback** specific");
  await page.getByRole("button", { name: "Preview message" }).click();
  await expect(page.locator(".ask-message-preview strong")).toHaveText(
    "feedback",
  );
  await page
    .getByRole("button", { name: "Markdown input", exact: true })
    .click();
  await expect(input).toHaveValue("Keep **feedback** specific");
  await expect(
    page.getByRole("group", { name: "Message formatting" }),
  ).toHaveCount(0);
  await expect(input).toBeFocused();
  await page
    .getByRole("button", { name: "Markdown input", exact: true })
    .click();
  await input.press("End");
  await input.press("Enter");
  expect(state.chats.size).toBe(0);
  await input.press("Control+Enter");
  await expect(page.locator(".ask-question strong")).toHaveText("feedback");
  await expect(input).toHaveValue("");
  expect((await input.boundingBox())!.height).toBeLessThanOrEqual(height + 2);
  await input.fill("line\n".repeat(70));
  const bounds = (await input.boundingBox())!;
  expect(bounds.height).toBeLessThanOrEqual(282);
  expect(
    await input.evaluate(
      (element) => element.scrollHeight > element.clientHeight,
    ),
  ).toBe(true);
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await expect(
      page.getByRole("button", { name: "Send question" }),
    ).toBeInViewport();
    await page.screenshot({
      path: info.outputPath(`composer-${width}.png`),
      fullPage: true,
    });
  }
});

test("conversations reopen after reload, apply edits with undo, and retain stale previews for recovery", async ({
  page,
}) => {
  const state = await fixture(page, [note]);
  await page.goto(`${base}/app/ask`);
  const input = page.getByLabel("Ask about your notes");
  await input.fill("Find my review note");
  await page
    .getByRole("button", { name: "Send question", exact: true })
    .click();
  await expect(page.locator(".ask-statement")).toContainText("working example");
  await input.fill("Shorten that note");
  await page
    .getByRole("button", { name: "Send question", exact: true })
    .click();
  await expect(
    page.getByRole("region", { name: "Proposed note changes" }),
  ).toContainText("Be specific");
  expect(state.records.get(note.id)!.version).toBe(1);
  await page.getByRole("button", { name: "Apply edit" }).click();
  await expect(page.locator(".ask-applied")).toContainText("Saved");
  expect(state.records.get(note.id)!.version).toBe(2);
  await page.reload();
  await page.getByRole("button", { name: "History", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: /Find my review note/ })
    .first()
    .click();
  await expect(page.locator(".ask-turn")).toHaveCount(2);
  await page
    .locator(".ask-applied")
    .getByRole("button", { name: "Undo" })
    .click();
  await expect(page.locator(".ask-proposal")).toContainText("Change undone");
  expect(state.records.get(note.id)!.content).toBe(note.content);
  await input.fill("Shorten it again");
  await page
    .getByRole("button", { name: "Send question", exact: true })
    .click();
  await expect(page.getByRole("button", { name: "Apply edit" })).toBeVisible();
  state.records.set(note.id, {
    ...state.records.get(note.id)!,
    version: 4,
    content: "A newer edit",
  });
  await page.getByRole("button", { name: "Apply edit" }).click();
  await expect(page.getByRole("alert")).toContainText("Memory changed");
  expect(state.records.get(note.id)!.content).toBe("A newer edit");
  await page.getByRole("button", { name: "History", exact: true }).click();
  await page
    .getByRole("button", { name: "Delete conversation Find my review note" })
    .click();
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(
    page.getByRole("dialog", { name: "Delete conversation", exact: true }),
  ).not.toBeVisible();
  await expect(
    page.getByRole("dialog", { name: "Conversations", exact: true }),
  ).toContainText("Your conversations will appear here");
  expect(state.chats.size).toBe(0);
});

test("an unconfirmed chat message survives navigation and retries with its original identity", async ({
  page,
}) => {
  const state = await fixture(page, [note]);
  const attempts: ReturnType<typeof conversationTurnSchema.parse>[] = [];
  await page.route("**/api/grove/conversations/*/turns", async (route) => {
    attempts.push(conversationTurnSchema.parse(route.request().postDataJSON()));
    if (attempts.length === 1) return route.abort("failed");
    await route.fallback();
  });
  await page.goto(`${base}/app/ask`);
  await page.getByLabel("Ask about your notes").fill("Find my review note");
  await page.getByRole("button", { name: "Send question" }).click();
  await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
  await page
    .getByRole("navigation", { name: "Notebook navigation" })
    .getByRole("link", { name: "Notes", exact: true })
    .click();
  await page
    .getByRole("navigation", { name: "Notebook navigation" })
    .getByRole("link", { name: "Ask Grove", exact: true })
    .click();
  await expect(page.locator(".ask-question")).toContainText(
    "Find my review note",
  );
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.locator(".ask-statement")).toContainText("working example");
  expect(attempts[1]).toEqual(attempts[0]);
  expect([...state.chats.values()][0].turns).toHaveLength(1);
});

test("workspace search includes personal notes and dialogs light-dismiss only on outside gestures", async ({
  page,
}) => {
  await fixture(page, [note]);
  const searches: ReturnType<typeof askSchema.parse>[] = [];
  await page.route("**/api/grove/ask", async (route) => {
    searches.push(askSchema.parse(route.request().postDataJSON()));
    await route.fulfill({
      json: {
        success: true,
        data: {
          status: "search",
          sources: [note],
          answer: null,
          searchMode: "hybrid",
        },
      },
    });
  });
  await page.goto(`${base}/app`);
  await page.keyboard.press("Control+k");
  const dialog = page.getByRole("dialog", { name: "Search your Grove" });
  await dialog.getByLabel("Search your Grove", { exact: true }).fill("review");
  await expect(dialog.locator(".quick-search-result")).toContainText(
    "Review preferences",
  );
  expect(searches.at(-1)).toMatchObject({
    query: "review",
    includePersonal: true,
  });
  const box = (await dialog.boundingBox())!;
  await page.mouse.click(2, 2, { button: "right" });
  await expect(dialog).toBeVisible();
  await page.mouse.move(2, 2);
  await page.mouse.down();
  await page.mouse.move(100, 2);
  await page.mouse.up();
  await expect(dialog).toBeVisible();
  await page.mouse.move(box.x + 30, box.y + 30);
  await page.mouse.down();
  await page.mouse.move(2, 2);
  await page.mouse.up();
  await expect(dialog).toBeVisible();
  await page.mouse.click(2, 2);
  await expect(dialog).toHaveCount(0);
  await page.locator(".memory-open").click();
  await expect(page.getByRole("dialog")).toBeVisible();
  const drawer = (await page.getByRole("dialog").boundingBox())!;
  if (drawer.x <= 2 && drawer.y <= 2) {
    await page.getByRole("button", { name: "Close dialog" }).click();
  } else await page.mouse.click(2, 2);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page
    .getByRole("navigation", { name: "Notebook navigation" })
    .getByRole("link", { name: "Ask Grove", exact: true })
    .click();
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await page.keyboard.press("Control+k");
  await dialog
    .getByLabel("Search your Grove", { exact: true })
    .fill("Summarize my review note");
  await dialog.getByRole("link", { name: "Ask Grove about this" }).click();
  await expect(page.getByLabel("Ask about your notes")).toHaveValue(
    "Summarize my review note",
  );
});

test("mobile notebook browsing keeps creation and dated writing in the selected notebook", async ({
  page,
}, info) => {
  const state = await fixture(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${base}/app`);
  const notebooks = page.getByRole("region", { name: "Your notebooks" });
  await expect(notebooks).toBeHidden();
  const toggle = page.getByRole("button", { name: "Notebooks", exact: true });
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await notebooks
    .getByRole("link", { name: project.name, exact: true })
    .click();
  await expect(notebooks).toBeHidden();
  await expect(
    page.getByRole("heading", { name: project.name, exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "New note", exact: true }),
  ).toHaveAttribute("href", `/app/notes/new?notebook=${project.id}`);
  await page.getByRole("link", { name: "Today’s note", exact: true }).click();
  await page
    .getByRole("textbox", { name: "What should stay with you?" })
    .fill("# Today in the notebook\n\nKeep it simple.");
  await page.getByRole("button", { name: "Save note", exact: true }).click();
  await expect(page.locator(".note-save-status")).toHaveText("Saved");
  await page
    .getByRole("button", { name: "Back to notes", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: project.name, exact: true }),
  ).toBeVisible();
  expect(
    [...state.records.values()].find((n) =>
      n.content.includes("Today in the notebook"),
    )?.projectId,
  ).toBe(project.id);
  await toggle.click();
  await expect(notebooks).toBeVisible();
  await page.screenshot({
    path: info.outputPath("simple-notebook-mobile.png"),
    fullPage: true,
  });
  expect(
    (
      await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze()
    ).violations,
  ).toEqual([]);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("Today's note uses the same editor and library, with date grouping and notebook organization", async ({
  page,
}, info) => {
  const state = await fixture(page, []);
  await page.goto(`${base}/app`);
  const navigation = page.getByRole("navigation", {
    name: "Notebook navigation",
  });
  await expect(
    navigation.getByRole("link", { name: "Journal", exact: true }),
  ).toHaveCount(0);
  await expect(
    navigation.getByRole("link", { name: "Notebooks", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: "New note", exact: true }),
  ).toHaveCount(1);
  await page.getByRole("link", { name: "Today’s note", exact: true }).click();
  const editor = page.locator(".note-editor-full");
  await editor.getByRole("button", { name: "Markdown", exact: true }).click();
  await expect(editor.getByLabel("What should stay with you?")).toHaveText(
    /^# .+/,
  );
  await expect(editor.getByLabel("Keep this note")).not.toBeVisible();
  await editor
    .getByLabel("What should stay with you?")
    .fill("# A quiet afternoon\n\nA long walk and a new idea.");
  await editor.getByRole("button", { name: "Save note" }).click();
  await expect(page.locator(".note-save-status")).toHaveText("Saved");
  await page.getByRole("button", { name: "Back to notes" }).click();
  await expect(page.locator(".memory-open")).toContainText("A quiet afternoon");
  expect(
    state.calls.find((call) => call.path === "/memories")?.body,
  ).toMatchObject({
    projectId: null,
    source: { agent: "website" },
    retentionDays: null,
    autoKind: true,
  });
  await page.getByRole("button", { name: "Filters", exact: true }).click();
  await expect(page.getByRole("combobox", { name: "Sort notes" })).toHaveText(
    "Date written",
  );
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await expect(page.locator(".library-date")).toHaveCount(1);
  await page.screenshot({
    path: info.outputPath("daily-note-library-desktop.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 320, height: 900 });
  expect(
    (
      await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze()
    ).violations,
  ).toEqual([]);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("a changed note preserves the draft for review and restoring history creates a new version", async ({
  page,
}, info) => {
  const state = await fixture(page, [note]);
  await page.goto(`${base}/app/memories/${note.id}`);
  await page.getByRole("button", { name: "Write", exact: true }).click();
  await page
    .getByLabel("What should stay with you?")
    .fill("# My revised note\n\nA reviewed replacement.");
  state.records.set(note.id, {
    ...note,
    version: 2,
    content: "# Newer saved version\n\nAn agent corrected this.",
  });
  await page.getByRole("button", { name: "Save note" }).click();
  await expect(
    page.getByRole("region", { name: "Review newer version" }),
  ).toContainText("An agent corrected this");
  await expect(page.getByLabel("What should stay with you?")).toHaveText(
    /A reviewed replacement/,
  );
  await page
    .getByRole("button", { name: "Keep my draft to replace it" })
    .click();
  await page.getByRole("button", { name: "Save note" }).click();
  await expect(page.locator(".note-save-status")).toHaveText("Saved");
  await page.goto(`${base}/app/memories/${note.id}`);
  await expect(page.locator(".reader-copy")).toContainText(
    "A reviewed replacement",
  );
  expect(state.records.get(note.id)?.version).toBe(3);
  await page.getByRole("button", { name: "History", exact: true }).click();
  const revision = page
    .locator(".revision-list > li")
    .filter({ hasText: "Revision 2" });
  await revision.getByRole("button", { name: "Compare with current" }).click();
  await expect(revision.locator(".revision-compare")).toContainText(
    "An agent corrected this",
  );
  await expect(revision.locator(".revision-compare")).toContainText(
    "A reviewed replacement",
  );
  await page.screenshot({
    path: info.outputPath("note-history-desktop.png"),
    fullPage: true,
  });
  await revision
    .getByRole("button", { name: "Restore as a new revision" })
    .click();
  await expect(page.locator(".reader-copy")).toContainText(
    "An agent corrected this",
  );
  expect(state.records.get(note.id)?.version).toBe(4);
});

test("reading and Markdown editing keep agent references behind details, with formatting undo and safe preview", async ({
  page,
}, info) => {
  await fixture(page);
  await page.goto(`${base}/app`);
  await page
    .locator(".memory-open")
    .filter({ hasText: "Review preferences" })
    .click();
  const dialog = page.getByRole("dialog", { name: "Note", exact: true });
  await expect(dialog.getByRole("textbox")).toHaveCount(0);
  await expect(
    dialog.locator("strong").filter({ hasText: "specific" }),
  ).toBeVisible();
  await expect(dialog.getByText(note.id, { exact: true })).not.toBeVisible();
  await dialog.getByRole("button", { name: "Note properties" }).click();
  await dialog.getByText("Agent details", { exact: true }).click();
  await expect(dialog.getByText(note.id, { exact: true })).toBeVisible();
  await dialog.getByText("Agent details", { exact: true }).click();
  await page
    .getByRole("dialog", { name: "Note properties", exact: true })
    .getByRole("button", { name: "Close dialog", exact: true })
    .click();
  await page.screenshot({ path: info.outputPath("reader-desktop.png") });
  await dialog.getByRole("button", { name: "Write", exact: true }).click();
  const editor = dialog.getByLabel("What should stay with you?");
  await editor.fill("A useful note");
  await editor.selectText();
  await dialog.getByRole("button", { name: "Bold", exact: true }).click();
  await expect(editor).toHaveText("**A useful note**");
  await editor.press("Control+z");
  await expect(editor).toHaveText("A useful note");
  await editor.press("Control+Shift+Z");
  await expect(editor).toHaveText("**A useful note**");
  await dialog.getByRole("button", { name: "Expand editor" }).click();
  await expect(dialog.locator(".note-editor-full")).toBeVisible();
  await editor.press("Control+z");
  await expect(editor).toHaveText("A useful note");
  await dialog
    .getByRole("button", { name: "Return to compact editor" })
    .click();
  await editor.press("Control+Shift+Z");
  await expect(editor).toHaveText("**A useful note**");
  await editor.fill(
    `${note.content}\n\n<script>alert('test')</script>\n\n[Unsafe](javascript:alert(1))\n\n![External image](https://images.example/pixel)`,
  );
  await dialog.getByRole("button", { name: "Preview", exact: true }).click();
  await expect(dialog.locator(".editor-preview strong")).toHaveText("specific");
  await expect(
    dialog.locator(
      ".editor-preview script, .editor-preview img, a[href^='javascript:']",
    ),
  ).toHaveCount(0);
  for (const width of [320, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect(
      (
        await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
          .analyze()
      ).violations,
    ).toEqual([]);
    expect(
      await dialog.evaluate((node) => node.scrollWidth <= node.clientWidth),
    ).toBe(true);
    await page.screenshot({
      path: info.outputPath(`editor-preview-${width}.png`),
    });
  }
  await dialog.getByRole("button", { name: "Write", exact: true }).click();
  await editor.fill("# A revised preference\n\nKeep it concise.");
  await dialog.getByRole("button", { name: "Save note", exact: true }).click();
  await expect(dialog.locator(".note-save-status")).toHaveText("Saved");
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(
    page.locator(".memory-open").filter({ hasText: "A revised preference" }),
  ).toBeVisible();
});

test("full-page writing keeps formatting, outline, focus and repeated keyboard saves in one document", async ({
  page,
}, info) => {
  const state = await fixture(page, [note]);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`${base}/app/memories/${note.id}/edit`);
  const editor = page.getByRole("textbox", {
    name: "What should stay with you?",
  });
  await expect(page.locator(".cm-note-h1")).toContainText("Review preferences");
  const content =
    "# A calmer page\n\n## Next steps\n\nA thought worth keeping.\n\n## A small idea\n\nTake a walk.";
  await editor.fill(content);
  await page.getByRole("button", { name: "Markdown", exact: true }).click();
  await expect(editor).toContainText("## Next steps");
  await page.getByRole("button", { name: "Write", exact: true }).click();
  await page.getByRole("button", { name: "Note outline", exact: true }).click();
  await page
    .getByRole("dialog", { name: "Note outline" })
    .getByRole("button", { name: "Next steps" })
    .click();
  await expect(editor).toBeFocused();
  await page.getByRole("button", { name: "Focus mode", exact: true }).click();
  await expect(page.locator(".app-sidebar")).not.toBeVisible();
  await editor.press("Escape");
  await expect(page.locator(".app-sidebar")).toBeVisible();
  await editor.press("Control+s");
  await expect(page.locator(".note-save-status")).toHaveText("Saved");
  expect(state.records.get(note.id)?.content).toBe(content);
  expect(state.records.get(note.id)?.source).toEqual(note.source);
  await editor.fill(`${content}\n\nBring a notebook.\n\n`);
  await editor.press("Control+s");
  await expect(page.locator(".note-save-status")).toHaveText("Saved");
  expect(state.records.get(note.id)?.version).toBe(3);
  expect(state.records.get(note.id)?.content).toBe(
    `${content}\n\nBring a notebook.`,
  );
  expect(
    state.calls
      .filter((call) => call.path === "/memories")
      .map((call) => call.body.expectedVersion),
  ).toEqual([1, 2]);
  await page.screenshot({
    path: info.outputPath("full-page-editor-desktop.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 320, height: 900 });
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
  await page.screenshot({
    path: info.outputPath("full-page-editor-mobile.png"),
    fullPage: true,
  });
  expect(errors).toEqual([]);
});

test("full-page drafts survive app navigation and still detect changes to their original version", async ({
  page,
}) => {
  const state = await fixture(page, [note]);
  await page.goto(`${base}/app/memories/${note.id}/edit`);
  const editor = page.getByRole("textbox", {
    name: "What should stay with you?",
  });
  await editor.fill("My unfinished thought.");
  await page
    .getByRole("navigation", { name: "Notebook navigation" })
    .getByRole("link", { name: "Notes", exact: true })
    .click();
  state.records.set(note.id, {
    ...note,
    version: 2,
    content: "An agent’s newer copy.",
  });
  await page.locator(".memory-open").first().click();
  await page.getByRole("button", { name: "Note actions" }).click();
  await page.getByRole("link", { name: "Open note page" }).click();
  await page.getByRole("button", { name: "Write", exact: true }).click();
  await expect(editor).toHaveText("My unfinished thought.");
  await editor.press("Control+s");
  await expect(
    page.getByRole("region", { name: "Review newer version" }),
  ).toContainText("An agent’s newer copy.");
  expect(
    state.calls.filter((call) => call.path === "/memories").at(-1)?.body
      .expectedVersion,
  ).toBe(1);
  await page.getByRole("button", { name: "Use saved version" }).click();
  await expect(editor).toHaveText("An agent’s newer copy.");
  await expect(
    page.getByRole("button", { name: "Save note", exact: true }),
  ).toBeDisabled();
});

test("returning to a draft during its first save follows that save without duplicating the note", async ({
  page,
}) => {
  const state = await fixture(page, []);
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let started = false;
  await page.route("**/api/grove/memories", async (route) => {
    started = true;
    await held;
    await route.fallback();
  });
  await page.goto(`${base}/app/notes/new`);
  const editor = page.getByRole("textbox", {
    name: "What should stay with you?",
  });
  await editor.fill("A thought saved once.");
  await editor.press("Control+s");
  await expect.poll(() => started).toBe(true);
  await page
    .getByRole("navigation", { name: "Notebook navigation" })
    .getByRole("link", { name: "Notes", exact: true })
    .click();
  await page.getByRole("link", { name: "New note", exact: true }).click();
  await expect(page.locator(".note-save-status")).toHaveText("Saving…");
  await expect(editor).toBeEditable();
  await editor.fill("A thought saved once, with newer typing.");
  release();
  await expect(page).toHaveURL(/\/memories\/[^/]+\?mode=edit$/);
  await expect(page.locator(".note-save-status")).toHaveText("Saved");
  await expect(editor).toHaveText("A thought saved once, with newer typing.");
  await editor.fill("A thought saved once, then refined.");
  await editor.press("Control+s");
  await expect(page.locator(".note-save-status")).toHaveText("Saved");
  expect(state.records.size).toBe(1);
  expect([...state.records.values()][0]).toMatchObject({
    content: "A thought saved once, then refined.",
    version: 3,
  });
});

test("combined project, kind, topic and query filters stay in POST bodies and clear independently", async ({
  page,
}) => {
  const state = await fixture(page);
  await page.goto(`${base}/app`);
  await expect(page.locator(".memory-open")).toHaveCount(2);
  await page.getByRole("button", { name: "Filters", exact: true }).click();
  await chooseOption(
    page.getByRole("combobox", { name: "Notebook", exact: true }),
    project.id,
  );
  await chooseOption(
    page.getByRole("combobox", { name: "Note type" }),
    "handoff",
  );
  await page.getByLabel("Topic tag").fill("frontend");
  await page.getByRole("button", { name: "Apply tag" }).click();
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await page
    .getByLabel("Search notes", { exact: true })
    .fill("keyboard access");
  await expect(page.locator(".memory-open")).toHaveCount(1);
  await expect(page.locator(".library-caption")).toBeVisible();
  await expect(page.locator(".sidebar-create")).toHaveAttribute(
    "href",
    `/app/notes/new?notebook=${project.id}`,
  );
  await expect
    .poll(
      () =>
        state.calls.filter((call) => call.path === "/memories/search").at(-1)
          ?.body,
    )
    .toEqual({
      projectId: project.id,
      kind: "handoff",
      tag: "frontend",
      query: "keyboard access",
      status: "active",
      sort: "relevance",
    });
  expect(page.url()).toBe(`${base}/app`);
  await page.getByRole("button", { name: "Filters", exact: true }).click();
  await page
    .getByRole("button", { name: "Clear filters", exact: true })
    .click();
  await chooseOption(
    page.getByRole("combobox", { name: "Notebook", exact: true }),
    "personal",
  );
  await expect(page.locator(".memory-open")).toHaveCount(1);
  await expect(page.locator(".memory-open")).toContainText(
    "Review preferences",
  );
  expect(
    state.calls.filter((call) => call.path === "/memories/search").at(-1)?.body
      .projectId,
  ).toBeNull();
  await expect(page.locator(".sidebar-create")).toHaveAttribute(
    "href",
    "/app/notes/new",
  );
});

test("pagination discards an old scope response after filters change", async ({
  page,
}) => {
  await fixture(page, [
    note,
    handoff,
    {
      ...note,
      id: crypto.randomUUID(),
      content: "Old scope only",
      enrichment: undefined,
    },
  ]);
  const gate = Promise.withResolvers<void>();
  const started = Promise.withResolvers<void>();
  await page.route("**/api/grove/memories/search", async (route) => {
    if (route.request().postDataJSON().cursor) {
      started.resolve();
      await gate.promise;
    }
    await route.fallback();
  });
  await page.goto(`${base}/app`);
  await page.getByRole("button", { name: "Load more", exact: true }).click();
  await started.promise;
  await page.getByRole("button", { name: "Filters", exact: true }).click();
  await chooseOption(
    page.getByRole("combobox", { name: "Notebook", exact: true }),
    project.id,
  );
  await expect(page.locator(".memory-open")).toHaveCount(1);
  gate.resolve();
  await expect(page.locator(".memory-open")).toContainText("Launch checklist");
  await expect(page.getByText("Old scope only")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Load more", exact: true }),
  ).toHaveCount(0);
});

test("multi-select drag moves preserve handoff references and provenance, and undo checks returned versions", async ({
  page,
}) => {
  const state = await fixture(page, [note, { ...handoff, projectId: null }]);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${base}/app`);
  await page.getByLabel("Select these notes").check();
  const source = (await page
    .locator(".memory-row .drag-handle")
    .first()
    .boundingBox())!;
  const target = (await page
    .locator(`.notebook-explorer [data-destination="${project.id}"]`)
    .boundingBox())!;
  await page.mouse.move(
    source.x + source.width / 2,
    source.y + source.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(source.x + source.width + 20, source.y + 10, {
    steps: 5,
  });
  await expect(page.locator(".memory-drag-preview")).toBeVisible();
  await page.mouse.move(
    target.x + target.width / 2,
    target.y + target.height / 2,
    { steps: 15 },
  );
  await expect(
    page.locator(`.notebook-explorer [data-destination="${project.id}"]`),
  ).toHaveAttribute("data-drop-active", "true");
  await page.mouse.up();
  await expect(page.locator(".workspace-notice")).toContainText(
    "2 notes moved",
  );
  const moves = state.calls.filter((call) => call.path === "/memories");
  expect(moves.map((call) => call.body.projectId)).toEqual([
    project.id,
    project.id,
  ]);
  expect(moves.find((call) => call.body.id === handoff.id)?.body).toMatchObject(
    {
      taskId: handoff.taskId,
      kind: "handoff",
      source: handoff.source,
      content: handoff.content,
      expectedVersion: 1,
    },
  );
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(page.locator(".workspace-notice")).toContainText(
    "Change undone",
  );
  expect(
    [...state.records.values()].map((m) => [m.projectId, m.version]),
  ).toEqual([
    [null, 3],
    [null, 3],
  ]);
});

test("sidebar note dragging carries a readable preview and marks the whole source row", async ({
  page,
}, info) => {
  const state = await fixture(page, [handoff]);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${base}/app`);
  await page
    .getByRole("button", { name: `Expand ${project.name}`, exact: true })
    .click();
  const source = page.locator(".notebook-pages li").filter({
    has: page.getByRole("link", { name: "Launch checklist", exact: true }),
  });
  const grip = source.getByRole("button", {
    name: /Move Launch checklist with drag/,
  });
  const rect = (await grip.boundingBox())!;
  await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2);
  await page.mouse.down();
  await page.mouse.move(rect.x + 90, rect.y + 70, { steps: 8 });
  const preview = page.locator(".memory-drag-preview");
  await expect(preview).toHaveText("Launch checklist");
  expect((await preview.boundingBox())!.width).toBeGreaterThan(140);
  await expect(source).toHaveAttribute("data-dragging", "true");
  const target = page.locator(
    '.notebook-explorer [data-destination="personal"]',
  );
  const destination = (await target.boundingBox())!;
  await page.mouse.move(
    destination.x + destination.width / 2,
    destination.y + destination.height / 2,
    { steps: 12 },
  );
  await expect(target).toHaveAttribute("data-drop-active", "true");
  await page.screenshot({ path: info.outputPath("sidebar-note-drag.png") });
  await page.mouse.up();
  await expect(page.locator(".workspace-notice")).toContainText(
    "1 note moved to Unfiled",
  );
  expect(state.records.get(handoff.id)?.projectId).toBeNull();
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect
    .poll(() => state.records.get(handoff.id)?.projectId)
    .toBe(project.id);
});

test("partial bulk failures are identifiable and undo never overwrites a concurrent edit", async ({
  page,
}) => {
  const state = await fixture(page);
  await page.goto(`${base}/app`);
  await page.getByLabel("Select these notes").check();
  state.records.set(handoff.id, {
    ...handoff,
    version: 2,
    content: "Agent updated the handoff",
  });
  await page
    .getByRole("group", { name: "Selected notes" })
    .getByRole("button", { name: "Archive", exact: true })
    .click();
  await expect(page.locator(".workspace-notice")).toContainText(
    "1 archived; 1 could not be archived",
  );
  await expect(page.getByRole("alert")).toContainText(
    "Launch checklist: Memory changed",
  );
  const archived = state.records.get(note.id)!;
  state.records.set(note.id, {
    ...archived,
    version: 3,
    content: "An agent corrected this",
  });
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(page.locator(".workspace-notice")).toContainText(
    "1 could not be undone",
  );
  expect(state.records.get(note.id)).toMatchObject({
    version: 3,
    status: "archived",
    content: "An agent corrected this",
  });
  expect(
    state.calls.find((call) => call.path.endsWith("/restore"))?.body
      .expectedVersion,
  ).toBe(2);
});

test("autosave retries a lost first response before saving newer typing and clears the creation draft", async ({
  page,
}) => {
  const state = await fixture(page, []);
  const attempts: ReturnType<typeof rememberSchema.parse>[] = [];
  const saved: Memory = {
    ...note,
    id: crypto.randomUUID(),
    content: "The first draft",
    source: { agent: "website" },
    enrichment: undefined,
  };
  await page.route("**/api/grove/memories", async (route) => {
    const input = rememberSchema.parse(route.request().postDataJSON());
    attempts.push(input);
    if (attempts.length === 1) {
      state.records.set(saved.id, {
        ...saved,
        kind: input.kind,
        autoKind: input.autoKind,
      });
      return route.abort("failed");
    }
    if (input.operationId === attempts[0].operationId)
      return route.fulfill({
        json: { success: true, data: state.records.get(saved.id) },
      });
    await route.fallback();
  });
  await page.goto(`${base}/app/notes/new`);
  const editor = page.getByRole("textbox", {
    name: "What should stay with you?",
  });
  await editor.fill(saved.content);
  await expect(page.locator(".note-save-status")).toContainText("Not saved");
  await editor.fill("The first draft, with a newer thought.");
  // New typing restarts autosave; don't race its completed save with a manual click.
  await expect(page).toHaveURL(`${base}/app/memories/${saved.id}?mode=edit`);
  await expect(page.locator(".note-save-status")).toContainText("Saved");
  expect(attempts[1]).toEqual(attempts[0]);
  expect(attempts[2]).toMatchObject({
    id: saved.id,
    expectedVersion: 1,
    content: "The first draft, with a newer thought.",
  });
  expect(state.records.size).toBe(1);
  expect(state.records.get(saved.id)!.version).toBe(2);
  await page.keyboard.press("Control+Alt+n");
  await expect(editor.locator(".cm-placeholder")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Save note", exact: true }),
  ).toBeDisabled();
  await expect(page.locator(".editor-footer")).toContainText("0 / 6,000");
});

test("save retries retain their operation and draft, and dialogs stay open while saving", async ({
  page,
}) => {
  await fixture(page, []);
  const gate = Promise.withResolvers<void>();
  const attempts: Record<string, unknown>[] = [];
  await page.route("**/api/grove/memories", async (route) => {
    attempts.push(route.request().postDataJSON());
    if (attempts.length === 1) {
      await gate.promise;
      return route.fulfill({
        status: 503,
        json: {
          success: false,
          error: { code: "unavailable", message: "Please retry" },
        },
      });
    }
    await route.fallback();
  });
  await page.goto(`${base}/app/profile`);
  await page.getByRole("button", { name: /^Communication/ }).click();
  await page
    .getByLabel("What should stay with you?")
    .fill("# Release handoff\n\nReady for review.");
  await page.getByText("Note options", { exact: true }).click();
  await chooseOption(
    page.getByRole("combobox", { name: "Note type", exact: true }),
    "handoff",
  );
  await page.getByRole("button", { name: "Save note", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Close dialog" }),
  ).toBeDisabled();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toBeVisible();
  gate.resolve();
  await expect(page.getByRole("alert")).toContainText("Please retry");
  await page.getByRole("button", { name: "Save note", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(attempts[0].taskId).toMatch(/^task-/);
  expect(attempts[1]).toEqual(attempts[0]);
});

test("named workspaces browse scoped memories and handoffs without manual agent IDs", async ({
  page,
}, info) => {
  const state = await fixture(page);
  await page.goto(`${base}/app/projects`);
  await expect(page.getByText(project.identity)).toHaveCount(0);
  await page.getByRole("button", { name: "New notebook", exact: true }).click();
  await page.getByLabel("Notebook name").fill("Research notes");
  await expect(page.getByLabel("Repository identity")).not.toBeVisible();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Create notebook", exact: true })
    .click();
  await expect(
    page
      .locator(".notebook-manager")
      .getByRole("link", { name: /Research notes/ }),
  ).toBeVisible();
  expect(state.projects.at(-1)?.identity).toMatch(/^workspace:/);
  await page
    .locator(".notebook-manager")
    .getByRole("link", { name: /Website redesign/ })
    .click();
  await expect(
    page.getByRole("heading", { name: project.name, exact: true }),
  ).toBeVisible();
  await expect(page.getByText(project.identity)).not.toBeVisible();
  await page.screenshot({
    path: info.outputPath("project-desktop.png"),
    fullPage: true,
  });
  await expect(page.locator(".memory-open")).toHaveCount(1);
  await expect(
    page.getByRole("navigation", { name: "Workspace views" }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Notebook options", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Progress notes", exact: true })
    .click();
  await page.getByRole("button", { name: /^Launch checklist/ }).click();
  await expect(page.getByText("Ready for the next session")).toBeVisible();
  expect(
    state.calls.filter((call) => call.path === "/briefs").at(-1)?.body,
  ).toEqual({ projectId: project.id, taskId: handoff.taskId });
  for (const width of [320, 1440]) {
    await page.setViewportSize({ width, height: 900 });
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
    await page.screenshot({
      path: info.outputPath(`handoffs-${width}.png`),
      fullPage: true,
    });
  }
});

test("notebook rename preserves location and requires review of a concurrent change", async ({
  page,
}, info) => {
  const state = await fixture(page);
  await page.goto(`${base}/app/projects`);
  await page
    .getByRole("button", { name: `Rename ${project.name}`, exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "Rename notebook",
    exact: true,
  });
  const submit = dialog.getByRole("button", {
    name: "Rename notebook",
    exact: true,
  });
  await expect(dialog.getByRole("combobox")).toHaveCount(0);
  await expect(dialog.getByLabel("Notebook name")).toBeFocused();
  await expect(submit).toBeDisabled();
  await dialog.screenshot({ path: info.outputPath("rename-notebook.png") });
  await dialog.getByLabel("Notebook name").fill(" My renamed notebook ");
  state.projects[0].name = "Changed elsewhere";
  state.projects[0].version++;
  await submit.click();
  await expect(dialog).toContainText("Changed elsewhere");
  await expect(submit).toBeDisabled();
  await expect(dialog.getByLabel("Notebook name")).toHaveValue(
    " My renamed notebook ",
  );
  await dialog.getByRole("button", { name: "Use this version" }).click();
  await submit.click();
  await expect(dialog).toHaveCount(0);
  expect(state.projects[0]).toMatchObject({
    name: "My renamed notebook",
    parentId: null,
    identity: project.identity,
    version: 3,
  });
  await page
    .getByRole("button", { name: "Move My renamed notebook", exact: true })
    .click();
  const move = page.getByRole("dialog", { name: "Move notebook", exact: true });
  await expect(move.getByLabel("Notebook name")).toHaveCount(0);
  await expect(move.getByRole("combobox")).toBeFocused();
  await move.screenshot({ path: info.outputPath("move-notebook.png") });
  await expect(
    move.getByRole("button", { name: "Move notebook", exact: true }),
  ).toBeDisabled();
  await move.getByRole("button", { name: "Cancel", exact: true }).click();
  expect(
    state.calls.filter((call) => call.path === `/projects/${project.id}`),
  ).toHaveLength(2);
});

test("nested notebooks share paths, create and move controls, and preserve note scope", async ({
  page,
}, info) => {
  const state = await fixture(page);
  await page.goto(`${base}/app/projects`);
  const manager = page.getByRole("region", { name: "Notebook organization" });
  await manager
    .getByRole("button", { name: `Add sub-notebook to ${project.name}` })
    .click();
  const dialog = page.getByRole("dialog");
  await expect(
    dialog.getByRole("combobox", { name: "Parent notebook" }),
  ).toHaveText(project.name);
  await dialog.getByLabel("Notebook name").fill("Research");
  await dialog
    .getByRole("button", { name: "Create notebook", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  const child = state.projects.find((p) => p.name === "Research")!;
  expect(child.parentId).toBe(project.id);
  await manager
    .getByRole("button", { name: "Add sub-notebook to Research" })
    .click();
  await dialog.getByLabel("Notebook name").fill("Interviews");
  await expect(
    dialog.getByRole("combobox", { name: "Parent notebook" }),
  ).toHaveText(`${project.name} / Research`);
  await dialog
    .getByRole("button", { name: "Create notebook", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  await manager
    .getByRole("button", { name: `Collapse ${project.name}` })
    .click();
  await expect(
    manager.getByRole("link", { name: "Research", exact: true }),
  ).toBeHidden();
  await manager
    .getByRole("button", { name: `Expand ${project.name}` })
    .press("Enter");
  await expect(
    manager.getByRole("link", { name: "Interviews", exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: info.outputPath("nested-notebooks-desktop.png"),
    fullPage: true,
  });

  await manager
    .getByRole("button", { name: "Move Research", exact: true })
    .click();
  await dialog.getByRole("combobox", { name: "Parent notebook" }).click();
  await expect(
    page.getByRole("option").filter({ hasText: "Research" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("option").filter({ hasText: "Interviews" }),
  ).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(dialog).toBeVisible();
  await expect(
    dialog.getByRole("combobox", { name: "Parent notebook" }),
  ).toBeFocused();
  await chooseOption(
    dialog.getByRole("combobox", { name: "Parent notebook" }),
    "",
  );
  await dialog
    .getByRole("button", { name: "Move notebook", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  expect(child.parentId).toBeNull();
  expect(state.projects.find((p) => p.name === "Interviews")?.parentId).toBe(
    child.id,
  );
  await page.reload();
  await manager.getByRole("link", { name: "Research", exact: true }).click();
  await expect(
    page.getByRole("navigation", { name: "Notebook path" }),
  ).toHaveText("NotesResearch");
  await expect(
    page.getByRole("region", { name: "Sub-notebooks" }),
  ).toContainText("Interviews");
  await page.locator(".sidebar-create").click();
  await page
    .getByRole("textbox", { name: "What should stay with you?" })
    .fill("# Interview notes\n\nLeave room for a surprising answer.");
  await page.getByRole("button", { name: "Save note", exact: true }).click();
  await expect(page.locator(".note-save-status")).toHaveText("Saved");
  expect(
    [...state.records.values()].find((p) =>
      p.content.startsWith("# Interview notes"),
    )?.projectId,
  ).toBe(child.id);
  await page
    .getByRole("region", { name: "Your notebooks" })
    .getByRole("link", { name: "Manage notebooks", exact: true })
    .click();
  await page.setViewportSize({ width: 320, height: 900 });
  await expect(
    manager.getByRole("link", { name: "Interviews", exact: true }),
  ).toBeVisible();
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
  await page.screenshot({
    path: info.outputPath("nested-notebooks-mobile.png"),
    fullPage: true,
  });
});

test("shared dropdowns support keyboard selection, typeahead, modal dismissal and narrow touch layouts", async ({
  page,
}, info) => {
  await fixture(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(`${base}/app`);
  await page.getByRole("button", { name: "Filters", exact: true }).click();
  const source = page.getByRole("combobox", { name: "Source", exact: true });
  await source.focus();
  await source.press("Enter");
  await page.keyboard.press("End");
  await page.keyboard.press("Home");
  await expect(
    page.getByRole("option", { name: "Any source", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("i");
  await expect(
    page.getByRole("option", { name: "Import", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(source).toHaveText("Import");
  await expect(source).toBeFocused();
  await chooseOption(source, "website");
  await source.press("Enter");
  await expect(page.getByRole("option", { selected: true })).toHaveAttribute(
    "data-value",
    "website",
  );
  expect(
    (
      await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze()
    ).violations,
  ).toEqual([]);
  await page.screenshot({
    path: info.outputPath("dropdown-desktop.png"),
    fullPage: true,
  });
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Close filters" }).click();
  if (
    await page
      .getByRole("button", { name: "Notebooks", exact: true })
      .isVisible()
  ) {
    await page.getByRole("button", { name: "Notebooks", exact: true }).click();
  }
  await page
    .getByRole("region", { name: "Your notebooks" })
    .getByRole("link", { name: "Manage notebooks", exact: true })
    .click();
  await page.getByRole("button", { name: "New notebook", exact: true }).click();
  await page.setViewportSize({ width: 320, height: 900 });
  const dialog = page.getByRole("dialog");
  const parent = dialog.getByRole("combobox", { name: "Parent notebook" });
  await parent.click();
  await page.keyboard.press("End");
  await expect(
    page.getByRole("option", { name: project.name, exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(parent).toHaveText(project.name);
  await parent.click();
  await page.screenshot({
    path: info.outputPath("dropdown-mobile-dialog.png"),
    fullPage: true,
  });
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
  await page.keyboard.press("Escape");
  await expect(dialog).toBeVisible();
  await expect(parent).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
});

test("long notebook menus scroll on touch without snapping back to the selected item", async ({
  browser,
}) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    reducedMotion: "reduce",
  });
  try {
    const page = await context.newPage();
    const state = await fixture(page);
    state.projects.push(
      ...Array.from({ length: 20 }, (_, n) => ({
        ...project,
        id: crypto.randomUUID(),
        name: `Notebook ${String(n).padStart(2, "0")}`,
        identity: `workspace:${n}`,
      })),
    );
    await page.goto(`${base}/app/notes/new?notebook=${project.id}`);
    await page.getByRole("button", { name: "Note actions", exact: true }).tap();
    await page.getByRole("button", { name: "Note properties" }).tap();
    const picker = page.getByRole("combobox", {
      name: "Notebook",
      exact: true,
    });
    await picker.tap();
    await expect(
      page.getByRole("option", { name: project.name, exact: true }),
    ).toBeFocused();
    // Reaching the first item used to mount a scroll control that refocused the
    // selected last item, making the top choices impossible to tap.
    await page
      .getByRole("option", { name: "Unfiled", exact: true })
      .scrollIntoViewIfNeeded();
    await page.getByRole("option", { name: "Unfiled", exact: true }).tap();
    await expect(picker).toHaveText("Unfiled");
    await expect(picker).toBeFocused();
    await picker.tap();
    await page
      .getByRole("option", { name: project.name, exact: true })
      .scrollIntoViewIfNeeded();
    await page.getByRole("option", { name: project.name, exact: true }).tap();
    await expect(picker).toHaveText(project.name);
    await expect(picker).toBeFocused();
    await expect(page.locator("[inert]")).toHaveCount(0);
  } finally {
    await context.close();
  }
});

test("mouse handles reveal collapsed destinations before one move", async ({
  page,
}) => {
  const state = await fixture(page, [note]);
  const child = {
    ...project,
    id: crypto.randomUUID(),
    name: "Research",
    parentId: project.id,
  };
  state.projects.push(child);
  await page.goto(`${base}/app`);
  const sidebar = page.getByRole("region", { name: "Your notebooks" });
  const handle = page.locator(".memory-row .drag-handle");
  const box = (await handle.boundingBox())!;
  const parent = sidebar.locator(`[data-destination="${project.id}"]`);
  const parentBox = (await parent.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    parentBox.x + parentBox.width / 2,
    parentBox.y + parentBox.height / 2,
    { steps: 8 },
  );
  await expect(page.locator(".memory-drag-preview")).toBeVisible();
  await expect(
    sidebar.getByRole("button", {
      name: "Collapse Website redesign",
      exact: true,
    }),
  ).toBeVisible();
  const target = sidebar.locator(`[data-destination="${child.id}"]`);
  const targetBox = (await target.boundingBox())!;
  await page.mouse.move(
    targetBox.x + targetBox.width / 2,
    targetBox.y + targetBox.height / 2,
  );
  await expect(target).toHaveAttribute("data-drop-active", "true");
  await page.mouse.up();
  await expect(page.locator(".workspace-notice")).toContainText("Research");
  expect(state.records.get(note.id)?.projectId).toBe(child.id);
  expect(state.calls.filter(({ path }) => path === "/memories")).toHaveLength(
    1,
  );
});

test("touch handles activate deliberately, scroll destinations and cancel without a write", async ({
  browser,
}, info) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  try {
    const state = await fixture(page, [note]);
    state.projects.push(
      ...Array.from({ length: 18 }, (_, index) => ({
        ...project,
        id: crypto.randomUUID(),
        name: `Notebook ${String(index).padStart(2, "0")}`,
      })),
    );
    await page.goto(`${base}/app`);
    const handle = page.locator(".memory-row .drag-handle");
    await handle.scrollIntoViewIfNeeded();
    const cdp = await context.newCDPSession(page);
    const touch = (
      type: "touchStart" | "touchMove" | "touchEnd" | "touchCancel",
      x = 0,
      y = 0,
    ) =>
      cdp.send("Input.dispatchTouchEvent", {
        type,
        touchPoints:
          type === "touchEnd" || type === "touchCancel" ? [] : [{ x, y }],
      });
    const pickUp = async () => {
      const box = (await handle.boundingBox())!;
      await touch("touchStart", box.x + box.width / 2, box.y + box.height / 2);
      await expect(page.locator(".memory-drag-preview")).toBeVisible();
    };
    await pickUp();
    const contact = (await handle.boundingBox())!;
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [
        {
          id: 0,
          x: contact.x + contact.width / 2,
          y: contact.y + contact.height / 2,
        },
        { id: 1, x: contact.x + 100, y: contact.y + 10 },
      ],
    });
    await expect(page.locator(".memory-drag-preview")).toHaveCount(0);
    await touch("touchEnd");
    expect(state.calls.filter(({ path }) => path === "/memories")).toHaveLength(
      0,
    );
    await pickUp();
    const tray = page.locator(".mobile-drop-destinations");
    const bounds = (await tray.boundingBox())!;
    // A finger travels to the tray's edge instead of teleporting, so the
    // pointer delta keeps updating while the autoscroll engages.
    const grip = (await handle.boundingBox())!;
    const target = {
      x: bounds.x + bounds.width / 2,
      y: bounds.y + bounds.height - 8,
    };
    for (let step = 1; step <= 12; step++) {
      await touch(
        "touchMove",
        grip.x +
          grip.width / 2 +
          ((target.x - grip.x - grip.width / 2) * step) / 12,
        grip.y +
          grip.height / 2 +
          ((target.y - grip.y - grip.height / 2) * step) / 12,
      );
    }
    await expect
      .poll(() => tray.evaluate((el) => el.scrollTop))
      .toBeGreaterThan(20);
    const cancel = page.getByRole("button", { name: "Drop here to cancel" });
    const cancelBox = (await cancel.boundingBox())!;
    await touch(
      "touchMove",
      cancelBox.x + cancelBox.width / 2,
      cancelBox.y + cancelBox.height / 2,
    );
    await expect(cancel).toHaveAttribute("data-drop-active", "true");
    await page.screenshot({ path: info.outputPath("touch-destinations.png") });
    await touch("touchEnd");
    await expect(page.locator(".memory-drag-preview")).toHaveCount(0);
    expect(state.calls.filter(({ path }) => path === "/memories")).toHaveLength(
      0,
    );
    await pickUp();
    const destination = page.locator(
      `.mobile-drop-tray [data-destination="${state.projects[1].id}"]`,
    );
    const trayTarget = (await destination.boundingBox())!;
    await touch(
      "touchMove",
      trayTarget.x + trayTarget.width / 2,
      trayTarget.y + trayTarget.height / 2,
    );
    await expect(destination).toHaveAttribute("data-drop-active", "true");
    await touch("touchEnd");
    await expect(page.locator(".workspace-notice")).toContainText(
      "1 note moved",
    );
    expect(state.records.get(note.id)?.projectId).toBe(state.projects[1].id);
    expect(state.calls.filter(({ path }) => path === "/memories")).toHaveLength(
      1,
    );
  } finally {
    await context.close();
  }
});

test("pen pickup cancels when its source disappears during navigation", async ({
  page,
  context,
}) => {
  const state = await fixture(page, [note]);
  await page.goto(`${base}/app`);
  const box = (await page.locator(".memory-row .drag-handle").boundingBox())!;
  const cdp = await context.newCDPSession(page);
  await cdp.send("Input.dispatchMouseEvent", {
    type: "mousePressed",
    button: "left",
    buttons: 1,
    x: box.x + 10,
    y: box.y + 10,
    pointerType: "pen",
  });
  await cdp.send("Input.dispatchMouseEvent", {
    type: "mouseMoved",
    button: "left",
    buttons: 1,
    x: box.x + 30,
    y: box.y + 10,
    pointerType: "pen",
  });
  await expect(page.locator(".memory-drag-preview")).toBeVisible();
  await page.evaluate(() => {
    history.pushState(null, "", "/app/ask");
    dispatchEvent(new PopStateEvent("popstate"));
  });
  await expect(page.locator(".memory-drag-preview")).toHaveCount(0);
  await cdp.send("Input.dispatchMouseEvent", {
    type: "mouseReleased",
    button: "left",
    buttons: 0,
    x: box.x + 30,
    y: box.y + 10,
    pointerType: "pen",
  });
  expect(state.calls.filter(({ path }) => path === "/memories")).toHaveLength(
    0,
  );
});

test("row actions have one owner, Escape restores focus and an interrupted swipe never consumes the next tap", async ({
  browser,
}) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  try {
    const state = await fixture(page);
    await page.goto(`${base}/app`);
    const buttons = page.locator(".row-controls > button");
    await buttons.first().tap();
    await page.getByRole("heading", { name: "Notes", exact: true }).tap();
    await expect(page.getByRole("group", { name: /^Actions for/ })).toHaveCount(
      0,
    );
    await buttons.nth(1).tap();
    await expect(page.getByRole("group", { name: /^Actions for/ })).toHaveCount(
      1,
    );
    await expect(buttons.nth(1)).toHaveAttribute("aria-expanded", "true");
    await page.keyboard.press("Escape");
    await expect(buttons.nth(1)).toBeFocused();
    await buttons.nth(1).tap();
    await page
      .getByRole("group", { name: /^Actions for/ })
      .getByRole("button", { name: "Move", exact: true })
      .tap();
    await expect(page.getByRole("dialog", { name: "Move note" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(buttons.nth(1)).toBeFocused();
    const row = page.locator(".memory-row").last();
    await row.scrollIntoViewIfNeeded();
    const box = (await row.boundingBox())!;
    const x = box.x + box.width - 90,
      y = box.y + 30;
    const cdp = await context.newCDPSession(page);
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ id: 1, x, y }],
    });
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ id: 1, x: x - 30, y }],
    });
    await expect(row).toHaveAttribute("data-swiping", "true");
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [
        { id: 1, x: x - 30, y },
        { id: 2, x: x - 70, y: y + 20 },
      ],
    });
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [
        { id: 1, x: x - 100, y },
        { id: 2, x: x - 130, y: y + 20 },
      ],
    });
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
    await expect(row).not.toHaveAttribute("data-swiping");
    await expect(page.getByRole("group", { name: /^Actions for/ })).toHaveCount(
      0,
    );
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect(state.calls.filter(({ path }) => path === "/memories")).toHaveLength(
      0,
    );
    await row.locator(".memory-open").tap();
    await expect(
      page.getByRole("dialog", { name: "Note", exact: true }),
    ).toBeVisible();
  } finally {
    await context.close();
  }
});

test("touch swipe only reveals actions, cancellation stays quiet, and keyboard actions also work", async ({
  page,
  context,
}, info) => {
  await fixture(page);
  await page.setViewportSize({ width: 390, height: 844 });
  const cdp = await context.newCDPSession(page);
  await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: true });
  await page.goto(`${base}/app`);
  const row = page
    .locator(".memory-list-item")
    .filter({ hasText: "Review preferences" })
    .locator(".memory-row");
  await row.scrollIntoViewIfNeeded();
  const rect = (await row.boundingBox())!;
  const x = rect.x + rect.width - 80,
    y = rect.y + 30;
  const touch = (
    type: "touchStart" | "touchMove" | "touchEnd" | "touchCancel",
    dx = 0,
    dy = 0,
  ) =>
    cdp.send("Input.dispatchTouchEvent", {
      type,
      touchPoints:
        type === "touchEnd" || type === "touchCancel"
          ? []
          : [{ x: x + dx, y: y + dy }],
    });
  await touch("touchStart");
  await touch("touchMove", -100);
  await touch("touchEnd");
  await expect(page.getByRole("group", { name: /^Actions for/ })).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.screenshot({
    path: info.outputPath("touch-actions.png"),
    fullPage: true,
  });
  await page.keyboard.press("Escape");
  await touch("touchStart");
  await touch("touchMove", -25);
  await touch("touchCancel");
  await expect(page.getByRole("group", { name: /^Actions for/ })).toHaveCount(
    0,
  );
  await touch("touchStart");
  await touch("touchMove", 2, -80);
  await touch("touchEnd");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("group", { name: /^Actions for/ })).toHaveCount(
    0,
  );
  await page
    .getByRole("button", {
      name: "Actions for Review preferences",
      exact: true,
    })
    .focus();
  await page.keyboard.press("Enter");
  await page.getByRole("button", { name: "Move", exact: true }).click();
  await chooseOption(
    page.getByRole("combobox", { name: "Destination", exact: true }),
    project.id,
  );
  await page.getByRole("button", { name: "Move here" }).click();
  await expect(page.locator(".workspace-notice")).toContainText("1 note moved");
});
