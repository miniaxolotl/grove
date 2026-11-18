import { expect, test, type Page } from "@playwright/test";
import { fixture, note, project } from "./fixtures/workspace-fixture";

const base = `http://127.0.0.1:${process.env.DASHBOARD_TEST_PORT || 3101}`;
const day = "2026-11-17";
const beforeMidnight = new Date("2026-11-18T07:59:00Z");
const afterMidnight = new Date("2026-11-18T08:01:00Z");
const todayLink = (page: Page) =>
  page.getByRole("link", { name: "Today’s note", exact: true });
const editor = (page: Page) =>
  page.getByRole("textbox", { name: "What should stay with you?" });
const save = (page: Page) =>
  page.getByRole("button", { name: "Save note", exact: true });
const fromNotes = async (page: Page) => {
  await page
    .getByRole("button", { name: "More note actions", exact: true })
    .click();
  await todayLink(page).click();
};

test.use({ timezoneId: "America/Los_Angeles", locale: "en-US" });

test("the workspace refresh cannot replace a conflicting draft", async ({
  page,
}) => {
  await page.clock.install({ time: beforeMidnight });
  const state = await fixture(page, []);
  await page.goto(`${base}/app/notes/new?from=journal&date=${day}`);
  await expect(editor(page)).toBeVisible();
  state.dailyNotes.set(day, note.id);
  state.records.set(note.id, note);
  await editor(page).fill("Text to keep through refresh");
  await save(page).click();
  const open = page.getByRole("button", {
    name: "Discard draft and open saved note",
  });
  await expect(open).toBeVisible();
  const refresh = page.waitForResponse(
    (r) => r.url().includes("/api/grove/projects") && r.ok(),
  );
  await page.clock.fastForward(61_000);
  await refresh;
  await expect(open).toBeVisible();
  expect(
    state.calls.filter(
      ({ path, body }) => path === `/memories/daily/${day}` && !body,
    ),
  ).toHaveLength(2);
  await expect(editor(page)).toHaveText("Text to keep through refresh");
  await page
    .getByRole("navigation", { name: "Workspace" })
    .getByRole("link", { name: "Notes", exact: true })
    .click();
  // The workspace refresh crossed midnight: revisit the original date.
  await page.goBack();
  await expect(editor(page)).toHaveText("Text to keep through refresh");
  await expect(open).toBeVisible();
});

test("reopening an interrupted first save recovers later typing and replays its receipt", async ({
  page,
}) => {
  await page.clock.setFixedTime(beforeMidnight);
  const state = await fixture(page, []);
  const attempts: unknown[] = [];
  const committed = { ...note, content: "First draft", projectId: null };
  await page.route(`**/api/grove/memories/daily/${day}`, async (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    attempts.push(route.request().postDataJSON());
    if (attempts.length === 1) {
      state.dailyNotes.set(day, committed.id);
      state.records.set(committed.id, committed);
      return route.abort();
    }
    return route.fulfill({ json: { success: true, data: committed } });
  });
  await page.goto(`${base}/app`);
  await fromNotes(page);
  await editor(page).fill(committed.content);
  await save(page).click();
  await expect(page.locator(".note-save-error")).toBeVisible();
  await editor(page).fill("Later typing after the interrupted save");
  await page
    .getByRole("navigation", { name: "Workspace" })
    .getByRole("link", { name: "Notes", exact: true })
    .click();
  await fromNotes(page);
  await expect(editor(page)).toHaveText(
    "Later typing after the interrupted save",
  );
  await save(page).click();
  await expect(page).toHaveURL(
    `${base}/app/memories/${note.id}?mode=edit&from=journal`,
  );
  await expect(page.locator(".note-save-status")).toHaveText("Saved");
  expect(attempts).toHaveLength(2);
  expect(attempts[1]).toEqual(attempts[0]);
  expect(state.records.get(note.id)?.content).toBe(
    "Later typing after the interrupted save",
  );
  expect(state.records.size).toBe(1);
});

test("a local date is pinned through midnight, then the notebook and Notes reopen the saved id", async ({
  page,
}, info) => {
  await page.clock.setFixedTime(beforeMidnight);
  await page.setViewportSize({ width: 1280, height: 720 });
  const old = { ...note, content: "# Tuesday, November 17, 2026" };
  const state = await fixture(page, [old]);
  await page.goto(`${base}/app/projects/${project.id}`);
  await page
    .getByRole("button", { name: "Notebook options", exact: true })
    .click();
  await todayLink(page).click();
  await expect(page).toHaveURL(new RegExp(`date=${day}$`));
  await expect(editor(page)).toHaveText(/Tuesday, November 17, 2026/);
  expect(state.records.size).toBe(1);
  expect(state.dailyNotes.size).toBe(0);

  await editor(page).fill(
    "# Garden field notes\n\nCounted eight new seedlings by the east fence.",
  );
  await page.clock.setFixedTime(afterMidnight);
  await save(page).click();
  await expect(page.locator(".note-save-status")).toHaveText("Saved");
  const id = state.dailyNotes.get(day)!;
  expect(id).toBeTruthy();
  expect(id).not.toBe(old.id);
  expect(state.records.get(id)?.projectId).toBe(project.id);
  await expect(page).toHaveURL(
    `${base}/app/memories/${id}?mode=edit&from=journal`,
  );
  await expect(editor(page)).toContainText("eight new seedlings");
  await page.goto(`${base}/app`);
  await fromNotes(page);
  await expect(page).toHaveURL(/date=2026-11-18$/);
  await expect(editor(page)).toHaveText(/Wednesday, November 18, 2026/);
  expect(state.dailyNotes.size).toBe(1);

  await page.clock.setFixedTime(beforeMidnight);
  await page.goto(`${base}/app`);
  await fromNotes(page);
  await expect(page).toHaveURL(
    `${base}/app/memories/${id}?mode=edit&from=journal`,
  );
  await expect(editor(page)).toContainText("eight new seedlings");
  const capture = info.outputPath("reopened-daily-note.png");
  await page.screenshot({ path: capture });
  await info.attach("reopened-daily-note", {
    path: capture,
    contentType: "image/png",
  });
  await editor(page).fill(
    "# Garden field notes\n\nCounted nine new seedlings by the east fence.",
  );
  await save(page).click();
  await expect(page.locator(".note-save-status")).toHaveText("Saved");
  expect(state.revisions.get(id)).toHaveLength(2);
  expect(state.records.size).toBe(2);
  expect(
    state.calls.filter(
      ({ path, body }) => path.startsWith("/memories/daily/") && body,
    ),
  ).toHaveLength(1);
});

test("a losing first save holds its draft and opens the winner only on request", async ({
  page,
}, info) => {
  await page.clock.setFixedTime(beforeMidnight);
  await page.setViewportSize({ width: 390, height: 844 });
  const state = await fixture(page, []);
  await page.goto(`${base}/app`);
  await fromNotes(page);
  await editor(page).fill(
    "# My unsaved draft\n\nKeep this observation available to copy.",
  );
  const winner = {
    ...note,
    projectId: null,
    content: "# Existing daily note\n\nSaved from another device.",
  };
  state.dailyNotes.set(day, winner.id);
  state.records.set(winner.id, winner);
  await save(page).click();
  const open = page.getByRole("button", {
    name: "Discard draft and open saved note",
  });
  await expect(open).toBeVisible();
  await expect(editor(page)).toContainText("available to copy");
  expect(state.records.size).toBe(1);
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth <=
        document.documentElement.clientWidth,
    ),
  ).toBe(true);
  const capture = info.outputPath("daily-note-conflict.png");
  await open.scrollIntoViewIfNeeded();
  await page.screenshot({ path: capture });
  await info.attach("daily-note-conflict", {
    path: capture,
    contentType: "image/png",
  });
  await open.click();
  await expect(page).toHaveURL(
    `${base}/app/memories/${winner.id}?mode=edit&from=journal`,
  );
  await expect(editor(page)).toContainText("Saved from another device.");
  await page.goBack();
  await expect(page).toHaveURL(
    `${base}/app/memories/${winner.id}?mode=edit&from=journal`,
  );
  await expect(editor(page)).toContainText("Saved from another device.");
});

test("archive opens the existing note and deletion never opens a fresh draft", async ({
  page,
}) => {
  await page.clock.setFixedTime(beforeMidnight);
  const state = await fixture(
    page,
    [{ ...note, status: "archived" }],
    new Map([[day, note.id]]),
  );
  await page.goto(`${base}/app`);
  await fromNotes(page);
  await expect(page).toHaveURL(
    `${base}/app/memories/${note.id}?mode=edit&from=journal`,
  );
  await expect(page.locator(".note-save-status")).toHaveText(
    "Saved · Archived",
  );
  await expect(save(page)).toBeDisabled();
  state.records.delete(note.id);
  await page.goto(`${base}/app`);
  await fromNotes(page);
  await expect(
    page.getByRole("heading", { name: "This daily note was deleted" }),
  ).toBeVisible();
  await expect(editor(page)).toHaveCount(0);
  expect(
    state.calls.filter(
      ({ path, body }) => path.startsWith("/memories/daily/") && body,
    ),
  ).toHaveLength(0);
});
