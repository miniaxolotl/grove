import { fixturePath, catalogResponse } from "./fixtures/notebook-catalog";
import { test, expect, type Page } from "@playwright/test";
import type { Memory } from "@lib/shared/contracts";
import { applySourceEdits } from "@lib/shared/document-edits";

const base = `http://127.0.0.1:${process.env.DASHBOARD_TEST_PORT || 3101}`;
const project = {
  id: "00000000-0000-4000-a000-000000000010",
  name: "Cache notebook",
  identity: "test:cache",
  parentId: null,
  version: 1,
};
const note: Memory = {
  id: "00000000-0000-4000-a000-000000000011",
  projectId: project.id,
  content: "# Cached thought\n\nOriginal words",
  kind: "fact",
  status: "active",
  version: 1,
  source: { agent: "website" },
  taskId: null,
  expiresAt: null,
  purgeAt: null,
  createdAt: "2026-10-21T10:00:00Z",
  updatedAt: "2026-10-21T10:00:00Z",
  indexing: "ready",
};
async function fixture(page: Page) {
  const state = {
    note: structuredClone(note),
    reads: [] as string[],
    writes: [] as Record<string, unknown>[],
  };
  await page.route("**/api/grove/**", async (route) => {
    const path = fixturePath(route.request().url()).replace("/api/grove", "");
    const input = route.request().postDataJSON();
    if (path === "/memories") {
      state.writes.push(input);
      state.note = {
        ...state.note,
        ...input,
        content: input.edits
          ? applySourceEdits(state.note.content, input.edits)
          : (input.content ?? state.note.content),
        version: state.note.version + 1,
      };
    } else state.reads.push(path);
    const data =
      path === "/projects"
        ? [project]
        : path === "/models"
          ? { config: { embedding: { provider: "disabled" } }, editable: false }
          : path === "/memories/search"
            ? { items: [state.note], nextCursor: null }
            : path === "/memories" || path === `/memories/${note.id}`
              ? state.note
              : path === "/me"
                ? {
                    captureEnabled: true,
                    recallEnabled: true,
                    organizeEnabled: true,
                    summariesEnabled: true,
                    accountId: "fixture",
                  }
                : [];
    await route.fulfill({
      json: {
        success: true,
        data: catalogResponse(route.request().url(), data),
      },
    });
  });
  return state;
}
async function navigate(page: Page, path: string) {
  await page.evaluate((path) => {
    history.pushState({}, "", path);
    dispatchEvent(new PopStateEvent("popstate"));
  }, path);
}
async function invalidateNotes(page: Page) {
  await page.evaluate(() => {
    const channel = new BroadcastChannel("grove-workspace:fixture-user");
    channel.postMessage({});
    channel.close();
  });
}

test("archive intent warms one request and navigation joins it", async ({
  page,
}) => {
  const state = await fixture(page);
  const started = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  let archiveReads = 0;
  await page.route("**/api/grove/memories/search", async (route) => {
    if (route.request().postDataJSON().status !== "archived")
      return route.fallback();
    archiveReads++;
    started.resolve();
    await release.promise;
    await route.fulfill({
      json: {
        success: true,
        data: {
          items: [
            { ...note, status: "archived", content: "# Archived thought" },
          ],
          nextCursor: null,
        },
      },
    });
  });
  await page.goto(`${base}/app`);
  await expect(page.locator(".memory-open")).toHaveText("Cached thought");
  expect(archiveReads).toBe(0);
  await page.getByRole("button", { name: "More note actions" }).click();
  const link = page
    .getByRole("group", { name: "More note actions" })
    .getByRole("link", { name: "Archive", exact: true });
  expect(archiveReads).toBe(0);
  await link.focus();
  await expect.poll(() => archiveReads, { timeout: 3000 }).toBe(1);
  await started.promise;
  await link.click();
  await expect(page).toHaveURL(/\/app\/archive$/);
  await expect(
    page.locator(".library-skeleton").getByRole("status"),
  ).toHaveText("Opening your archive…");
  expect(archiveReads).toBe(1);
  release.resolve();
  await expect(page.locator(".memory-open")).toHaveText("Archived thought");
  await page.goBack();
  await expect(page.locator(".memory-open")).toHaveText("Cached thought");
  expect(
    state.reads.filter((path) => path === "/memories/search"),
  ).toHaveLength(1);
  expect(archiveReads).toBe(1);
});

test("fresh Notes, Settings and note-detail revisits reuse snapshots without new reads", async ({
  page,
}) => {
  const state = await fixture(page);
  await page.goto(`${base}/app`);
  await expect(page.locator(".memory-open")).toHaveText("Cached thought");
  await navigate(page, `/app/memories/${note.id}`);
  await expect(page.locator(".editor-preview")).toContainText("Original words");
  expect(
    state.reads.filter((path) => path === `/memories/${note.id}`),
  ).toHaveLength(0);
  await navigate(page, "/app/settings/models");
  await expect(
    page.getByRole("checkbox", { name: "Answers and writing", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Keyword search is available.")).toBeVisible();
  const reads = state.reads.length;
  for (let visit = 0; visit < 3; visit++) {
    await navigate(page, "/app");
    await expect(page.locator(".memory-open")).toHaveText("Cached thought");
    await navigate(page, "/app/settings/models");
    await expect(
      page.getByRole("checkbox", { name: "Answers and writing", exact: true }),
    ).toBeVisible();
  }
  expect(state.reads).toHaveLength(reads);
});

test("session replacement clears snapshots and retained drafts, including held old-account responses", async ({
  page,
}) => {
  await fixture(page);
  await page.goto(`${base}/app`);
  await expect(page.locator(".memory-open")).toHaveText("Cached thought");
  await navigate(page, `/app/memories/${note.id}?mode=edit`);
  const editor = page.getByRole("textbox", {
    name: "What should stay with you?",
  });
  await editor.fill("Private unsaved draft from old session");
  const started = Promise.withResolvers<void>(),
    release = Promise.withResolvers<void>();
  await page.route("**/api/grove/memories/search", async (route) => {
    started.resolve();
    await release.promise;
    await route.fulfill({
      json: { success: true, data: { items: [note], nextCursor: null } },
    });
  });
  await navigate(page, "/app");
  await invalidateNotes(page);
  await started.promise;
  await page.route("**/api/grove/memories/search", (route) =>
    route.fulfill({
      json: {
        success: true,
        data: {
          items: [{ ...note, content: "# New session note" }],
          nextCursor: null,
        },
      },
    }),
  );
  await page.evaluate(() =>
    (
      window as unknown as {
        switchWorkspaceAccount: (account: string, session: string) => void;
      }
    ).switchWorkspaceAccount("fixture-user", "replacement-session"),
  );
  await expect(page.locator(".memory-open")).toHaveText("New session note");
  release.resolve();
  await navigate(page, `/app/memories/${note.id}?mode=edit`);
  await expect(editor).toHaveText("# New session note");
  await expect(
    page.getByText("Private unsaved draft from old session", { exact: true }),
  ).toHaveCount(0);
});

test("a save finishing after navigation publishes before returning to the note", async ({
  page,
}) => {
  const state = await fixture(page);
  const started = Promise.withResolvers<void>(),
    release = Promise.withResolvers<void>();
  await page.route("**/api/grove/memories", async (route) => {
    started.resolve();
    await release.promise;
    await route.fallback();
  });
  await page.goto(`${base}/app/memories/${note.id}?mode=edit`);
  const editor = page.getByRole("textbox", {
    name: "What should stay with you?",
  });
  await editor.fill("# Saved away\n\nTyping survives navigation.");
  await editor.press("Control+s");
  await started.promise;
  await navigate(page, "/app/settings");
  release.resolve();
  await expect.poll(() => state.note.version).toBe(2);
  await navigate(page, "/app");
  await expect(page.locator(".memory-open")).toHaveText("Saved away");
  await navigate(page, `/app/memories/${note.id}?mode=edit`);
  await expect(editor).toContainText("Typing survives navigation.");
  expect(state.note.content).toBe(
    "# Saved away\n\nTyping survives navigation.",
  );
  expect(state.writes).toHaveLength(1);
});

test("row deletion retains conflict review when a save replay returns a later version", async ({
  page,
}) => {
  const state = await fixture(page);
  const attempts: Record<string, unknown>[] = [];
  await page.route("**/api/grove/memories", async (route) => {
    attempts.push(route.request().postDataJSON());
    if (attempts.length === 1) return route.abort("failed");
    state.note = { ...note, version: 3, content: "# Agent revision" };
    await route.fulfill({ json: { success: true, data: state.note } });
  });
  await page.goto(`${base}/app/memories/${note.id}?mode=edit`);
  const editor = page.getByRole("textbox", {
    name: "What should stay with you?",
  });
  await editor.fill("Committed before connection loss");
  await editor.press("Control+s");
  await expect(page.locator(".note-save-status")).toContainText("Not saved");
  const draft = "Retained newer draft. ".repeat(350);
  await editor.fill(draft);
  await navigate(page, "/app");
  const row = page.locator(`[data-note-id="${note.id}"]`);
  await row.getByRole("button", { name: "Actions for Cached thought" }).click();
  await row.getByRole("button", { name: "Delete note…", exact: true }).click();
  const dialog = page.getByRole("dialog", {
    name: "Delete note?",
    exact: true,
  });
  await dialog.getByRole("button", { name: "Retry pending save" }).click();
  await expect(dialog.getByRole("alert")).toContainText("changed elsewhere");
  await expect(
    dialog.getByRole("button", { name: "Delete note and discard draft" }),
  ).toBeDisabled();
  expect(attempts).toHaveLength(2);
  expect(attempts[1]).toEqual(attempts[0]);
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await row.getByRole("button", { name: "Actions for Agent revision" }).click();
  await row.getByRole("button", { name: "Delete note…", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("changed elsewhere");
  await expect(
    dialog.getByRole("button", { name: "Delete note and discard draft" }),
  ).toBeDisabled();
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await navigate(page, `/app/memories/${note.id}?mode=edit`);
  await expect(editor).toHaveText(draft.trim());
  await expect(page.locator(".revision-compare")).toContainText(
    "Agent revision",
  );
  await editor.press("Control+s");
  expect(attempts).toHaveLength(2);
  expect(state.reads).not.toContain("/memories/delete");
});

test("held background revalidation keeps content and dirty conflict bases intact", async ({
  page,
}) => {
  const state = await fixture(page);
  await page.goto(`${base}/app/memories/${note.id}?mode=edit`);
  const editor = page.getByRole("textbox", {
    name: "What should stay with you?",
  });
  await editor.fill("Local draft remains mine");
  const release = Promise.withResolvers<void>(),
    started = Promise.withResolvers<void>();
  await page.route(`**/api/grove/memories/${note.id}`, async (route) => {
    started.resolve();
    await release.promise;
    await route.fulfill({
      json: {
        success: true,
        data: { ...note, content: "Remote writer", version: 2 },
      },
    });
  });
  await invalidateNotes(page);
  await started.promise;
  await expect(editor).toHaveText("Local draft remains mine");
  release.resolve();
  await expect(page.locator(".revision-diff")).toBeVisible();
  await expect(editor).toHaveText("Local draft remains mine");
  expect(state.writes).toHaveLength(0);
});

test("opening notes never presents a false empty count", async ({ page }) => {
  await fixture(page);
  const release = Promise.withResolvers<void>();
  await page.route("**/api/grove/memories/search", async (route) => {
    await release.promise;
    await route.fallback();
  });
  await page.goto(`${base}/app`);
  await expect(
    page
      .getByRole("status", { name: "" })
      .filter({ hasText: "Opening your notes…" }),
  ).toBeVisible();
  await expect(page.locator(".library-summary")).toContainText("Your notes");
  await expect(page.getByText("0 notes", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "No notes yet" })).toHaveCount(
    0,
  );
  release.resolve();
  await expect(page.locator(".memory-open")).toHaveText("Cached thought");
  await expect(page.locator(".library-summary")).toHaveText("1 note");
});

test.describe("phone Notes header", () => {
  test.use({ viewport: { width: 320, height: 844 }, hasTouch: true });

  test("keeps secondary actions in More without pushing search down", async ({
    page,
  }) => {
    await fixture(page);
    await page.goto(`${base}/app`);
    const title = page.getByRole("heading", { name: "Notes", exact: true });
    const more = page.getByRole("button", { name: "More note actions" });
    const today = page.getByRole("link", { name: "Today’s note" });
    const importNotes = page.getByRole("button", { name: "Import notes" });
    const search = page.getByRole("textbox", { name: "Search notes" });
    await expect(more).toBeVisible();
    await page.evaluate(() => document.fonts.ready.then(() => undefined));
    const [heading, trigger, field] = await Promise.all(
      [title, more, search].map((item) => item.boundingBox()),
    );
    expect(trigger!.y).toBeLessThan(heading!.y + heading!.height);
    expect(trigger!.x).toBeGreaterThan(heading!.x);
    expect(field!.y).toBeGreaterThan(trigger!.y + trigger!.height);
    await expect(today).toBeHidden();
    await expect(importNotes).toBeHidden();
    await more.click();
    await expect(today).toBeVisible();
    await expect(importNotes).toBeVisible();
    expect((await search.boundingBox())!.y).toBe(field!.y);
  });
});

for (const { width, hasTouch } of [
  { width: 1440, hasTouch: false },
  { width: 390, hasTouch: false },
  { width: 390, hasTouch: true },
  { width: 320, hasTouch: true },
]) {
  test.describe(`${width}px ${hasTouch ? "touch" : "pointer"}`, () => {
    test.use({ viewport: { width, height: 900 }, hasTouch });
    test("slow notes keep the selection header and first rows aligned", async ({
      page,
    }) => {
      await fixture(page);
      const release = Promise.withResolvers<void>();
      await page.route("**/api/grove/memories/search", async (route) => {
        await release.promise;
        await route.fulfill({
          json: {
            success: true,
            data: {
              items: [
                note,
                {
                  ...note,
                  id: "00000000-0000-4000-a000-000000000012",
                  content: "# Second thought",
                },
              ],
              nextCursor: null,
            },
          },
        });
      });
      await page.goto(`${base}/app`);
      const skeleton = page.locator(".library-skeleton");
      const nav = page.getByRole("navigation", {
        name: "Workspace",
        exact: true,
      });
      await expect(skeleton).toBeVisible();
      expect(
        await page.evaluate(() => matchMedia("(pointer: coarse)").matches),
      ).toBe(hasTouch);
      await page.evaluate(() => document.fonts.ready.then(() => undefined));
      const status = skeleton.getByRole("status");
      await expect(status).toHaveText("Opening your notes…");
      expect(
        await status.evaluate((element) => {
          const box = element.getBoundingClientRect();
          return element.contains(
            document.elementFromPoint(box.x + 2, box.y + box.height / 2),
          );
        }),
      ).toBe(true);
      await expect(skeleton.getByRole("checkbox")).toHaveCount(0);
      const rows = page.locator(".library-list .memory-row");
      const geometry = async () =>
        Promise.all([
          page.locator(".library-list .library-selection-header").boundingBox(),
          rows.nth(0).boundingBox(),
          rows.nth(1).boundingBox(),
          nav.boundingBox(),
        ]);
      const before = await geometry();
      await expect(page.locator(".app-main > .app-footer")).toBeHidden();
      release.resolve();
      await expect(page.locator(".memory-open")).toHaveText([
        "Cached thought",
        "Second thought",
      ]);
      const after = await geometry();
      for (const [index, box] of before.entries()) {
        expect(Math.abs(after[index]!.y - box!.y)).toBeLessThanOrEqual(1);
        expect(Math.abs(after[index]!.width - box!.width)).toBeLessThanOrEqual(
          1,
        );
        expect(
          Math.abs(after[index]!.height - box!.height),
        ).toBeLessThanOrEqual(1);
      }
      await expect(page.locator(".app-main > .app-footer")).toBeVisible();
    });
  });
}

test("interrupted refresh keeps notes, selection and geometry with a keyboard retry", async ({
  page,
}) => {
  await fixture(page);
  await page.goto(`${base}/app`);
  await expect(page.locator(".memory-open")).toHaveText("Cached thought");
  const row = page.locator(".memory-list-item");
  const selection = row.getByRole("checkbox");
  await selection.check();
  const before = await row.boundingBox();
  const release = Promise.withResolvers<void>();
  await page.route("**/api/grove/memories/search", async (route) => {
    await release.promise;
    await route.fulfill({
      status: 503,
      json: { success: false, error: { message: "Temporarily unavailable" } },
    });
  });
  await invalidateNotes(page);
  await expect(page.locator(".library-refreshing")).toBeVisible();
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(page.locator(".library-refreshing")).toHaveCSS(
    "animation-name",
    "none",
  );
  await expect(page.locator(".library-refreshing")).toBeVisible();
  await expect(row).toBeVisible();
  await expect(selection).toBeChecked();
  release.resolve();
  const retry = page.getByRole("button", { name: "Retry refreshing notes" });
  await expect(retry).toBeVisible();
  expect((await row.boundingBox())?.y).toBe(before?.y);
  await expect(selection).toBeChecked();
  await page.unroute("**/api/grove/memories/search");
  await retry.focus();
  await page.keyboard.press("Enter");
  await expect(retry).toHaveCount(0);
  await expect(page.locator(".library-summary")).toBeFocused();
  await expect(selection).toBeChecked();
  expect((await row.boundingBox())?.y).toBe(before?.y);
});

test("an empty library has one next step and keeps recovery when refresh fails", async ({
  page,
}) => {
  await fixture(page);
  const release = Promise.withResolvers<void>();
  let fail = false;
  await page.route("**/api/grove/memories/search", async (route) => {
    if (fail) {
      await release.promise;
      await route.fulfill({
        status: 503,
        json: { success: false, error: { message: "Temporarily unavailable" } },
      });
    } else {
      await route.fulfill({
        json: { success: true, data: { items: [], nextCursor: null } },
      });
    }
  });
  await page.goto(`${base}/app`);
  const empty = page.getByRole("heading", {
    name: "No notes yet",
    exact: true,
  });
  const write = page.getByRole("link", {
    name: "Write your first note",
    exact: true,
  });
  await expect(empty).toBeVisible();
  await expect(write).toHaveAttribute("href", "/app/notes/new");
  await expect(page.getByText("0 notes", { exact: true })).toHaveCount(0);
  await expect(
    page.getByText("Write a note to get started.", { exact: true }),
  ).toHaveCount(0);
  const more = page.getByRole("button", { name: "More note actions" });
  await more.click();
  await expect(
    page.getByRole("button", { name: "Graph", exact: true }),
  ).toBeHidden();
  await page.keyboard.press("Escape");
  await write.focus();
  fail = true;
  await invalidateNotes(page);
  await expect(page.locator(".library-refreshing")).toBeVisible();
  await expect(write).toBeFocused();
  release.resolve();
  const retry = page.getByRole("button", { name: "Retry refreshing notes" });
  await expect(retry).toBeVisible();
  await expect(empty).toBeHidden();
  await expect(write).toBeHidden();
  fail = false;
  await retry.press("Enter");
  await expect(page.locator(".library-summary")).toBeFocused();
  await expect(empty).toBeVisible();
  await expect(write).toBeVisible();
});

test("an interrupted next page retries its cursor without replacing loaded notes", async ({
  page,
}) => {
  await fixture(page);
  const cursors: unknown[] = [];
  let fail = true;
  await page.route("**/api/grove/memories/search", async (route) => {
    const { cursor } = route.request().postDataJSON();
    cursors.push(cursor ?? null);
    if (cursor && fail) {
      await route.fulfill({
        status: 503,
        json: { success: false, error: { message: "Temporarily unavailable" } },
      });
      return;
    }
    await route.fulfill({
      json: {
        success: true,
        data: {
          items: [
            cursor
              ? {
                  ...note,
                  id: "00000000-0000-4000-a000-000000000012",
                  content: "# Next thought",
                }
              : note,
          ],
          nextCursor: cursor ? null : "next-page",
        },
      },
    });
  });
  await page.goto(`${base}/app`);
  const first = page.locator(".memory-list-item").first();
  const selection = first.getByRole("checkbox");
  await selection.check();
  const loadMore = page.getByRole("button", { name: "Load more", exact: true });
  await loadMore.scrollIntoViewIfNeeded();
  const before = await first.boundingBox();
  await loadMore.click();
  const retry = page.getByRole("button", { name: "Retry loading more notes" });
  await expect(retry).toBeVisible();
  await expect(selection).toBeChecked();
  expect((await first.boundingBox())?.y).toBe(before?.y);
  fail = false;
  await retry.focus();
  await page.keyboard.press("Enter");
  await expect(page.locator(".memory-open")).toHaveText([
    "Cached thought",
    "Next thought",
  ]);
  expect(cursors.filter((cursor) => cursor === null)).toHaveLength(1);
  expect(cursors.at(-1)).toBe("next-page");
  await expect(selection).toBeChecked();
  await expect(page.locator(".library-summary")).toBeFocused();
  await expect(retry).toHaveCount(0);
});

test("a successful replay returning a later agent edit requires explicit review and retains the original draft", async ({
  page,
}) => {
  const state = await fixture(page);
  await page.route("**/api/grove/memories", async (route) => {
    state.writes.push(route.request().postDataJSON());
    state.note = {
      ...note,
      version: 3,
      content: "Agent changed this after our save",
    };
    await route.fulfill({ json: { success: true, data: state.note } });
  });
  await page.goto(`${base}/app/memories/${note.id}?mode=edit`);
  const editor = page.getByRole("textbox", {
    name: "What should stay with you?",
  });
  await editor.fill("My original uncertain save");
  await editor.press("Control+s");
  await expect(page.locator(".revision-compare")).toContainText(
    "Agent changed this after our save",
  );
  await expect(editor).toHaveText("My original uncertain save");
  await navigate(page, "/app/settings");
  await navigate(page, `/app/memories/${note.id}?mode=edit`);
  await expect(page.locator(".revision-diff")).toBeVisible();
  await expect(editor).toHaveText("My original uncertain save");
  expect(state.writes).toHaveLength(1);
  expect(state.writes[0].expectedVersion).toBe(1);
});

test("notebook and note reads start independently and hidden mobile previews stay idle", async ({
  page,
}) => {
  const state = await fixture(page);
  const release = Promise.withResolvers<void>();
  await page.route("**/api/grove/projects/catalog?**", async (route) => {
    await release.promise;
    await route.fallback();
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${base}/app/projects/${project.id}`);
  await expect(page.locator(".memory-open")).toHaveText("Cached thought");
  expect(
    state.reads.filter((path) => path === "/memories/search"),
  ).toHaveLength(1);
  release.resolve();
  await expect(
    page.getByRole("heading", { name: project.name, exact: true }),
  ).toBeVisible();
  expect(
    state.reads.filter((path) => path === "/memories/search"),
  ).toHaveLength(1);
  await page.getByRole("button", { name: "Notebooks", exact: true }).click();
  await expect(page.locator(".notebook-pages")).toContainText("Cached thought");
  expect(
    state.reads.filter((path) => path === "/memories/search"),
  ).toHaveLength(2);
});

test("closed linked notes stay idle and expanded connections reuse batched title pages", async ({
  page,
}) => {
  const state = await fixture(page);
  const ids = Array.from(
    { length: 9 },
    (_, index) =>
      `00000000-0000-4000-a000-${String(100 + index).padStart(12, "0")}`,
  );
  const connections = ids.map((id) => ({
    id,
    level: "note",
    type: "complementary",
    reason: "Shared context",
    basis: "additional_context",
    direction: "both",
    from: { id: note.id, title: "Cached thought" },
    to: { id, title: `Linked ${id}` },
    evidence: [],
    coverage: {
      from: { total: 1, examined: 1, supporting: 1 },
      to: { total: 1, examined: 1, supporting: 1 },
    },
    breadth: "thread",
    revision: "a".repeat(64),
    reviewVersion: 0,
    dismissed: false,
    updatedAt: note.updatedAt,
  }));
  const reads: Record<string, unknown>[] = [];
  const release = Promise.withResolvers<void>();
  await page.route("**/api/grove/relationships/search", async (route) => {
    const input = route.request().postDataJSON();
    reads.push(input);
    await release.promise;
    await route.fulfill({
      json: {
        success: true,
        data: {
          items: input.cursor ? connections.slice(5) : connections.slice(0, 5),
          nextCursor: input.cursor ? null : "next",
          status: "ready",
        },
      },
    });
  });
  await page.goto(`${base}/app`);
  await page.locator(".memory-open").click();
  await expect(page.locator(".editor-preview")).toBeVisible();
  expect(reads).toHaveLength(0);
  await page.locator(".linked-notes summary").click();
  await expect.poll(() => reads.length).toBe(1);
  expect(reads[0]).toMatchObject({ endpointId: note.id, limit: 5 });
  release.resolve();
  await expect(page.locator(".connection-row")).toHaveCount(5);
  await page.getByRole("button", { name: "More connections" }).click();
  await expect(page.locator(".connection-row")).toHaveCount(9);
  expect(reads).toHaveLength(2);
  expect(reads[1].cursor).toBe("next");
  await page.locator(".linked-notes summary").click();
  await page.locator(".linked-notes summary").click();
  await expect(page.locator(".connection-row").last()).toContainText(
    `Linked ${ids.at(-1)}`,
  );
  expect(reads).toHaveLength(2);
  expect(
    state.reads.some((path) => ids.some((id) => path === `/memories/${id}`)),
  ).toBe(false);
});

test("cross-tab changes revalidate the same account without broadcasting note content", async ({
  page,
  context,
}) => {
  const first = await fixture(page);
  const other = await context.newPage();
  const second = await fixture(other);
  await page.goto(`${base}/app`);
  await other.goto(`${base}/app`);
  await expect(other.locator(".memory-open")).toHaveText("Cached thought");
  await page.evaluate(() => {
    const messages: unknown[] = [];
    Object.assign(window, { cacheMessages: messages });
    const channel = new BroadcastChannel("grove-workspace:fixture-user");
    channel.onmessage = (event) => messages.push(event.data);
  });
  first.note = { ...note, content: "# Changed in another tab", version: 2 };
  await navigate(other, `/app/memories/${note.id}?mode=edit`);
  const editor = other.getByRole("textbox", {
    name: "What should stay with you?",
  });
  await editor.fill("# Changed in another tab");
  await editor.press("Control+s");
  await expect.poll(() => second.writes.length).toBe(1);
  await expect(page.locator(".memory-open")).toHaveText(
    "Changed in another tab",
  );
  const messages = JSON.stringify(
    await page.evaluate(
      () => (window as unknown as { cacheMessages: unknown[] }).cacheMessages,
    ),
  );
  expect(messages).toContain(note.id);
  expect(messages).not.toContain("Changed in another tab");
});

test("bulk delete restores a conflicted note instead of hiding it", async ({
  page,
}) => {
  const state = await fixture(page);
  const second: Memory = {
    ...note,
    id: "00000000-0000-4000-a000-000000000012",
    content: "# Second thought\n\nStill here",
  };
  await page.route("**/api/grove/memories/search", async (route) => {
    await route.fulfill({
      json: {
        success: true,
        data: { items: [state.note, second], nextCursor: null },
      },
    });
  });
  await page.route("**/api/grove/memories/delete", async (route) => {
    const items = route.request().postDataJSON().items as { id: string }[];
    await route.fulfill({
      json: {
        success: true,
        data: {
          results: items.map((item) =>
            item.id === second.id
              ? { id: item.id, outcome: "conflict" }
              : { id: item.id, outcome: "deleted" },
          ),
        },
      },
    });
  });
  await page.goto(`${base}/app`);
  await expect(page.locator(".memory-open")).toHaveText([
    "Cached thought",
    "Second thought",
  ]);
  await page.getByLabel("Select these notes").check();
  await page
    .getByRole("group", { name: "Selected notes" })
    .getByRole("button", { name: "Delete", exact: true })
    .click();
  const dialog = page.getByRole("dialog", { name: "Delete 2 notes?" });
  await dialog
    .getByRole("button", { name: "Delete 2 notes", exact: true })
    .click();
  await expect(dialog).not.toBeVisible();
  // Both rows leave instantly; only the conflicted note snaps back, which
  // proves the rollback lifted its client tombstone before the refetch landed.
  await expect(page.locator(".memory-open")).toHaveText(["Second thought"]);
  const notifications = page.getByRole("region", { name: "Notifications" });
  await expect(notifications.locator(".workspace-toast")).toContainText(
    "changed or are no longer available",
  );
});
