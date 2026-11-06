/* global URL, Headers, Response, crypto, document, innerWidth, console, fetch, AbortSignal, chrome, performance, HTMLTextAreaElement, Node */
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
      await worker.evaluate(() => {
        globalThis.localOnlyRequests = 0;
        globalThis.fetch = async () => {
          globalThis.localOnlyRequests++;
          throw new Error("Local checks must not contact a server");
        };
      });
      const localPage = await context.newPage();
      await localPage.route("https://**.writing-fixture.test/**", (route) =>
        route.fulfill({
          contentType: "text/html",
          body: '<!doctype html><html lang="en"><title>Local-only writing</title><body><label for="draft">Message</label><textarea id="draft" rows="8" style="width:95%;height:180px"></textarea></body></html>',
        }),
      );
      await localPage.goto("https://notes.writing-fixture.test/form");
      await localPage.locator("#draft").fill("This is a sentnce.");
      await localPage
        .locator("div[data-grove-writing-ui]")
        .waitFor({ state: "attached" });
      await localPage.locator("#draft").press("Alt+Enter");
      await localPage
        .getByRole("button", { name: "sentnce — Spelling", exact: true })
        .click();
      await localPage
        .getByRole("button", { name: "sentence", exact: true })
        .click();
      assert.equal(
        await localPage.locator("#draft").inputValue(),
        "This is a sentence.",
        "fresh install checks an unlisted website without signing in or site setup",
      );
      await worker.evaluate(async () => {
        const stored = (await chrome.storage.local.get("writing-browser:en"))[
          "writing-browser:en"
        ];
        await chrome.storage.local.set({
          "writing-browser:en": {
            ...stored,
            version: stored.version + 1,
            sites: [
              {
                domain: "writing-fixture.test",
                enabled: false,
                restrictions: {},
              },
            ],
          },
        });
      });
      await localPage
        .locator("div[data-grove-writing-ui]")
        .waitFor({ state: "detached" });
      await localPage.goto("https://deep.notes.writing-fixture.test/form");
      await localPage.locator("#draft").fill("This is a sentnce.");
      await localPage
        .locator("button[data-grove-writing-ui]")
        .waitFor({ state: "attached" });
      const domainState = await worker.evaluate(async () => {
        const [tab] = (await chrome.tabs.query({})).filter((tab) =>
          tab.url?.startsWith("https://deep.notes.writing-fixture.test/"),
        );
        return (
          await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            world: "ISOLATED",
            func: () =>
              chrome.runtime.sendMessage({ kind: "writingSiteState" }),
          })
        )[0].result;
      });
      assert.equal(
        domainState.data.settings.enabled,
        false,
        "domain Off includes every subdomain",
      );
      assert.equal(
        await localPage.locator("div[data-grove-writing-ui]").count(),
        0,
      );
      await worker.evaluate(async () => {
        const stored = (await chrome.storage.local.get("writing-browser:en"))[
          "writing-browser:en"
        ];
        await chrome.storage.local.set({
          "writing-browser:en": {
            ...stored,
            version: stored.version + 1,
            sites: [],
          },
        });
      });
      await localPage
        .locator("div[data-grove-writing-ui]")
        .waitFor({ state: "attached" });
      await worker.evaluate(async () => {
        const stored = (await chrome.storage.local.get("writing-browser:en"))[
          "writing-browser:en"
        ];
        await chrome.storage.local.set({
          "writing-browser:en": {
            ...stored,
            version: stored.version + 1,
            settings: { ...stored.settings, enabled: false },
          },
        });
      });
      await localPage
        .locator("div[data-grove-writing-ui]")
        .waitFor({ state: "detached" });
      await localPage.reload();
      await localPage.locator("#draft").focus();
      await localPage
        .locator("button[data-grove-writing-ui]")
        .waitFor({ state: "attached" });
      assert.equal(
        await localPage.locator("div[data-grove-writing-ui]").count(),
        0,
        "browser-wide writing Off survives navigation while signed out",
      );
      assert.equal(
        await worker.evaluate(() => globalThis.localOnlyRequests),
        0,
      );
      await worker.evaluate(async () => {
        const stored = (await chrome.storage.local.get("writing-browser:en"))[
          "writing-browser:en"
        ];
        await chrome.storage.local.set({
          "writing-browser:en": {
            ...stored,
            version: stored.version + 1,
            settings: { ...stored.settings, enabled: true },
          },
        });
      });
      await localPage.close();
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
          const writingOperations = new Map();
          let writingConsented = false;
          const writingAvailability = () => ({
            available: true,
            authorized: true,
            consented: writingConsented,
            policy: "rewrite-context-v3:0000000000000000",
            provider: "Synthetic writing provider; no live model transmission.",
          });
          let uncertain = true;
          globalThis.fixtureRequests = [];
          globalThis.fixtureCaptureRequests = [];
          globalThis.fixtureWritingInputs = [];
          globalThis.fixtureSearchQueries = [];
          globalThis.fixtureSharingAllowed = true;
          globalThis.fixtureShareWrites = [];
          const shares = new Map();
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
                writingTools: writingAvailability(),
                grant: {
                  personal: true,
                  allProjects: false,
                  projectIds: [],
                  sharingEnabled: globalThis.fixtureSharingAllowed,
                },
              };
            else if (path === "/v1/browser/writing/consent") {
              writingConsented = body.accepted;
              data = writingAvailability();
            } else if (path === "/v1/browser/writing/requests") {
              globalThis.fixtureWritingInputs.push(body);
              if (!writingConsented)
                throw new Error("Fixture requires explicit AI consent");
              const choices = {
                concise: ["I'm Elias.", "I am Elias.", "My name's Elias."],
                verbose: [
                  "I go by the name Elias.",
                  "The name I use is Elias.",
                  "I am known by the name Elias.",
                ],
                rewrite: [
                  "Elias is my name.",
                  "I'm called Elias.",
                  "My name's Elias.",
                ],
                humanize: [
                  "Hi, I'm Elias.",
                  "Hey, my name's Elias.",
                  "You can call me Elias.",
                ],
                synonyms: ["radiant", "luminous", "shining"],
                antonyms: ["dim", "dull", "dark"],
              };
              const work = {
                id: body.id,
                tool: body.tool,
                status: "queued",
                expiresAt: new Date(Date.now() + 900000).toISOString(),
                result: {
                  language: "en",
                  tool: body.tool,
                  original: body.sentence,
                  alternatives: choices[body.tool],
                },
              };
              writingOperations.set(body.id, work);
              data = { ...work, result: null };
            } else if (path.startsWith("/v1/browser/writing/requests/")) {
              const parts = path.split("/"),
                id = parts[5];
              if (path.endsWith("/cancel")) {
                writingOperations.delete(id);
                data = { id, status: "cancelled" };
              } else {
                const work = writingOperations.get(id);
                if (!work) throw new Error("Unknown writing fixture request");
                data = globalThis.fixtureWritingProcessing
                  ? { ...work, status: "processing", result: null }
                  : {
                      ...work,
                      status: "completed",
                      ...(globalThis.fixtureWritingExpired
                        ? {
                            expiresAt: new Date(
                              Date.now() - 1000,
                            ).toISOString(),
                          }
                        : {}),
                    };
              }
            } else if (path === "/v1/tools/notebooks")
              data = { items: [], nextCursor: null };
            else if (path === "/v1/browser/captures") {
              globalThis.fixtureCaptureRequests.push(body);
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
              globalThis.fixtureCaptureStarted?.();
              await globalThis.fixtureCaptureGate;
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
            } else if (path.endsWith("/share")) {
              globalThis.fixtureSharingStarted?.();
              await globalThis.fixtureSharingGate;
              const id = path.split("/")[3],
                note = notes.find((note) => note.id === id);
              if (!note) throw new Error("Unknown note");
              if (init?.method === "POST") {
                globalThis.fixtureShareWrites.push(body);
                shares.set(id, {
                  id: crypto.randomUUID(),
                  version: 1,
                  active: true,
                  includeDescendants: false,
                  duration: body.duration,
                  expiresAt: null,
                  url: `https://usegrove.cloud/s/gsh_${"A".repeat(43)}`,
                });
                if (globalThis.fixtureShareLost) {
                  globalThis.fixtureShareLost = false;
                  throw new Error("Fixture sharing response lost after commit");
                }
              }
              data = {
                available: true,
                canShare: true,
                target: {
                  kind: "note",
                  id,
                  name: "Field notes",
                  version: note.version,
                },
                direct: shares.get(id) ?? null,
                inherited: [],
              };
            } else if (
              path.startsWith("/v1/shares/") &&
              init?.method === "DELETE"
            ) {
              const [id, direct] = [...shares.entries()].find(([, share]) =>
                path.endsWith(share.id),
              );
              shares.set(id, {
                ...direct,
                active: false,
                url: null,
                version: direct.version + 1,
              });
              data = {
                available: true,
                canShare: true,
                target: {
                  kind: "note",
                  id,
                  name: "Field notes",
                  version: notes.find((note) => note.id === id).version,
                },
                direct: shares.get(id),
                inherited: [],
              };
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
      await page.evaluate(() => {
        const write = globalThis.navigator.clipboard.writeText.bind(
          globalThis.navigator.clipboard,
        );
        globalThis.navigator.clipboard.writeText = (text) => {
          globalThis.lastWritingCopy = text;
          return write(text);
        };
      });
      assert.deepEqual(
        await page.locator("#navigation button").allTextContents(),
        ["Notes", "Search", "Settings"],
      );
      assert.equal(await page.locator("#new-note").isVisible(), false);
      assert.equal(await page.locator("#save-details").count(), 0);
      await page
        .locator("#notice")
        .filter({
          hasText: "Couldn’t prepare that note. Try again.",
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
      const requestsBeforeWriting = await worker.evaluate(
        () => globalThis.fixtureRequests.length,
      );
      await page.locator("#note").fill("This is a sentnce.");
      await page
        .locator("#writing-review")
        .filter({ hasText: "1 suggestion" })
        .waitFor();
      await page.locator("#note").press("Alt+Enter");
      await page
        .getByRole("button", { name: "sentnce — Spelling", exact: true })
        .waitFor();
      await page.keyboard.press("Escape");
      await page.locator("#writing-review").click();
      await page
        .getByRole("button", { name: "sentnce — Spelling", exact: true })
        .click();
      await page
        .getByRole("button", { name: "sentence", exact: true })
        .waitFor();
      if (process.env.EXTENSION_SCREENSHOTS) {
        await mkdir(process.env.EXTENSION_SCREENSHOTS, { recursive: true });
        await page.screenshot({
          path: join(
            process.env.EXTENSION_SCREENSHOTS,
            `${target}-writing-correction-390.png`,
          ),
          fullPage: true,
        });
      }
      await page.getByRole("button", { name: "sentence", exact: true }).click();
      assert.equal(
        await page.evaluate(() => globalThis.lastWritingCopy),
        "sentence",
        "correction choices copy and replace in one click",
      );
      assert.equal(
        await page.locator("#note").inputValue(),
        "This is a sentence.",
      );
      await page.locator("#note").press("Control+z");
      assert.equal(
        await page.locator("#note").inputValue(),
        "This is a sentnce.",
        "corrections must preserve native Undo",
      );
      assert.equal(
        await worker.evaluate(() => globalThis.fixtureRequests.length),
        requestsBeforeWriting,
        "typing, checking, correction and Undo must not call the server/model",
      );
      const writingTimings = await page.evaluate(
        async ({ accountId, connectionId }) => {
          const window = await chrome.windows.getCurrent(),
            times = [];
          for (let i = 0; i < 30; i++) {
            const start = performance.now();
            const result = await chrome.runtime.sendMessage({
              kind: "writingCheck",
              windowId: window.id,
              accountId,
              connectionId,
              payload: {
                text: "This zorbler has a flibber and a quaxler. "
                  .repeat(150)
                  .slice(0, 6000),
              },
            });
            if (!result.ok || result.data.issues.length > 50)
              throw new Error("Local check did not complete within its bounds");
            times.push(performance.now() - start);
          }
          times.sort((a, b) => a - b);
          return { p95: times[28], max: times[29] };
        },
        { accountId, connectionId },
      );
      console.info(
        `${target} local writing roundtrip p95 ${writingTimings.p95.toFixed(2)}ms; max ${writingTimings.max.toFixed(2)}ms`,
      );
      assert.ok(
        writingTimings.p95 < 150,
        "installed warm local-check latency regression; this is not a universal frame-time guarantee",
      );
      await page.locator("#note").fill("");
      const permittedSite = "https://api.usegrove.cloud";
      const sourcePage = await context.newPage();
      await sourcePage.route(`${permittedSite}/__writing_fixture`, (route) =>
        route.fulfill({
          contentType: "text/html",
          body: `<!doctype html><html lang="en"><title>Synthetic writing fixture</title><body style="font:16px system-ui;padding:24px"><h1>Writing fixture</h1><label for="body">Message</label><textarea id="body" rows="8" style="display:block;width:100%;max-width:600px;box-sizing:border-box;font:16px/1.6 system-ui"></textarea><label for="username">Username</label><input id="username" autocomplete="username"><label for="password">Password</label><input id="password" type="password"><label for="fake-user">Username</label><textarea id="fake-user" name="username" rows="6">PRIVATE_FIELD_CANARY</textarea><script>globalThis.excludedReads=0; for (const id of ["username","password","fake-user"]) Object.defineProperty(document.getElementById(id),"value",{get(){globalThis.excludedReads++;return "PRIVATE_FIELD_CANARY";},configurable:true});</script></body></html>`,
        }),
      );
      await sourcePage.goto(`${permittedSite}/__writing_fixture`);
      await sourcePage.locator("#body").fill("This is a sentnce.");
      await sourcePage
        .locator("div[data-grove-writing-ui]")
        .waitFor({ state: "attached" });
      await sourcePage.locator("#body").press("Alt+Enter");
      await sourcePage
        .getByRole("button", { name: "sentnce — Spelling", exact: true })
        .click();
      await sourcePage
        .getByRole("button", { name: "sentence", exact: true })
        .click();
      assert.equal(
        await sourcePage.locator("#body").inputValue(),
        "This is a sentence.",
      );
      await sourcePage.locator("#body").press("Control+z");
      assert.equal(
        await sourcePage.locator("#body").inputValue(),
        "This is a sentnce.",
      );
      for (const id of ["username", "password", "fake-user"]) {
        await sourcePage.locator(`#${id}`).focus();
        assert.equal(
          await sourcePage.locator("div[data-grove-writing-ui]").count(),
          0,
          `${id} must have no writing controller`,
        );
      }
      assert.equal(
        await sourcePage.evaluate(() => globalThis.excludedReads),
        0,
        "excluded fields must not be read even when rendered as a tall textarea",
      );
      await sourcePage.locator("#body").focus();
      await sourcePage
        .locator("div[data-grove-writing-ui]")
        .waitFor({ state: "attached" });
      await sourcePage
        .locator("#body")
        .evaluate((element) =>
          element.setAttribute("autocomplete", "username"),
        );
      await sourcePage
        .locator("div[data-grove-writing-ui]")
        .waitFor({ state: "detached" });
      await sourcePage.evaluate(() => {
        document.body.insertAdjacentHTML(
          "beforeend",
          `
          <label id="wrapped-label">Message <textarea id="wrapped" rows="6">Username</textarea></label>
          <span id="security-label">Verification code</span><textarea id="security-field" rows="6" aria-labelledby="security-label">PRIVATE_FIELD_CANARY</textarea>
          <label>Name <textarea id="identity-field" rows="6">PRIVATE_FIELD_CANARY</textarea></label>
          <label>Message <textarea id="single-line" rows="6" aria-multiline="false">PRIVATE_FIELD_CANARY</textarea></label>
        `,
        );
      });
      const [writingSourceTab] = await worker.evaluate(async () =>
        (await chrome.tabs.query({})).filter((tab) =>
          tab.url?.endsWith("/__writing_fixture"),
        ),
      );
      // Page-world getters cannot observe isolated-world content scripts. Instrument
      // the actual extension world, without adding any test hook to shipped code.
      await worker.evaluate(
        async (tabId) =>
          chrome.scripting.executeScript({
            target: { tabId },
            world: "ISOLATED",
            func: () => {
              globalThis.privateReads = 0;
              globalThis.labelBulkReads = 0;
              const value = Object.getOwnPropertyDescriptor(
                HTMLTextAreaElement.prototype,
                "value",
              );
              for (const id of [
                "security-field",
                "identity-field",
                "single-line",
              ]) {
                Object.defineProperty(document.getElementById(id), "value", {
                  get() {
                    globalThis.privateReads++;
                    return value.get.call(this);
                  },
                  configurable: true,
                });
              }
              const text = Object.getOwnPropertyDescriptor(
                Node.prototype,
                "textContent",
              );
              Object.defineProperty(
                document.getElementById("wrapped-label"),
                "textContent",
                {
                  get() {
                    globalThis.labelBulkReads++;
                    return text.get.call(this);
                  },
                  configurable: true,
                },
              );
            },
          }),
        writingSourceTab.id,
      );
      await sourcePage.locator("#wrapped").focus();
      await sourcePage
        .locator("div[data-grove-writing-ui]")
        .waitFor({ state: "attached" });
      for (const id of ["security-field", "identity-field", "single-line"]) {
        await sourcePage.locator(`#${id}`).focus();
        assert.equal(
          await sourcePage.locator("div[data-grove-writing-ui]").count(),
          0,
          `${id} must be excluded from metadata alone`,
        );
      }
      const [{ result: privateAccess }] = await worker.evaluate(
        async (tabId) =>
          chrome.scripting.executeScript({
            target: { tabId },
            world: "ISOLATED",
            func: () => ({
              values: globalThis.privateReads,
              labels: globalThis.labelBulkReads,
            }),
          }),
        writingSourceTab.id,
      );
      assert.deepEqual(
        privateAccess,
        { values: 0, labels: 0 },
        "eligibility must not read values or bulk label content, including nested editables",
      );
      await worker.evaluate(
        async (tabId) =>
          chrome.scripting.executeScript({
            target: { tabId },
            world: "ISOLATED",
            func: () => {
              const send = chrome.runtime.sendMessage.bind(chrome.runtime);
              globalThis.writingChecks = 0;
              globalThis.writingSuggestions = 0;
              globalThis.holdWritingResults = true;
              globalThis.writingResultGate = new Promise((resolve) => {
                globalThis.releaseWritingResult = resolve;
              });
              chrome.runtime.sendMessage = async (message, ...rest) => {
                if (message.kind === "writingSiteCheck")
                  globalThis.writingChecks++;
                if (message.kind === "writingSiteSuggest")
                  globalThis.writingSuggestions++;
                const response = await send(message, ...rest);
                if (
                  message.kind === "writingSiteCheck" &&
                  globalThis.holdWritingResults
                ) {
                  document.documentElement.dataset.writingHeld = "true";
                  await globalThis.writingResultGate;
                }
                if (
                  message.kind === "writingSiteSuggest" &&
                  message.payload.word === "sentnce" &&
                  globalThis.holdSuggestions
                ) {
                  document.documentElement.dataset.suggestionsHeld = "true";
                  await globalThis.suggestionGate;
                  globalThis.requestAnimationFrame(() => {
                    document.documentElement.dataset.suggestionReleased =
                      "true";
                  });
                }
                return response;
              };
            },
          }),
        writingSourceTab.id,
      );
      await sourcePage.locator("#wrapped").fill("This is a sentnce.");
      await sourcePage.waitForFunction(
        () => document.documentElement.dataset.writingHeld === "true",
      );
      await sourcePage.locator("#wrapped").fill("This sentence is correct.");
      const stableEditor = await sourcePage.locator("#wrapped").boundingBox();
      await worker.evaluate(
        async (tabId) =>
          chrome.scripting.executeScript({
            target: { tabId },
            world: "ISOLATED",
            func: () => {
              globalThis.holdWritingResults = false;
              globalThis.releaseWritingResult();
            },
          }),
        writingSourceTab.id,
      );
      await sourcePage.locator("#wrapped").press("Alt+Enter");
      await sourcePage
        .getByRole("dialog", { name: "Writing suggestions" })
        .getByText("No issues found by spelling and basic grammar checks.", {
          exact: true,
        })
        .waitFor();
      assert.equal(
        await sourcePage
          .getByRole("button", { name: "sentnce — Spelling", exact: true })
          .count(),
        0,
        "late results must not revive an old typo",
      );
      assert.equal(
        await sourcePage.locator("#wrapped").inputValue(),
        "This sentence is correct.",
      );
      assert.deepEqual(
        await sourcePage.locator("#wrapped").boundingBox(),
        stableEditor,
        "checking and review must not shift/remount the editor",
      );
      const [{ result: alternativesWhileTyping }] = await worker.evaluate(
        async (tabId) =>
          chrome.scripting.executeScript({
            target: { tabId },
            world: "ISOLATED",
            func: () => globalThis.writingSuggestions,
          }),
        writingSourceTab.id,
      );
      assert.equal(
        alternativesWhileTyping,
        0,
        "typing and issue-list review must not generate spelling candidates",
      );
      await sourcePage.keyboard.press("Escape");
      await worker.evaluate(
        async (tabId) =>
          chrome.scripting.executeScript({
            target: { tabId },
            world: "ISOLATED",
            func: () => {
              globalThis.holdSuggestions = true;
              globalThis.suggestionGate = new Promise((resolve) => {
                globalThis.releaseSuggestions = resolve;
              });
            },
          }),
        writingSourceTab.id,
      );
      await sourcePage
        .locator("#wrapped")
        .fill("This is a sentnce with a zorbler.");
      await sourcePage.locator("#wrapped").press("Alt+Enter");
      await sourcePage
        .getByRole("button", { name: "sentnce — Spelling", exact: true })
        .click();
      await sourcePage.waitForFunction(
        () => document.documentElement.dataset.suggestionsHeld === "true",
      );
      await sourcePage
        .getByRole("button", { name: "Ignore", exact: true })
        .focus();
      await worker.evaluate(
        async (tabId) =>
          chrome.scripting.executeScript({
            target: { tabId },
            world: "ISOLATED",
            func: () => {
              globalThis.holdSuggestions = false;
              globalThis.releaseSuggestions();
            },
          }),
        writingSourceTab.id,
      );
      await sourcePage.waitForFunction(
        () => document.documentElement.dataset.suggestionReleased === "true",
      );
      assert.equal(
        await sourcePage
          .locator("div[data-grove-writing-ui]")
          .evaluate((element) => element.shadowRoot.activeElement?.textContent),
        "Ignore",
        "alternatives arriving must not replace the focused action or steal keyboard focus",
      );
      await sourcePage
        .getByRole("button", { name: "Ignore", exact: true })
        .click();
      await sourcePage.locator("#wrapped").press("Alt+Enter");
      await sourcePage
        .getByRole("button", { name: "zorbler — Spelling", exact: true })
        .click();
      await worker.evaluate(
        async (tabId) =>
          chrome.scripting.executeScript({
            target: { tabId },
            world: "ISOLATED",
            func: () => {
              globalThis.holdSuggestions = false;
              globalThis.releaseSuggestions();
            },
          }),
        writingSourceTab.id,
      );
      await sourcePage.waitForFunction(
        () => document.documentElement.dataset.suggestionReleased === "true",
      );
      await sourcePage
        .getByRole("dialog", { name: "Writing suggestions" })
        .getByText("zorbler", { exact: true })
        .waitFor();
      assert.equal(
        await sourcePage
          .getByRole("dialog", { name: "Writing suggestions" })
          .getByText("sentnce", { exact: true })
          .count(),
        0,
        "late alternatives must not revive an ignored or previously opened issue",
      );
      await sourcePage.keyboard.press("Escape");
      await sourcePage
        .locator("#wrapped")
        .fill("This is a sentnce. ".repeat(10000));
      await sourcePage.locator("#wrapped").press("Alt+Enter");
      await sourcePage
        .getByRole("button", { name: "sentnce — Spelling", exact: true })
        .first()
        .waitFor();
      const mirroredLength = await sourcePage
        .locator("div[data-grove-writing-ui]")
        .evaluate(
          (element) =>
            element.shadowRoot.querySelector(".text").textContent.length,
        );
      assert.ok(
        mirroredLength <= 6001,
        `only checked text may be mirrored, not the full long editor (${mirroredLength})`,
      );
      await sourcePage.keyboard.press("Escape");
      // A metadata-only label edit immediately detaches the previously valid field.
      await sourcePage
        .locator("#wrapped")
        .evaluate((element) =>
          element.setAttribute("aria-labelledby", "security-label"),
        );
      await sourcePage
        .locator("div[data-grove-writing-ui]")
        .waitFor({ state: "detached" });
      await sourcePage
        .locator("#body")
        .evaluate((element) => element.removeAttribute("autocomplete"));
      await sourcePage.locator("#body").focus();
      await sourcePage
        .locator("div[data-grove-writing-ui]")
        .waitFor({ state: "attached" });
      const disabledSite = await page.evaluate(
        async ({ accountId, connectionId, origin }) => {
          const window = await chrome.windows.getCurrent();
          return chrome.runtime.sendMessage({
            kind: "writingConfigure",
            windowId: window.id,
            accountId,
            connectionId,
            payload: { site: { origin, enabled: false } },
          });
        },
        { accountId, connectionId, origin: permittedSite },
      );
      assert.equal(disabledSite.ok, true);
      await sourcePage
        .locator("div[data-grove-writing-ui]")
        .waitFor({ state: "detached" });
      const registeredSites = await worker.evaluate(() =>
        chrome.scripting.getRegisteredContentScripts(),
      );
      assert.equal(
        registeredSites.filter((script) =>
          script.id.startsWith("grove-writing-"),
        ).length,
        0,
        "disabling the only site must also remove future registration",
      );
      const allStorage = await worker.evaluate(async () => ({
        local: await chrome.storage.local.get(null),
        session: await chrome.storage.session.get(null),
      }));
      assert.ok(!JSON.stringify(allStorage).includes("PRIVATE_FIELD_CANARY"));
      assert.equal(
        await worker.evaluate(() => globalThis.fixtureRequests.length),
        requestsBeforeWriting,
        "website checking must not use HTTP/model requests",
      );
      const siteAIEnabled = await page.evaluate(
        async ({ accountId, connectionId, origin }) => {
          const window = await chrome.windows.getCurrent();
          return chrome.runtime.sendMessage({
            kind: "writingConfigure",
            windowId: window.id,
            accountId,
            connectionId,
            payload: { site: { origin, enabled: true } },
          });
        },
        { accountId, connectionId, origin: permittedSite },
      );
      assert.equal(siteAIEnabled.ok, true);
      await sourcePage.locator("#body").fill("My name is Elias.");
      await sourcePage.locator("#body").evaluate((element) => {
        element.focus();
        element.setSelectionRange(0, element.value.length);
      });
      await sourcePage
        .getByRole("button", { name: "Use AI", exact: true })
        .click();
      await sourcePage
        .getByRole("menuitem", { name: "Rewrite", exact: true })
        .click();
      await sourcePage
        .getByText(
          /AI uses your selection and nearby text to suggest alternatives/,
        )
        .waitFor();
      await sourcePage
        .getByRole("button", { name: "Generate alternatives", exact: true })
        .click();
      await sourcePage
        .getByRole("button", { name: "Elias is my name.", exact: true })
        .click();
      assert.equal(
        await sourcePage.locator("#body").inputValue(),
        "Elias is my name.",
      );
      await sourcePage.locator("#body").press("Control+z");
      assert.equal(
        await sourcePage.locator("#body").inputValue(),
        "My name is Elias.",
      );
      await sourcePage.locator("#fake-user").focus();
      assert.equal(
        await sourcePage.locator("[data-grove-writing-tools]").count(),
        0,
        "excluded fields must have no AI selection controller",
      );
      await sourcePage.close();
      await page.bringToFront();
      const toolCases = [
        ["Shorten", "I'm Elias."],
        ["Expand", "I go by the name Elias."],
        ["Rewrite", "Elias is my name."],
        ["Humanize", "Hi, I'm Elias."],
      ];
      for (const [label, alternative] of toolCases) {
        const original = "Hello world! My name is Elias. Nice to meet you.";
        await page.locator("#note").fill(original);
        const beforeMenu = await worker.evaluate(
          () =>
            globalThis.fixtureRequests.filter((path) =>
              path.startsWith("/v1/browser/writing/"),
            ).length,
        );
        await page.locator("#note").evaluate((element) => {
          element.focus();
          element.setSelectionRange(13, 30);
        });
        await page.getByRole("button", { name: "Use AI", exact: true }).click();
        const menu = page.getByRole("menu", { name: "Writing tools" });
        assert.equal(
          await menu.getByRole("menuitem").count(),
          4,
          "all registered sentence tools are available in one menu",
        );
        assert.equal(
          await worker.evaluate(
            () =>
              globalThis.fixtureRequests.filter((path) =>
                path.startsWith("/v1/browser/writing/"),
              ).length,
          ),
          beforeMenu,
          "selection and menu opening never transmit the sentence",
        );
        if (label === "Shorten" && process.env.EXTENSION_SCREENSHOTS)
          await page.screenshot({
            path: join(
              process.env.EXTENSION_SCREENSHOTS,
              `${target}-writing-tools-390.png`,
            ),
            fullPage: true,
          });
        await menu
          .getByRole("menuitem", { name: new RegExp(`^${label}`) })
          .click();
        const consent = page.getByRole("button", {
          name: "Generate alternatives",
          exact: true,
        });
        assert.equal(
          await consent.count(),
          0,
          "valid connection-scoped AI consent does not prompt again for each tool or editor",
        );
        await page
          .getByRole("button", { name: alternative, exact: true })
          .waitFor();
        const dialog = page.getByRole("dialog", { name: "AI writing tools" });
        const submitted = await worker.evaluate(() =>
          globalThis.fixtureWritingInputs.at(-1),
        );
        assert.equal(submitted.sentence, "My name is Elias.");
        assert.deepEqual(submitted.context, {
          previousSentence: "Hello world!",
          nextSentence: "Nice to meet you.",
          sentenceBefore: "",
          sentenceAfter: "",
          startsSentence: true,
          endsSentence: true,
          startsParagraph: false,
          endsParagraph: false,
        });
        assert.equal(
          await dialog
            .getByText("Context shared with AI", { exact: true })
            .count(),
          0,
          "review shows alternatives, not request internals",
        );
        if (label === "Shorten" && process.env.EXTENSION_SCREENSHOTS)
          await page.screenshot({
            path: join(
              process.env.EXTENSION_SCREENSHOTS,
              `${target}-context-preview-390.png`,
            ),
            fullPage: true,
          });
        assert.equal(
          await dialog.locator(".alternative").count(),
          3,
          "each tool returns multiple distinct alternatives",
        );
        assert.equal(
          await page.locator("#note").inputValue(),
          original,
          "generated alternatives never automatically change text",
        );
        if (label === "Shorten" && process.env.EXTENSION_SCREENSHOTS)
          await page.screenshot({
            path: join(
              process.env.EXTENSION_SCREENSHOTS,
              `${target}-writing-alternatives-390.png`,
            ),
            fullPage: true,
          });
        if (label === "Shorten") {
          for (const [width, height, colorScheme] of [
            [320, 480, "light"],
            [390, 844, "dark"],
          ]) {
            await page.setViewportSize({ width, height });
            await page.emulateMedia({ colorScheme });
            await page.evaluate(
              () =>
                new Promise((resolve) =>
                  globalThis.requestAnimationFrame(() =>
                    globalThis.requestAnimationFrame(resolve),
                  ),
                ),
            );
            const bounds = await dialog.boundingBox();
            assert.ok(
              bounds.x >= 0 &&
                bounds.y >= 0 &&
                bounds.x + bounds.width <= width &&
                bounds.y + bounds.height <= height,
              "AI review stays inside narrow/short and dark viewports",
            );
            assert.deepEqual(
              (
                await new AxeBuilder({ page })
                  .include("[data-grove-writing-tools]")
                  .analyze()
              ).violations,
              [],
              `AI review axe at ${width} ${colorScheme}`,
            );
            if (process.env.EXTENSION_SCREENSHOTS)
              await page.screenshot({
                path: join(
                  process.env.EXTENSION_SCREENSHOTS,
                  `${target}-writing-alternatives-${colorScheme}-${width}.png`,
                ),
                fullPage: true,
              });
          }
          await page.setViewportSize({ width: 390, height: 844 });
          await page.emulateMedia({ colorScheme: "light" });
          await dialog
            .getByRole("button", { name: "Copy", exact: true })
            .first()
            .click();
          await dialog.getByText("Copied", { exact: true }).waitFor();
          assert.equal(
            await page.locator("#note").inputValue(),
            original,
            "copy never replaces the sentence",
          );
        }
        await page
          .getByRole("button", { name: alternative, exact: true })
          .click();
        assert.equal(
          await page.locator("#note").inputValue(),
          `Hello world! ${alternative} Nice to meet you.`,
          "only the selected sentence changes",
        );
        assert.equal(
          await page.evaluate(() => globalThis.lastWritingCopy),
          alternative,
          "choosing an alternative both copies and replaces",
        );
        await page.locator("#note").press("Control+z");
        assert.equal(
          await page.locator("#note").inputValue(),
          original,
          "AI application preserves native Undo",
        );
      }
      for (const [label, replacement] of [
        ["Synonyms", "radiant"],
        ["Opposite words", "dim"],
      ]) {
        await page.locator("#note").fill("A bright idea.");
        await page.locator("#note").evaluate((element) => {
          element.focus();
          element.setSelectionRange(2, 8);
        });
        await page.getByRole("button", { name: "Use AI", exact: true }).click();
        const wordMenu = page.getByRole("menu", { name: "Writing tools" });
        assert.equal(
          await wordMenu.getByRole("menuitem").count(),
          4,
          "word choices stay compact instead of adding a larger command menu",
        );
        if (label === "Synonyms" && process.env.EXTENSION_SCREENSHOTS)
          await page.screenshot({
            path: join(
              process.env.EXTENSION_SCREENSHOTS,
              `${target}-word-tools-390.png`,
            ),
            fullPage: true,
          });
        await wordMenu
          .getByRole("menuitem", { name: label, exact: true })
          .click();
        await page
          .getByRole("button", { name: replacement, exact: true })
          .click();
        assert.equal(
          await worker.evaluate(() =>
            Object.hasOwn(globalThis.fixtureWritingInputs.at(-1), "context"),
          ),
          false,
          "synonyms and opposites keep selection-only transmission",
        );
        assert.equal(
          await page.locator("#note").inputValue(),
          `A ${replacement} idea.`,
        );
        assert.equal(
          await page.evaluate(() => globalThis.lastWritingCopy),
          replacement,
        );
        await page.locator("#note").press("Control+z");
        assert.equal(
          await page.locator("#note").inputValue(),
          "A bright idea.",
        );
      }
      await page.evaluate(() => {
        globalThis.workingClipboard = globalThis.navigator.clipboard.writeText;
        globalThis.navigator.clipboard.writeText = () =>
          Promise.reject(new Error("Synthetic clipboard failure"));
      });
      await page.locator("#note").fill("This is a sentnce.");
      await page
        .locator("#writing-review")
        .filter({ hasText: "1 suggestion" })
        .waitFor();
      await page.locator("#note").press("Alt+Enter");
      await page
        .getByRole("button", { name: "sentnce — Spelling", exact: true })
        .click();
      await page.getByRole("button", { name: "sentence", exact: true }).click();
      assert.equal(
        await page.locator("#note").inputValue(),
        "This is a sentence.",
      );
      await page
        .locator("#writing-hint")
        .filter({ hasText: "Clipboard unavailable" })
        .waitFor();
      await page.locator("#note").press("Control+z");
      assert.equal(
        await page.locator("#note").inputValue(),
        "This is a sentnce.",
      );
      await page.evaluate(() => {
        globalThis.navigator.clipboard.writeText = globalThis.workingClipboard;
      });
      await page.evaluate(async () => {
        const values = await chrome.storage.session.get(null);
        for (const [key, value] of Object.entries(values))
          if (key.startsWith("writingPanel:")) {
            value.createdAt = Date.now() - 900001;
            await chrome.storage.session.set({ [key]: value });
          }
      });
      await worker.evaluate(() => {
        globalThis.fixtureWritingExpired = true;
      });
      await page.locator("#note").fill("My name is Elias.");
      await page.locator("#note").evaluate((element) => {
        element.focus();
        element.setSelectionRange(0, element.value.length);
      });
      await page.getByRole("button", { name: "Use AI", exact: true }).click();
      await page
        .getByRole("menuitem", { name: "Rewrite", exact: true })
        .click();
      await page
        .getByText("These alternatives expired. Your text is unchanged.", {
          exact: true,
        })
        .waitFor();
      assert.equal(
        await page.locator(".alternative").count(),
        0,
        "expired alternatives cannot be applied or copied from an old review",
      );
      assert.equal(
        await page.locator("#note").inputValue(),
        "My name is Elias.",
      );
      await page.getByRole("button", { name: "Close", exact: true }).click();
      await worker.evaluate(() => {
        globalThis.fixtureWritingExpired = false;
        globalThis.fixtureWritingProcessing = true;
      });
      await page.locator("#note").fill("My name is Elias.");
      await page.locator("#note").evaluate((element) => {
        element.focus();
        element.setSelectionRange(0, element.value.length);
      });
      await page.getByRole("button", { name: "Use AI", exact: true }).click();
      await page
        .getByRole("menuitem", { name: "Rewrite", exact: true })
        .click();
      const queuedDialog = page.getByRole("dialog", {
        name: "AI writing tools",
      });
      await queuedDialog.getByText("Queued", { exact: true }).waitFor();
      const unchangedEditorBox = await page.locator("#note").boundingBox();
      await queuedDialog
        .getByRole("button", { name: "Cancel", exact: true })
        .focus();
      await queuedDialog
        .getByRole("button", { name: "Cancel", exact: true })
        .evaluate((button) => {
          globalThis.retainedAIAction = button;
        });
      await queuedDialog
        .getByText("Generating alternatives…", { exact: true })
        .waitFor();
      assert.ok(
        await page.evaluate(
          () =>
            document.querySelector("[data-grove-writing-tools]").shadowRoot
              .activeElement === globalThis.retainedAIAction &&
            globalThis.retainedAIAction.isConnected,
        ),
        "durable status updates must preserve the actual focused action",
      );
      assert.deepEqual(
        await page.locator("#note").boundingBox(),
        unchangedEditorBox,
        "pending AI work never shifts the editor",
      );
      await page.locator("#note").fill("A newer sentence stays here.");
      await page.waitForFunction(async () => {
        const values = await chrome.storage.session.get(null);
        return Object.entries(values)
          .filter(
            ([key]) =>
              key.startsWith("writingBinding:") ||
              key.startsWith("writingPanel:"),
          )
          .every(([, value]) => !value.active?.length);
      });
      await worker.evaluate(() => {
        globalThis.fixtureWritingProcessing = false;
      });
      assert.equal(
        await page
          .getByRole("dialog", { name: "AI writing tools" })
          .isVisible(),
        false,
      );
      assert.equal(
        await page.locator("#note").inputValue(),
        "A newer sentence stays here.",
      );
      const beforeAIToggle = await worker.evaluate(
        () =>
          globalThis.fixtureRequests.filter(
            (path) => path === "/v1/browser/writing/requests",
          ).length,
      );
      await page.locator('[data-nav="settings"]').click();
      await page.locator("#writing-settings > summary").click();
      await page.locator("#writing-ai-rewrites").uncheck();
      await page
        .locator("#writing-settings-status")
        .filter({ hasText: "Saved on this device." })
        .waitFor();
      await page.locator('[data-nav="capture"]').click();
      await page.locator("#note").fill("This is a sentnce.");
      await page
        .locator("#writing-review")
        .filter({ hasText: "1 suggestion" })
        .waitFor();
      await page.locator("#note").evaluate((element) => {
        element.focus();
        element.setSelectionRange(0, element.value.length);
      });
      await page.locator("#note").press("Alt+Enter");
      assert.equal(
        await page.getByRole("button", { name: "Use AI", exact: true }).count(),
        0,
        "AI Off removes selection actions without disabling local checks",
      );
      await page.locator('[data-nav="settings"]').click();
      await page.locator("#writing-ai-rewrites").check();
      await page
        .locator("#writing-settings-status")
        .filter({ hasText: "Saved on this device." })
        .waitFor();
      await page.locator("#writing-settings > summary").click();
      await page.locator('[data-nav="capture"]').click();
      assert.equal(
        await worker.evaluate(
          () =>
            globalThis.fixtureRequests.filter(
              (path) => path === "/v1/browser/writing/requests",
            ).length,
        ),
        beforeAIToggle,
        "AI enablement never generates alternatives on its own",
      );
      assert.ok(
        !(await worker.evaluate(() => globalThis.fixtureRequests)).includes(
          "/v1/browser/pages",
        ),
      );
      // Installed browser navigation, not fabricated tab messages. The panel stays
      // mounted while its window's actual active tab navigates across origins.
      await page.locator("#new-note").click();
      await page.locator("#confirm-replace").click();
      const readSource = () =>
        page.evaluate(async () => {
          const { id } = await globalThis.chrome.windows.getCurrent();
          return (await globalThis.chrome.storage.session.get(`draft:${id}`))[
            `draft:${id}`
          ]?.source;
        });
      const waitSource = (key, value) =>
        page.waitForFunction(
          async ({ key, value }) => {
            const { id } = await globalThis.chrome.windows.getCurrent();
            return (
              (await globalThis.chrome.storage.session.get(`draft:${id}`))[
                `draft:${id}`
              ]?.source?.[key] === value
            );
          },
          { key, value },
        );
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
      await waitSource("url", "https://source.example/article?id=1");
      assert.equal((await readSource()).title, "First source");
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
      await waitSource("title", "Next source");
      assert.equal((await readSource()).url, "https://next.example/other");
      await sourceTab.evaluate(() => {
        document.title = "Updated source";
      });
      await waitSource("title", "Updated source");
      assert.equal(
        await worker.evaluate(() => globalThis.fixtureRequests.length),
        requestsBeforeNavigation,
        "prefill and title changes never contact Grove",
      );
      await sourceTab.goto("about:blank");
      await waitSource("url", undefined);
      await sourceTab.goto("https://source.example/article");
      await waitSource("title", "First source");
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
        (await readSource()).url,
        "https://source.example/article",
        "late navigation metadata cannot replace the source visible at first edit",
      );
      await page.reload();
      await page.locator("#workspace").waitFor({ state: "visible" });
      assert.equal((await readSource()).url, "https://source.example/article");
      await page.locator("#new-note").click();
      await page.locator("#confirm-replace").click();
      await sourceTab.bringToFront();
      await waitSource("title", "Next source");
      // Retained explicit source removal/legacy state stays pinned even without source controls.
      await page.evaluate(
        async ({ accountId, connectionId }) => {
          const { id } = await globalThis.chrome.windows.getCurrent();
          const result = await globalThis.chrome.runtime.sendMessage({
            kind: "edit",
            windowId: id,
            accountId,
            connectionId,
            payload: { source: null },
          });
          if (!result.ok) throw new Error(result.error.message);
        },
        { accountId, connectionId },
      );
      await page.reload();
      await page.locator("#workspace").waitFor({ state: "visible" });
      await sourceTab.goto("https://source.example/article");
      assert.equal(
        await readSource(),
        undefined,
        "explicit removal stays pinned off",
      );
      await page.locator("#new-note").click();
      await sourceTab.bringToFront();
      await waitSource("title", "First source");
      await page
        .locator("#note")
        .fill(
          "# Field notes\n\nA source worth keeping. <script>not executable</script>\n\n- [x] A useful task\n- **A clear idea**\n\n| Tool | Purpose |\n| --- | --- |\n| Grove | Keep thoughts |\n\n```js\nconst safe = true;\n```\n\n[Source](https://example.com/read)\n\n[Unsafe](javascript:alert(1))\n\n![No tracking](https://tracker.example/pixel.png)",
        );
      const savedSourcePage = await context.newPage();
      await savedSourcePage.route(
        "https://source.writing-fixture.test/article",
        (route) =>
          route.fulfill({
            contentType: "text/html",
            body: "<!doctype html><html><title>Page worth keeping</title><body>Only the reviewed note is saved, not this body.</body></html>",
          }),
      );
      await savedSourcePage.goto("https://source.writing-fixture.test/article");
      await page
        .locator("#capture-form")
        .evaluate((form) => form.requestSubmit());
      await page
        .locator("#save-state")
        .filter({ hasText: "Save not confirmed" })
        .waitFor();
      assert.equal(
        await worker.evaluate(
          () => globalThis.fixtureCaptureRequests[0].provenance.url,
        ),
        "https://source.example/article",
        "Save retains the originating page from the first edit, without source-link controls",
      );
      await savedSourcePage.close();
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
      assert.deepEqual(
        await worker.evaluate(() =>
          globalThis.fixtureCaptureRequests.slice(0, 2),
        ),
        await worker.evaluate(() => [
          globalThis.fixtureCaptureRequests[0],
          globalThis.fixtureCaptureRequests[0],
        ]),
        "uncertain retry preserves the exact original page and request",
      );
      assert.equal(
        await page.locator("#note").inputValue(),
        "A newer draft stays after retry.",
      );
      assert.equal(
        await page
          .locator("#save-version, #save-indexing, #save-details")
          .count(),
        0,
        "save feedback omits backend metadata",
      );
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
      assert.equal(
        await page.locator("#context-actions, #select-notes").count(),
        0,
      );
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
      assert.equal(
        await page
          .locator("#results input[data-note-selection]:visible")
          .count(),
        0,
        "selection is opt-in, not permanent search chrome",
      );
      assert.equal(
        await page.locator("#results .note-preview h2").textContent(),
        "Field notes",
      );
      assert.equal(
        await page.locator("#results .note-preview strong").textContent(),
        "A clear idea",
      );
      assert.equal(
        await page
          .locator(
            "#results .note-preview script, #results .note-preview img, #results .note-preview a",
          )
          .count(),
        0,
      );
      await page.locator("#results .note-menu summary").click();
      await page.locator("#results .open-note").click();
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
      await worker.evaluate(() => {
        globalThis.fixtureSharingGate = new Promise((resolve) => {
          globalThis.releaseSharing = resolve;
        });
        globalThis.fixtureSharingReached = new Promise((resolve) => {
          globalThis.fixtureSharingStarted = resolve;
        });
      });
      await page.locator("#share-reader").click();
      await worker.evaluate(() => globalThis.fixtureSharingReached);
      const openingShareBox = await page.locator("#sharing").boundingBox();
      assert.match(
        await page.locator("#share-status").textContent(),
        /Opening/,
      );
      await worker.evaluate(() => {
        globalThis.releaseSharing();
        globalThis.fixtureSharingStarted = undefined;
      });
      await page.locator("#create-share").waitFor({ state: "visible" });
      assert.equal(
        (await page.locator("#sharing").boundingBox()).height,
        openingShareBox.height,
        "opening sharing reserves its real action space",
      );
      assert.equal(
        (await page.locator("#sharing").boundingBox()).y,
        openingShareBox.y,
        "loading does not recenter the surface",
      );
      await page.locator("#sharing").press("Escape");
      assert.equal(
        await page.locator("#reader").evaluate((element) => element.open),
        true,
        "sharing stays contextual to the reader",
      );
      assert.equal(
        await page
          .locator("#share-reader")
          .evaluate((element) => element === document.activeElement),
        true,
        "Escape returns focus to the reader action",
      );
      await page.locator("#close-reader").click();
      await page.locator("#results .note-menu summary").click();
      await page
        .locator("#results .note-actions")
        .getByRole("menuitem", { name: "Copy", exact: true })
        .click();
      await page
        .locator("#results .row-feedback")
        .filter({ hasText: /Copied|Couldn’t copy/ })
        .waitFor();
      await worker.evaluate(() => {
        globalThis.fixtureSharingAllowed = false;
      });
      await page.locator("#results .note-menu summary").click();
      await page
        .locator("#results .note-actions")
        .getByRole("menuitem", { name: "Share", exact: true })
        .click();
      await page.locator("#share-approval").waitFor({ state: "visible" });
      assert.equal(
        await worker.evaluate(() => globalThis.fixtureShareWrites.length),
        0,
      );
      await worker.evaluate(() => {
        globalThis.fixtureSharingAllowed = true;
      });
      await page.locator("#share-retry").click();
      await page.locator("#create-share").waitFor({ state: "visible" });
      assert.equal(
        await page.locator("#share-preview").isVisible(),
        false,
        "sharing keeps the note preview behind its disclosure",
      );
      assert.equal(
        await page.locator("#share-duration").isVisible(),
        false,
        "expiry is a secondary option",
      );
      assert.equal(
        await page.locator("#share-note-title").textContent(),
        "Field notes",
      );
      assert.equal(
        await page.locator("#share-note").evaluate((element) => element.open),
        false,
      );
      assert.equal(
        await page
          .locator("#share-options")
          .evaluate((element) => element.open),
        false,
      );
      assert.match(
        await page.locator("#share-expiry-label").textContent(),
        /1 week/,
      );
      assert.equal(await page.locator("#share-duration").inputValue(), "1w");
      assert.ok(
        (await page.locator("#sharing").boundingBox()).height < 365,
        "sharing starts as a compact surface, not a second reader",
      );
      if (process.env.EXTENSION_SCREENSHOTS)
        await page.screenshot({
          path: join(
            process.env.EXTENSION_SCREENSHOTS,
            `${target}-sharing-create-390.png`,
          ),
          fullPage: true,
        });
      assert.equal(
        await worker.evaluate(() => globalThis.fixtureShareWrites.length),
        0,
        "opening sharing never publishes",
      );
      await page.locator("#share-options summary").click();
      await page.locator("#share-duration").selectOption("1d");
      await page.locator("#share-options summary").click();
      await worker.evaluate(() => {
        globalThis.fixtureShareLost = true;
      });
      await page.locator("#create-share").click();
      await page
        .locator("#share-status")
        .filter({ hasText: "Not confirmed" })
        .waitFor();
      await page.locator("#share-retry").click();
      await page.locator("#copy-share").waitFor({ state: "visible" });
      assert.equal(
        await page.locator("#share-link").isVisible(),
        false,
        "the URL does not compete with Copy link",
      );
      assert.equal(
        await page.locator("#revoke-share").isVisible(),
        false,
        "turning off a link stays in options",
      );
      assert.equal(
        await page
          .locator("#copy-share")
          .evaluate((element) => element === document.activeElement),
        true,
        "reconciliation moves focus from the hidden retry to Copy link",
      );
      assert.equal(
        await worker.evaluate(() => globalThis.fixtureShareWrites.length),
        1,
        "uncertain link creation is checked, not blindly repeated",
      );
      assert.equal(
        (await worker.evaluate(() => globalThis.fixtureShareWrites[0]))
          .duration,
        "1d",
      );
      await page.locator("#copy-share").click();
      await page
        .locator("#share-status")
        .filter({ hasText: /Link copied|Select the link/ })
        .waitFor();
      const copyPosition = await page.locator("#copy-share").boundingBox();
      await worker.evaluate(() => {
        globalThis.fixtureSharingGate = new Promise((resolve) => {
          globalThis.releaseSharing = resolve;
        });
        globalThis.fixtureSharingReached = new Promise((resolve) => {
          globalThis.fixtureSharingStarted = resolve;
        });
      });
      await page.locator("#copy-share").click();
      await worker.evaluate(() => globalThis.fixtureSharingReached);
      assert.equal(await page.locator("#copy-share").isDisabled(), true);
      assert.match(
        await page.locator("#share-status").textContent(),
        /Checking link/,
      );
      assert.equal(
        (await page.locator("#copy-share").boundingBox()).y,
        copyPosition.y,
        "pending feedback keeps the main action in place",
      );
      await worker.evaluate(() => {
        globalThis.releaseSharing();
        globalThis.fixtureSharingStarted = undefined;
      });
      await page
        .locator("#share-status")
        .filter({ hasText: /Link copied|Select the link/ })
        .waitFor();
      assert.equal(await page.locator("#copy-share").isDisabled(), false);
      assert.equal(
        (await page.locator("#copy-share").boundingBox()).y,
        copyPosition.y,
        "completed feedback does not shift the action",
      );
      const shareAudit = await new AxeBuilder({ page }).analyze();
      assert.deepEqual(
        shareAudit.violations.map((item) => item.id),
        [],
      );
      if (process.env.EXTENSION_SCREENSHOTS)
        await page.screenshot({
          path: join(
            process.env.EXTENSION_SCREENSHOTS,
            `${target}-sharing-390.png`,
          ),
          fullPage: true,
        });
      for (const colorScheme of ["light", "dark"]) {
        await page.emulateMedia({ colorScheme });
        for (const width of [280, 320, 390, 768]) {
          await page.setViewportSize({
            width,
            height: width === 320 ? 480 : 844,
          });
          assert.ok(
            await page.evaluate(
              () => document.documentElement.scrollWidth <= innerWidth,
            ),
          );
          const box = await page.locator("#sharing").boundingBox();
          assert.ok(box.width <= Math.min(360, width - 24) + 1);
          assert.ok(
            box.y >= 0 && box.y + box.height <= (width === 320 ? 480 : 844),
            "compact sharing fits short panels",
          );
          const audit = await new AxeBuilder({ page }).analyze();
          assert.deepEqual(
            audit.violations.map((item) => item.id),
            [],
            `sharing accessibility ${colorScheme} ${width}`,
          );
          if (
            process.env.EXTENSION_SCREENSHOTS &&
            (width === 320 || width === 768)
          )
            await page.screenshot({
              path: join(
                process.env.EXTENSION_SCREENSHOTS,
                `${target}-sharing-${colorScheme}-${width}.png`,
              ),
              fullPage: true,
            });
        }
      }
      await page.emulateMedia({ colorScheme: "light" });
      await page.setViewportSize({ width: 390, height: 844 });
      await worker.evaluate(() => {
        globalThis.fixtureSharingAllowed = false;
      });
      await page.evaluate(() => {
        globalThis.lastWritingCopy =
          "unchanged after sharing permission revoked";
      });
      await page.locator("#copy-share").click();
      await page
        .locator("#share-status")
        .filter({ hasText: "Allow sharing links in Grove first." })
        .waitFor();
      assert.equal(
        await page.evaluate(() => globalThis.lastWritingCopy),
        "unchanged after sharing permission revoked",
        "copying a public link rechecks publication access",
      );
      assert.equal(await page.locator("#share-link").inputValue(), "");
      await worker.evaluate(() => {
        globalThis.fixtureSharingAllowed = true;
      });
      await page.locator("#share-retry").click();
      await page.locator("#copy-share").waitFor({ state: "visible" });
      await page.evaluate(() => {
        globalThis.shareClipboardWrite =
          globalThis.navigator.clipboard.writeText;
        globalThis.navigator.clipboard.writeText = async () => {
          throw new Error("Synthetic clipboard denial");
        };
      });
      await page.locator("#copy-share").click();
      await page
        .locator("#share-status")
        .filter({ hasText: "Select the link" })
        .waitFor();
      assert.equal(
        await page
          .locator("#share-link")
          .evaluate((input) => input.selectionEnd - input.selectionStart),
        (await page.locator("#share-link").inputValue()).length,
      );
      assert.equal(
        await page
          .locator("#share-options")
          .evaluate((element) => element.open),
        true,
        "clipboard failure reveals manual copying in place",
      );
      assert.equal(
        await page
          .locator("#share-link")
          .evaluate((element) => element === document.activeElement),
        true,
      );
      await page.setViewportSize({ width: 320, height: 480 });
      const manualCopyAudit = await new AxeBuilder({ page }).analyze();
      assert.deepEqual(
        manualCopyAudit.violations.map((item) => item.id),
        [],
        "expanded link options are keyboard accessible in a short panel",
      );
      if (process.env.EXTENSION_SCREENSHOTS)
        await page.screenshot({
          path: join(
            process.env.EXTENSION_SCREENSHOTS,
            `${target}-sharing-options-320.png`,
          ),
          fullPage: true,
        });
      await page.locator("#share-note summary").click();
      assert.equal(
        await page.locator("#share-preview strong").textContent(),
        "A clear idea",
      );
      await page.locator("#share-note summary").click();
      await page.setViewportSize({ width: 390, height: 844 });
      await page.evaluate(() => {
        globalThis.navigator.clipboard.writeText =
          globalThis.shareClipboardWrite;
      });
      await page.locator("#revoke-share").click();
      await page
        .locator("#share-status")
        .filter({ hasText: "Link turned off" })
        .waitFor();
      assert.equal(await page.locator("#share-link").inputValue(), "");
      await page.locator("#close-sharing").click();
      assert.equal(
        await page
          .locator(
            '#results input[type="checkbox"], #select-notes, #context-actions, #context',
          )
          .count(),
        0,
        "bulk actions are absent",
      );
      const noteMenu = page.locator("#results .note-menu");
      await noteMenu.locator("summary").focus();
      await noteMenu.locator("summary").press("ArrowUp");
      assert.equal(
        await noteMenu
          .getByRole("menuitem", { name: "Share", exact: true })
          .evaluate((element) => element === document.activeElement),
        true,
      );
      await noteMenu.press("Escape");
      await noteMenu.locator("summary").press("ArrowDown");
      if (process.env.EXTENSION_SCREENSHOTS)
        await page.screenshot({
          path: join(
            process.env.EXTENSION_SCREENSHOTS,
            `${target}-result-menu-390.png`,
          ),
          fullPage: true,
        });
      assert.equal(
        await noteMenu
          .locator(".open-note")
          .evaluate((element) => element === document.activeElement),
        true,
      );
      await noteMenu.locator(".open-note").press("ArrowDown");
      assert.equal(
        await noteMenu
          .getByRole("menuitem", { name: "Copy", exact: true })
          .evaluate((element) => element === document.activeElement),
        true,
      );
      await noteMenu.press("Escape");
      assert.equal(
        await noteMenu
          .locator("summary")
          .evaluate((element) => element === document.activeElement),
        true,
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
      await page.locator("#writing-settings > summary").click();
      const websites = page
        .locator("#writing-controls > details")
        .filter({ has: page.locator("#writing-sites") });
      await websites.locator(":scope > summary").click();
      const siteRow = page.locator("#writing-sites > details").first();
      await siteRow.locator(":scope > summary").click();
      const siteSpelling = siteRow.locator("[data-feature='spelling']");
      await siteSpelling.focus();
      await page.evaluate(() => {
        globalThis.retainedSiteControl = document.activeElement;
      });
      await siteSpelling.press("Space");
      await page
        .locator("#writing-settings-status")
        .filter({ hasText: "Saved on this device." })
        .waitFor();
      assert.ok(
        await page.evaluate(
          () =>
            document.activeElement === globalThis.retainedSiteControl &&
            document.activeElement.isConnected,
        ),
        "saving site restrictions must retain the actual focused control",
      );
      assert.equal(
        await siteRow.evaluate((element) => element.open),
        true,
        "site disclosure stays open after saving",
      );
      await siteSpelling.press("Space");
      await page
        .locator("#writing-settings-status")
        .filter({ hasText: "Saved on this device." })
        .waitFor();
      await page.locator("#writing-spelling").uncheck();
      await page
        .locator("#writing-settings-status")
        .filter({ hasText: "Saved on this device." })
        .waitFor();
      const spellingOff = await page.evaluate(
        async ({ accountId, connectionId }) => {
          const window = await chrome.windows.getCurrent();
          return chrome.runtime.sendMessage({
            kind: "writingCheck",
            windowId: window.id,
            accountId,
            connectionId,
            payload: { text: "This is a sentnce and a apple." },
          });
        },
        { accountId, connectionId },
      );
      assert.equal(spellingOff.ok, true);
      assert.ok(
        spellingOff.data.issues.every((issue) => issue.rule !== "spelling"),
      );
      assert.ok(
        spellingOff.data.issues.some((issue) => issue.rule === "articles"),
        "disabling spelling must leave grammar running",
      );
      await page.locator("#writing-spelling").check();
      await page
        .locator("#writing-settings-status")
        .filter({ hasText: "Saved on this device." })
        .waitFor();
      if (process.env.EXTENSION_SCREENSHOTS) {
        await page.setViewportSize({ width: 390, height: 844 });
        await websites.locator(":scope > summary").click();
        await page.locator("#writing-settings").scrollIntoViewIfNeeded();
        await page.screenshot({
          path: join(
            process.env.EXTENSION_SCREENSHOTS,
            `${target}-writing-settings-390.png`,
          ),
          fullPage: true,
        });
      }
      await page.locator("#writing-settings > summary").click();
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
          if (name === "capture") {
            await page.locator("#note-details").evaluate((element) => {
              element.open = true;
            });
            const destination = await page
              .locator("#destination")
              .evaluate((element) => {
                const style = globalThis.getComputedStyle(element);
                const canvas = document.createElement("canvas");
                const context = canvas.getContext("2d");
                context.font = style.font;
                return {
                  width: element.getBoundingClientRect().width,
                  needed:
                    context.measureText(element.selectedOptions[0].textContent)
                      .width +
                    parseFloat(style.paddingLeft) +
                    parseFloat(style.paddingRight),
                };
              });
            assert.ok(
              destination.width >= destination.needed,
              `selected notebook remains readable at ${width}px: ${JSON.stringify(destination)}`,
            );
            await page.locator("#note-details").evaluate((element) => {
              element.open = false;
            });
          }
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
      assert.equal(
        await page.locator("#source-details").count(),
        0,
        "source links are saved automatically, not another composer control",
      );
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
      // Hold the real resume RPC response so visibility cannot masquerade as
      // completion on a fast local host (the CI failure saw the same pending state).
      await otherPanel.evaluate(() => {
        const runtime = globalThis.chrome.runtime;
        const send = runtime.sendMessage.bind(runtime);
        const gate = new Promise((resolve) => {
          globalThis.releaseResume = resolve;
        });
        runtime.sendMessage = async (message) => {
          const result = await send(message);
          if (message.kind === "inbox") {
            runtime.sendMessage = send;
            await gate;
          }
          return result;
        };
      });
      await otherPanel.locator("#extension-toggle").focus();
      await otherPanel.locator("#extension-toggle").press("Space");
      await otherPanel.locator("#workspace").waitFor({ state: "visible" });
      assert.equal(
        await otherPanel.locator("#extension-toggle").getAttribute("aria-busy"),
        "true",
        "workspace visibility precedes completion of a slow resume",
      );
      assert.equal(
        await otherPanel.locator("#extension-toggle").isDisabled(),
        true,
        "a pending resume cannot accept another toggle",
      );
      await otherPanel.evaluate(() => globalThis.releaseResume());
      await otherPanel.waitForFunction(() => {
        const toggle = document.querySelector("#extension-toggle");
        return !toggle.disabled && !toggle.hasAttribute("aria-busy");
      });
      assert.equal(
        await otherPanel.evaluate(() => document.activeElement.id),
        "extension-toggle",
        "keyboard toggle preserves focus through resume",
      );
      assert.equal(
        await otherPanel.locator("#note").inputValue(),
        "A newer draft stays after retry.",
      );
      await otherPanel
        .locator("#note")
        .fill("# Shared from Notes\n\nA newly saved thought.");
      await worker.evaluate(() => {
        globalThis.fixtureCaptureGate = new Promise((resolve) => {
          globalThis.releaseCapture = resolve;
        });
        globalThis.fixtureCaptureReached = new Promise((resolve) => {
          globalThis.fixtureCaptureStarted = resolve;
        });
      });
      await otherPanel.locator("#share-draft").click();
      await worker.evaluate(() => globalThis.fixtureCaptureReached);
      await otherPanel
        .locator("#note")
        .fill("# Shared from Notes\n\nA newer thought typed while saving.");
      await worker.evaluate(() => {
        globalThis.releaseCapture();
        globalThis.fixtureCaptureStarted = undefined;
      });
      await otherPanel
        .locator("#notice")
        .filter({ hasText: "Save your changes before sharing." })
        .waitFor();
      assert.equal(
        await otherPanel.locator("#sharing[open]").count(),
        0,
        "typing during Save & share cannot publish an earlier snapshot",
      );
      await otherPanel.locator("#share-draft").click();
      await otherPanel.locator("#create-share").waitFor({ state: "visible" });
      assert.equal(
        await worker.evaluate(() => globalThis.fixtureShareWrites.length),
        1,
        "Save & share saves but still waits for publication confirmation",
      );
      assert.match(
        await otherPanel.locator("#share-preview").textContent(),
        /Shared from Notes/,
      );
      await otherPanel.locator("#create-share").click();
      await otherPanel.locator("#copy-share").waitFor({ state: "visible" });
      assert.equal(
        await worker.evaluate(() => globalThis.fixtureShareWrites.length),
        2,
      );
      await otherPanel.locator("#close-sharing").click();
      if (process.env.EXTENSION_SCREENSHOTS)
        await otherPanel.screenshot({
          path: join(
            process.env.EXTENSION_SCREENSHOTS,
            `${target}-saved-notes-390.png`,
          ),
          fullPage: true,
        });
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
