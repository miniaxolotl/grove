/* global URL, Headers, Response, crypto, document, innerWidth, console, fetch, AbortSignal */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtemp, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import process from "node:process";

// Reuse the repository's locked browser/axe tooling, not a second browser stack.
const require = createRequire(
  new URL("../packages/website/package.json", import.meta.url),
);
const { chromium } = require("@playwright/test");
const { default: AxeBuilder } = require("@axe-core/playwright");
const accountId = "00000000-0000-4000-a000-000000000001",
  connectionId = "00000000-0000-4000-a000-000000000002";

for (const target of ["chrome", "edge"])
  test(`installed ${target} package runs capture, recall, context and recovery with synthetic HTTP responses`, async () => {
    const directory = await mkdtemp(
      join(
        process.env.CI ? tmpdir() : "/tmp/opencode",
        "grove-extension-host-",
      ),
    );
    const extension = resolve(`packages/browser-extension/dist/${target}`);
    const context = await chromium.launchPersistentContext(directory, {
      channel: "chromium",
      ignoreDefaultArgs: ["--disable-extensions"],
      ...(target === "edge" && process.env.EXTENSION_EDGE_BINARY
        ? { executablePath: process.env.EXTENSION_EDGE_BINARY }
        : {}),
      headless: process.env.EXTENSION_HEADED !== "1",
      args: [
        `--disable-extensions-except=${extension}`,
        `--load-extension=${extension}`,
      ],
      viewport: { width: 390, height: 844 },
    });
    try {
      console.info(`${target} host: ${context.browser().version()}`);
      const worker =
        context.serviceWorkers()[0] ??
        (await context.waitForEvent("serviceworker"));
      const extensionId = new URL(worker.url()).host;
      if (process.env.EXTENSION_PUBLIC_NETWORK === "1") {
        const publicHosts = await worker.evaluate(async () => {
          const metadata = await fetch(
            "https://api.usegrove.cloud/.well-known/oauth-protected-resource/mcp",
            {
              credentials: "omit",
              cache: "no-store",
              redirect: "error",
              signal: AbortSignal.timeout(10000),
            },
          );
          if (!metadata.ok)
            throw new Error(`Public API discovery status ${metadata.status}`);
          const resource = await metadata.json();
          const discovery = await fetch(
            "https://clerk.usegrove.cloud/.well-known/openid-configuration",
            {
              credentials: "omit",
              cache: "no-store",
              redirect: "error",
              signal: AbortSignal.timeout(10000),
            },
          );
          if (!discovery.ok)
            throw new Error(
              `Public issuer discovery status ${discovery.status}`,
            );
          return {
            resource: resource.resource,
            issuers: resource.authorization_servers,
            issuer: (await discovery.json()).issuer,
          };
        });
        assert.equal(publicHosts.resource, "https://api.usegrove.cloud/mcp");
        assert.deepEqual(publicHosts.issuers, ["https://clerk.usegrove.cloud"]);
        assert.equal(
          new URL(publicHosts.issuer).origin,
          "https://clerk.usegrove.cloud",
        );
        console.info(
          `${target} privileged public API/issuer discovery passed (no credentials or mutations)`,
        );
      }
      await worker.evaluate(
        async ({ accountId, connectionId }) => {
          const browser = globalThis.chrome;
          const currentWindow = await browser.windows.getCurrent();
          const key = `oauth:https://api.usegrove.cloud|https://clerk.usegrove.cloud|${browser.identity.getRedirectURL()}`;
          await browser.storage.session.set({
            [`entryError:${currentWindow.id}`]:
              "Synthetic capture was rejected before the panel opened.",
            [`${key}:tokens`]: {
              access_token: "fixture-token",
              token_type: "Bearer",
              expires_in: 3600,
            },
            [`${key}:expires`]: Date.now() + 3600000,
          });
          const notes = [],
            operations = new Map();
          let uncertain = true;
          globalThis.fixtureRequests = [];
          globalThis.fixtureSearchQueries = [];
          globalThis.fetch = async (input, init) => {
            const path = new URL(String(input)).pathname;
            globalThis.fixtureRequests.push(path);
            if (
              new Headers(init?.headers).get("Authorization") !==
              "Bearer fixture-token"
            )
              return Response.json(
                {
                  success: false,
                  error: {
                    code: "unauthorized",
                    message: "Fixture token required",
                  },
                },
                { status: 401 },
              );
            const body = init?.body ? JSON.parse(String(init.body)) : {};
            let data;
            if (path === "/v1/browser/connect")
              data = {
                accountId,
                connectionId,
                capabilities: ["memory:read", "memory:write"],
                grant: { personal: true, allProjects: false, projectIds: [] },
              };
            else if (path === "/v1/tools/notebooks")
              data = { items: [], nextCursor: null };
            else if (path === "/v1/browser/captures") {
              if (operations.has(body.operationId))
                data = operations.get(body.operationId);
              else {
                data = {
                  id: crypto.randomUUID(),
                  projectId: null,
                  content: body.content,
                  kind: "fact",
                  version: 1,
                  status: "active",
                  source: { agent: "api" },
                  taskId: null,
                  expiresAt: null,
                  purgeAt: null,
                  indexing: "pending",
                  createdAt: new Date().toISOString(),
                  updatedAt: new Date().toISOString(),
                };
                notes.push(data);
                operations.set(body.operationId, data);
              }
              if (uncertain) {
                uncertain = false;
                throw new Error("Fixture connection lost after commit");
              }
            } else if (
              path === "/v1/memories/search" ||
              path === "/v1/browser/pages"
            ) {
              if (path === "/v1/memories/search") {
                globalThis.fixtureSearchQueries.push(body);
                await globalThis.fixtureSearchGate;
                if (body.query === "latest") await globalThis.fixtureLatestGate;
                if (globalThis.fixtureSearchFailed)
                  throw new Error("Synthetic search is offline");
              }
              data = { items: notes, nextCursor: null };
            } else if (path.startsWith("/v1/memories/"))
              data = notes.find((note) => path.endsWith(note.id));
            else throw new Error(`Unexpected fixture request ${path}`);
            return Response.json({ success: true, data });
          };
        },
        { accountId, connectionId },
      );
      const page = await context.newPage();
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.goto(`chrome-extension://${extensionId}/panel.html`);
      await page.locator("#workspace").waitFor({ state: "visible" });
      assert.deepEqual(
        await page.locator("#navigation button").allTextContents(),
        ["Notes", "Search", "Settings"],
      );
      assert.equal(await page.locator("#new-note").isVisible(), false);
      assert.equal(await page.locator("#save-details").isVisible(), false);
      await page
        .locator("#notice")
        .filter({
          hasText: "Synthetic capture was rejected before the panel opened.",
        })
        .waitFor({ timeout: 3000 });
      await page.locator("#dismiss-notice").click();
      await page.evaluate(async () => {
        const window = await globalThis.chrome.windows.getCurrent();
        globalThis.chrome.sidePanel.onOpened.addListener((info) => {
          globalThis.nativePanelOpened = info;
        });
        const button = document.createElement("button");
        button.id = "native-panel-probe";
        button.textContent = "Native panel probe";
        button.onclick = () => {
          void globalThis.chrome.sidePanel.open({ windowId: window.id }).then(
            () => {
              globalThis.nativePanelResult = "accepted";
            },
            (error) => {
              globalThis.nativePanelResult = error.message;
            },
          );
        };
        document.body.prepend(button);
      });
      await page.locator("#native-panel-probe").click();
      await page.waitForFunction(() => globalThis.nativePanelResult);
      assert.equal(
        await page.evaluate(() => globalThis.nativePanelResult),
        "accepted",
      );
      if (!process.env.EXTENSION_EDGE_BINARY || target !== "edge") {
        await page.waitForFunction(() => globalThis.nativePanelOpened);
        assert.ok(
          (
            await page.evaluate(() => globalThis.nativePanelOpened.path)
          ).endsWith("/panel.html"),
        );
      } else
        console.info(
          "Native Edge accepted sidePanel.open; onOpened/visible sidebar is not asserted by this supplemental host test.",
        );
      await page
        .locator("#native-panel-probe")
        .evaluate((element) => element.remove());
      assert.equal(await page.locator("#note").inputValue(), "");
      assert.ok(
        !(await worker.evaluate(() => globalThis.fixtureRequests)).includes(
          "/v1/browser/pages",
        ),
      );
      // Installed browser navigation, not fabricated tab messages. The panel stays
      // mounted while its window's actual active tab navigates across origins.
      await context.route("https://source.example/**", (route) =>
        route.fulfill({
          contentType: "text/html",
          body: "<title>First source</title><p>Source fixture</p>",
        }),
      );
      await context.route("https://next.example/**", (route) =>
        route.fulfill({
          contentType: "text/html",
          body: "<title>Next source</title><p>Next fixture</p>",
        }),
      );
      const sourceTab = await context.newPage();
      await sourceTab.goto(
        "https://source.example/article?utm_source=fixture&id=1",
      );
      await page.waitForFunction(
        () =>
          document.querySelector("#source-url").value ===
          "https://source.example/article?id=1",
      );
      assert.equal(
        await page.locator("#source-title").inputValue(),
        "First source",
      );
      if (process.env.EXTENSION_SCREENSHOTS) {
        await mkdir(process.env.EXTENSION_SCREENSHOTS, { recursive: true });
        await page.screenshot({
          path: join(
            process.env.EXTENSION_SCREENSHOTS,
            `${target}-notes-auto-390.png`,
          ),
          fullPage: true,
        });
      }
      const requestsBeforeNavigation = await worker.evaluate(
        () => globalThis.fixtureRequests.length,
      );
      await sourceTab.goto("https://next.example/other");
      await page.waitForFunction(
        () => document.querySelector("#source-title").value === "Next source",
      );
      assert.equal(
        await page.locator("#source-url").inputValue(),
        "https://next.example/other",
      );
      await sourceTab.evaluate(() => {
        document.title = "Updated source";
      });
      await page.waitForFunction(
        () =>
          document.querySelector("#source-title").value === "Updated source",
      );
      assert.equal(
        await worker.evaluate(() => globalThis.fixtureRequests.length),
        requestsBeforeNavigation,
        "prefill and title changes never contact Grove",
      );
      await sourceTab.goto("about:blank");
      await page.waitForFunction(
        () => document.querySelector("#source-url").value === "",
      );
      await sourceTab.goto("https://source.example/article");
      await page.waitForFunction(
        () => document.querySelector("#source-title").value === "First source",
      );
      await worker.evaluate(() => {
        const nativeQuery = globalThis.chrome.tabs.query.bind(
          globalThis.chrome.tabs,
        );
        globalThis.fixtureTabsQueryStarted = new Promise((resolve) => {
          globalThis.markTabsQueryStarted = resolve;
        });
        const gate = new Promise((resolve) => {
          globalThis.releaseTabsQuery = () => {
            globalThis.chrome.tabs.query = nativeQuery;
            resolve();
          };
        });
        globalThis.chrome.tabs.query = async (...args) => {
          globalThis.markTabsQueryStarted();
          await gate;
          return nativeQuery(...args);
        };
      });
      await sourceTab.goto("https://next.example/other");
      await worker.evaluate(() => globalThis.fixtureTabsQueryStarted);
      await page.locator("#note").fill("Pin this originating page");
      await worker.evaluate(() => globalThis.releaseTabsQuery());
      await page.locator("#new-note").waitFor({ state: "visible" });
      assert.equal(
        await page.locator("#source-url").inputValue(),
        "https://source.example/article",
        "late navigation metadata cannot replace the source visible at first edit",
      );
      await page.reload();
      await page.locator("#workspace").waitFor({ state: "visible" });
      assert.equal(
        await page.locator("#source-url").inputValue(),
        "https://source.example/article",
      );
      await page.locator("#new-note").click();
      await page.locator("#confirm-replace").click();
      await sourceTab.bringToFront();
      await page.waitForFunction(
        () => document.querySelector("#source-title").value === "Next source",
      );
      await page.locator("#source-details summary").click();
      await page.locator("#remove-source").click();
      await sourceTab.goto("https://source.example/article");
      assert.equal(
        await page.locator("#source-url").inputValue(),
        "",
        "explicit removal stays pinned off",
      );
      await page.locator("#source-details summary").click();
      await page
        .locator("#note")
        .fill(
          "# Field notes\n\nA source worth keeping. <script>not executable</script>\n\n- [x] A useful task\n- **A clear idea**\n\n| Tool | Purpose |\n| --- | --- |\n| Grove | Keep thoughts |\n\n```js\nconst safe = true;\n```\n\n[Source](https://example.com/read)\n\n[Unsafe](javascript:alert(1))\n\n![No tracking](https://tracker.example/pixel.png)",
        );
      await page.locator("#save").click();
      await page
        .locator("#save-state")
        .filter({ hasText: "Save not confirmed" })
        .waitFor();
      assert.equal(
        await page.locator("#recovery-settings").evaluate((el) => el.hidden),
        false,
        "unknown saves keep a visible recovery section in Settings",
      );
      const uncertainRequests = await worker.evaluate(
        () => globalThis.fixtureRequests.length,
      );
      const uncertainReceipts = await worker.evaluate(() =>
        globalThis.chrome.storage.local.get("pending"),
      );
      await page.locator("#extension-toggle").click();
      await page.locator("#paused").waitFor({ state: "visible" });
      await page.reload();
      await page.locator("#paused").waitFor({ state: "visible" });
      assert.equal(
        await worker.evaluate(() => globalThis.fixtureRequests.length),
        uncertainRequests,
      );
      assert.deepEqual(
        await worker.evaluate(() =>
          globalThis.chrome.storage.local.get("pending"),
        ),
        uncertainReceipts,
        "unknown saves retain their exact recovery receipt while off",
      );
      await page.locator("#extension-toggle").click();
      await page.locator("#workspace").waitFor({ state: "visible" });
      assert.match(
        await page.locator("#save-state").textContent(),
        /Save not confirmed/,
      );
      await page.locator("#note").fill("A newer draft stays after retry.");
      await page.locator("#save").click();
      await page
        .locator("#save-state")
        .filter({
          hasText:
            "Your earlier note is saved. These changes aren’t saved yet.",
        })
        .waitFor();
      assert.equal(
        await page.locator("#note").inputValue(),
        "A newer draft stays after retry.",
      );
      assert.equal(await page.locator("#save-version").isVisible(), false);
      await page.locator("#save-details summary").click();
      assert.equal(await page.locator("#save-version").textContent(), "1");
      assert.equal(
        await page.locator("#save-indexing").textContent(),
        "pending",
      );
      await page.locator("#save-details summary").click();
      if (process.env.EXTENSION_SCREENSHOTS) {
        await mkdir(process.env.EXTENSION_SCREENSHOTS, { recursive: true });
        await page.screenshot({
          path: join(
            process.env.EXTENSION_SCREENSHOTS,
            `${target}-capture-390.png`,
          ),
          fullPage: true,
        });
      }
      const persisted = await worker.evaluate(() =>
        globalThis.chrome.storage.local.get(null),
      );
      assert.ok(!JSON.stringify(persisted).includes("worth keeping"));
      assert.ok(!JSON.stringify(persisted).includes("fixture-token"));
      await page.locator('[data-nav="search"]').click();
      assert.equal(await page.locator("#context-actions").isVisible(), false);
      await page.locator("#query").fill("source");
      assert.equal(
        await page.locator("#search-form button, #search-form select").count(),
        0,
      );
      await page.locator("#results .note-row").waitFor();
      assert.equal(await page.locator("#results .note-row").count(), 1);
      assert.deepEqual(
        await worker.evaluate(() => globalThis.fixtureSearchQueries.at(-1)),
        { query: "source", status: "active", limit: 20, sort: "relevance" },
        "omit projectId to search all granted scopes, not Personal only",
      );
      await page.evaluate(() => {
        globalThis.retainedSearchRow =
          document.querySelector("#results .note-row");
      });
      await worker.evaluate(() => {
        globalThis.fixtureSearchGate = new Promise((resolve) => {
          globalThis.releaseSearch = resolve;
        });
      });
      await page.locator("#query").press("Enter");
      await page
        .locator("#results-status")
        .filter({ hasText: "Finding notes" })
        .waitFor();
      assert.equal(
        await page.evaluate(
          () =>
            globalThis.retainedSearchRow ===
            document.querySelector("#results .note-row"),
        ),
        true,
      );
      assert.equal(
        await page
          .locator("#query")
          .evaluate((el) => el === document.activeElement),
        true,
      );
      await worker.evaluate(() => globalThis.releaseSearch());
      await page
        .locator("#results-status")
        .filter({ hasText: "1 note · checked" })
        .waitFor();
      assert.equal(
        await page.evaluate(
          () =>
            globalThis.retainedSearchRow ===
            document.querySelector("#results .note-row"),
        ),
        true,
        "unchanged results keep their mounted row after refresh",
      );
      await worker.evaluate(() => {
        globalThis.fixtureSearchFailed = true;
      });
      await page.locator("#query").press("Enter");
      await page
        .locator("#results-status")
        .filter({ hasText: "stale" })
        .waitFor();
      assert.equal(await page.locator("#results .note-row").count(), 1);
      assert.equal(await page.locator("#query").inputValue(), "source");
      await worker.evaluate(() => {
        globalThis.fixtureSearchFailed = false;
      });
      await page.locator("#query").press("Enter");
      await page
        .locator("#results-status")
        .filter({ hasText: "1 note · checked" })
        .waitFor();
      await page.locator("#results .note-row button").click();
      await page.locator("#reader[open]").waitFor();
      assert.equal(
        await page.locator("#reader-content h2").textContent(),
        "Field notes",
      );
      assert.equal(
        await page
          .locator("#reader-content table tbody td")
          .first()
          .textContent(),
        "Grove",
      );
      assert.equal(
        await page.locator("#reader-content pre code").textContent(),
        "const safe = true;",
      );
      assert.equal(
        await page.locator("#reader-content .reader-task input").isChecked(),
        true,
      );
      assert.equal(
        await page
          .locator(
            "#reader-content script, #reader-content img, #reader-content iframe, #reader-content a[href^='javascript:']",
          )
          .count(),
        0,
      );
      assert.equal(
        await page.locator("#reader-content a").first().getAttribute("rel"),
        "noreferrer noopener",
      );
      const readerAudit = await new AxeBuilder({ page }).analyze();
      assert.deepEqual(
        readerAudit.violations.map((item) => item.id),
        [],
        "formatted reader accessibility",
      );
      assert.match(
        await page.locator("#reader-content").textContent(),
        /<script>not executable<\/script>/,
      );
      await page.locator("#copy-note").click();
      await page
        .locator("#reader-copy-state")
        .filter({ hasText: /Copied|Could not copy/ })
        .waitFor();
      if (process.env.EXTENSION_SCREENSHOTS) {
        await page.screenshot({
          path: join(
            process.env.EXTENSION_SCREENSHOTS,
            `${target}-reader-390.png`,
          ),
          fullPage: true,
        });
      }
      await page.locator("#close-reader").click();
      const statusBeforeSelection = await page
        .locator("#results-status")
        .boundingBox();
      await page.locator('#results input[type="checkbox"]').check();
      assert.equal(await page.locator("#context-actions").isVisible(), true);
      assert.equal(
        (await page.locator("#results-status").boundingBox()).y,
        statusBeforeSelection.y,
        "context actions use reserved space instead of shifting results",
      );
      await page.locator("#review-context").click();
      await page.locator("#context[open]").waitFor();
      assert.equal(await page.locator("#copy").isDisabled(), true);
      assert.match(
        await page.locator("#context-text").inputValue(),
        /Grove source: https:\/\/usegrove.cloud\/app\/memories\//,
      );
      await page.locator("#copy-consent").check();
      await page.locator("#copy").click();
      await page
        .locator("#copy-state")
        .filter({ hasText: /Copied|Clipboard unavailable/ })
        .waitFor();
      await page.locator("#close-context").click();
      await page.locator("#clear-selection").click();
      assert.equal(await page.locator("#context-actions").isVisible(), false);
      assert.equal(
        await page.locator('#results input[type="checkbox"]').isChecked(),
        false,
      );
      for (const width of [280, 320, 390, 768]) {
        await page.setViewportSize({ width, height: 844 });
        assert.ok(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
          `overflow at ${width}`,
        );
        const audit = await new AxeBuilder({ page }).analyze();
        assert.deepEqual(
          audit.violations.map((item) => item.id),
          [],
          `axe at ${width}`,
        );
      }
      if (process.env.EXTENSION_SCREENSHOTS) {
        await mkdir(process.env.EXTENSION_SCREENSHOTS, { recursive: true });
        await page.setViewportSize({ width: 390, height: 844 });
        await page.screenshot({
          path: join(
            process.env.EXTENSION_SCREENSHOTS,
            `${target}-search-390.png`,
          ),
          fullPage: true,
        });
      }
      await page.locator('[data-nav="capture"]').click();
      await page.reload();
      await page.locator("#workspace").waitFor({ state: "visible" });
      assert.equal(
        await page.locator("#note").inputValue(),
        "A newer draft stays after retry.",
      );
      await page.locator('[data-nav="search"]').click();
      const beforeTyping = await worker.evaluate(
        () => globalThis.fixtureSearchQueries.length,
      );
      await page.locator("#query").pressSequentially("source", { delay: 15 });
      await page
        .locator("#results-status")
        .filter({ hasText: "1 note · checked" })
        .waitFor();
      assert.equal(
        await worker.evaluate(() => globalThis.fixtureSearchQueries.length),
        beforeTyping + 1,
        "typing a word issues one debounced request",
      );
      await worker.evaluate(() => {
        globalThis.fixtureSearchGate = new Promise((resolve) => {
          globalThis.releaseSearch = resolve;
        });
        globalThis.fixtureLatestGate = new Promise((resolve) => {
          globalThis.releaseLatest = resolve;
        });
      });
      await page.locator("#query").fill("obsolete");
      await page
        .locator("#results-status")
        .filter({ hasText: "Finding notes" })
        .waitFor();
      await page.locator("#query").fill("latest");
      await worker.evaluate(() => globalThis.releaseSearch());
      await page.waitForFunction(() =>
        document
          .querySelector("#results-status")
          .textContent.includes("Finding notes"),
      );
      assert.ok(
        !(await page.locator("#results-status").textContent()).includes(
          "checked",
        ),
        "obsolete results cannot mark a newer query complete",
      );
      await worker.evaluate(() => globalThis.releaseLatest());
      await page
        .locator("#results-status")
        .filter({ hasText: "1 note · checked" })
        .waitFor();
      await page.locator("#query").fill("");
      await page
        .locator("#results-status")
        .filter({ hasText: "Type to search" })
        .waitFor();
      assert.equal(await page.locator("#results .note-row").count(), 0);
      await page.locator('[data-nav="settings"]').click();
      assert.equal(await page.locator("#account-id").isVisible(), false);
      assert.equal(await page.locator("#recovery-settings").isVisible(), false);
      if (process.env.EXTENSION_SCREENSHOTS)
        await page.screenshot({
          path: join(
            process.env.EXTENSION_SCREENSHOTS,
            `${target}-settings-390.png`,
          ),
          fullPage: true,
        });
      for (const width of [320, 390, 768]) {
        await page.setViewportSize({ width, height: 844 });
        for (const name of ["capture", "search", "settings"]) {
          await page.locator(`[data-nav="${name}"]`).click();
          assert.ok(
            await page.evaluate(
              () => document.documentElement.scrollWidth <= innerWidth,
            ),
            `${name} overflow at ${width}`,
          );
          assert.ok(
            (await page.locator(".primary:visible").count()) <= 1,
            `${name} has one primary action at most`,
          );
          const audit = await new AxeBuilder({ page }).analyze();
          assert.deepEqual(
            audit.violations.map((item) => item.id),
            [],
            `${name} axe at ${width}`,
          );
          if (process.env.EXTENSION_SCREENSHOTS)
            await page.screenshot({
              path: join(
                process.env.EXTENSION_SCREENSHOTS,
                `${target}-minimal-${name}-${width}.png`,
              ),
              fullPage: true,
            });
        }
      }
      await page.setViewportSize({ width: 390, height: 480 });
      await page.locator('[data-nav="capture"]').click();
      await page.locator("#source-details summary").click();
      await page.locator("#save").scrollIntoViewIfNeeded();
      const saveBox = await page.locator("#save").boundingBox();
      const navBox = await page.locator("#navigation").boundingBox();
      assert.ok(
        saveBox.y >= 0 && saveBox.y + saveBox.height <= navBox.y,
        "Save stays reachable above navigation in a short panel",
      );
      assert.equal(
        await page.locator("#note").inputValue(),
        "A newer draft stays after retry.",
      );
      await page.locator('[data-nav="settings"]').click();
      const otherPanel = await context.newPage();
      await otherPanel.goto(`chrome-extension://${extensionId}/panel.html`);
      await otherPanel.locator("#workspace").waitFor({ state: "visible" });
      assert.equal(
        await otherPanel.locator("#note").inputValue(),
        "A newer draft stays after retry.",
      );
      await page.locator("#extension-toggle").click();
      await page.waitForFunction(
        () =>
          document
            .querySelector("#extension-toggle")
            .getAttribute("aria-checked") === "false",
      );
      await otherPanel.locator("#paused").waitFor({ state: "visible" });
      const pausedRequests = await worker.evaluate(
        () => globalThis.fixtureRequests.length,
      );
      const pausedSession = await worker.evaluate(() =>
        globalThis.chrome.storage.session.get(null),
      );
      await otherPanel.reload();
      await otherPanel.locator("#paused").waitFor({ state: "visible" });
      assert.equal(
        await worker.evaluate(() => globalThis.fixtureRequests.length),
        pausedRequests,
        "reopening while off does not contact Grove",
      );
      assert.deepEqual(
        await worker.evaluate(() =>
          globalThis.chrome.storage.session.get(null),
        ),
        pausedSession,
      );
      assert.equal(
        await worker.evaluate(() => globalThis.chrome.action.getBadgeText({})),
        "OFF",
      );
      for (const width of [280, 320, 390, 768]) {
        await otherPanel.setViewportSize({ width, height: 600 });
        const audit = await new AxeBuilder({ page: otherPanel }).analyze();
        assert.deepEqual(
          audit.violations.map((item) => item.id),
          [],
          `paused axe at ${width}`,
        );
        assert.ok(
          await otherPanel.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        );
      }
      await page.locator("#theme").selectOption("dark");
      await otherPanel.waitForFunction(
        () => document.documentElement.dataset.theme === "dark",
      );
      const darkAudit = await new AxeBuilder({ page }).analyze();
      assert.deepEqual(
        darkAudit.violations.map((item) => item.id),
        [],
        "dark Settings accessibility",
      );
      for (const width of [280, 320, 390, 768]) {
        await page.setViewportSize({ width, height: 600 });
        const audit = await new AxeBuilder({ page }).analyze();
        assert.deepEqual(
          audit.violations.map((item) => item.id),
          [],
          `dark Settings at ${width}`,
        );
        assert.ok(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        );
        await page.locator("#logout").scrollIntoViewIfNeeded();
        assert.ok(
          await page.locator("#logout").evaluate((element) => {
            const box = element.getBoundingClientRect(),
              nav = document.querySelector("nav").getBoundingClientRect();
            return box.bottom <= nav.top;
          }),
          "scrollable Settings actions cannot hide beneath navigation",
        );
      }
      if (process.env.EXTENSION_SCREENSHOTS) {
        await page.setViewportSize({ width: 390, height: 844 });
        await page.locator("main").evaluate((element) => {
          element.scrollTop = 0;
        });
        await otherPanel.setViewportSize({ width: 390, height: 844 });
        await otherPanel.screenshot({
          path: join(
            process.env.EXTENSION_SCREENSHOTS,
            `${target}-off-dark-390.png`,
          ),
          fullPage: true,
        });
        await page.screenshot({
          path: join(
            process.env.EXTENSION_SCREENSHOTS,
            `${target}-settings-dark-390.png`,
          ),
          fullPage: true,
        });
      }
      await page.locator("#theme").selectOption("system");
      await otherPanel.locator("#extension-toggle").focus();
      await otherPanel.locator("#extension-toggle").press("Space");
      await otherPanel.locator("#workspace").waitFor({ state: "visible" });
      assert.equal(
        await otherPanel.evaluate(() => document.activeElement.id),
        "extension-toggle",
        "keyboard toggle preserves focus through resume",
      );
      assert.equal(
        await otherPanel.locator("#note").inputValue(),
        "A newer draft stays after retry.",
      );
      await page.waitForFunction(
        () =>
          document
            .querySelector("#extension-toggle")
            .getAttribute("aria-checked") === "true",
      );
      await page.locator("#logout").click();
      await page.locator("#welcome").waitFor({ state: "visible" });
      await otherPanel
        .locator("#welcome")
        .waitFor({ state: "visible", timeout: 3000 });
      assert.equal(await otherPanel.locator("#note").inputValue(), "");
      assert.deepEqual(
        await worker.evaluate(() =>
          globalThis.chrome.storage.session.get(null),
        ),
        {},
      );
      assert.deepEqual(errors, []);
    } finally {
      await context.close();
    }
  });
