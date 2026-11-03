import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { after, before, test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { createDatabase, type Knex } from "@lib/database";
import {
  MemoryService,
  sessionPrincipal,
  DocumentImports,
  ConversationDocuments,
  MediaAttachments,
  runTask,
  documentImportHandlers,
  conversationDocumentHandlers,
} from "@lib/memory";
import { rememberSchema } from "@lib/shared/contracts";
import { mediaReference } from "@lib/shared/media";
import type { FilePage } from "@lib/shared/files";
import { createApp } from "../../packages/api/src/app.ts";
import { localMedia } from "../../packages/api/src/media-store.ts";
import { extractDocument } from "../../packages/api/src/document-extraction.ts";

const url = process.env.TEST_MIGRATION_DATABASE_URL!;
assert(url && new URL(url).pathname.endsWith("_test"));
const authority = createDatabase(url),
  name = `grove_files_${randomUUID().replaceAll("-", "")}_test`;
let owner: Knex, api: Knex, worker: Knex, directory: string;
before(async () => {
  await authority.raw("CREATE DATABASE ??", [name]);
  const target = (source: string) => {
    const u = new URL(source);
    u.pathname = `/${name}`;
    return u.href;
  };
  owner = createDatabase(target(url));
  await owner.migrate.latest();
  api = createDatabase(target(process.env.TEST_DATABASE_URL!));
  worker = createDatabase(target(process.env.TEST_WORKER_DATABASE_URL!));
  directory = await mkdtemp("/tmp/opencode/grove-files-");
});
after(async () => {
  await Promise.all([owner?.destroy(), api?.destroy(), worker?.destroy()]);
  await authority.raw("DROP DATABASE ?? WITH (FORCE)", [name]);
  await authority.destroy();
  if (directory) await rm(directory, { recursive: true, force: true });
});
async function fixture() {
  const subject = `files_${randomUUID()}`,
    account = (await api.raw("SELECT * FROM grove_account(?)", [subject]))
      .rows[0];
  const principal = sessionPrincipal(account.id, subject),
    service = new MemoryService(api, "files-secret".repeat(4));
  const store = localMedia(directory);
  await store.ready();
  const docs = new ConversationDocuments(service),
    imports = new DocumentImports(service);
  const app = createApp({
    memories: service,
    media: store,
    auth: { principal: async () => principal },
    origin: "http://localhost",
    siteUrl: "http://localhost:3000",
    issuer: "https://fixture.example.test",
    webhookSecret: "fixture",
    ready: async () => {},
  });
  const request = (path: string, body?: unknown) =>
    app.request(`http://localhost/v1${path}`, {
      method: body === undefined ? "GET" : "POST",
      ...(body === undefined
        ? {}
        : {
            body: JSON.stringify(body),
            headers: { "content-type": "application/json" },
          }),
    });
  const search = async (body = {}): Promise<FilePage> => {
    const r = await request("/files/search", body);
    assert.equal(r.status, 200, await r.clone().text());
    return (await r.json()).data;
  };
  const drain = async (id: string) => {
    for (let i = 0; i < 30; i++) {
      const task = await owner("background_tasks").where({ id }).first();
      if (["succeeded", "failed", "cancelled"].includes(task.status)) {
        assert.equal(task.status, "succeeded");
        return;
      }
      await runTask(
        worker,
        {
          ...documentImportHandlers(
            new MemoryService(worker, service.cursorSecret),
            extractDocument,
            store,
          ),
          ...conversationDocumentHandlers(
            new MemoryService(worker, service.cursorSecret),
            extractDocument,
          ),
        },
        { id },
      );
    }
    throw new Error("unfinished task");
  };
  const chatUpload = async (filename = "Garden.txt", accept = false) => {
    const chat = await service.conversations.create(principal, {
      id: randomUUID(),
      includePersonal: false,
    });
    const id = randomUUID(),
      bytes = Buffer.from("Seedlings need damp mulch."),
      task = await docs.upload(principal, chat.id, id, filename, bytes);
    await drain(task.taskId);
    if (accept) {
      const list = await docs.list(principal, chat.id);
      await docs.accept(
        principal,
        chat.id,
        { expectedVersion: list.version },
        store,
        new AbortController().signal,
      );
    }
    return { chat, id, bytes };
  };
  return {
    principal,
    service,
    docs,
    imports,
    store,
    request,
    search,
    drain,
    chatUpload,
  };
}
test("files inventory exposes private chat uploads and honest storage counters without source keys", async () => {
  const f = await fixture();
  const staged = await f.chatUpload("Unconfirmed.txt"),
    accepted = await f.chatUpload("Accepted.txt", true);
  const page = await f.search();
  assert.equal(page.items.length, 2);
  assert.equal(page.items.find((x) => x.id === staged.id)?.state, "staged");
  const entry = page.items.find((x: { id: string }) => x.id === accepted.id);
  assert(entry);
  assert.equal(entry.state, "retained");
  const locations = await f.request("/files/locations", {
    source: entry.source,
    id: entry.id,
  });
  assert.equal(locations.status, 200);
  const location = (await locations.json()).data.items[0];
  assert.equal(location.conversationId, accepted.chat.id);
  assert.equal(
    location.downloadPath,
    `/conversations/${accepted.chat.id}/documents/${accepted.id}/original`,
  );
  const storage = await f.request("/files/storage");
  assert.equal(storage.status, 200);
  const usage = (await storage.json()).data;
  assert.equal(usage.budgetBytes, accepted.bytes.length);
  assert.equal(usage.stagingBytes, staged.bytes.length);
  assert.equal(usage.byteLimit, 1024 * 1024 * 1024);
  assert.equal(usage.stagingLimit, 75 * 1024 * 1024);
  assert.equal(usage.attempts, 1);
  assert(
    !JSON.stringify({ page, usage, location }).match(
      /objectKey|object_key|sha256|damp mulch|staging":/,
    ),
  );
});
test("inventory removal and expiry never reopen inaccessible sources or refund retained bytes", async () => {
  const f = await fixture(),
    accepted = await f.chatUpload("Removed.txt", true),
    staged = await f.chatUpload("Expired.txt");
  await f.docs.remove(f.principal, accepted.chat.id, accepted.id);
  await owner("conversation_documents")
    .where({ id: staged.id })
    .update({ expiresAt: owner.raw("now()-interval '1 second'") });
  assert.equal((await f.search()).items.length, 0);
  assert.equal(
    (await f.request("/files/locations", { source: "chat", id: accepted.id }))
      .status,
    404,
  );
  const usage = (await (await f.request("/files/storage")).json()).data;
  assert.equal(usage.budgetBytes, accepted.bytes.length);
  assert.equal(
    usage.stagingBytes,
    staged.bytes.length,
    "still physically staged until cleanup; not fictitiously freed",
  );
  assert.equal(usage.visibleBytes, 0);
  const list = await f.docs.list(f.principal, staged.chat.id);
  assert.equal(list.documents.length, 0);
});
test("inventory and locations deny foreign accounts, agents, malformed input and deleted chats", async () => {
  const a = await fixture(),
    b = await fixture(),
    doc = await a.chatUpload("Private.txt", true);
  assert.equal((await b.search()).items.length, 0);
  assert.equal(
    (await b.request("/files/locations", { source: "chat", id: doc.id }))
      .status,
    404,
  );
  const agent = createApp({
    memories: a.service,
    auth: {
      principal: async () => ({
        ...a.principal,
        type: "oauth" as const,
        connectionId: randomUUID(),
      }),
    },
    origin: "http://localhost",
    siteUrl: "http://localhost:3000",
    issuer: "https://fixture.example.test",
    webhookSecret: "fixture",
    ready: async () => {},
  });
  for (const [path, method] of [
    ["/files/search", "POST"],
    ["/files/locations", "POST"],
    ["/files/storage", "GET"],
  ]) {
    const response = await agent.request(`http://localhost/v1${path}`, {
      method,
      ...(method === "POST"
        ? { body: "{}", headers: { "content-type": "application/json" } }
        : {}),
    });
    assert.equal(response.status, 403);
  }
  assert.equal(
    (await a.request("/files/search", { kind: "secret", projectId: "bad" }))
      .status,
    400,
  );
  await a.service.conversations.remove(a.principal, doc.chat.id);
  assert.equal((await a.search()).items.length, 0);
  assert.equal(
    (await a.request("/files/locations", { source: "chat", id: doc.id }))
      .status,
    404,
  );
});
test("file locations follow current notebooks, deduplicate multi-chunk notes and keep historical media explicit", async () => {
  const f = await fixture(),
    project = await f.service.project(f.principal, {
      name: "Botany",
      identity: randomUUID(),
    });
  const note = await f.service.remember(
    f.principal,
    rememberSchema.parse({
      operationId: randomUUID(),
      content: "Garden image",
      projectId: project.id,
    }),
  );
  const media = new MediaAttachments(f.service),
    id = randomUUID();
  const upload = {
    id,
    memoryId: note.id,
    version: note.version,
    bytes: 100,
    mime: "image/png",
    sha256: createHash("sha256").update("fixture").digest("hex"),
  };
  const claim = await media.claim(f.principal, upload);
  await media.finish(f.principal, upload, claim.row.leaseId, {
    width: 2,
    height: 2,
  });
  const saved = await f.service.remember(
    f.principal,
    rememberSchema.parse({
      operationId: randomUUID(),
      id: note.id,
      expectedVersion: note.version,
      projectId: project.id,
      content: `![Garden](${mediaReference(id)})`,
    }),
  );
  const page = await f.search({ projectId: project.id, kind: "image" });
  assert.equal(page.items.length, 1);
  const locations = async () =>
    (
      await (
        await f.request("/files/locations", { source: "media", id })
      ).json()
    ).data.items;
  assert.equal((await locations())[0].projectName, "Botany");
  assert.equal((await locations())[0].historical, false);
  await f.service.remember(
    f.principal,
    rememberSchema.parse({
      operationId: randomUUID(),
      id: note.id,
      expectedVersion: saved.version,
      projectId: null,
      content: "Image no longer in current note",
    }),
  );
  assert.equal((await f.search({ projectId: project.id })).items.length, 0);
  assert.equal((await f.search({ memoryId: note.id })).items.length, 1);
  const history = (await locations())[0];
  assert.equal(history.projectId, null);
  assert.equal(history.historical, true);
  assert.equal(
    history.downloadPath,
    `/memories/${note.id}/media/${id}?version=${saved.version}`,
  );
  assert.equal((await f.search({ view: "history" })).items.length, 1);
  assert.equal((await f.search({ view: "unfiled" })).items.length, 1);
});
test("chat to full-text conversion lists one retained original with all saved-note associations", async () => {
  const f = await fixture(),
    doc = await f.chatUpload("Botany.txt", true);
  const list = await f.docs.list(f.principal, doc.chat.id);
  const converted = await f.docs.import(f.principal, doc.chat.id, {
    id: randomUUID(),
    expectedVersion: list.version,
  });
  const review = await f.imports.get(f.principal, converted.id);
  const confirm = await f.imports.confirm(f.principal, converted.id, {
    id: randomUUID(),
    expectedVersion: review.version,
  });
  await f.drain(confirm.taskId);
  const page = await f.search();
  assert.equal(
    page.items.length,
    1,
    "conversion must not count the same retained source twice",
  );
  const locations = (
    await (
      await f.request("/files/locations", { source: "chat", id: doc.id })
    ).json()
  ).data.items;
  assert.equal(
    locations.filter((l: { memoryId?: string }) => l.memoryId).length,
    1,
  );
  assert.equal(
    locations.filter((l: { conversationId?: string }) => l.conversationId)
      .length,
    1,
  );
  const memoryId = locations.find(
    (l: { memoryId?: string }) => l.memoryId,
  ).memoryId;
  const pageForNote = await f.search({ memoryId });
  assert.equal(pageForNote.items.length, 1);
  await f.docs.remove(f.principal, doc.chat.id, doc.id);
  const stillAvailable = (
    await (
      await f.request("/files/locations", { source: "chat", id: doc.id })
    ).json()
  ).data.items;
  assert.equal(stillAvailable.length, 1);
  assert.equal(stillAvailable[0].memoryId, memoryId);
  assert(stillAvailable[0].downloadPath.startsWith("/import-batches/"));
});
test("file search uses signed filter/account-bound keyset pages and literal filename matching", async () => {
  const f = await fixture(),
    batchId = randomUUID();
  await f.imports.create(f.principal, { id: batchId });
  // Populate many genuine bounded import records without parser/provider work.
  for (let i = 0; i < 25; i++)
    await f.imports.upload(
      f.principal,
      batchId,
      randomUUID(),
      `File ${i === 0 ? "%_" : i}.txt`,
      Buffer.from("staged"),
    );
  for (let i = 0; i < 7; i++) await f.chatUpload(`Chat ${i}.txt`);
  const first = await f.search();
  assert.equal(first.items.length, 30);
  assert(first.nextCursor);
  const second = await f.search({ after: first.nextCursor });
  assert.equal(second.items.length, 2);
  assert.equal(second.nextCursor, null);
  assert.equal(
    new Set([...first.items, ...second.items].map((x) => x.id)).size,
    32,
  );
  assert.equal((await f.search({ query: "%_" })).items.length, 1);
  assert.equal(
    (
      await f.request("/files/search", {
        after: first.nextCursor,
        kind: "image",
      })
    ).status,
    400,
  );
  assert.equal(
    (await f.request("/files/search", { after: `${first.nextCursor}broken` }))
      .status,
    400,
  );
  const other = await fixture();
  assert.equal(
    (await other.request("/files/search", { after: first.nextCursor })).status,
    400,
  );
  const staged = first.items[0];
  const detail = await f.request("/files/locations", {
    source: staged.source,
    id: staged.id,
  });
  assert.equal(detail.status, 200);
  assert.equal((await detail.json()).data.items[0].downloadPath, null);
});
test("uncertain media writes reserve budget but are not reported as accessible original bytes", async () => {
  const f = await fixture(),
    note = await f.service.remember(
      f.principal,
      rememberSchema.parse({
        operationId: randomUUID(),
        content: "Recording draft",
      }),
    );
  const media = new MediaAttachments(f.service),
    upload = {
      id: randomUUID(),
      memoryId: note.id,
      version: note.version,
      bytes: 100,
      mime: "audio/wav",
      sha256: "a".repeat(64),
    };
  await media.claim(f.principal, upload);
  const usage = (await (await f.request("/files/storage")).json()).data;
  assert.equal(usage.budgetBytes, 100);
  assert.equal(usage.visibleBytes, 0);
  const entry = (await f.search({ kind: "recording" })).items[0];
  assert.equal(entry.state, "reserved");
  const locations = (
    await (
      await f.request("/files/locations", { source: "media", id: upload.id })
    ).json()
  ).data;
  assert.equal(locations.items[0].downloadPath, null);
});
test("many imported-note locations paginate without duplicates and disappear with deleted notes", async () => {
  const f = await fixture(),
    batchId = randomUUID(),
    fileId = randomUUID();
  await f.imports.create(f.principal, { id: batchId });
  await f.imports.upload(
    f.principal,
    batchId,
    fileId,
    "Long reference.txt",
    Buffer.from("Source paragraph. ".repeat(12500)),
  );
  const prepared = await f.imports.prepare(f.principal, batchId, randomUUID());
  await f.drain(prepared.taskId);
  const review = await f.imports.get(f.principal, batchId);
  const confirm = await f.imports.confirm(f.principal, batchId, {
    id: randomUUID(),
    expectedVersion: review.version,
  });
  await f.drain(confirm.taskId);
  const first = (
    await (
      await f.request("/files/locations", { source: "import", id: fileId })
    ).json()
  ).data;
  assert.equal(first.items.length, 30);
  assert(first.nextCursor);
  const second = (
    await (
      await f.request("/files/locations", {
        source: "import",
        id: fileId,
        after: first.nextCursor,
      })
    ).json()
  ).data;
  assert(second.items.length > 0);
  assert.equal(second.nextCursor, null);
  const ids = [...first.items, ...second.items].map((x) => x.memoryId);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal((await f.search()).items[0].locationCount, ids.length);
  const notes = await owner("memories")
    .whereIn("id", ids)
    .select("id", "version");
  await f.service.forget(f.principal, {
    operationId: randomUUID(),
    items: notes.map((n) => ({ id: n.id, expectedVersion: n.version })),
  });
  assert.equal((await f.search()).items.length, 0);
  assert.equal(
    (
      await f.request("/files/locations", {
        source: "import",
        id: fileId,
        after: first.nextCursor,
      })
    ).status,
    404,
  );
});
test("inventory sorts globally across pages with microsecond-safe dates and stable name/size ties", async () => {
  const f = await fixture(),
    records: { id: string; index: number; filename: string; bytes: number }[] =
      [];
  for (let group = 0; group < 2; group++) {
    const chat = await f.service.conversations.create(f.principal, {
      id: randomUUID(),
      includePersonal: false,
    });
    for (let j = 0; j < 18; j++) {
      const index = group * 18 + j,
        id = randomUUID(),
        filename = `${index % 2 ? "a" : "Z"} ${index % 4}.txt`,
        bytes = 10 + (index % 3);
      await f.docs.upload(
        f.principal,
        chat.id,
        id,
        filename,
        Buffer.alloc(bytes, 65),
      );
      await owner("conversation_documents")
        .where({ id })
        .update({
          createdAt: `2026-10-25T12:00:00.${String(index).padStart(6, "0")}Z`,
        });
      records.push({ id, index, filename, bytes });
    }
  }
  const newest = await f.search();
  assert.deepEqual(
    newest.items.map((x) => x.id),
    [...records]
      .reverse()
      .slice(0, 30)
      .map((x) => x.id),
  );
  for (const sort of ["newest", "name", "size"]) {
    const first = await f.search({ sort }),
      second = await f.search({ sort, after: first.nextCursor });
    assert.equal(first.items.length, 30);
    assert.equal(second.items.length, 6);
    const compare = (
      a: (typeof records)[number],
      b: (typeof records)[number],
    ) =>
      sort === "newest"
        ? b.index - a.index
        : sort === "size"
          ? b.bytes - a.bytes || a.id.localeCompare(b.id)
          : a.filename
              .toLowerCase()
              .localeCompare(b.filename.toLowerCase(), "en") ||
            a.id.localeCompare(b.id);
    const expected = [...records].sort(compare).map((x) => x.id);
    assert.deepEqual(
      [...first.items, ...second.items].map((x) => x.id),
      expected,
    );
    assert.equal(
      (
        await f.request("/files/search", {
          sort: sort === "name" ? "size" : "name",
          after: first.nextCursor,
        })
      ).status,
      400,
    );
  }
});
test("file views distinguish temporary, failed and chat-only sources without widening authorization", async () => {
  const f = await fixture(),
    staged = await f.chatUpload("Temporary.txt"),
    accepted = await f.chatUpload("Chat only.txt", true);
  const failed = await f.chatUpload("Needs attention.txt");
  await owner("conversation_documents")
    .where({ id: failed.id })
    .update({ status: "failed" });
  const ids = async (view: string) =>
    (await f.search({ view })).items.map((x) => x.id).sort();
  assert.deepEqual(await ids("temporary"), [staged.id, failed.id].sort());
  assert.deepEqual(await ids("attention"), [failed.id]);
  assert.deepEqual(
    await ids("chat_only"),
    [staged.id, accepted.id, failed.id].sort(),
  );
  const converted = await f.docs.import(f.principal, accepted.chat.id, {
    id: randomUUID(),
    expectedVersion: (await f.docs.list(f.principal, accepted.chat.id)).version,
  });
  const review = await f.imports.get(f.principal, converted.id),
    confirm = await f.imports.confirm(f.principal, converted.id, {
      id: randomUUID(),
      expectedVersion: review.version,
    });
  await f.drain(confirm.taskId);
  assert.deepEqual(await ids("chat_only"), [staged.id, failed.id].sort());
  const other = await fixture();
  assert.equal((await other.search({ view: "chat_only" })).items.length, 0);
  await f.docs.remove(f.principal, accepted.chat.id, accepted.id);
  assert.equal(
    (await f.search({ view: "unfiled" })).items.length,
    1,
    "separately saved source remains authorized through its note",
  );
});
test("location-aware search matches current note/notebook/chat titles and hides removed locations", async () => {
  const f = await fixture(),
    doc = await f.chatUpload("Reference.txt", true);
  await owner("conversations")
    .where({ id: doc.chat.id })
    .update({ title: "Seedling questions" });
  assert.equal(
    (await f.search({ query: "Seedling questions" })).items.length,
    1,
  );
  const converted = await f.docs.import(f.principal, doc.chat.id, {
    id: randomUUID(),
    expectedVersion: (await f.docs.list(f.principal, doc.chat.id)).version,
  });
  const project = await f.service.project(f.principal, {
    name: "Botany research",
    identity: randomUUID(),
  });
  let review = await f.imports.get(f.principal, converted.id);
  await f.imports.place(f.principal, converted.id, {
    expectedVersion: review.version,
    destination: { projectId: project.id, version: project.version },
  });
  review = await f.imports.get(f.principal, converted.id);
  const confirm = await f.imports.confirm(f.principal, converted.id, {
    id: randomUUID(),
    expectedVersion: review.version,
  });
  await f.drain(confirm.taskId);
  assert.equal((await f.search({ query: "Botany research" })).items.length, 1);
  assert.equal(
    (await f.search({ query: "Seedlings need damp mulch" })).items.length,
    1,
  );
  await f.docs.remove(f.principal, doc.chat.id, doc.id);
  assert.equal(
    (await f.search({ query: "Seedling questions" })).items.length,
    0,
  );
  assert.equal((await f.search({ query: "Botany research" })).items.length, 1);
});
