import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import type { Assistance, AssistanceRequest } from "@lib/shared/assistance";
import { preferencesFor } from "@lib/shared/preferences";

const base = `http://127.0.0.1:${process.env.DASHBOARD_TEST_PORT || 3101}`;
const project = {
  id: "00000000-0000-4000-8000-000000000081",
  name: "Launch notes",
  identity: "launch",
  version: 1,
  parentId: null,
};
const note = {
  id: "00000000-0000-4000-8000-000000000082",
  version: 1,
  quote: "Use a staged launch after the migration rehearsal.",
};

test("general brief starts only on request, shows sources/coverage and keeps enqueue and save replay identities", async ({
  page,
}, info) => {
  const requests: AssistanceRequest[] = [],
    applications: unknown[] = [];
  let current: Assistance | undefined,
    loseRequest = true,
    loseSave = true;
  await page.route("**/api/grove/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    const body = route.request().postDataJSON();
    let data: unknown = {};
    if (path.endsWith("/projects")) data = [project];
    else if (path.endsWith("/me"))
      data = {
        accountId: "meeting-owner",
        ...preferencesFor({ preparationEnabled: true }),
        aiAvailability: { generation: true },
      };
    else if (path.endsWith("/memories/search"))
      data = { items: [], nextCursor: null };
    else if (path.endsWith("/assistance")) {
      requests.push(body);
      current = {
        id: body.id,
        kind: "preparation",
        status: "ready",
        version: 2,
        error: null,
        applied: [],
        progress: 0,
        result: {
          coverage: {
            total: 14,
            examined: 2,
            supplied: 2,
            cited: 1,
            partial: true,
            reason:
              "Only supplied notes were reviewed. Select exact notes to review other evidence.",
          },
          preparation: {
            sections: [
              {
                heading: "Research context",
                items: [
                  {
                    text: "Use a staged launch after the migration rehearsal.",
                    sources: [note],
                  },
                ],
              },
            ],
          },
        },
      };
      if (loseRequest) {
        loseRequest = false;
        await route.abort();
        return;
      }
      data = current;
    } else if (path.endsWith("/apply")) {
      applications.push(body);
      if (loseSave) {
        loseSave = false;
        await route.abort();
        return;
      }
      current = {
        ...current!,
        status: "applied",
        version: 3,
        result: null,
        applied: [{ id: note.id, version: 1 }],
      };
      data = current;
    } else if (path.endsWith("/undo")) {
      current = { ...current!, status: "undone", version: 4 };
      data = current;
    } else if (path.includes("/assistance/")) data = current;
    await route.fulfill({ json: { success: true, data } });
  });
  await page.goto(`${base}/app/projects/${project.id}`);
  await page.getByRole("button", { name: "Notebook options" }).click();
  await page
    .getByRole("button", { name: "Tools for these notes", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Open Create a brief", exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "Create a brief",
    exact: true,
  });
  expect(requests).toHaveLength(0);
  await dialog
    .getByRole("textbox", { name: "What should this brief help you do?" })
    .fill("Review rollout risks and migration decisions.");
  await page.screenshot({ path: info.outputPath("meeting-form-desktop.png") });
  await dialog
    .getByRole("button", { name: "Create brief", exact: true })
    .click();
  await expect(dialog.getByRole("alert")).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: "Edit tool inputs", exact: true }),
  ).toBeDisabled();
  await dialog
    .getByRole("button", { name: "Try loading again", exact: true })
    .click();
  await expect(
    dialog.getByRole("heading", { name: "Research context", exact: true }),
  ).toBeVisible();
  expect(requests).toHaveLength(2);
  expect(requests[0]).toEqual(requests[1]);
  expect(requests[0]).toMatchObject({
    kind: "preparation",
    scope: { kind: "notebooks", ids: [project.id], includeDescendants: false },
    goal: "Review rollout risks and migration decisions.",
  });
  await expect(dialog.getByText(/Partial coverage/)).toBeVisible();
  await dialog.getByText("Sources", { exact: true }).first().click();
  await expect(
    dialog.getByRole("link", { name: "Revision 1" }).first(),
  ).toHaveAttribute("href", `/app/memories/${note.id}?revision=1`);
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
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
    await page.screenshot({
      path: info.outputPath(`meeting-brief-${width}.png`),
    });
  }
  await dialog
    .getByRole("button", { name: "Save result", exact: true })
    .click();
  await expect(dialog.getByRole("alert")).toBeVisible();
  await dialog
    .getByRole("button", { name: "Save result", exact: true })
    .click();
  await expect(
    dialog.getByRole("button", { name: "Undo", exact: true }),
  ).toBeVisible();
  expect(applications[0]).toEqual(applications[1]);
  expect(applications[0]).toMatchObject({
    expectedVersion: 2,
    destinationProjectId: project.id,
  });
  await dialog.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(dialog.getByText("Undone", { exact: true })).toBeVisible();
});

test("tool opt-in is never silently changed and cancelling preserves the brief inputs", async ({
  page,
}) => {
  let enabled = false,
    requests = 0,
    current: Assistance | undefined;
  await page.route("**/api/grove/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    const body = route.request().postDataJSON();
    let data: unknown = {};
    if (path.endsWith("/projects")) data = [project];
    else if (path.endsWith("/me"))
      data = {
        accountId: "meeting-owner",
        ...preferencesFor({ preparationEnabled: enabled }),
      };
    else if (path.endsWith("/memories/search"))
      data = { items: [], nextCursor: null };
    else if (path.endsWith("/assistance")) {
      requests++;
      current = {
        id: body.id,
        kind: "preparation",
        status: "pending",
        version: 1,
        result: null,
        error: null,
        applied: [],
        progress: 0,
      };
      data = current;
    } else if (path.endsWith("/cancel")) {
      expect(body).toEqual({ expectedVersion: 1 });
      current = {
        ...current!,
        version: 2,
        status: "cancelled",
        result: null,
        error: "Generation cancelled. Start a new result to try again.",
      };
      data = current;
    } else if (path.includes("/assistance/")) data = current;
    await route.fulfill({ json: { success: true, data } });
  });
  await page.goto(`${base}/app/projects/${project.id}`);
  await page.getByRole("button", { name: "Notebook options" }).click();
  await page
    .getByRole("button", { name: "Tools for these notes", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Open Create a brief", exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "Create a brief",
    exact: true,
  });
  await dialog
    .getByRole("textbox", { name: "What should this brief help you do?" })
    .fill("Rollout risks");
  await expect(
    dialog.getByRole("button", { name: "Create brief", exact: true }),
  ).toBeDisabled();
  expect(requests).toBe(0);
  await dialog
    .getByRole("button", { name: "Close dialog", exact: true })
    .click();
  enabled = true;
  await page.reload();
  await page.getByRole("button", { name: "Notebook options" }).click();
  await page
    .getByRole("button", { name: "Tools for these notes", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Open Create a brief", exact: true })
    .click();
  await dialog
    .getByRole("textbox", { name: "What should this brief help you do?" })
    .fill("Rollout risks");
  await dialog
    .getByRole("button", { name: "Create brief", exact: true })
    .click();
  await dialog
    .getByRole("button", { name: "Cancel generation", exact: true })
    .click();
  await expect(dialog.getByText(/Generation cancelled/)).toBeVisible();
  await dialog
    .getByRole("button", { name: "Edit tool inputs", exact: true })
    .click();
  await expect(
    dialog.getByRole("textbox", {
      name: "What should this brief help you do?",
    }),
  ).toHaveValue("Rollout risks");
  expect(requests).toBe(1);
});

test("brief source recovery keeps the goal, removes exact pins and never falls back to the notebook", async ({
  page,
}) => {
  const notes = [
    note,
    { ...note, id: "00000000-0000-4000-8000-000000000083" },
  ].map((ref, index) => ({
    id: ref.id,
    version: 1,
    projectId: project.id,
    content: `Launch source ${index + 1}`,
    kind: "fact",
    status: "active",
    source: { agent: "website" },
    taskId: null,
    expiresAt: null,
    purgeAt: null,
    createdAt: "2026-10-25T10:00:00Z",
    updatedAt: "2026-10-25T10:00:00Z",
    indexing: "ready",
  }));
  const requests: AssistanceRequest[] = [];
  await page.route("**/api/grove/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    let data: unknown = {};
    if (path.endsWith("/projects")) data = [project];
    else if (path.endsWith("/me"))
      data = {
        accountId: "meeting-owner",
        ...preferencesFor({ preparationEnabled: true }),
      };
    else if (path.endsWith("/memories/search"))
      data = { items: notes, nextCursor: null };
    else if (path.endsWith("/assistance")) {
      requests.push(route.request().postDataJSON());
      await route.fulfill({
        status: 409,
        json: {
          success: false,
          error: {
            code: "sources_changed",
            message: "These notes changed. Refresh the preview.",
          },
        },
      });
      return;
    } else {
      const found = notes.find((item) => path.endsWith(`/memories/${item.id}`));
      if (found) data = { ...found, version: 2 };
    }
    await route.fulfill({ json: { success: true, data } });
  });
  await page.goto(`${base}/app`);
  await page.getByRole("checkbox", { name: "Select these notes" }).check();
  await page
    .getByRole("button", { name: "Tools for these notes", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Open Create a brief", exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "Create a brief",
    exact: true,
  });
  await dialog
    .getByRole("textbox", { name: "What should this brief help you do?" })
    .fill("Keep this agenda while recovering");
  await dialog
    .getByRole("button", { name: "Create brief", exact: true })
    .click();
  await expect(dialog.getByRole("alert")).toBeVisible();
  expect(requests[0]).toMatchObject({
    scope: {
      kind: "notes",
      sources: notes.map(({ id, version }) => ({ id, version })),
    },
  });
  await dialog
    .getByRole("button", { name: "Edit tool inputs", exact: true })
    .click();
  await expect(
    dialog.getByRole("textbox", {
      name: "What should this brief help you do?",
    }),
  ).toHaveValue("Keep this agenda while recovering");
  await dialog.getByRole("button", { name: "Remove selected note 1" }).click();
  await expect(
    dialog.getByText("Selected notes (1)", { exact: true }),
  ).toBeFocused();
  await dialog
    .getByRole("button", { name: "Create brief", exact: true })
    .click();
  await expect(dialog.getByRole("alert")).toBeVisible();
  expect(requests[1]).toMatchObject({
    scope: { kind: "notes", sources: [{ id: notes[1].id, version: 1 }] },
  });
  expect(requests[1].id).not.toBe(requests[0].id);
});
