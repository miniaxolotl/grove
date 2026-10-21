import AxeBuilder from "@axe-core/playwright";
import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { chooseOption } from "./fixtures/select";
import {
  listSchema,
  projectSchema,
  rememberSchema,
  versionSchema,
  type Memory,
} from "@lib/shared/contracts";
import { askSchema, briefRequestSchema } from "@lib/shared/models";
import {
  conversationCreateSchema,
  conversationTurnSchema,
  type Conversation,
} from "@lib/shared/conversations";

const base = `http://127.0.0.1:${process.env.DASHBOARD_TEST_PORT || 3101}`;
const project = {
  id: "00000000-0000-4000-a000-000000000010",
  name: "Website redesign",
  identity: "git:github.com/example/website",
  parentId: null as string | null,
  version: 1,
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
  await expect(menu.locator("button, a").first()).toBeFocused();
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
      ".workspace-utilities > .app-icon",
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
    await drawer.getByRole("button", { name: "Edit note", exact: true }).tap();
    const editor = drawer.getByRole("textbox", {
      name: "What should stay with you?",
    });
    await editor.fill("A soft landing");
    await editor.press("Home");
    for (let i = 0; i < 6; i++) await editor.press("Shift+ArrowRight");
    await drawer.getByRole("button", { name: "Bold", exact: true }).tap();
    await expect(editor).toHaveText("**A soft** landing");
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
    await drawer
      .getByRole("button", { name: "Note actions", exact: true })
      .tap();
    await page
      .getByRole("button", { name: "Hide note properties", exact: true })
      .tap();
    await page.setViewportSize({ width: 320, height: 750 });
    expect(
      await drawer.evaluate((el) => el.scrollWidth <= el.clientWidth),
    ).toBe(true);
    expect(
      (await drawer.locator(".writing-layout").boundingBox())!.height,
    ).toBeGreaterThan(400);
    await page.screenshot({ path: info.outputPath("compact-reader-320.png") });
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
    for (const name of ["Export", "Delete note…"]) {
      const control = page.getByRole("button", { name, exact: true });
      await expect(control).toBeInViewport();
      const bounds = (await control.boundingBox())!;
      expect(bounds.width).toBeGreaterThanOrEqual(44);
      expect(bounds.height).toBeGreaterThanOrEqual(44);
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
  await page.getByRole("button", { name: "Delete note…", exact: true }).click();
  const confirm = page.getByRole("dialog", { name: "Delete note?" });
  await confirm.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Delete note…", exact: true }),
  ).toBeFocused();
  await page.getByRole("button", { name: "Export", exact: true }).click();
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
    page.getByRole("button", { name: "Export", exact: true }),
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
    drawer.getByRole("link", { name: "Launch checklist" }),
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
  await drawer.getByRole("button", { name: "Export", exact: true }).click();
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
    drawer.getByRole("button", { name: "Edit note", exact: true }),
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
  await page.getByRole("button", { name: "Delete note…", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Delete note?" });
  await expect(dialog).toContainText("local draft");
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(editor).toContainText("exceeds the save limit");
  await page.getByRole("button", { name: "Delete note…", exact: true }).click();
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
  await page.getByRole("button", { name: "Delete note…", exact: true }).click();
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
  expect(await readFile((await (await download).path())!, "utf8")).toBe(
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
  await page.getByRole("button", { name: "Export", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Export note", exact: true });
  await expect(dialog).toContainText("Includes unsaved changes");
  const download = page.waitForEvent("download");
  await dialog
    .getByRole("button", { name: "Markdown (.md)", exact: true })
    .click();
  const file = await download;
  expect(file.suggestedFilename()).toBe("note-CON.md");
  expect(await readFile((await file.path())!, "utf8")).toBe(content);
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
  await page.getByRole("button", { name: "Export", exact: true }).click();
  await expect(dialog).toContainText("Includes unsaved changes");
  gate.resolve();
  await expect(page).toHaveURL(/\/app\/memories\/[^/]+\?mode=edit$/);
  await expect(dialog).toBeVisible();
  const download = page.waitForEvent("download");
  await dialog
    .getByRole("button", { name: "Markdown (.md)", exact: true })
    .click();
  expect(await readFile((await (await download).path())!, "utf8")).toBe(
    "# First save export",
  );
  const pdfDownload = page.waitForEvent("download");
  await dialog.getByRole("button", { name: "PDF (.pdf)", exact: true }).click();
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const loading = getDocument({
    data: new Uint8Array(await readFile((await (await pdfDownload).path())!)),
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
  await page.getByRole("button", { name: "Export", exact: true }).click();
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
  await page.getByRole("button", { name: "Export", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Export note", exact: true });
  const pending = page.waitForEvent("download");
  await dialog.getByRole("button", { name: "PDF (.pdf)", exact: true }).click();
  const download = await pending;
  // WebKit normalizes spaces in download filenames to underscores.
  expect(download.suggestedFilename()).toMatch(/^Café[ _]review\.pdf$/);
  await download.saveAs(info.outputPath("note.pdf"));
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const loading = getDocument({
    data: new Uint8Array(await readFile((await download.path())!)),
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
  await page.getByRole("button", { name: "Export", exact: true }).click();
  expect(fonts).toEqual([]);
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "PDF (.pdf)", exact: true }).click();
  const file = await download;
  await file.saveAs(info.outputPath("focused-note.pdf"));
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const loading = getDocument({
    data: new Uint8Array(await readFile((await file.path())!)),
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
  await page.getByRole("button", { name: "Export", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Export note", exact: true });
  await dialog.getByRole("button", { name: "PDF (.pdf)", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText(
    "Could not prepare the PDF",
  );
  const markdown = page.waitForEvent("download");
  await dialog
    .getByRole("button", { name: "Markdown (.md)", exact: true })
    .click();
  expect(await readFile((await (await markdown).path())!, "utf8")).toContain(
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
  await page.getByRole("button", { name: "Export", exact: true }).click();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "PDF (.pdf)", exact: true }).click();
  const file = await download;
  await file.saveAs(info.outputPath("wide-table.pdf"));
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const loading = getDocument({
    data: new Uint8Array(await readFile((await file.path())!)),
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
    page.getByRole("button", { name: "Edit note", exact: true }),
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
      page.getByRole("button", { name: "Edit note", exact: true }),
    ).toBeInViewport();
    await expect(
      page.getByRole("button", { name: "Back to notes", exact: true }),
    ).toBeInViewport();
    const position = await paper.evaluate((element) => element.scrollTop);
    await page.getByRole("button", { name: "Edit note", exact: true }).click();
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
  ).toBeVisible();
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
    if (path === "/conversations") {
      if (request.method() === "POST") {
        const { id, ...scope } = conversationCreateSchema.parse(body);
        if (!chats.has(id))
          chats.set(id, {
            id,
            scope,
            title: "New conversation",
            version: 0,
            updatedAt: new Date().toISOString(),
            turns: [],
          });
        data = chats.get(id);
      } else data = { items: [...chats.values()].reverse(), nextCursor: null };
    } else if (path.startsWith("/conversations/")) {
      const chat = chats.get(path.split("/")[2])!;
      if (request.method() === "DELETE") {
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
  return { records, calls, projects, chats };
}

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
  await page.getByRole("button", { name: "Read note", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("Review preferences");
  await expect(page.getByRole("dialog")).toBeInViewport();
  await page.keyboard.press("Escape");
  await page
    .getByRole("button", { name: "Exit full screen", exact: true })
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
  await drawer.getByRole("button", { name: "Edit note", exact: true }).click();
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
      page.getByRole("button", { name: "Exit full screen", exact: true }),
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
      },
    })),
  });
  await page.goto(`${base}/app/ask`);
  await page.getByRole("button", { name: "History", exact: true }).click();
  await page.getByRole("button", { name: /^Reading thread/ }).click();
  const log = page.getByRole("log", { name: "Conversation" });
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
  await drawer.getByRole("button", { name: "Export", exact: true }).click();
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
  await question.press("Enter");
  await expect(page.locator(".ask-statement")).toHaveCount(2);
  expect(
    [...state.chats.values()][0].turns.map((turn) => turn.question),
  ).toEqual(["How should I give feedback?", "Tell me more about that"]);
  for (const width of [1440, 320]) {
    await page.setViewportSize({ width, height: 1000 });
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
  await question.press("Enter");
  await started.promise;
  await page
    .getByRole("button", { name: "New conversation", exact: true })
    .click();
  gate.resolve();
  await expect(page.locator(".ask-turn")).toHaveCount(0);
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await page.getByLabel("Search saved notes").fill("feedback");
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
  await input.press("Enter");
  await expect(page.locator(".ask-statement")).toContainText("working example");
  await input.fill("Shorten that note");
  await input.press("Enter");
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
  await input.press("Enter");
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
  await expect(page.getByRole("dialog")).toContainText(
    "Your conversations will appear here",
  );
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
  await dialog.getByLabel("Search your Grove").fill("review");
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
  await dialog.getByLabel("Search your Grove").fill("Summarize my review note");
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
  await expect(page.getByRole("combobox", { name: "Sort notes" })).toHaveText(
    "Date written",
  );
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
  await page.getByRole("button", { name: "Edit note", exact: true }).click();
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
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("textbox")).toHaveCount(0);
  await expect(
    dialog.locator("strong").filter({ hasText: "specific" }),
  ).toBeVisible();
  await expect(dialog.getByText(note.id, { exact: true })).not.toBeVisible();
  await dialog.getByRole("button", { name: "Note properties" }).click();
  await dialog.getByText("Agent details", { exact: true }).click();
  await expect(dialog.getByText(note.id, { exact: true })).toBeVisible();
  await dialog.getByText("Agent details", { exact: true }).click();
  await dialog.getByRole("button", { name: "Note properties" }).click();
  await page.screenshot({ path: info.outputPath("reader-desktop.png") });
  await dialog.getByRole("button", { name: "Edit note", exact: true }).click();
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
  await dialog.getByRole("button", { name: "Edit note", exact: true }).click();
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
    .getByRole("complementary", { name: "Note outline" })
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
  await page.getByRole("button", { name: "Edit note", exact: true }).click();
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
  await page.getByLabel("Search notes").fill("keyboard access");
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
      sort: "updated_desc",
    });
  expect(page.url()).toBe(`${base}/app`);
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
  await page.getByRole("button", { name: "Save note", exact: true }).click();
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
  await page.getByRole("link", { name: "New note", exact: true }).click();
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
    .getByRole("link", { name: "Manage", exact: true })
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
  await page
    .getByRole("region", { name: "Your notebooks" })
    .getByRole("link", { name: "Manage", exact: true })
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
    await touch(
      "touchMove",
      bounds.x + bounds.width / 2,
      bounds.y + bounds.height - 8,
    );
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
    const target = (await destination.boundingBox())!;
    await touch(
      "touchMove",
      target.x + target.width / 2,
      target.y + target.height / 2,
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
    const buttons = page.locator(".row-controls button");
    await buttons.first().tap();
    await buttons.nth(1).tap();
    await expect(
      page.getByRole("button", { name: "Close actions", exact: true }),
    ).toHaveCount(1);
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
    await expect(
      page.getByRole("button", { name: "Close actions" }),
    ).toHaveCount(0);
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
  await expect(
    page.getByRole("button", { name: "Close actions" }),
  ).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.screenshot({
    path: info.outputPath("touch-actions.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "Close actions" }).click();
  await touch("touchStart");
  await touch("touchMove", -25);
  await touch("touchCancel");
  await expect(page.getByRole("button", { name: "Close actions" })).toHaveCount(
    0,
  );
  await touch("touchStart");
  await touch("touchMove", 2, -80);
  await touch("touchEnd");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Close actions" })).toHaveCount(
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
