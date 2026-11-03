// Synthetic identities/provider only; real API, parser, database, source store and UI.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { setTimeout as pause } from "node:timers/promises";
import { resolve } from "node:path";
import process from "node:process";
import console from "node:console";
import { URL } from "node:url";
import { Buffer } from "node:buffer";
import { createDatabase } from "../../lib/database/src/index.ts";
import {
  MemoryService,
  sessionPrincipal,
  runTask,
  conversationDocumentHandlers,
  documentImportHandlers,
} from "../../lib/memory/src/index.ts";
import { conversationPlanSchema } from "../../lib/shared/src/conversations.ts";
import { createApp } from "../../packages/api/src/app.ts";
import { localMedia } from "../../packages/api/src/media-store.ts";
import { extractDocument } from "../../packages/api/src/document-extraction.ts";

const requireApi = createRequire(
    new URL("../../packages/api/package.json", import.meta.url),
  ),
  requireWebsite = createRequire(
    new URL("../../packages/website/package.json", import.meta.url),
  );
const { serve } = requireApi("@hono/node-server"),
  { zipSync, strToU8 } = requireApi("fflate"),
  { chromium, webkit, expect } = requireWebsite("@playwright/test"),
  AxeBuilder = requireWebsite("@axe-core/playwright").default;
const source = process.env.TEST_MIGRATION_DATABASE_URL;
assert(source && new URL(source).pathname.endsWith("_test"));
const authority = createDatabase(source),
  name = `grove_ask_browser_${randomUUID().replaceAll("-", "")}_test`;
const target = (value) => {
  const url = new URL(value);
  url.pathname = `/${name}`;
  return url.href;
};
const apiPort = Number(process.env.ASK_API_PORT || 26636),
  port = Number(process.env.DASHBOARD_TEST_PORT || 26637);
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
try {
  await authority.raw("CREATE DATABASE ??", [name]);
  owner = createDatabase(target(source));
  await owner.migrate.latest();
  api = createDatabase(target(process.env.TEST_DATABASE_URL));
  worker = createDatabase(target(process.env.TEST_WORKER_DATABASE_URL));
  const account = (
      await api.raw("SELECT * FROM grove_account(?)", [
        `ask_browser_${randomUUID()}`,
      ])
    ).rows[0],
    principal = sessionPrincipal(
      account.id,
      account.clerk_subject ?? account.clerkSubject,
    ),
    service = new MemoryService(api, "synthetic-secret".repeat(4));
  service.providers.generation = {
    profile: "synthetic-document-browser",
    generate: async (schema, _i, _s, o) => {
      if (Object.is(schema, conversationPlanSchema))
        return schema.parse({
          query: "seedlings",
          intent: "answer",
          references: [],
          research: [],
          organizeAfter: null,
        });
      const sources = o.context.documents.sources,
        selected = sources.find((s) => s.content.includes("damp mulch"));
      assert(selected);
      return schema.parse({
        message: "",
        statements: [],
        proposals: [],
        documentStatements: [
          {
            text: "Seedlings need damp mulch.",
            sources: [
              {
                id: selected.id,
                version: selected.version,
                quote: "damp mulch",
              },
            ],
          },
        ],
      });
    },
  };
  await mkdir("/tmp/opencode", { recursive: true });
  directory = await mkdtemp("/tmp/opencode/ask-browser-");
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
  if (process.env.ASK_WORKER_DIRECTORY) {
    packagedWorker = spawn(process.execPath, ["dist/worker.js"], {
      cwd: process.env.ASK_WORKER_DIRECTORY,
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
  } else {
    const workerService = new MemoryService(
        worker,
        "synthetic-secret".repeat(4),
      ),
      handlers = {
        ...conversationDocumentHandlers(workerService, extractDocument),
        ...documentImportHandlers(workerService, extractDocument, media),
      };
    working = (async () => {
      while (!stop) {
        await runTask(worker, handlers);
        await pause(40);
      }
    })();
  }
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
      /* The owned fixture is still compiling. */
    }
    if (ready) break;
    await pause(100);
  }
  assert(ready);
  const browserName = process.env.ASK_BROWSER || "chromium",
    browser = await (browserName === "webkit" ? webkit : chromium).launch({
      headless: true,
    });
  try {
    for (const width of [1440, 390, 320]) {
      const context = await browser.newContext({
          viewport: { width, height: width === 1440 ? 1000 : 844 },
        }),
        page = await context.newPage(),
        errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.goto(`http://127.0.0.1:${port}/app/ask`);
      const original = Buffer.from(
        zipSync({
          "[Content_Types].xml": strToU8(
            '<Types><Override ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
          ),
          "word/document.xml": strToU8(
            '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Seedlings need damp mulch.</w:t></w:r></w:p></w:body></w:document>',
          ),
        }),
      );
      await page.getByLabel("Attach notes and documents").setInputFiles([
        {
          name: "Seedlings.docx",
          mimeType:
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          buffer: original,
        },
        {
          name: "Garden.md",
          mimeType: "text/markdown",
          buffer: Buffer.from(
            "# Garden journal\n\nKeep seedlings away from harsh light.",
          ),
        },
      ]);
      await expect(
        page.getByRole("list", { name: "Attached documents" }),
      ).toContainText("Ready", { timeout: 30000 });
      await expect(
        page.getByRole("button", { name: "Save document text…", exact: true }),
      ).toBeEnabled();
      const before = Number(
        (
          await owner("memories")
            .where({ accountId: account.id })
            .count("id as n")
            .first()
        ).n,
      );
      const composer = page.getByRole("textbox", {
        name: "Ask about your notes",
      });
      await composer.fill("What do the seedlings need?");
      await composer.press("Enter");
      await expect(page.locator(".ask-document-evidence")).toContainText(
        "damp mulch",
        { timeout: 30000 },
      );
      const chat = await owner("conversations")
        .where({ accountId: account.id })
        .orderBy("createdAt", "desc")
        .first();
      assert.equal(
        Number(
          (
            await owner("memories")
              .where({ accountId: account.id })
              .count("id as n")
              .first()
          ).n,
        ),
        before,
      );
      await page
        .getByRole("button", { name: "Seedlings.docx · part 1", exact: true })
        .click();
      const citation = page.getByRole("dialog", {
        name: "Seedlings.docx",
        exact: true,
      });
      await expect(citation).toContainText("Seedlings need damp mulch.");
      const downloadPromise = page.waitForEvent("download");
      await citation
        .getByRole("link", { name: "Download original", exact: true })
        .click();
      const download = await downloadPromise;
      assert.deepEqual(await readFile(await download.path()), original);
      await page.keyboard.press("Escape");
      await composer.fill("And what about mulch?");
      await composer.press("Enter");
      await expect(page.locator(".ask-document-evidence")).toHaveCount(2);
      const accessibility = await new AxeBuilder({ page })
        .include("main")
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze();
      assert.deepEqual(accessibility.violations, []);
      assert(
        await page.evaluate(
          () =>
            globalThis.document.documentElement.scrollWidth <=
            globalThis.innerWidth,
        ),
      );
      if (browserName === "chromium" && width !== 390) {
        const screenshots = resolve(
          "documentation/design/screenshots/ask-documents",
        );
        await mkdir(screenshots, { recursive: true });
        await page
          .locator(".ask-conversation")
          .evaluate((element) => (element.scrollTop = 0));
        await page.evaluate(() => globalThis.scrollTo(0, 0));
        await page.screenshot({
          path: resolve(screenshots, `real-answer-${width}.png`),
          fullPage: true,
        });
      }
      await page
        .getByRole("button", { name: "Save document text…", exact: true })
        .click();
      const review = page.getByRole("dialog", {
        name: "Save document text",
        exact: true,
      });
      await expect(
        review.getByRole("heading", { name: "2 proposed notes", exact: true }),
      ).toBeVisible();
      await review
        .getByLabel("I’ve reviewed the notes, destinations and sharing.")
        .check();
      await review
        .getByRole("button", { name: "Confirm import", exact: true })
        .click();
      await expect(
        review.getByRole("heading", { name: "Import complete", exact: true }),
      ).toBeVisible({ timeout: 30000 });
      await page.keyboard.press("Escape");
      assert.equal(
        Number(
          (
            await owner("memories")
              .where({ accountId: account.id })
              .count("id as n")
              .first()
          ).n,
        ),
        before + 2,
      );
      await page
        .getByRole("button", { name: "Remove Seedlings.docx", exact: true })
        .click();
      await expect(
        page.getByRole("list", { name: "Attached documents" }),
      ).not.toContainText("Seedlings.docx");
      await expect(page.locator(".ask-document-evidence")).toHaveCount(0);
      const reopened = await service.conversations.get(principal, chat.id);
      assert.equal(reopened.turns[0].result.documentSources.length, 0);
      assert.equal(reopened.turns[0].result.documentStatements.length, 0);
      if (width === 320) {
        await page.goto(`http://127.0.0.1:${port}/app`);
        await page
          .getByRole("button", { name: "Import notes", exact: true })
          .click();
        const upload = page.getByRole("dialog", {
          name: "Import notes",
          exact: true,
        });
        await upload
          .getByLabel("Upload notes and PDFs")
          .setInputFiles({
            name: "Handoff.txt",
            mimeType: "text/plain",
            buffer: Buffer.from("Private source for a follow-up question."),
          });
        await expect(
          upload.getByRole("button", {
            name: "Ask about these documents",
            exact: true,
          }),
        ).toBeEnabled({ timeout: 30000 });
        await upload
          .getByRole("button", {
            name: "Ask about these documents",
            exact: true,
          })
          .click();
        await expect(
          page.getByRole("list", { name: "Attached documents" }),
        ).toContainText("Handoff.txt", { timeout: 30000 });
        assert.equal(
          Number(
            (
              await owner("memories")
                .where({ accountId: account.id })
                .count("id as n")
                .first()
            ).n,
          ),
          before + 2,
        );
      }
      assert.deepEqual(errors, []);
      await context.close();
      console.log(
        `${browserName} ${width}px: real DOCX/Markdown upload, private citations/follow-up/original, reviewed save and removal pass`,
      );
    }
  } finally {
    await browser.close();
  }
} finally {
  stop = true;
  if (working) await working;
  fixture?.kill("SIGTERM");
  if (packagedWorker) {
    packagedWorker.kill("SIGTERM");
    assert.equal(await workerExit, 0, "packaged worker drains cleanly");
  }
  if (server) await new Promise((resolve) => server.close(resolve));
  await Promise.all([owner?.destroy(), api?.destroy(), worker?.destroy()]);
  await authority.raw("DROP DATABASE ?? WITH (FORCE)", [name]);
  await authority.destroy();
  if (directory) await rm(directory, { recursive: true, force: true });
}
