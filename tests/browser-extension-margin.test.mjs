/* global URL, chrome, document, innerWidth, getComputedStyle, Event */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtemp, mkdir } from "node:fs/promises";
import { resolve, join } from "node:path";
import process from "node:process";
const require = createRequire(
  new URL("../packages/website/package.json", import.meta.url),
);
const { chromium, expect } = require("@playwright/test");
const { default: AxeBuilder } = require("@axe-core/playwright");

test("installed margin writing keeps counts, pause, prose adapters and review scoped to the field", async () => {
  const directory = await mkdtemp("/tmp/opencode/grove-margin-browser-");
  const extension = resolve("packages/browser-extension/dist/chrome");
  const context = await chromium.launchPersistentContext(directory, {
    channel: "chromium",
    headless: true,
    ignoreDefaultArgs: ["--disable-extensions"],
    args: [
      `--disable-extensions-except=${extension}`,
      `--load-extension=${extension}`,
    ],
    viewport: { width: 900, height: 720 },
  });
  try {
    const worker =
      context.serviceWorkers()[0] ??
      (await context.waitForEvent("serviceworker"));
    const extensionId = new URL(worker.url()).host;
    await worker.evaluate(() => {
      globalThis.marginNetwork = 0;
      globalThis.fetch = async () => {
        globalThis.marginNetwork++;
        throw new Error("Local checks must not contact Grove");
      };
    });
    const page = await context.newPage();
    await page.route("https://margin-fixture.test/**", (route) =>
      route.fulfill({
        contentType: "text/html",
        body: `<!doctype html><html lang="en"><title>Writing review fixture</title><style>body{font:16px/1.5 system-ui;margin:32px;background:#fff;color:#212722}main{max-width:560px}label{display:block;margin-top:20px}textarea,input,[contenteditable]{box-sizing:border-box;font:16px/1.6 system-ui;border:1px solid #879289;border-radius:6px;padding:12px;width:100%}textarea{height:176px;resize:both}[contenteditable]{min-height:100px}button{font:inherit}</style><main><h1>Writing review</h1><label for="message">Message</label><textarea id="message" rows="6"></textarea><label for="subject">Subject</label><input id="subject" type="text"><label id="reply-label">Reply</label><div id="reply" aria-labelledby="reply-label" contenteditable="true"><p>This is a <b>sentnce</b>.</p><p>Keep <em>this formatting</em>.</p></div><label for="username">Username</label><input id="username" autocomplete="username"><label for="address">Shipping address</label><textarea id="address">PRIVATE_CANARY</textarea><div id="shadow"></div></main><script>globalThis.excludedReads=0;for(const id of ['username','address']){const e=document.getElementById(id);Object.defineProperty(e,'value',{get(){globalThis.excludedReads++;return 'PRIVATE_CANARY'},configurable:true})}const shadow=document.getElementById('shadow').attachShadow({mode:'open'});shadow.innerHTML='<label for="comment">Comment</label><textarea id="comment" rows="4" style="width:500px;height:100px;font:16px system-ui"></textarea>';</script></html>`,
      }),
    );
    await page.goto("https://margin-fixture.test/");
    const field = page.locator("#message");
    await field.fill("This is a sentnce. This is a apple.");
    const badge = page.locator(".badge");
    await expect(badge).toHaveAttribute("data-kind", "mixed");
    await expect(badge.locator(".badge-count")).toHaveText("2");
    await expect(badge).toHaveClass(/compact/);
    const before = await field.boundingBox();
    const bounds = await badge.boundingBox();
    assert.ok(
      bounds.x >= before.x &&
        bounds.x + bounds.width <= before.x + before.width,
      "indicator is at the right edge",
    );
    assert.ok(
      bounds.y >= before.y &&
        bounds.y + bounds.height <= before.y + before.height,
      "short text leaves an in-field bottom-right indicator",
    );
    await badge.click();
    const card = page.getByRole("dialog", { name: "Writing suggestions" });
    await expect(card).toBeVisible();
    await expect(card.locator(".issue-label").first()).toBeFocused();
    await card.getByRole("button", { name: "Grammar 1", exact: true }).click();
    await card.getByRole("button", { name: "All 2", exact: true }).click();
    assert.equal(
      await card.locator(".issue-label").first().getAttribute("data-original"),
      "sentnce",
      "returning from a category filter preserves source order",
    );
    assert.equal(
      await card
        .locator(".issue-row")
        .first()
        .evaluate(
          (element) => getComputedStyle(element).borderInlineStartWidth,
        ),
      "0px",
      "issue rows do not use decorative coloured left rails",
    );
    assert.equal(
      (await card.innerText()).includes("·"),
      false,
      "status uses plain language instead of dot-separated fragments",
    );
    assert.equal(
      await card.evaluate(
        (element) => element.getAnimations({ subtree: true }).length,
      ),
      0,
      "review has no decorative animation",
    );
    await expect(
      card.getByRole("switch", { name: "Checking in this field" }),
    ).toBeChecked();
    await card
      .locator(
        '.issue-label[data-original="sentnce"][data-category="spelling"]',
      )
      .click();
    await card.getByRole("button", { name: "sentence", exact: true }).click();
    await expect(field).toHaveValue("This is a sentence. This is a apple.");
    await expect(badge.locator(".badge-count")).toHaveText("1");
    await field.press("Control+z");
    await expect(field).toHaveValue("This is a sentnce. This is a apple.");
    await expect(badge.locator(".badge-count")).toHaveText("2");
    assert.deepEqual(
      await field.boundingBox(),
      before,
      "checking/review/edit never resizes the host field",
    );
    await badge.click();
    await card
      .getByRole("switch", { name: "Checking in this field" })
      .uncheck();
    await expect(card).toContainText("Off here");
    await card
      .getByRole("button", { name: "Close writing suggestions" })
      .click();
    await field.fill("This is a sentnce.");
    await expect(badge).toHaveAttribute("data-kind", "neutral");
    await page.locator("#subject").fill("This is a sentnce.");
    await expect(badge).toHaveAttribute("data-kind", "spelling");
    await field.focus();
    await expect(badge).toHaveAttribute("aria-label", /Off here/);
    await badge.click();
    await card.getByRole("switch", { name: "Checking in this field" }).check();
    await expect(card).toContainText("1 issue");
    await card
      .getByRole("button", { name: "Close writing suggestions" })
      .click();
    await field.fill("This is a sentence.");
    await expect(badge).toHaveAttribute("data-kind", "clean");
    await expect(badge.locator(".badge-count")).toHaveText("0");
    await field.fill("This is a sentence. ".repeat(400));
    await expect(badge).toHaveAttribute("aria-label", /Partly checked/);
    await expect(badge).toHaveAttribute("data-kind", "neutral");
    for (const id of ["username", "address"]) {
      await page.locator(`#${id}`).focus();
      await expect(badge).toHaveCount(0);
    }
    assert.equal(await page.evaluate(() => globalThis.excludedReads), 0);
    const rich = page.locator("#reply");
    await rich.focus();
    await expect(badge).toHaveAttribute("data-kind", "spelling");
    await badge.click();
    await card
      .locator(
        '.issue-label[data-original="sentnce"][data-category="spelling"]',
      )
      .click();
    await card.getByRole("button", { name: "sentence", exact: true }).click();
    await expect(rich.locator("b")).toHaveText("sentence");
    await expect(rich.locator("em")).toHaveText("this formatting");
    await rich.press("Control+z");
    await expect(rich.locator("b")).toHaveText("sentnce");
    await expect(badge).toHaveAttribute("data-kind", "spelling");
    await rich.locator("b").evaluate((element) => {
      element.style.display = "none";
    });
    await expect(badge).not.toHaveAttribute("data-kind", "spelling");
    await rich.locator("b").evaluate((element) => {
      element.style.display = "";
    });
    await expect(badge).toHaveAttribute("data-kind", "spelling");
    await rich.evaluate((element) => {
      element.innerHTML =
        'This is a sent<span style="display:none">PRIVATE_CANARY</span>nce.';
      element.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await rich.focus();
    await expect(badge).toHaveAttribute(
      "data-kind",
      /spelling|grammar|mixed|clean/,
    );
    await badge.click();
    assert.equal(
      await card.locator('.issue-label[data-original="sentnce"]').count(),
      0,
      "proofing never joins words across CSS-hidden content",
    );
    await card
      .getByRole("button", { name: "Close writing suggestions" })
      .click();
    await page.locator("#shadow textarea").fill("This is a sentnce.");
    await expect(badge).toHaveAttribute("data-kind", "spelling");
    await page
      .locator("#shadow textarea")
      .evaluate((element) => element.setAttribute("autocomplete", "username"));
    await expect(badge).toHaveCount(0);

    await field.fill("This is a sentnce. This is a apple. ".repeat(12));
    await expect(badge.locator(".badge-count")).toHaveText("24");
    await page
      .getByRole("heading", { name: "Writing review", exact: true })
      .hover();
    const compactBounds = await badge.boundingBox();
    await badge.hover();
    assert.deepEqual(
      await badge.boundingBox(),
      compactBounds,
      "hover never expands the compact hit target across text or host controls",
    );
    await badge.click();
    await expect(card.locator(".issue-row")).toHaveCount(24);
    const geometry = await card.locator(".review-list").evaluate((element) => ({
      client: element.clientHeight,
      scroll: element.scrollHeight,
    }));
    assert.ok(
      geometry.scroll > geometry.client,
      "issue list scrolls, not the action footer",
    );
    await card.locator(".review-list").evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });
    await expect(card.getByRole("switch")).toBeVisible();
    assert.equal(await worker.evaluate(() => globalThis.marginNetwork), 0);
    if (process.env.EXTENSION_SCREENSHOTS) {
      await mkdir(process.env.EXTENSION_SCREENSHOTS, { recursive: true });
      await page.screenshot({
        path: join(process.env.EXTENSION_SCREENSHOTS, "margin-overview.png"),
      });
    }
    const panel = await context.newPage();
    await panel.goto(`chrome-extension://${extensionId}/panel.html`);
    await panel.getByRole("button", { name: "Writing", exact: true }).click();
    await expect(
      panel.getByRole("button", { name: "Writing settings", exact: true }),
    ).toBeVisible();
    await expect(panel.locator("#writing-site-review")).toContainText(
      "Choose a text field",
    );
    await page.bringToFront();
    const current = await panel.evaluate(async () => {
      const { id } = await chrome.windows.getCurrent();
      return chrome.runtime.sendMessage({
        kind: "writingReviewGet",
        windowId: id,
      });
    });
    assert.equal(current.ok, true);
    assert.equal(
      current.data.issues.length,
      24,
      "trusted panel reads only the active field",
    );
    const toggle = async (action) =>
      panel.evaluate(
        async ({ state, action }) => {
          const { id } = await chrome.windows.getCurrent();
          return chrome.runtime.sendMessage({
            kind: "writingReviewAction",
            windowId: id,
            payload: {
              editorId: state.editorId,
              revision: state.revision,
              action,
            },
          });
        },
        { state: current.data, action },
      );
    const paused = await toggle("pause");
    assert.equal(paused.data.phase, "paused");
    await expect(panel.locator("#writing-site-review")).toContainText(
      "Off here",
    );
    await page.locator("#subject").fill("A new message.");
    await toggle("pause");
    await expect(page.locator(".badge")).not.toHaveAttribute(
      "aria-label",
      /Off here/,
    );
    await expect(page.locator("#subject")).toHaveValue("A new message.");
    await expect(panel.locator("#writing-site-review")).toContainText(
      "No issues found",
    );
    const a11y = await new AxeBuilder({ page: panel }).analyze();
    assert.deepEqual(
      a11y.violations.map((issue) => issue.id),
      [],
    );
    await field.focus();
    await badge.click();
    await card.getByRole("switch", { name: "Checking in this field" }).check();
    await card
      .getByRole("button", { name: "Close writing suggestions" })
      .click();
    await field.fill("This is a sentnce. This is a apple.");
    await expect(badge).toHaveAttribute("data-kind", "mixed");
    await page.setViewportSize({ width: 390, height: 844 });
    await badge.click();
    await card
      .locator(
        '.issue-label[data-original="sentnce"][data-category="spelling"]',
      )
      .click();
    const narrow = await new AxeBuilder({ page }).analyze();
    assert.deepEqual(
      narrow.violations.map((issue) => issue.id),
      [],
    );
    for (const width of [280, 320, 390, 768]) {
      await panel.setViewportSize({ width, height: 480 });
      await page.bringToFront();
      await expect(panel.locator("#writing-site-review")).toContainText(
        "2 issues",
      );
      assert.equal(
        await panel.evaluate(
          () => document.documentElement.scrollWidth > innerWidth,
        ),
        false,
        `no sidebar overflow at ${width}`,
      );
    }
    if (process.env.EXTENSION_SCREENSHOTS) {
      await panel.setViewportSize({ width: 320, height: 480 });
      await panel.screenshot({
        path: join(process.env.EXTENSION_SCREENSHOTS, "margin-sidebar-320.png"),
      });
      await page.screenshot({
        path: join(process.env.EXTENSION_SCREENSHOTS, "margin-detail-390.png"),
      });
      await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
      await page.addStyleTag({
        content:
          ":root{color-scheme:dark}body{background:#191c1a;color:#edf2e8}textarea,input,[contenteditable]{background:#222624;color:#edf2e8;border-color:#5a705d}",
      });
      await page.screenshot({
        path: join(
          process.env.EXTENSION_SCREENSHOTS,
          "margin-detail-dark-390.png",
        ),
      });
    }
  } finally {
    await context.close();
  }
});
