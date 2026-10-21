// Production Next routing + real Clerk development sign-in, deterministic API data.
// PERF_CLERK_SECRET_KEY / PERF_USER_ID must identify a disposable development user.
/* global fetch, window, PerformanceObserver */
import process from "node:process";
import console from "node:console";
import { URL } from "node:url";
import { setTimeout } from "node:timers";
import { performance } from "node:perf_hooks";
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
const require = createRequire(
  new URL("../../packages/website/package.json", import.meta.url),
);
const { chromium, expect } = require("@playwright/test");
const origin = process.env.PERF_ORIGIN || "http://localhost:4382";
const key = process.env.PERF_CLERK_SECRET_KEY;
assert(
  key?.startsWith("sk_test_"),
  "A disposable Clerk development instance is required",
);
assert(process.env.PERF_USER_ID, "PERF_USER_ID is required");
const tokenResponse = await fetch("https://api.clerk.com/v1/sign_in_tokens", {
  method: "POST",
  headers: {
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    user_id: process.env.PERF_USER_ID,
    expires_in_seconds: 600,
  }),
});
assert(tokenResponse.ok, `Development ticket HTTP ${tokenResponse.status}`);
const { token } = await tokenResponse.json();
const project = {
  id: "00000000-0000-4000-a000-000000000010",
  name: "Performance notebook",
  identity: "perf:synthetic",
  parentId: null,
  version: 1,
};
const notes = Array.from({ length: 30 }, (_, i) => ({
  id: `00000000-0000-4000-a000-${String(100 + i).padStart(12, "0")}`,
  projectId: i % 2 ? project.id : null,
  content: `# Performance note ${i + 1}\n\nA repeatable synthetic note for measuring navigation and loading.\n\n${"Keep the workspace responsive. ".repeat(20)}`,
  kind: "fact",
  status: "active",
  version: 1,
  source: { agent: "website" },
  taskId: null,
  expiresAt: null,
  purgeAt: null,
  createdAt: "2026-10-20T12:00:00Z",
  updatedAt: "2026-10-21T12:00:00Z",
  indexing: "ready",
}));
const browser = await chromium.launch();
async function fixture(context, reads) {
  await context.route(/https:\/\/.*(?:posthog|sentry)\./, (route) =>
    route.fulfill({ json: {} }),
  );
  await context.route("**/api/grove/**", async (route) => {
    const path = new URL(route.request().url()).pathname.replace(
      "/api/grove",
      "",
    );
    const body = route.request().postDataJSON();
    reads.push({ path, method: route.request().method(), at: Date.now() });
    await new Promise((resolve) => setTimeout(resolve, 100));
    const data =
      path === "/projects"
        ? [project]
        : path === "/me"
          ? {
              telemetryEnabled: true,
              memoryCount: notes.length,
              projectCount: 1,
              account: { telemetryEnabled: true },
            }
          : path === "/memories/search"
            ? {
                items: notes
                  .filter(
                    (n) =>
                      body?.projectId === undefined ||
                      n.projectId === body.projectId,
                  )
                  .slice(0, body?.limit || 30),
                nextCursor: null,
              }
            : path.startsWith("/memories/")
              ? notes.find((n) => path === `/memories/${n.id}`)
              : [];
    await route.fulfill({ json: { success: true, data } });
  });
}
const login = await browser.newContext();
await fixture(login, []);
const signIn = await login.newPage();
await signIn.goto(`${origin}/sign-in`);
await signIn.waitForFunction(() => window.Clerk?.loaded);
if (process.env.PERF_VERIFY_LAZY)
  await expect(signIn.locator('input[name="identifier"]')).toBeVisible({
    timeout: 15000,
  });
await signIn.evaluate(async (ticket) => {
  const result = await window.Clerk.client.signIn.create({
    strategy: "ticket",
    ticket,
  });
  // The mounted SignIn UI can activate the ticket and reset this mutable resource.
  // Verify the intended active account below rather than relying on that race.
  if (result.status !== "complete" && result.status !== null)
    throw new Error(`Sign-in: ${result.status}`);
  if (result.createdSessionId)
    await window.Clerk.setActive({ session: result.createdSessionId });
}, token);
await signIn.waitForFunction(
  (userId) => !!window.Clerk?.session && window.Clerk.user?.id === userId,
  process.env.PERF_USER_ID,
  { timeout: 15000 },
);
await signIn.goto(`${origin}/app`);
await expect(signIn.locator(".memory-open").first()).toBeVisible();
const storageState = await login.storageState();
await login.close();
const report = {
  source:
    process.env.PERF_SOURCE ||
    execFileSync("git", ["rev-parse", "HEAD"], {
      encoding: "utf8",
    }).trim(),
  buildId: (
    await readFile(
      process.env.PERF_BUILD_DIR
        ? `${process.env.PERF_BUILD_DIR}/BUILD_ID`
        : new URL("../../packages/website/.next/BUILD_ID", import.meta.url),
      "utf8",
    )
  ).trim(),
  measuredAt: new Date().toISOString(),
  api: "intercepted, 100ms fixed delay; real development Clerk and production Next",
  profiles: {},
};
try {
  for (const mobile of process.env.PERF_ONLY_LAZY ? [] : [false, true]) {
    const runs = [];
    for (let run = 0; run < Number(process.env.PERF_RUNS || 10); run++) {
      const context = await browser.newContext({
        storageState,
        viewport: mobile
          ? { width: 390, height: 844 }
          : { width: 1440, height: 1000 },
        isMobile: mobile,
        hasTouch: mobile,
      });
      const reads = [];
      await fixture(context, reads);
      const page = await context.newPage();
      const cdp = await context.newCDPSession(page);
      await cdp.send("Network.enable");
      await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
      if (mobile) {
        await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
        await cdp.send("Network.emulateNetworkConditions", {
          offline: false,
          latency: 100,
          downloadThroughput: 200000,
          uploadThroughput: 93750,
        });
      }
      await page.addInitScript(() => {
        window.perf = { longTasks: 0, longTaskMs: 0, cls: 0 };
        new PerformanceObserver((list) =>
          list.getEntries().forEach((e) => {
            window.perf.longTasks++;
            window.perf.longTaskMs += e.duration;
          }),
        ).observe({ type: "longtask", buffered: true });
        new PerformanceObserver((list) =>
          list.getEntries().forEach((e) => {
            if (!e.hadRecentInput) window.perf.cls += e.value;
          }),
        ).observe({ type: "layout-shift", buffered: true });
      });
      const start = performance.now();
      await page.goto(`${origin}/app`, { waitUntil: "domcontentloaded" });
      await expect(page.locator(".memory-open").first()).toBeVisible({
        timeout: 60000,
      });
      const cold = performance.now() - start;
      const metrics = await page.evaluate(() => ({
        ...window.perf,
        js: performance
          .getEntriesByType("resource")
          .filter((e) => new URL(e.name).pathname.endsWith(".js"))
          .map((e) => ({
            path: new URL(e.name).pathname,
            bytes: e.encodedBodySize,
            duration: e.duration,
          })),
        fonts: performance
          .getEntriesByType("resource")
          .filter((e) => new URL(e.name).pathname.endsWith(".woff2"))
          .map((e) => ({
            path: new URL(e.name).pathname,
            bytes: e.encodedBodySize,
            duration: e.duration,
          })),
        heap: performance.memory?.usedJSHeapSize,
      }));
      const initialReads = reads.length;
      await page.locator('.app-nav[href="/app/settings"]:visible').click();
      await expect(
        page.getByRole("heading", { name: "Settings", exact: true }),
      ).toBeVisible();
      const warmStart = performance.now();
      await page
        .getByRole("navigation", { name: "Notebook navigation" })
        .getByRole("link", { name: "Notes", exact: true })
        .click();
      await expect(page.locator(".memory-open").first()).toBeVisible();
      const warm = performance.now() - warmStart;
      const repeatedReads = reads.length - initialReads;
      const drawerStart = performance.now();
      await page.locator(".memory-open").first().click();
      await expect(page.getByLabel("Markdown preview")).toBeVisible();
      const drawer = performance.now() - drawerStart;
      await page
        .getByRole("button", { name: "Edit note", exact: true })
        .click();
      await expect(page.locator(".cm-editor")).toBeVisible();
      await page.screenshot({
        path: `${process.env.PERF_OUTPUT || "/tmp/opencode/grove-performance"}-${mobile ? "mobile" : "desktop"}.png`,
      });
      runs.push({ cold, warm, drawer, initialReads, repeatedReads, metrics });
      await writeFile(
        `${process.env.PERF_OUTPUT || "/tmp/opencode/grove-performance"}-${mobile ? "mobile" : "desktop"}-runs.json`,
        `${JSON.stringify(runs, null, 2)}\n`,
      );
      await context.close();
    }
    const p75 = (field) =>
      [...runs].sort((a, b) => a[field] - b[field])[
        Math.ceil(runs.length * 0.75) - 1
      ][field];
    report.profiles[mobile ? "mobile-4x-1.6Mbps-100ms" : "desktop"] = {
      p75: { cold: p75("cold"), warm: p75("warm"), drawer: p75("drawer") },
      runs,
    };
  }
  if (process.env.PERF_VERIFY_LAZY) {
    assert(
      process.env.PERF_BUNDLE_REPORT,
      "PERF_BUNDLE_REPORT is required for chunk checks",
    );
    const bundles = JSON.parse(
      await readFile(process.env.PERF_BUNDLE_REPORT, "utf8"),
    );
    const editor = bundles.routes["app/memories/[id]/page"].chunks.find(
      (chunk) => chunk.containsEditor,
    );
    assert(
      editor,
      "An editor chunk is required for failure/recovery verification",
    );
    const width = Number(process.env.PERF_VERIFY_WIDTH || 1440);
    const context = await browser.newContext({
      storageState,
      viewport: { width, height: width < 768 ? 844 : 1000 },
      isMobile: width < 768,
      hasTouch: width < 768,
    });
    await fixture(context, []);
    const page = await context.newPage();
    await page.goto(`${origin}/app`);
    await expect(page.locator(".memory-open").first()).toBeVisible();
    await page.getByRole("button", { name: "Open user menu" }).last().click();
    await expect(
      page.getByRole("button", { name: "Sign out", exact: true }),
    ).toBeVisible();
    await page.keyboard.press("Escape");
    const before = await page.evaluate(() =>
      performance.getEntriesByType("resource").map((entry) => entry.name),
    );
    assert(
      !before.some((url) => url.endsWith(editor.file)),
      "The editor should not load before opening a note",
    );
    const chunk = `${origin}/_next/${editor.file}`;
    const release = Promise.withResolvers();
    await page.route(chunk, async (route) => {
      await release.promise;
      await route.abort("failed");
    });
    // Avoid hover/focus preloading so this checks an actual failed first open.
    await page
      .locator(".memory-open")
      .first()
      .evaluate((button) => button.click());
    const panel = page.getByRole("dialog", { name: "Note", exact: true });
    await expect(panel.getByRole("status")).toContainText("Opening your note…");
    const pendingBounds = await panel.boundingBox();
    const close = panel.getByRole("button", {
      name: "Close dialog",
      exact: true,
    });
    await expect(close).toBeFocused();
    release.resolve();
    await expect(
      page.getByRole("button", { name: "Try opening again" }),
    ).toBeVisible();
    assert.deepEqual(
      await panel.boundingBox(),
      pendingBounds,
      "Failure must preserve drawer geometry",
    );
    await page.unroute(chunk);
    await page.getByRole("button", { name: "Try opening again" }).focus();
    await page.keyboard.press("Enter");
    await expect(page.getByLabel("Markdown preview")).toBeVisible({
      timeout: 15000,
    });
    assert.deepEqual(
      await panel.boundingBox(),
      pendingBounds,
      "Ready content must preserve drawer geometry",
    );
    await expect(close).toBeFocused();
    await page.getByRole("button", { name: "Edit note", exact: true }).click();
    await expect(page.locator(".cm-editor")).toBeVisible();
    await context.close();
    const anonymous = await browser.newContext();
    const denial = await anonymous.request.get(`${origin}/api/grove/me`);
    assert.equal(denial.status(), 401);
    assert.equal(denial.headers()["cache-control"], "private, no-store");
    await anonymous.close();
    report.lazyRetry = `Sign-in and account controls render; editor absent before open; held/failed/retried drawer keeps geometry and focus at ${width}px; anonymous BFF denied with private no-store`;
  }
  await writeFile(
    `${process.env.PERF_OUTPUT || "/tmp/opencode/grove-performance"}.json`,
    `${JSON.stringify(report, null, 2)}\n`,
  );
  console.log(
    JSON.stringify(
      Object.fromEntries(
        Object.entries(report.profiles).map(([profile, data]) => [
          profile,
          data.p75,
        ]),
      ),
      null,
      2,
    ),
  );
  if (report.lazyRetry) console.log(report.lazyRetry);
} finally {
  await browser.close();
}
