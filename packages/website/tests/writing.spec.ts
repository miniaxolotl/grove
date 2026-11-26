import { test, expect, type Page } from "@playwright/test";
import type { Memory } from "@lib/shared/contracts";
import { fixture } from "./fixtures/workspace-fixture";

const base = `http://127.0.0.1:${process.env.DASHBOARD_TEST_PORT || 3101}`;

test("pausing writing assistance keeps saved child preferences and resumes them unchanged", async ({
  page,
}) => {
  const state = await fixture(page);
  await page.route("**/api/grove/admin", (route) =>
    route.fulfill({ json: { success: true, data: { role: "member" } } }),
  );
  await page.goto(`${base}/app/settings`);
  const master = page.getByRole("checkbox", {
    name: "Writing assistance",
    exact: true,
  });
  const spelling = page.getByRole("checkbox", {
    name: "Spelling",
    exact: true,
  });
  const grammar = page.getByRole("checkbox", {
    name: "Basic grammar",
    exact: true,
  });
  await spelling.uncheck();
  await master.uncheck();
  await expect(
    page.getByText("Checks paused. Your saved choices are kept.", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(spelling).not.toBeChecked();
  await expect(grammar).toBeChecked();
  await expect(spelling).toBeDisabled();
  await expect(grammar).toBeDisabled();
  await master.check();
  await expect(spelling).toBeEnabled();
  await expect(spelling).not.toBeChecked();
  await expect(grammar).toBeChecked();
  expect(
    state.calls.some(
      (call) =>
        call.body &&
        (call.path.startsWith("/proofing") ||
          call.path === "/account/settings"),
    ),
  ).toBe(false);
});

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

async function openDraft(page: Page, content = draft.content) {
  await fixture(page, [{ ...draft, content }]);
  await page.goto(`${base}/app/memories/${draft.id}?mode=edit`);
  await page
    .getByRole("textbox", { name: "What should stay with you?" })
    .waitFor();
  // The webapp advertises native proofing so the extension never double-binds.
  await expect(page.locator("html[data-grove-native-writing]")).toHaveCount(1);
}

for (const width of [1440, 390, 320]) {
  test.describe(`toolbar writing review at ${width}px`, () => {
    test.use({
      viewport: { width, height: width === 320 ? 480 : 900 },
      hasTouch: width < 600,
    });

    test("reviews existing and new issues with exact and similar actions and native Undo", async ({
      page,
    }, info) => {
      const source =
        "This is teh first note.\n\nThis is teh second note.\n\nThis is the the final note.";
      await openDraft(page, source);
      const editor = page.getByRole("textbox", {
        name: "What should stay with you?",
      });
      const toolbar = page.locator(".editor-heading");
      const review = toolbar.getByRole("button", {
        name: "Spelling and grammar",
        exact: true,
      });
      await expect(review).toBeVisible();
      const headerBounds = await toolbar.boundingBox();
      const reviewBounds = await review.boundingBox();
      expect(reviewBounds!.x + reviewBounds!.width).toBeLessThanOrEqual(width);
      expect(
        await toolbar.evaluate(
          (element) => element.scrollWidth - element.clientWidth,
        ),
      ).toBeLessThanOrEqual(1);
      if (width < 600) {
        expect(reviewBounds!.height).toBeGreaterThanOrEqual(44);
        expect(reviewBounds!.width).toBeGreaterThanOrEqual(44);
        expect(headerBounds!.height).toBeLessThanOrEqual(100);
      }
      await review.click();
      const list = page.getByRole("dialog", {
        name: "Writing suggestions",
        exact: true,
      });
      const typos = list
        .locator("li[data-writing-rule=spelling]")
        .filter({ hasText: "teh" });
      await expect(typos).toHaveCount(2, { timeout: 30000 });
      await expect(
        list.locator("li[data-writing-rule=repetition]"),
      ).not.toHaveCount(0);
      await page.screenshot({
        path: info.outputPath("toolbar-writing-review.png"),
      });
      await page.keyboard.press("Escape");
      await expect(review).toBeFocused();
      await page.screenshot({
        path: info.outputPath("toolbar-writing-closed.png"),
      });
      await review.click();
      const alternatives = typos.first().locator("summary");
      await alternatives.focus();
      await alternatives.press("Enter");
      await expect(
        typos.first().locator("details .grove-writing-replacement").first(),
      ).toBeVisible();
      await alternatives.press("Enter");
      await typos
        .first()
        .getByRole("button", { name: "Ignore", exact: true })
        .click();
      await expect(typos).toHaveCount(1);
      await expect(editor).toContainText("teh first note.");
      await list
        .getByRole("button", { name: "Check writing", exact: true })
        .click();
      await expect(typos).toHaveCount(1);
      await typos
        .first()
        .getByRole("button", { name: "Apply “the”", exact: true })
        .click();
      await expect(typos).toHaveCount(0);
      await expect(editor).toContainText("the second note.");
      await page.keyboard.press("Escape");
      await expect(review).toBeFocused();
      await editor.focus();
      await page.keyboard.press(
        process.platform === "darwin" ? "Meta+z" : "Control+z",
      );
      await expect(editor).toHaveText(source.replaceAll("\n", ""));

      // A fresh edit contributes new results without losing feedback in the
      // untouched paragraph. Batch actions only affect current matching spans.
      await editor.press(
        process.platform === "darwin" ? "Meta+End" : "Control+End",
      );
      await page.keyboard.insertText("\n\nThis is teh newest note.");
      await review.click();
      await list
        .getByRole("button", { name: "Check writing", exact: true })
        .click();
      await expect(typos).toHaveCount(2, { timeout: 30000 });
      await typos
        .first()
        .getByRole("button", { name: "Apply “the” to 2 similar", exact: true })
        .click();
      await expect(typos).toHaveCount(0);
      await expect(editor).toContainText("teh first note.");
      await expect(editor).toContainText("the newest note.");
      await page.keyboard.press("Escape");
      await editor.focus();
      await page.keyboard.press(
        process.platform === "darwin" ? "Meta+z" : "Control+z",
      );
      await expect(editor).toHaveText(
        `${source.replaceAll("\n", "")}This is teh newest note.`,
      );
      await review.click();
      await list
        .getByRole("button", { name: "Check writing", exact: true })
        .click();
      await expect(typos).toHaveCount(2, { timeout: 30000 });
      await typos
        .first()
        .getByRole("button", { name: "Ignore 2 similar", exact: true })
        .click();
      await expect(typos).toHaveCount(0);
      await expect(editor).toHaveText(
        `${source.replaceAll("\n", "")}This is teh newest note.`,
      );
      await expect(
        list.locator("li[data-writing-rule=repetition]"),
      ).not.toHaveCount(0);
      expect(
        await page.evaluate(() =>
          Object.values(localStorage).some((value) =>
            value.includes("teh newest"),
          ),
        ),
      ).toBe(false);
      await page.keyboard.press("Escape");
      await editor.press(
        process.platform === "darwin" ? "Meta+End" : "Control+End",
      );
      await page.keyboard.insertText("\n\nThis is teh later note.");
      await review.click();
      await list
        .getByRole("button", { name: "Check writing", exact: true })
        .click();
      await expect(typos).toHaveCount(1, { timeout: 30000 });
    });

    test("jumps to the exact offscreen issue and keeps editor identity and Undo", async ({
      page,
    }) => {
      const content = `${Array.from({ length: 40 }, (_, i) => `## Part ${i + 1}\n\nThis paragraph is ready to read.`).join("\n\n")}\n\nThis is teh final paragraph.`;
      await openDraft(page, content);
      const editor = page.getByRole("textbox", {
        name: "What should stay with you?",
      });
      const identity = await editor.elementHandle();
      await page
        .locator(".editor-heading")
        .getByRole("button", { name: "Spelling and grammar", exact: true })
        .click();
      const list = page.getByRole("dialog", {
        name: "Writing suggestions",
        exact: true,
      });
      const typo = list
        .locator("li[data-writing-rule=spelling]")
        .filter({ hasText: "teh" })
        .first();
      await expect(typo).toBeVisible({ timeout: 30000 });
      await typo.getByRole("button", { name: /Show in text/ }).click();
      await expect(list).not.toBeVisible();
      await expect(editor).toBeFocused();
      await expect
        .poll(() => page.evaluate(() => window.getSelection()?.toString()))
        .toBe("teh");
      await expect(
        page
          .locator(".codemirror-host .grove-writing-spelling")
          .filter({ hasText: "teh" }),
      ).toBeInViewport();
      expect(await identity?.evaluate((element) => element.isConnected)).toBe(
        true,
      );
      await expect(editor).toContainText("This is teh final paragraph.");
    });
  });
}

test("toolbar review explains paused checks without enabling checks or sending prose", async ({
  page,
}) => {
  await page.addInitScript(() =>
    localStorage.setItem("grove.writing.settings.v1", '{"enabled":false}'),
  );
  const requests: string[] = [];
  page.on("request", (request) => {
    if (/proofing\/(?:check|worker)/.test(request.url()))
      requests.push(request.url());
  });
  await openDraft(page);
  await page
    .locator(".editor-heading")
    .getByRole("button", { name: "Spelling and grammar", exact: true })
    .click();
  const list = page.getByRole("dialog", {
    name: "Writing suggestions",
    exact: true,
  });
  await expect(
    list.getByText("Writing checks paused", { exact: true }),
  ).toBeVisible();
  await expect(
    list.getByRole("link", { name: "Writing settings" }),
  ).toHaveAttribute("href", "/app/settings");
  await expect(
    list.getByRole("button", { name: "Check writing", exact: true }),
  ).toHaveCount(0);
  await expect(list.getByText(/No issues found/)).toHaveCount(0);
  expect(requests).toEqual([]);
  expect(
    await page.evaluate(
      () =>
        JSON.parse(localStorage.getItem("grove.writing.settings.v1")!).enabled,
    ),
  ).toBe(false);
});

test("toolbar retains an honest failed-check state and retries without changing text", async ({
  page,
}) => {
  let fail = true;
  await page.route(/\/proofing\/worker\.js\?/, async (route) => {
    if (fail) await route.abort("failed");
    else await route.continue();
  });
  await openDraft(page);
  await page
    .locator(".editor-heading")
    .getByRole("button", { name: "Spelling and grammar", exact: true })
    .click();
  const list = page.getByRole("dialog", {
    name: "Writing suggestions",
    exact: true,
  });
  await expect(list.getByRole("alert")).toContainText(
    "On-device checks couldn’t load",
    { timeout: 15000 },
  );
  await expect(list.getByText(/No issues found/)).toHaveCount(0);
  fail = false;
  await list
    .getByRole("button", { name: "Retry writing checks", exact: true })
    .click();
  await expect(list.locator(".grove-writing-list > li").first()).toBeVisible({
    timeout: 30000,
  });
  await expect(list.getByRole("alert")).toHaveCount(0);
  await expect(
    page.getByRole("textbox", { name: "What should stay with you?" }),
  ).toContainText("teh checker");
});

test("similar corrections protect Markdown code and link destinations", async ({
  page,
}) => {
  const source =
    "Read **teh** draft.\n\nRead [teh notebook](https://private.example/teh).\n\n`teh`\n\n```txt\nteh\n```";
  await openDraft(page, source);
  const editor = page.getByRole("textbox", {
    name: "What should stay with you?",
  });
  await page
    .getByRole("group", { name: "Editor mode" })
    .getByRole("button", { name: "Markdown", exact: true })
    .click();
  await page
    .locator(".editor-heading")
    .getByRole("button", { name: "Spelling and grammar", exact: true })
    .click();
  const list = page.getByRole("dialog", {
    name: "Writing suggestions",
    exact: true,
  });
  const typos = list
    .locator("li[data-writing-rule=spelling]")
    .filter({ hasText: "teh" });
  await expect(typos).toHaveCount(2, { timeout: 30000 });
  await typos
    .first()
    .getByRole("button", { name: "Apply “the” to 2 similar", exact: true })
    .click();
  await page.keyboard.press("Escape");
  const corrected = source
    .replace("**teh**", "**the**")
    .replace("[teh notebook]", "[the notebook]");
  await expect(editor).toHaveText(corrected.replaceAll("\n", ""));
  await editor.focus();
  await page.keyboard.press(
    process.platform === "darwin" ? "Meta+z" : "Control+z",
  );
  await expect(editor).toHaveText(source.replaceAll("\n", ""));
});

test("manual toolbar corrections keep valid issues in untouched paragraphs", async ({
  page,
}) => {
  await page.addInitScript(() =>
    localStorage.setItem("grove.writing.settings.v1", '{"automatic":false}'),
  );
  await openDraft(
    page,
    "This is teh first note.\n\nThis is the the final note.",
  );
  await page
    .locator(".editor-heading")
    .getByRole("button", { name: "Spelling and grammar", exact: true })
    .click();
  const list = page.getByRole("dialog", {
    name: "Writing suggestions",
    exact: true,
  });
  const typo = list
    .locator("li[data-writing-rule=spelling]")
    .filter({ hasText: "teh" });
  const repetition = list.locator("li[data-writing-rule=repetition]");
  await expect(typo).toHaveCount(1, { timeout: 30000 });
  await expect(repetition).toHaveCount(1);
  await typo.getByRole("button", { name: "Apply “the”", exact: true }).click();
  await expect(typo).toHaveCount(0);
  await expect(repetition).toHaveCount(1);
});

test("superseding a check during worker startup keeps the next check usable", async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.setItem("grove.writing.settings.v1", '{"automatic":false}');
  });
  const requested = page.waitForRequest(/\/proofing\/worker\.js\?/);
  const gate = Promise.withResolvers<void>();
  let requests = 0;
  await page.route(/\/proofing\/worker\.js\?/, async (route) => {
    requests++;
    await gate.promise;
    await route.continue();
  });
  await openDraft(page);
  const check = page.getByRole("button", {
    name: "Check writing",
    exact: true,
  });
  await check.click();
  await requested;
  await check.click();
  gate.resolve();
  await expect(page.locator(".grove-writing-status").first()).toContainText(
    /suggestion/,
  );
  expect(requests).toBe(1);
});

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
      // Engine + worker load lazily on first edit; status counts issues.
      const status = page.locator(".grove-writing-status");
      await expect(status.first()).toContainText(/suggestion/, {
        timeout: 30000,
      });
      await expect(
        page.locator(".codemirror-host .grove-writing-spelling").first(),
      ).toBeVisible();
      await page.screenshot({
        path: info.outputPath("writing-underlines.png"),
      });
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
      await page.keyboard.press(
        process.platform === "darwin" ? "Meta+z" : "Control+z",
      );
      // Native undo restores the exact original text.
      await expect(editor).toContainText("teh", { timeout: 5000 });
      // Dismissal returns focus to the editor for uninterrupted writing.
      await first.click();
      await expect(card).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(card).not.toBeVisible();
      await expect(editor).toBeFocused();
      await first.click();
      await expect(card).toBeVisible();
      await card.getByRole("button", { name: "Close suggestion" }).click();
      await expect(card).not.toBeVisible();
      await expect(editor).toBeFocused();
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
      await expect(
        list.locator(".grove-writing-list button").first(),
      ).toBeVisible();
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

test("switching to manual checks discards an automatic check still loading", async ({
  page,
}) => {
  const requested = page.waitForRequest(/\/proofing\/worker\.js\?/);
  const gate = Promise.withResolvers<void>();
  await page.route(/\/proofing\/worker\.js\?/, async (route) => {
    await gate.promise;
    await route.continue();
  });
  await openDraft(page);
  await requested;
  const checking = page.getByText("Checking…", { exact: true });
  await expect(checking).toBeVisible();
  // Preferences changed in another tab while the first check was waiting.
  const otherTab = await page.context().newPage();
  await otherTab.goto(`${base}/robots.txt`);
  await otherTab.evaluate(() => {
    localStorage.setItem("grove.writing.settings.v1", '{"automatic":false}');
  });
  const manual = page.getByRole("button", {
    name: "Check writing",
    exact: true,
  });
  await expect(manual).toBeVisible();
  await expect(checking).toHaveCount(0);
  gate.resolve();
  await manual.click();
  await expect(page.locator(".grove-writing-status").first()).toContainText(
    /suggestion/,
  );
});
