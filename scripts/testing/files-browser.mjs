// Disposable identities/data only; real API, extraction, source storage and UI.
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { setTimeout as pause } from "node:timers/promises";
import process from "node:process";
import console from "node:console";
import { URL } from "node:url";
import { Buffer } from "node:buffer";
import { createDatabase } from "../../lib/database/src/index.ts";
import {
  MemoryService,
  sessionPrincipal,
  DocumentImports,
  ConversationDocuments,
  runTask,
  documentImportHandlers,
  conversationDocumentHandlers,
} from "../../lib/memory/src/index.ts";
import { rememberSchema } from "../../lib/shared/src/contracts.ts";
import { mediaReference } from "../../lib/shared/src/media.ts";
import { createApp } from "../../packages/api/src/app.ts";
import { localMedia } from "../../packages/api/src/media-store.ts";
import { extractDocument } from "../../packages/api/src/document-extraction.ts";

const requireApi = createRequire(
    new URL("../../packages/api/package.json", import.meta.url),
  ),
  requireSite = createRequire(
    new URL("../../packages/website/package.json", import.meta.url),
  );
const { serve } = requireApi("@hono/node-server"),
  sharp = requireApi("sharp"),
  { chromium, webkit, expect } = requireSite("@playwright/test"),
  AxeBuilder = requireSite("@axe-core/playwright").default;
const source = process.env.TEST_MIGRATION_DATABASE_URL;
assert(source && new URL(source).pathname.endsWith("_test"));
const authority = createDatabase(source),
  name = `grove_files_browser_${randomUUID().replaceAll("-", "")}_test`;
const target = (value) => {
  const url = new URL(value);
  url.pathname = `/${name}`;
  return url.href;
};
const apiPort = Number(process.env.FILES_API_PORT || 26656),
  port = Number(process.env.DASHBOARD_TEST_PORT || 26657);
let owner, api, worker, directory, server, fixture;
try {
  await authority.raw("CREATE DATABASE ??", [name]);
  owner = createDatabase(target(source));
  await owner.migrate.latest();
  api = createDatabase(target(process.env.TEST_DATABASE_URL));
  worker = createDatabase(target(process.env.TEST_WORKER_DATABASE_URL));
  const account = (
    await api.raw("SELECT * FROM grove_account(?)", [
      `files_browser_${randomUUID()}`,
    ])
  ).rows[0];
  const principal = sessionPrincipal(
      account.id,
      account.clerk_subject ?? account.clerkSubject,
    ),
    service = new MemoryService(api, "files-browser-secret".repeat(3));
  directory = await mkdtemp("/tmp/opencode/files-browser-");
  const media = localMedia(directory);
  await media.ready();
  const imports = new DocumentImports(service),
    docs = new ConversationDocuments(service);
  const drain = async (id) => {
    for (let i = 0; i < 30; i++) {
      const row = await owner("background_tasks").where({ id }).first();
      if (row.status === "succeeded") return;
      assert(!["failed", "cancelled"].includes(row.status));
      const runner = new MemoryService(worker, service.cursorSecret);
      await runTask(
        worker,
        {
          ...documentImportHandlers(runner, extractDocument, media),
          ...conversationDocumentHandlers(runner, extractDocument),
        },
        { id },
      );
    }
    throw new Error("task did not finish");
  };
  const project = await service.project(principal, {
    name: "Garden notebook",
    identity: randomUUID(),
  });
  const batchId = randomUUID(),
    fileId = randomUUID(),
    original = Buffer.from(
      "# Garden field guide\n\nSeedlings need damp mulch and gentle light.\n\n" +
        "Keep a record of watering. ".repeat(250),
    );
  await imports.create(principal, { id: batchId });
  await imports.upload(
    principal,
    batchId,
    fileId,
    "Garden field guide.md",
    original,
  );
  const prep = await imports.prepare(principal, batchId, randomUUID());
  await drain(prep.taskId);
  let review = await imports.get(principal, batchId);
  await imports.place(principal, batchId, {
    expectedVersion: review.version,
    destination: { projectId: project.id, version: project.version },
  });
  review = await imports.get(principal, batchId);
  const confirm = await imports.confirm(principal, batchId, {
    id: randomUUID(),
    expectedVersion: review.version,
  });
  await drain(confirm.taskId);
  const chat = await service.conversations.create(principal, {
    id: randomUUID(),
    includePersonal: false,
  });
  const docId = randomUUID(),
    chatBytes = Buffer.from("Private plant checklist for this conversation.");
  let activeDocId = docId;
  const chatTask = await docs.upload(
    principal,
    chat.id,
    docId,
    "Plant checklist.txt",
    chatBytes,
  );
  await drain(chatTask.taskId);
  let chatList = await docs.list(principal, chat.id);
  await docs.accept(
    principal,
    chat.id,
    { expectedVersion: chatList.version },
    media,
    new globalThis.AbortController().signal,
  );
  const pendingId = randomUUID(),
    pendingTask = await docs.upload(
      principal,
      chat.id,
      pendingId,
      "Reading draft.txt",
      Buffer.from("A temporary attachment, not a saved note."),
    );
  await drain(pendingTask.taskId);
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
  const note = await service.remember(
    principal,
    rememberSchema.parse({
      operationId: randomUUID(),
      projectId: project.id,
      content: "Garden photograph",
    }),
  );
  const png = await sharp({
      create: { width: 2, height: 2, channels: 3, background: "green" },
    })
      .png()
      .toBuffer(),
    imageId = randomUUID();
  const upload = await app.request(
    `http://127.0.0.1:${apiPort}/v1/memories/${note.id}/media/${imageId}`,
    {
      method: "PUT",
      body: new Uint8Array(png),
      headers: {
        "content-type": "image/png",
        "content-length": String(png.length),
        "x-grove-note-version": String(note.version),
        "x-grove-content-sha256": createHash("sha256")
          .update(png)
          .digest("hex"),
      },
    },
  );
  assert.equal(upload.status, 201, await upload.clone().text());
  await service.remember(
    principal,
    rememberSchema.parse({
      operationId: randomUUID(),
      id: note.id,
      expectedVersion: note.version,
      projectId: project.id,
      content: `Garden photograph\n\n![Garden](${mediaReference(imageId)})`,
    }),
  );
  server = serve({ fetch: app.fetch, hostname: "127.0.0.1", port: apiPort });
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
      /*owned fixture startup*/
    }
    if (ready) break;
    await pause(100);
  }
  assert(ready);
  const browserName = process.env.FILES_BROWSER || "chromium",
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
      await page.goto(`http://127.0.0.1:${port}/app/settings/data`);
      await page
        .getByRole("link", { name: "View files & storage", exact: true })
        .click();
      await expect(
        page.getByRole("heading", { name: "Files & storage", exact: true }),
      ).toBeVisible();
      await expect(
        page.getByRole("list", { name: "Uploaded files", exact: true }),
      ).toContainText("Garden field guide.md");
      await expect(page.locator(".files-storage")).not.toHaveAttribute(
        "open",
        "",
      );
      if (width <= 390)
        await expect(page.locator("#files-list-heading")).toBeInViewport();
      await page.getByLabel("Sort by", { exact: true }).selectOption("name");
      await expect(page.locator(".file-name strong").first()).toHaveText(
        "Garden field guide.md",
      );
      await page.getByLabel("Sort by", { exact: true }).selectOption("size");
      await expect(page.locator(".file-name strong").first()).toHaveText(
        "Garden field guide.md",
      );
      const fileSummary = page
        .locator(".file-row > details > summary")
        .filter({ hasText: "Garden field guide.md" });
      await fileSummary.focus();
      await fileSummary.press("Enter");
      const locations = page.getByRole("list", {
        name: "Locations for Garden field guide.md",
        exact: true,
      });
      await expect(
        locations.getByRole("link", { name: "Garden notebook", exact: true }),
      ).toHaveCount(2);
      assert(
        await locations
          .getByRole("link", { name: "Notes", exact: true })
          .first()
          .evaluate((element) => element.clientWidth >= element.scrollWidth),
        "notebook root label is not clipped by file-row grid styles",
      );
      const downloadPromise = page.waitForEvent("download");
      await locations
        .getByRole("link", { name: "Download original", exact: true })
        .first()
        .click();
      assert.deepEqual(
        await readFile(await (await downloadPromise).path()),
        original,
      );
      await page.locator(".files-storage > summary").click();
      const accessibility = await new AxeBuilder({ page })
        .include("main")
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze();
      assert.deepEqual(accessibility.violations, []);
      await page.locator(".files-storage > summary").click();
      assert(
        await page.evaluate(
          () =>
            globalThis.document.documentElement.scrollWidth <=
            globalThis.innerWidth,
        ),
      );
      if (browserName === "chromium") {
        await page.locator(".settings-page").evaluate((element) => {
          element.scrollTop = 0;
        });
        if (width === 390)
          await page
            .getByText("Garden field guide.md", { exact: true })
            .evaluate((element) =>
              element.closest("details").scrollIntoView({ block: "start" }),
            );
        const screenshots = resolve(
          "documentation/design/screenshots/files-experience",
        );
        await mkdir(screenshots, { recursive: true });
        await page.screenshot({
          path: resolve(screenshots, `files-${width}.png`),
          fullPage: true,
        });
      }
      await page
        .getByRole("searchbox", { name: "Search files", exact: true })
        .fill("Garden notebook");
      await page
        .getByRole("button", { name: "Search files", exact: true })
        .click();
      await expect(page.locator(".file-row")).toHaveCount(2);
      await page
        .getByRole("button", { name: "Clear filters", exact: true })
        .click();
      await page.getByRole("button", { name: /^Filters/ }).click();
      if (width === 1440) {
        await page
          .getByLabel("Show files", { exact: true })
          .selectOption("temporary");
        await expect(page.locator(".file-row")).toHaveCount(1);
        await expect(
          page.getByRole("list", { name: "Uploaded files", exact: true }),
        ).toContainText("Reading draft.txt");
        await page
          .getByLabel("Show files", { exact: true })
          .selectOption("all");
      }
      await page.getByLabel("File type", { exact: true }).selectOption("image");
      await expect(
        page.getByRole("list", { name: "Uploaded files", exact: true }),
      ).not.toContainText("Garden field guide.md");
      await expect(
        page.getByRole("list", { name: "Uploaded files", exact: true }),
      ).toContainText("Image ");
      assert(
        await page.evaluate(
          () =>
            globalThis.document.documentElement.scrollWidth <=
            globalThis.innerWidth,
        ),
        "expanded filters stay within the viewport",
      );
      assert.deepEqual(
        (
          await new AxeBuilder({ page })
            .include("main")
            .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
            .analyze()
        ).violations,
        [],
      );
      await page.goto(
        `http://127.0.0.1:${port}/app/settings/files?projectId=${project.id}`,
      );
      await expect(
        page.getByRole("list", { name: "Uploaded files", exact: true }),
      ).not.toContainText("Plant checklist.txt");
      await expect(
        page.getByText(/notes directly in Garden notebook/),
      ).toBeVisible();
      await page
        .getByRole("link", { name: "All uploads", exact: true })
        .click();
      await expect(
        page.getByRole("list", { name: "Uploaded files", exact: true }),
      ).toContainText("Plant checklist.txt");
      await page.getByText("Plant checklist.txt", { exact: true }).click();
      await expect(
        page.getByRole("list", { name: "Locations for Plant checklist.txt" }),
      ).toContainText("Ask Grove chat");
      await docs.remove(principal, chat.id, activeDocId);
      await page
        .getByRole("button", { name: "Refresh files", exact: true })
        .click();
      await expect(
        page.getByRole("list", { name: "Uploaded files", exact: true }),
      ).not.toContainText("Plant checklist.txt");
      // Restore a separate accepted upload for the next viewport, not revoked identity.
      if (width !== 320) {
        const nextId = randomUUID(),
          next = await docs.upload(
            principal,
            chat.id,
            nextId,
            "Plant checklist.txt",
            chatBytes,
          );
        await drain(next.taskId);
        chatList = await docs.list(principal, chat.id);
        await docs.accept(
          principal,
          chat.id,
          { expectedVersion: chatList.version },
          media,
          new globalThis.AbortController().signal,
        );
        activeDocId = nextId;
      }
      assert.deepEqual(errors, []);
      await context.close();
      console.log(
        `${browserName} ${width}px: real inventory/storage, notebook associations, filters, exact original, removal, WCAG/overflow pass`,
      );
    }
  } finally {
    await browser.close();
  }
} finally {
  fixture?.kill("SIGTERM");
  if (server) await new Promise((resolve) => server.close(resolve));
  await Promise.all([owner?.destroy(), api?.destroy(), worker?.destroy()]);
  await authority.raw("DROP DATABASE ?? WITH (FORCE)", [name]);
  await authority.destroy();
  if (directory) await rm(directory, { recursive: true, force: true });
}
