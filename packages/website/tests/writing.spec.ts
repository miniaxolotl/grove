import { test, expect, type Page } from "@playwright/test";
import type { Memory } from "@lib/shared/contracts";
import { fixture } from "./fixtures/workspace-fixture";

const base = `http://127.0.0.1:${process.env.DASHBOARD_TEST_PORT || 3101}`;

const draft: Memory = {
  id: "00000000-0000-4000-a000-000000000021",
  projectId: null,
  content:
    "This is the the test of teh checker with an hour and a university.\n\nAll of the words are here in order to test.",
  kind: "preference",
  autoKind: false,
  status: "active",
  version: 1,
  source: {
    agent: "opencode",
    session: "writing-fixture",
    verification: "Verified in the browser",
  },
  taskId: null,
  expiresAt: null,
  purgeAt: null,
  indexing: "ready",
  createdAt: "2026-11-07T10:00:00Z",
  updatedAt: "2026-11-07T10:00:00Z",
  enrichment: {
    title: "Writing check",
    status: "ready",
    tags: [],
    relationships: [],
    profiles: ["private-profile"],
  },
};

async function openDraft(page: Page) {
  await fixture(page, [draft]);
  await page.goto(`${base}/app/memories/${draft.id}?mode=edit`);
  await page.getByRole("textbox", { name: "What should stay with you?" }).waitFor();
  // The webapp advertises native proofing so the extension never double-binds.
  await expect(page.locator("html[data-grove-native-writing]")).toHaveCount(1);
}

for (const width of [1440, 390]) {
  test.describe(`webapp writing at ${width}px`, () => {
    test.use({ viewport: { width, height: 900 }, hasTouch: width < 600 });
    test("local proofing underlines, cards and one-click apply with undo", async ({
      page,
    }, info) => {
      await openDraft(page);
      const editor = page.getByRole("textbox", {
        name: "What should stay with you?",
      });
      // Engine + dictionary load lazily on first edit; status counts issues.
      const status = page.locator(".grove-writing-status");
      await expect(status.first()).toContainText(/suggestion/, {
        timeout: 30000,
      });
      await expect(
        page.locator(".codemirror-host .grove-writing-spelling").first(),
      ).toBeVisible();
      await page.screenshot({ path: info.outputPath("writing-underlines.png") });
      // Click the first underline to review it.
      const first = page
        .locator(".codemirror-host .grove-writing-spelling")
        .first();
      await first.click();
      const card = page.getByRole("dialog", {
        name: /Writing suggestion/,
      });
      await expect(card).toBeVisible();
      await page.screenshot({ path: info.outputPath("writing-card.png") });
      // Apply the first replacement with one click, then undo restores it.
      const before = await editor.textContent();
      const replacement = await card
        .locator(".grove-writing-replacement")
        .first()
        .textContent();
      await card.locator(".grove-writing-replacement").first().click();
      expect(await editor.textContent()).not.toBe(before);
      expect(replacement?.trim().length).toBeGreaterThan(0);
      await page.keyboard.press(process.platform === "darwin" ? "Meta+z" : "Control+z");
      // Native undo restores the exact original text.
      await expect(editor).toContainText("teh", { timeout: 5000 });
      await page.screenshot({ path: info.outputPath("writing-applied.png") });
    });

    test("all-issues list and settings switches govern checks", async ({
      page,
    }, info) => {
      await openDraft(page);
      // Settings navigation checks the account role; stay a plain member.
      await page.route("**/api/grove/admin", async (route) => {
        await route.fulfill({
          json: { success: true, data: { role: "member" } },
        });
      });
      const editor = page.getByRole("textbox", {
        name: "What should stay with you?",
      });
      await expect(page.locator(".grove-writing-status").first()).toContainText(
        /suggestion/,
        { timeout: 30000 },
      );
      await page.keyboard.press("Alt+Enter");
      const list = page.getByRole("dialog", { name: "Writing suggestions" });
      await expect(list).toBeVisible();
      await expect(list.locator(".grove-writing-list button").first()).toBeVisible();
      await page.screenshot({ path: info.outputPath("writing-list.png") });
      await page.keyboard.press("Escape");
      await expect(list).not.toBeVisible();
      // Disabling spelling from Settings removes spelling underlines only.
      await page.goto(`${base}/app/settings`);
      await expect(
        page.getByRole("heading", { name: "Writing", exact: true }),
      ).toBeVisible();
      await page.screenshot({ path: info.outputPath("writing-settings.png") });
      await page.getByLabel("Spelling", { exact: true }).uncheck();
      await page.goto(`${base}/app/memories/${draft.id}?mode=edit`);
      await expect(editor).toBeVisible();
      await expect(
        page.locator(".codemirror-host .grove-writing-spelling"),
      ).toHaveCount(0, { timeout: 30000 });
      // Grammar underlines from the same engine remain.
      await expect(
        page.locator(".codemirror-host .grove-writing-grammar").first(),
      ).toBeVisible({ timeout: 30000 });
    });
  });
}
