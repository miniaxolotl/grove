import AxeBuilder from "@axe-core/playwright";
import { test, expect, type Page } from "@playwright/test";
import {
  listSchema,
  projectSchema,
  rememberSchema,
  versionSchema,
  type Memory,
} from "@lib/shared/contracts";
import { briefRequestSchema } from "@lib/shared/models";

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

async function fixture(page: Page, initial = [note, handoff]) {
  const records = new Map(
    initial.map((memory) => [memory.id, structuredClone(memory)]),
  );
  const projects = [structuredClone(project)];
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
          m.status === input.status &&
          (!input.query ||
            m.content.toLowerCase().includes(input.query.toLowerCase())),
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
        autoKind: input.autoKind,
        taskId: input.taskId ?? null,
        projectId: input.projectId,
        source: input.source,
        version: (previous?.version ?? 0) + 1,
        enrichment: undefined,
      };
      records.set(saved.id, saved);
      data = saved;
    } else if (/\/(archive|restore)$/.test(path)) {
      const input = versionSchema.parse(body);
      const previous = records.get(path.split("/")[2])!;
      if (previous.version !== input.expectedVersion) return conflict();
      const saved: Memory = {
        ...previous,
        version: previous.version + 1,
        status: path.endsWith("/archive") ? "archived" : "active",
      };
      records.set(saved.id, saved);
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
    } else if (path.startsWith("/memories/"))
      data = records.get(path.split("/")[2]);
    else throw new Error(`Unexpected fixture request: ${path}`);
    await route.fulfill({ json: { success: true, data } });
  });
  return { records, calls, projects };
}

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
  await dialog
    .getByRole("button", { name: "Edit memory", exact: true })
    .click();
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
  await dialog
    .getByRole("button", { name: "Save memory", exact: true })
    .click();
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
    .getByRole("combobox", { name: "Project", exact: true })
    .selectOption(project.id);
  await page
    .getByRole("combobox", { name: "Memory kind" })
    .selectOption("handoff");
  await page.getByLabel("Topic tag").fill("frontend");
  await page.getByRole("button", { name: "Apply tag" }).click();
  await page.getByLabel("Search memories").fill("keyboard access");
  await page.getByRole("button", { name: "Search", exact: true }).click();
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
    });
  expect(page.url()).toBe(`${base}/app`);
  await page
    .getByRole("button", { name: "Clear filters", exact: true })
    .click();
  await page
    .getByRole("combobox", { name: "Project", exact: true })
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
    .getByRole("combobox", { name: "Project", exact: true })
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
  await page.getByLabel("Select loaded memories").check();
  await page
    .locator(".drag-handle")
    .first()
    .dragTo(page.getByRole("button", { name: project.name, exact: true }));
  await expect(page.locator(".workspace-notice")).toContainText(
    "2 memories moved",
  );
  const moves = state.calls.filter((call) => call.path === "/memories");
  expect(moves.map((call) => call.body.projectId)).toEqual([
    project.id,
    project.id,
  ]);
  expect(moves[1].body).toMatchObject({
    taskId: handoff.taskId,
    kind: "handoff",
    source: handoff.source,
    content: handoff.content,
    expectedVersion: 1,
  });
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
  await page.getByLabel("Select loaded memories").check();
  state.records.set(handoff.id, {
    ...handoff,
    version: 2,
    content: "Agent updated the handoff",
  });
  await page
    .getByRole("group", { name: "Selected memories" })
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
  await page.getByRole("button", { name: "Add memory", exact: true }).click();
  await page
    .getByLabel("What should stay with you?")
    .fill("# Release handoff\n\nReady for review.");
  await page
    .getByRole("combobox", { name: "Kind", exact: true })
    .selectOption("handoff");
  await page.getByRole("button", { name: "Save memory", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Close dialog" }),
  ).toBeDisabled();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toBeVisible();
  gate.resolve();
  await expect(page.getByRole("alert")).toContainText("Please retry");
  await page.getByRole("button", { name: "Save memory", exact: true }).click();
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
  await page.getByRole("button", { name: "Add project", exact: true }).click();
  await page.getByLabel("Project name").fill("Research notes");
  await expect(page.getByLabel("Repository identity")).not.toBeVisible();
  await page.getByRole("button", { name: "Save project", exact: true }).click();
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
  await page.getByRole("button", { name: "Memories", exact: true }).click();
  await expect(page.locator(".memory-open")).toHaveCount(1);
  await page.getByRole("button", { name: "Handoffs", exact: true }).click();
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
  const row = page.locator(".memory-row").first();
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
  await expect(page.locator(".workspace-notice")).toContainText(
    "1 memory moved",
  );
});
