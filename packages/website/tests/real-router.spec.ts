import { test, expect } from "@playwright/test";
import { fixture, note, handoff, project } from "./fixtures/workspace-fixture";

const base = `http://127.0.0.1:${process.env.ROUTER_TEST_PORT || 4379}`;
test("real Next navigation preserves a quick-open list, URL, focus, reload and Back/Forward", async ({
  page,
}) => {
  await fixture(page);
  await page.goto(`${base}/app?notebook=personal&sort=title_asc`);
  const row = page.locator(`[data-note-id="${note.id}"] .memory-open`);
  await expect(row).toBeVisible();
  const mounted = await row.elementHandle();
  await row.click();
  const dialog = page.getByRole("dialog", { name: "Note", exact: true });
  await expect(dialog).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`[?&]note=${note.id}`));
  await expect(page).toHaveTitle("Review preferences · Grove");
  expect(
    await row.evaluate((current, original) => current === original, mounted),
  ).toBe(true);
  await page.goBack();
  await expect(dialog).toHaveCount(0);
  await page.goForward();
  await expect(dialog).toBeVisible();
  await page.reload();
  await expect(dialog).toBeVisible();
  await expect(page).toHaveTitle("Review preferences · Grove");
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(row).toBeFocused();
});

test("real Next canonical note routes retain editor state and Undo through Settings and Back", async ({
  page,
}) => {
  const state = await fixture(page);
  await page.route("**/api/grove/admin", (route) =>
    route.fulfill({
      status: 403,
      json: {
        success: false,
        error: { code: "forbidden", message: "Not an administrator" },
      },
    }),
  );
  await page.goto(`${base}/app/memories/${note.id}?mode=edit`);
  const editor = page.getByRole("textbox", {
    name: "What should stay with you?",
  });
  await expect(editor).toBeVisible();
  await editor.focus();
  await editor.press("Control+End");
  await editor.press("End");
  await editor.press("x");
  await expect
    .poll(() => state.records.get(note.id)?.content.endsWith("x"))
    .toBe(true);
  await editor.press("Home");
  await editor.press("Shift+ArrowRight");
  const selectedText = await page.evaluate(() =>
    window.getSelection()?.toString(),
  );
  expect(selectedText?.length).toBe(1);
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await expect(page).toHaveURL(`${base}/app/settings`);
  await page.goBack();
  await expect(editor).toBeVisible();
  await expect(editor).toContainText("x");
  await editor.focus();
  await expect
    .poll(() => page.evaluate(() => window.getSelection()?.toString()))
    .toBe(selectedText);
  await editor.press("Control+z");
  await expect
    .poll(() => state.records.get(note.id)?.content)
    .toBe(note.content);
});

test("real Next notebook and chat entry resolve exact authorized locations without sending on entry", async ({
  page,
}) => {
  const state = await fixture(page);
  const id = "00000000-0000-4000-a000-000000000091";
  state.chats.set(id, {
    id,
    title: "Recorded field question",
    version: 0,
    toolsVersion: 0,
    tools: { exa: false, tavily: false, organize: false },
    scope: { projectId: project.id, includePersonal: false },
    updatedAt: note.updatedAt,
    turns: [],
  });
  await page.goto(`${base}/app/ask?chat=${id}`);
  await expect(page).toHaveTitle("Recorded field question · Grove");
  expect(
    state.calls.filter((call) => call.path.endsWith("/turns")),
  ).toHaveLength(0);
  await page.goto(`${base}/app/projects/${project.id}`);
  await expect(
    page.getByRole("heading", { name: project.name, exact: true }),
  ).toBeVisible();
  await page.locator(`[data-note-id="${handoff.id}"] .memory-open`).click();
  await expect(
    page.getByRole("dialog", { name: "Note", exact: true }),
  ).toBeVisible();
  await expect(page).toHaveTitle("Launch checklist · Grove");
});
