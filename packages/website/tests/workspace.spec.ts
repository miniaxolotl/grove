import AxeBuilder from "@axe-core/playwright";
import { test, expect, type Page } from "@playwright/test";
import {
  listSchema,
  projectSchema,
  rememberSchema,
  versionSchema,
  type Memory,
} from "@lib/shared/contracts";
import { askSchema, briefRequestSchema } from "@lib/shared/models";

const base = `http://127.0.0.1:${process.env.DASHBOARD_TEST_PORT || 3101}`;
const project = {
  id: "00000000-0000-4000-a000-000000000010",
  name: "Website redesign",
  identity: "git:github.com/example/website",
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
        .querySelector(".library-places")!
        .getBoundingClientRect();
      const main = document
        .querySelector(".library-main")!
        .getBoundingClientRect();
      return {
        overflow: document.documentElement.scrollWidth > innerWidth,
        separated: places.right <= main.left || places.bottom <= main.top,
        font: getComputedStyle(document.querySelector("h1")!).fontFamily,
      };
    });
    expect(geometry.overflow).toBe(false);
    expect(geometry.separated).toBe(true);
    expect(geometry.font.toLowerCase()).toContain("inter");
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
  ).toHaveCount(0);
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
  await page
    .getByRole("combobox", { name: "Source", exact: true })
    .selectOption("website");
  await page.getByLabel("Last updated").selectOption("7");
  await page
    .getByRole("combobox", { name: "Keep for", exact: true })
    .selectOption("ephemeral");
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
  const handle = page.locator(".drag-handle");
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
  await expect(page.locator('[data-destination="personal"]')).toHaveAttribute(
    "data-drop-active",
    "true",
  );
  await page.keyboard.press("ArrowDown");
  await expect(
    page.locator(`[data-destination="${project.id}"]`),
  ).toHaveAttribute("data-drop-active", "true");
  await page.keyboard.press("Space");
  await expect(page.locator(".workspace-notice")).toContainText("1 note moved");
  expect(state.records.get(note.id)?.projectId).toBe(project.id);
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
  await expect(dialog.getByLabel("Keep this note")).toHaveValue("permanent");
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
  await page.getByRole("button", { name: "New note", exact: true }).click();
  await dialog
    .getByLabel("What should stay with you?")
    .fill("Temporary review context");
  await dialog.getByText("Note options", { exact: true }).click();
  await dialog.getByLabel("Keep this note").selectOption("ephemeral");
  await dialog.getByLabel("Expires after").selectOption("7");
  await dialog.getByRole("button", { name: "Save note", exact: true }).click();
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
    if (path === "/projects") {
      if (request.method() === "POST") {
        const input = projectSchema.parse(body);
        const created = { id: crypto.randomUUID(), ...input };
        projects.push(created);
        data = created;
      } else data = projects;
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
  return { records, calls, projects };
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
  await page
    .getByRole("combobox", { name: "Graph relationships" })
    .selectOption("duplicate");
  await expect(page.locator(".react-flow__node")).toHaveCount(0);
  await expect(page.getByText("No matching connections here.")).toBeVisible();
  await page
    .getByRole("combobox", { name: "Graph relationships" })
    .selectOption("conflicting");
  await expect(page.locator(".react-flow__edge")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("Ask Grove cites saved notes, scopes follow-ups, searches automatically and discards cancelled answers", async ({
  page,
}, info) => {
  const state = await fixture(page);
  const calls: ReturnType<typeof askSchema.parse>[] = [];
  const started = Promise.withResolvers<void>();
  const gate = Promise.withResolvers<void>();
  await page.route("**/api/grove/ask", async (route) => {
    const input = askSchema.parse(route.request().postDataJSON());
    calls.push(input);
    if (input.query === "Wait for this") {
      started.resolve();
      await gate.promise;
    }
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
  await page
    .getByRole("combobox", { name: "Look in notebook" })
    .selectOption(project.id);
  await page.getByLabel("Include personal notes").uncheck();
  const question = page.getByLabel("Ask about your notes");
  await question.fill("How should I give feedback?");
  await page.getByRole("button", { name: "Send question" }).click();
  await expect(page.locator(".ask-statement")).toContainText("working example");
  expect(calls[0]).toMatchObject({
    projectId: project.id,
    includePersonal: false,
    previousQuestions: [],
  });
  state.records.set(note.id, { ...note, version: 2 });
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
  expect(calls[1].previousQuestions).toEqual(["How should I give feedback?"]);
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

test("a journal entry is an editable personal note, with options kept secondary", async ({
  page,
}, info) => {
  const state = await fixture(page, []);
  await page.goto(`${base}/app/journal`);
  await page.getByRole("button", { name: "New entry", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByLabel("What should stay with you?")).toHaveValue(
    /^# .+/,
  );
  await expect(dialog.getByLabel("Keep this note")).not.toBeVisible();
  await dialog
    .getByLabel("What should stay with you?")
    .fill("# A quiet afternoon\n\nA long walk and a new idea.");
  await dialog.getByRole("button", { name: "Save note" }).click();
  await expect(page.locator(".journal-entry")).toContainText(
    "A quiet afternoon",
  );
  expect(
    state.calls.find((call) => call.path === "/memories")?.body,
  ).toMatchObject({
    projectId: null,
    source: { agent: "website" },
    retentionDays: null,
    autoKind: false,
  });
  await page.screenshot({
    path: info.outputPath("journal-desktop.png"),
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
  await expect(page.getByLabel("What should stay with you?")).toHaveValue(
    /A reviewed replacement/,
  );
  await page
    .getByRole("button", { name: "Keep my draft to replace it" })
    .click();
  await page.getByRole("button", { name: "Save note" }).click();
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
  await dialog.getByText("Agent details", { exact: true }).click();
  await expect(dialog.getByText(note.id, { exact: true })).toBeVisible();
  await dialog.getByText("Agent details", { exact: true }).click();
  await page.screenshot({ path: info.outputPath("reader-desktop.png") });
  await dialog.getByRole("button", { name: "Edit note", exact: true }).click();
  const editor = dialog.getByLabel("What should stay with you?");
  await editor.fill("A useful note");
  await editor.selectText();
  await dialog.getByRole("button", { name: "Bold", exact: true }).click();
  await expect(editor).toHaveValue("**A useful note**");
  await editor.press("Control+z");
  await expect(editor).toHaveValue("A useful note");
  await editor.press("Control+Shift+z");
  await expect(editor).toHaveValue("**A useful note**");
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
  await expect(dialog).toHaveCount(0);
  await expect(
    page.locator(".memory-open").filter({ hasText: "A revised preference" }),
  ).toBeVisible();
});

test("combined project, kind, topic and query filters stay in POST bodies and clear independently", async ({
  page,
}) => {
  const state = await fixture(page);
  await page.goto(`${base}/app`);
  await expect(page.locator(".memory-open")).toHaveCount(2);
  await page.getByRole("button", { name: "Filters", exact: true }).click();
  await page
    .getByRole("combobox", { name: "Notebook", exact: true })
    .selectOption(project.id);
  await page
    .getByRole("combobox", { name: "Note type" })
    .selectOption("handoff");
  await page.getByLabel("Topic tag").fill("frontend");
  await page.getByRole("button", { name: "Apply tag" }).click();
  await page.getByLabel("Search notes").fill("keyboard access");
  await expect(page.locator(".memory-open")).toHaveCount(1);
  await expect(
    page.getByText("Words + meaning", { exact: false }),
  ).toBeVisible();
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
  await page
    .getByRole("combobox", { name: "Notebook", exact: true })
    .selectOption("personal");
  await expect(page.locator(".memory-open")).toHaveCount(1);
  await expect(page.locator(".memory-open")).toContainText(
    "Review preferences",
  );
  expect(
    state.calls.filter((call) => call.path === "/memories/search").at(-1)?.body
      .projectId,
  ).toBeNull();
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
  await page
    .getByRole("combobox", { name: "Notebook", exact: true })
    .selectOption(project.id);
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
  const source = (await page.locator(".drag-handle").first().boundingBox())!;
  const target = (await page
    .getByRole("button", { name: project.name, exact: true })
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
    page.locator(`[data-destination="${project.id}"]`),
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
  await page.goto(`${base}/app`);
  await page.getByRole("button", { name: "New note", exact: true }).click();
  await page
    .getByLabel("What should stay with you?")
    .fill("# Release handoff\n\nReady for review.");
  await page.getByText("Note options", { exact: true }).click();
  await page
    .getByRole("combobox", { name: "Note type", exact: true })
    .selectOption("handoff");
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
    .getByRole("button", { name: "Save notebook", exact: true })
    .click();
  await expect(
    page.getByRole("link", { name: /Research notes/ }),
  ).toBeVisible();
  expect(state.projects.at(-1)?.identity).toMatch(/^workspace:/);
  await page.getByRole("link", { name: /Website redesign/ }).click();
  await expect(
    page.getByRole("heading", { name: project.name, exact: true }),
  ).toBeVisible();
  await expect(page.getByText(project.identity)).not.toBeVisible();
  await page.screenshot({
    path: info.outputPath("project-desktop.png"),
    fullPage: true,
  });
  await page
    .getByRole("navigation", { name: "Workspace views" })
    .getByRole("button", { name: "Notes", exact: true })
    .click();
  await expect(page.locator(".memory-open")).toHaveCount(1);
  await page
    .getByRole("navigation", { name: "Workspace views" })
    .getByRole("button", { name: "In progress", exact: true })
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
  await page
    .getByRole("combobox", { name: "Destination", exact: true })
    .selectOption(project.id);
  await page.getByRole("button", { name: "Move here" }).click();
  await expect(page.locator(".workspace-notice")).toContainText("1 note moved");
});
