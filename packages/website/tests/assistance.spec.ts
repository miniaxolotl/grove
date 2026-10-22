import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import type { Assistance, AssistanceRequest } from "@lib/shared/assistance";
import { preferencesFor } from "@lib/shared/preferences";

const base = `http://127.0.0.1:${process.env.DASHBOARD_TEST_PORT || 3101}`;
const project = {
  id: "00000000-0000-4000-8000-000000000051",
  name: "Japan trip",
  identity: "japan",
  version: 1,
  parentId: null,
};
const note = {
  id: "00000000-0000-4000-8000-000000000052",
  projectId: project.id,
  content: "Book the Kyoto train tomorrow.",
  kind: "fact",
  status: "active",
  version: 1,
  source: { agent: "website" },
  taskId: null,
  expiresAt: null,
  purgeAt: null,
  createdAt: "2026-10-22T10:00:00Z",
  updatedAt: "2026-10-22T10:00:00Z",
  indexing: "ready",
};
const ref = { id: note.id, version: 1, quote: note.content };

test("action preview is lazy, source-linked, editable and keeps its save identity after a lost reply", async ({
  page,
}, info) => {
  const requests: AssistanceRequest[] = [],
    applications: unknown[] = [];
  let current: Assistance | undefined,
    lose = true;
  await page.route("**/api/grove/**", async (route) => {
    const path = new URL(route.request().url()).pathname,
      body = route.request().postDataJSON();
    let data: unknown = {};
    if (path.endsWith("/projects")) data = [project];
    else if (path.endsWith("/me"))
      data = { accountId: "assistance-owner", ...preferencesFor({}) };
    else if (path.endsWith("/memories/search"))
      data = { items: [note], nextCursor: null };
    else if (path.endsWith(`/memories/${note.id}`)) data = note;
    else if (path.endsWith("/assistance")) {
      requests.push(body);
      current = {
        id: body.id,
        kind: "actions",
        status: "ready",
        version: 2,
        error: null,
        applied: [],
        progress: 1,
        result: {
          items: [{ text: note.content, sources: [ref] }],
          coverage: { total: 1, examined: 1 },
        },
      };
      data = current;
    } else if (path.endsWith("/apply")) {
      applications.push(body);
      if (lose) {
        lose = false;
        await route.abort();
        return;
      }
      current = {
        ...current!,
        status: "applied",
        version: 3,
        applied: [{ id: note.id, version: 1 }],
      };
      data = current;
    } else if (path.endsWith("/undo")) {
      current = { ...current!, status: "undone", version: 4 };
      data = current;
    } else if (path.includes("/assistance/")) data = current;
    await route.fulfill({ json: { success: true, data } });
  });
  await page.goto(`${base}/app`);
  expect(requests).toHaveLength(0);
  await page.getByRole("checkbox", { name: "Select these notes" }).check();
  await page
    .getByRole("button", { name: "Extract action list", exact: true })
    .click();
  const dialog = page.getByRole("dialog", { name: "Action list", exact: true });
  await expect(dialog.getByRole("textbox", { name: "Action 1" })).toHaveValue(
    note.content,
  );
  await dialog.getByText("Sources", { exact: true }).click();
  await expect(
    dialog.getByRole("link", { name: "Revision 1" }),
  ).toHaveAttribute("href", `/app/memories/${note.id}?revision=1`);
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(
      dialog.getByRole("button", { name: "Save action list" }),
    ).toBeInViewport();
    expect(
      (
        await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
          .analyze()
      ).violations,
    ).toEqual([]);
    await page.screenshot({
      path: info.outputPath(`action-list-${width}.png`),
    });
  }
  await dialog
    .getByRole("textbox", { name: "Action 1" })
    .fill("Ask about Kyoto train tickets.");
  await expect(dialog.getByText("Edited", { exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "Save action list" }).click();
  await expect(dialog.getByRole("alert")).toBeVisible();
  await dialog.getByRole("button", { name: "Save action list" }).click();
  await expect(
    dialog.getByRole("button", { name: "Undo", exact: true }),
  ).toBeVisible();
  expect(applications).toHaveLength(2);
  expect(applications[0]).toEqual(applications[1]);
  await dialog.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(dialog.getByText("Undone", { exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "Close dialog" }).click();
  await expect(
    page.getByRole("button", { name: "Extract action list", exact: true }),
  ).toBeFocused();
});

test("visible notebook visits freeze once; history and cleanup use compact evidence previews", async ({
  page,
}, info) => {
  let visits = 0,
    generation = 0,
    current: Assistance | undefined;
  const visitId = "00000000-0000-4000-8000-000000000053";
  await page.route("**/api/grove/**", async (route) => {
    const path = new URL(route.request().url()).pathname,
      body = route.request().postDataJSON();
    let data: unknown = {};
    if (path.endsWith("/projects")) data = [project];
    else if (path.endsWith("/me"))
      data = { accountId: "assistance-owner", ...preferencesFor({}) };
    else if (path.endsWith("/memories/search"))
      data = {
        items: [note],
        nextCursor: null,
        visit: { projectId: project.id, token: "4", from: "1", ready: true },
      };
    else if (path.endsWith("/notebook-visits")) {
      visits++;
      data = {
        id: visitId,
        projectId: project.id,
        from: "1",
        to: "4",
        baseline: false,
        at: "2026-10-22T10:00:00Z",
      };
    } else if (path.endsWith("/assistance")) {
      generation++;
      current = {
        id: body.id,
        kind: body.kind,
        status: "ready",
        version: 2,
        error: null,
        applied: [],
        progress: 1,
        result: {
          coverage: { total: 2, examined: 2 },
          ...(body.kind === "digest"
            ? {
                changes: [
                  {
                    id: note.id,
                    kind: "edited",
                    before: 1,
                    after: 2,
                    at: "2026-10-22T10:00:00Z",
                    title: "Kyoto train",
                    beforeContent: "Take the night train.",
                    afterContent: "Take the daytime train.",
                  },
                ],
                summary: { items: [] },
              }
            : {
                candidates: [
                  {
                    key: "pair",
                    kind: "duplicate",
                    reason: "Same train plan.",
                    evidence: [ref],
                    replacement: [],
                    content: note.content,
                    sources: [ref],
                    target: ref,
                    before: note.content,
                    dismissed: false,
                    reviewVersion: 0,
                  },
                ],
              }),
        },
      };
      data = current;
    } else if (path.endsWith("/review")) {
      current!.result!.candidates![0] = {
        ...current!.result!.candidates![0],
        dismissed: body.dismissed,
        reviewVersion: body.expectedVersion + 1,
      };
      data = current;
    } else if (path.includes("/assistance/")) data = current;
    await route.fulfill({ json: { success: true, data } });
  });
  await page.goto(`${base}/app/projects/${project.id}`);
  await expect.poll(() => visits).toBe(1);
  expect(generation).toBe(0);
  await page.getByRole("button", { name: "Notebook options" }).click();
  await page
    .getByRole("button", { name: "Since your last visit", exact: true })
    .click();
  const history = page.getByRole("dialog", {
    name: "Since your last visit",
    exact: true,
  });
  await history.getByText("edited", { exact: true }).click();
  await expect(
    history.getByText("Take the night train.", { exact: true }),
  ).toBeVisible();
  await expect(
    history.getByText("Take the daytime train.", { exact: true }),
  ).toBeVisible();
  await page.setViewportSize({ width: 320, height: 900 });
  await page.screenshot({ path: info.outputPath("digest-320.png") });
  await history.getByRole("button", { name: "Close dialog" }).click();
  await page.getByRole("button", { name: "Notebook options" }).click();
  await page
    .getByRole("button", { name: "Review notebook", exact: true })
    .click();
  const cleanup = page.getByRole("dialog", {
    name: "Review notebook",
    exact: true,
  });
  await cleanup.getByText("Preview changes", { exact: true }).click();
  await expect(
    cleanup.getByRole("heading", { name: "Proposed note" }),
  ).toBeVisible();
  await page.screenshot({ path: info.outputPath("cleanup-320.png") });
  await cleanup.getByRole("button", { name: "Keep both", exact: true }).click();
  await cleanup.getByRole("button", { name: "Show kept notes" }).click();
  await cleanup.getByRole("button", { name: "Undo keep both" }).click();
  await expect(
    cleanup.getByRole("button", { name: "Keep both", exact: true }),
  ).toBeVisible();
  expect(visits).toBe(1);
  expect(generation).toBe(2);
});

test("filing suggestion is requested from the existing move chooser and can abstain", async ({
  page,
}) => {
  let current: Assistance | undefined,
    calls = 0;
  await page.route("**/api/grove/**", async (route) => {
    const path = new URL(route.request().url()).pathname,
      body = route.request().postDataJSON();
    let data: unknown = {};
    if (path.endsWith("/projects")) data = [project];
    else if (path.endsWith("/me"))
      data = { accountId: "assistance-owner", ...preferencesFor({}) };
    else if (path.endsWith("/memories/search"))
      data = { items: [{ ...note, projectId: null }], nextCursor: null };
    else if (path.endsWith(`/memories/${note.id}`))
      data = { ...note, projectId: null };
    else if (path.endsWith("/assistance")) {
      calls++;
      current = {
        id: body.id,
        kind: "filing",
        status: "ready",
        version: 2,
        result: {
          filing: { destination: [], reason: "", evidence: [] },
          coverage: { total: 1, examined: 1 },
        },
        applied: [],
        error: null,
        progress: 1,
      };
      data = current;
    } else if (path.includes("/assistance/")) data = current;
    await route.fulfill({ json: { success: true, data } });
  });
  await page.goto(`${base}/app`);
  await page.getByRole("checkbox", { name: "Select these notes" }).check();
  await page.getByRole("button", { name: "Move", exact: true }).first().click();
  expect(calls).toBe(0);
  await page.getByRole("button", { name: "Suggest a notebook" }).click();
  const dialog = page.getByRole("dialog", { name: "Suggested notebook" });
  await expect(dialog.getByText("No clear match.")).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Move here" })).toHaveCount(
    0,
  );
  await dialog.getByRole("button", { name: "Close dialog" }).click();
  await expect(
    page.getByRole("button", { name: "Suggest a notebook" }),
  ).toBeFocused();
});
