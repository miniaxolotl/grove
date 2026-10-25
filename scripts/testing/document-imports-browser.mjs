// Test-only real API/worker/database journey. Never imported into production.
import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import console from "node:console";
import { URL } from "node:url";
import { randomUUID, createHash } from "node:crypto";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { setTimeout as pause } from "node:timers/promises";
import process from "node:process";
import { resolve } from "node:path";
import { createDatabase } from "../../lib/database/src/index.ts";
import {
  MemoryService,
  sessionPrincipal,
  runTask,
  documentImportHandlers,
} from "../../lib/memory/src/index.ts";
import { createApp } from "../../packages/api/src/app.ts";
import { localMedia } from "../../packages/api/src/media-store.ts";
import { extractDocument } from "../../packages/api/src/document-extraction.ts";

const requireApi = createRequire(
  new URL("../../packages/api/package.json", import.meta.url),
);
const requireWebsite = createRequire(
  new URL("../../packages/website/package.json", import.meta.url),
);
const { serve } = requireApi("@hono/node-server");
const { chromium, webkit } = requireWebsite("@playwright/test");
const source = process.env.TEST_MIGRATION_DATABASE_URL;
assert(
  source && new URL(source).pathname.endsWith("_test"),
  "Use a disposable test database",
);
const authority = createDatabase(source),
  name = `grove_import_browser_${randomUUID().replaceAll("-", "")}_test`;
const target = (input) => {
  const u = new URL(input);
  u.pathname = `/${name}`;
  return u.href;
};
const apiPort = Number(process.env.IMPORT_API_PORT || 26506),
  port = Number(process.env.DASHBOARD_TEST_PORT || 26507);
let owner,
  api,
  worker,
  server,
  fixture,
  directory,
  working,
  packagedWorker,
  workerExit,
  stop = false;

function pdf() {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [4 0 R] /Count 1 >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents 5 0 R >>",
  ];
  const text =
    "BT /F1 12 Tf 50 700 Td (Botanical research: seedlings need indirect sunlight.) Tj ET";
  objects.push(`<< /Length ${text.length} >>\nstream\n${text}\nendstream`);
  let result = "%PDF-1.4\n";
  const offsets = [];
  objects.forEach((value, i) => {
    offsets.push(Buffer.byteLength(result));
    result += `${i + 1} 0 obj\n${value}\nendobj\n`;
  });
  const xref = Buffer.byteLength(result);
  result += `xref\n0 6\n0000000000 65535 f \n${offsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(result);
}

try {
  await authority.raw("CREATE DATABASE ??", [name]);
  owner = createDatabase(target(source));
  await owner.migrate.latest();
  api = createDatabase(target(process.env.TEST_DATABASE_URL));
  worker = createDatabase(target(process.env.TEST_WORKER_DATABASE_URL));
  const account = (
    await api.raw("SELECT * FROM grove_account(?)", [
      `import_browser_${randomUUID()}`,
    ])
  ).rows[0];
  const principal = sessionPrincipal(
    account.id,
    account.clerk_subject ?? account.clerkSubject,
  );
  const service = new MemoryService(api, "synthetic-test-secret".repeat(3));
  await service.project(principal, {
    name: "Research",
    identity: "browser-research",
  });
  await mkdir("/tmp/opencode", { recursive: true });
  directory = await mkdtemp("/tmp/opencode/import-browser-");
  const media = localMedia(directory);
  await media.ready();
  const app = createApp({
    memories: service,
    media,
    auth: { principal: async () => principal },
    origin: `http://127.0.0.1:${apiPort}`,
    siteUrl: `http://127.0.0.1:${port}`,
    issuer: "https://fixture.example.test",
    webhookSecret: "fixture",
    ready: async () => {},
  });
  server = serve({ fetch: app.fetch, hostname: "127.0.0.1", port: apiPort });
  const handlers = documentImportHandlers(
    new MemoryService(worker, "synthetic-test-secret".repeat(3)),
    extractDocument,
    media,
  );
  if (process.env.IMPORT_WORKER_DIRECTORY) {
    packagedWorker = spawn(process.execPath, ["dist/worker.js"], {
      cwd: process.env.IMPORT_WORKER_DIRECTORY,
      env: {
        PATH: process.env.PATH,
        NODE_ENV: "test",
        DATABASE_URL: target(process.env.TEST_WORKER_DATABASE_URL),
        API_ORIGIN: `http://127.0.0.1:${apiPort}`,
        SITE_URL: `http://127.0.0.1:${port}`,
        CLERK_ISSUER: "https://clerk.example.test",
        CLERK_PUBLISHABLE_KEY: "pk_test_Zml4dHVyZS5jbGVyay5hY2NvdW50cy5kZXYk",
        CLERK_SECRET_KEY: "sk_test_fixture",
        CLERK_WEBHOOK_SIGNING_SECRET: "fixture",
        CURSOR_SECRET: "x".repeat(32),
        EMBEDDING_MODE: "disabled",
        WORKER_LANES: "bulk",
        EXPORT_STORAGE: "disabled",
        EXPORT_DIRECTORY: `${directory}-exports`,
        MEDIA_STORAGE: "local",
        MEDIA_DIRECTORY: directory,
      },
      stdio: ["ignore", "ignore", "inherit"],
    });
    workerExit = new Promise((resolve, reject) => {
      packagedWorker.once("exit", resolve);
      packagedWorker.once("error", reject);
    });
  } else
    working = (async () => {
      while (!stop) {
        await runTask(worker, handlers);
        await pause(40);
      }
    })();
  fixture = spawn(process.execPath, ["tests/fixtures/dashboard-server.mjs"], {
    cwd: resolve("packages/website"),
    env: {
      ...process.env,
      DASHBOARD_TEST_PORT: String(port),
      DASHBOARD_API_FIXTURE_PORT: String(apiPort),
    },
    stdio: ["ignore", "ignore", "inherit"],
  });
  let ready = false;
  for (let i = 0; i < 100; i++) {
    try {
      ready = (await globalThis.fetch(`http://127.0.0.1:${port}`)).ok;
    } catch {
      // The isolated component fixture is still compiling.
    }
    if (ready) break;
    await pause(100);
  }
  assert(ready, "isolated component fixture did not become ready");
  for (const [browserName, engine] of process.env.IMPORT_BROWSER === "webkit"
    ? [["webkit", webkit]]
    : [["chromium", chromium]]) {
    const browser = await engine.launch({ headless: true });
    try {
      for (const width of [1440, 390, 320]) {
        const context = await browser.newContext({
            viewport: { width, height: width === 1440 ? 1000 : 844 },
          }),
          page = await context.newPage();
        const errors = [];
        page.on("pageerror", (error) => errors.push(error.message));
        await page.goto(`http://127.0.0.1:${port}/app`);
        await page
          .getByRole("button", { name: "Import notes", exact: true })
          .click();
        const dialog = page.getByRole("dialog", {
          name: "Import notes",
          exact: true,
        });
        const original = pdf();
        await dialog.getByLabel("Upload notes and PDFs").setInputFiles([
          {
            name: "Garden.md",
            mimeType: "text/markdown",
            buffer: Buffer.from(
              "# Garden journal\n\nWater the seedlings each morning.",
            ),
          },
          { name: "Botany.pdf", mimeType: "application/pdf", buffer: original },
        ]);
        await dialog
          .getByRole("heading", { name: "2 proposed notes" })
          .waitFor();
        const placement = dialog.locator(".import-placement");
        await placement.getByRole("combobox").first().click();
        await page
          .getByRole("option", { name: "Research", exact: true })
          .click();
        await placement
          .getByRole("button", { name: "Use for all notes" })
          .click();
        const draft = dialog
          .locator(".import-draft")
          .filter({ hasText: "Botany.pdf" });
        await draft
          .getByText("Review note and destination", { exact: true })
          .click();
        await draft.getByRole("combobox").first().click();
        await page
          .getByRole("option", { name: "New notebook…", exact: true })
          .click();
        await draft
          .getByLabel("New notebook name")
          .fill(`Plant care ${browserName} ${width}`);
        await draft.getByRole("button", { name: "Save reviewed note" }).click();
        await page.waitForFunction(() => {
          const panel = globalThis.document.querySelector(".import-notes");
          return (
            panel &&
            !panel.textContent.includes("Working…") &&
            !panel.querySelector(
              ".import-draft button.app-button.primary:not(:disabled)",
            )
          );
        });
        assert(
          await draft
            .getByRole("textbox", { name: "Content from Botany.pdf" })
            .inputValue()
            .then((text) => text.includes("indirect sunlight")),
        );
        assert(
          await dialog.evaluate(
            (element) => element.scrollWidth <= element.clientWidth,
          ),
        );
        const captures = resolve(
          "documentation/design/screenshots/note-imports",
        );
        await mkdir(captures, { recursive: true });
        await dialog.evaluate((element) => (element.scrollTop = 0));
        await page.screenshot({
          path: resolve(captures, `real-${browserName}-${width}.png`),
        });
        await dialog
          .getByLabel("I’ve reviewed the notes, destinations and sharing.")
          .check();
        if (width === 390)
          await page.screenshot({
            path: resolve(captures, `confirm-${browserName}-${width}.png`),
          });
        await dialog
          .getByRole("button", { name: "Confirm import", exact: true })
          .click();
        await dialog
          .getByRole("heading", { name: "Import complete", exact: true })
          .waitFor({ timeout: 20000 });
        const batch = await owner("document_import_batches")
          .where({ accountId: account.id })
          .orderBy("createdAt", "desc")
          .first();
        const rows = await owner("document_import_notes")
          .where({ batchId: batch.id })
          .whereNotNull("memoryId");
        assert.equal(rows.length, 2);
        const file = await owner("document_import_files")
          .where({ batchId: batch.id, filename: "Botany.pdf" })
          .first();
        const response = await context.request.get(
          `http://127.0.0.1:${port}/api/grove/import-batches/${batch.id}/files/${file.id}/original`,
        );
        assert.equal(response.status(), 200);
        assert.match(response.headers()["content-disposition"], /^attachment/);
        assert.equal(
          createHash("sha256")
            .update(await response.body())
            .digest("hex"),
          createHash("sha256").update(original).digest("hex"),
        );
        assert.deepEqual(errors, []);
        await context.close();
        console.log(
          JSON.stringify({
            browser: browserName,
            width,
            notes: 2,
            original: "verified",
            status: "passed",
          }),
        );
      }
    } finally {
      await browser.close();
    }
  }
} finally {
  stop = true;
  await working?.catch(() => {});
  if (packagedWorker?.exitCode === null) packagedWorker.kill("SIGTERM");
  const workerStatus = workerExit ? await workerExit : null;
  fixture?.kill("SIGTERM");
  if (fixture && fixture.exitCode === null)
    await new Promise((resolve) => fixture.once("close", resolve));
  if (server) await new Promise((resolve) => server.close(resolve));
  await Promise.all([owner?.destroy(), api?.destroy(), worker?.destroy()]);
  await authority.raw("DROP DATABASE IF EXISTS ?? WITH (FORCE)", [name]);
  await authority.destroy();
  if (directory) await rm(directory, { recursive: true, force: true });
  if (workerExit)
    assert.equal(
      workerStatus,
      0,
      "packaged worker failed or did not drain cleanly",
    );
}
