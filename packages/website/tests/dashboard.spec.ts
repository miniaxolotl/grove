import AxeBuilder from "@axe-core/playwright";
import { test, expect, type Page } from "@playwright/test";
import type { Memory } from "@lib/shared/contracts";

const base = `http://127.0.0.1:${process.env.DASHBOARD_TEST_PORT || 3101}`;
const sample: Memory = {
  id: "00000000-0000-4000-a000-000000000002",
  projectId: null,
  content: "I prefer concise explanations with one concrete example.",
  kind: "preference",
  status: "active",
  version: 1,
  source: { agent: "opencode" },
  taskId: null,
  expiresAt: null,
  purgeAt: null,
  createdAt: "2026-10-18T10:00:00Z",
  updatedAt: "2026-10-18T10:00:00Z",
  indexing: "ready",
};
async function fixture(
  page: Page,
  initial: Memory[] = [sample],
  failSave = false,
) {
  let memories = structuredClone(initial);
  await page.route("**/api/grove/**", async (route) => {
    const path = new URL(route.request().url()).pathname.replace(
      "/api/grove",
      "",
    );
    const body = route.request().postDataJSON();
    let data: unknown = [];
    if (path === "/relationships/search")
      data = { items: [], nextCursor: null, status: "ready" };
    else if (path === "/memories/search")
      data = {
        items: memories.filter(
          (memory) =>
            memory.status === body.status &&
            (!body.query || memory.content.includes(body.query)),
        ),
        nextCursor: null,
      };
    else if (path === "/memories") {
      if (failSave) {
        await route.fulfill({
          status: 503,
          json: {
            success: false,
            error: {
              code: "unavailable",
              message: "The service is temporarily unavailable",
            },
          },
        });
        return;
      }
      const saved = {
        ...sample,
        ...body,
        id: body.id ?? crypto.randomUUID(),
        version: body.expectedVersion ? body.expectedVersion + 1 : 1,
        indexing: "pending",
      };
      memories = [...memories.filter((m) => m.id !== saved.id), saved];
      data = saved;
    } else if (path.endsWith("/archive") || path.endsWith("/restore")) {
      memories = memories.map((memory) => ({
        ...memory,
        status: path.endsWith("/archive") ? "archived" : "active",
      }));
      data = memories[0];
    } else if (path.endsWith("/revisions"))
      data = [
        { version: 1, content: sample.content, createdAt: sample.createdAt },
      ];
    else if (path === "/memories/delete") {
      memories = [];
      data = { results: [{ outcome: "deleted" }] };
    } else if (path.startsWith("/memories/"))
      data = memories.find((memory) => memory.id === path.split("/")[2]);
    else if (path === "/me")
      data = {
        accountId: "fixture-user",
        captureEnabled: true,
        recallEnabled: true,
      };
    await route.fulfill({ json: { success: true, data } });
  });
}

test("memory editor reports persistence failures and retains the draft", async ({
  page,
}) => {
  await fixture(page, [], true);
  await page.goto(`${base}/app`);
  await page.getByRole("link", { name: "New note", exact: true }).click();
  await page
    .getByLabel("What should stay with you?")
    .fill("Keep this draft on failure.");
  await page.getByRole("button", { name: "Save note", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText(
    "temporarily unavailable",
  );
  await expect(page.getByLabel("What should stay with you?")).toHaveText(
    "Keep this draft on failure.",
  );
  await expect(page.locator(".note-editor-full")).toBeVisible();
  await expect(page.getByText("Note saved.", { exact: false })).toHaveCount(0);
});

test("save, correct, inspect revisions, archive, restore and delete through the dashboard", async ({
  page,
}) => {
  await fixture(page, []);
  await page.goto(`${base}/app`);
  await page.getByRole("link", { name: "Write your first note" }).click();
  await page.getByLabel("What should stay with you?").fill(sample.content);
  await page.getByRole("button", { name: "Save note", exact: true }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Saved" }),
  ).toContainText("Saved");
  await page.getByRole("button", { name: "Back to notes" }).click();
  await page.getByRole("button", { name: /^I prefer concise/ }).click();
  await page.getByRole("button", { name: "Edit note", exact: true }).click();
  await page
    .getByLabel("What should stay with you?")
    .fill("I prefer examples in TypeScript.");
  await page.getByRole("button", { name: "Save note", exact: true }).click();
  await expect(page.locator(".note-save-status")).toHaveText("Saved");
  await page.getByRole("button", { name: "History", exact: true }).click();
  await expect(page.getByText(sample.content, { exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Note actions" }).click();
  await page.getByRole("button", { name: "Archive", exact: true }).click();
  await expect(page.getByText("Good things start small.")).toBeVisible();
  await page.goto(`${base}/app/archive`);
  await page.getByRole("button", { name: /^I prefer examples/ }).click();
  await page.getByRole("button", { name: "Note actions" }).click();
  await page.getByRole("button", { name: "Restore", exact: true }).click();
  await page.goto(`${base}/app`);
  await page.getByRole("button", { name: /^I prefer examples/ }).click();
  await page.getByRole("button", { name: "Note actions" }).click();
  await page.getByRole("button", { name: "Delete note…", exact: true }).click();
  await page.getByRole("button", { name: "Delete this note" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "permanently deleted" }),
  ).toBeVisible();
  await expect(page.getByText("Good things start small.")).toBeVisible();
});

test("a filtered empty library can return to all memories without losing the query workflow", async ({
  page,
}) => {
  await fixture(page);
  await page.goto(`${base}/app`);
  await page
    .getByRole("textbox", { name: "Search notes" })
    .fill("a missing memory");
  await expect(page.getByText("Nothing here matches yet.")).toBeVisible();
  await page
    .getByRole("button", { name: "Clear filters", exact: true })
    .click();
  await expect(page.getByRole("textbox", { name: "Search notes" })).toHaveValue(
    "",
  );
  await expect(
    page.getByRole("button", { name: /^I prefer concise/ }),
  ).toBeVisible();
});

for (const path of [
  "/app",
  "/app/archive",
  "/app/projects",
  "/app/settings/connections",
  "/app/settings",
]) {
  test(`${path} recovers from an unavailable service without a false empty or loading state`, async ({
    page,
  }) => {
    await fixture(page);
    let unavailable = true;
    await page.route("**/api/grove/**", async (route) => {
      if (!unavailable) return route.fallback();
      await route.fulfill({
        status: 503,
        json: {
          success: false,
          error: { code: "unavailable", message: "Temporarily unavailable" },
        },
      });
    });
    await page.goto(`${base}${path}`);
    await expect(page.getByRole("alert")).toContainText(
      "Temporarily unavailable",
    );
    await expect(page.locator(".app-empty")).toHaveCount(0);
    await expect(
      page.getByText(/Loading (memories|projects|connections|preferences)/),
    ).toHaveCount(0);
    unavailable = false;
    await page.getByRole("button", { name: "Try loading again" }).click();
    await expect(page.getByRole("alert")).toHaveCount(0);
    if (path === "/app")
      await expect(
        page.getByRole("button", { name: /^I prefer concise/ }),
      ).toBeVisible();
    else if (path === "/app/settings")
      await expect(
        page.getByRole("button", { name: "Save preferences" }),
      ).toBeVisible();
    else await expect(page.locator(".app-empty")).toBeVisible();
  });
}

test("dashboard navigation, narrow layouts and dialogs meet accessibility checks", async ({
  page,
}) => {
  await fixture(page);
  for (const path of [
    "/app",
    "/app/projects",
    "/app/archive",
    "/app/settings/connections",
    "/app/settings",
  ]) {
    await page.goto(`${base}${path}`);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    for (const width of [320, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      if (path !== "/app/archive") {
        await expect(
          page.locator('.app-sidebar a[aria-current="page"]:visible'),
        ).toBeInViewport({ ratio: 1 });
      }
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      ).toBe(true);
      const violations = (
        await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
          .analyze()
      ).violations;
      expect(
        violations.map((v) => ({
          id: v.id,
          nodes: v.nodes.map((n) => n.target),
        })),
      ).toEqual([]);
    }
  }
  await page.goto(`${base}/app`);
  await page.getByRole("button", { name: /^I prefer concise/ }).click();
  await expect(
    page.getByRole("button", { name: "Close dialog" }),
  ).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
});
