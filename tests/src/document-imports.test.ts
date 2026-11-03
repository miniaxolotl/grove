import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { createDatabase, tenant, type Knex } from "@lib/database";
import { rememberSchema } from "@lib/shared/contracts";
import {
  MemoryService,
  sessionPrincipal,
  Tasks,
  runTask,
  exportHandlers,
} from "@lib/memory";
import { localArtifacts } from "../../packages/api/src/artifacts.ts";
import * as imports from "../../lib/memory/src/document-imports.ts";
import { extractDocument } from "../../packages/api/src/document-extraction.ts";
import { localMedia } from "../../packages/api/src/media-store.ts";
import { createApp } from "../../packages/api/src/app.ts";
import {
  cleanupHandlers,
  scheduleCleanup,
} from "../../lib/memory/src/cleanup.ts";

test("existing notebook discovery works without cached profiles and reads the matching source", async () => {
  const f = await fixture(),
    id = randomUUID(),
    fileId = randomUUID();
  const project = await f.service.project(f.principal, {
    name: "Reference",
    identity: randomUUID(),
  });
  const first = await f.service.remember(
    f.principal,
    rememberSchema.parse({
      operationId: randomUUID(),
      projectId: project.id,
      content: "Initial note one",
    }),
  );
  const second = await f.service.remember(
    f.principal,
    rememberSchema.parse({
      operationId: randomUUID(),
      projectId: project.id,
      content: "Initial note two",
    }),
  );
  const sorted = [first, second].sort((a, b) => a.id.localeCompare(b.id));
  await f.service.remember(
    f.principal,
    rememberSchema.parse({
      operationId: randomUUID(),
      id: sorted[0].id,
      expectedVersion: 1,
      projectId: project.id,
      content: "Unrelated invoice record",
    }),
  );
  const matching = await f.service.remember(
    f.principal,
    rememberSchema.parse({
      operationId: randomUUID(),
      id: sorted[1].id,
      expectedVersion: 1,
      projectId: project.id,
      content: "Oak roots need damp mulch and careful watering.",
    }),
  );
  await f.subject.create(f.principal, { id });
  await f.subject.upload(
    f.principal,
    id,
    fileId,
    "tree.txt",
    Buffer.from("Oak roots need damp mulch."),
  );
  const prep = await f.subject.prepare(f.principal, id, randomUUID());
  await f.drain(prep.taskId);
  f.service.providers.generation = {
    profile: "discovery-test",
    generate: async (schema, _instructions, sources, options) => {
      assert(
        (options?.context?.notebooks ?? []).some(
          (value) => (value as { id: string }).id === project.id,
        ),
      );
      assert(
        sources.some(
          (source) =>
            source.id === matching.id && source.content.includes("damp mulch"),
        ),
      );
      return schema.parse({
        groups: [
          {
            files: [fileId],
            destination: [project.id],
            name: [],
            reason: "Oak care",
            evidence: [
              { id: fileId, version: 1, quote: "Oak roots need damp mulch" },
              {
                id: matching.id,
                version: matching.version,
                quote: "Oak roots need damp mulch",
              },
            ],
          },
        ],
      });
    },
  };
  const batch = await f.subject.get(f.principal, id);
  await f.subject.suggest(
    f.principal,
    id,
    { id: randomUUID(), expectedVersion: batch.version },
    new AbortController().signal,
  );
  assert.deepEqual(
    (await f.subject.get(f.principal, id)).notes[0].destination,
    { projectId: project.id, version: project.version },
  );
});

test("upload IDs cannot be rebound to another batch", async () => {
  const f = await fixture(),
    first = randomUUID(),
    second = randomUUID(),
    fileId = randomUUID();
  await f.subject.create(f.principal, { id: first });
  await f.subject.upload(
    f.principal,
    first,
    fileId,
    "note.txt",
    Buffer.from("First file"),
  );
  await f.subject.cancel(f.principal, first);
  await f.subject.create(f.principal, { id: second });
  await assert.rejects(
    f.subject.upload(
      f.principal,
      second,
      fileId,
      "note.txt",
      Buffer.from("New file"),
    ),
    (failure) => (failure as { code?: string }).code === "operation_conflict",
  );
});

test("review pagination preserves source segment order and excludes whitespace-only notes", async () => {
  const f = await fixture(),
    id = randomUUID();
  await f.subject.create(f.principal, { id });
  const text = Array.from(
    { length: 25 },
    (_, i) => `Section ${String(i).padStart(2, "0")} ` + "x".repeat(5989),
  ).join("");
  await f.subject.upload(
    f.principal,
    id,
    randomUUID(),
    "ordered.txt",
    Buffer.from(text + " ".repeat(13000)),
  );
  const p = await f.subject.prepare(f.principal, id, randomUUID());
  await f.drain(p.taskId);
  const first = await f.subject.get(f.principal, id),
    second = await f.subject.get(f.principal, id, first.next!);
  const drafts = [...first.notes, ...second.notes];
  assert(drafts.every((note) => !!note.content.trim()));
  assert.match(drafts[0].content, /^Section 00/);
  assert.match(drafts[1].content, /^Section 01/);
  assert.match(second.notes[0].content, /^Section 20/);
});

test("concurrent suggestion retries reserve one provider call and changed-payload request IDs conflict", async () => {
  const f = await fixture(),
    id = randomUUID(),
    fileId = randomUUID();
  await f.subject.create(f.principal, { id });
  await f.subject.upload(
    f.principal,
    id,
    fileId,
    "garden.md",
    Buffer.from("Garden seedlings need water"),
  );
  const p = await f.subject.prepare(f.principal, id, randomUUID());
  await f.drain(p.taskId);
  let enter!: () => void,
    release!: () => void,
    calls = 0;
  const entered = new Promise<void>((resolve) => (enter = resolve)),
    held = new Promise<void>((resolve) => (release = resolve));
  f.service.providers.generation = {
    profile: "suggestion-test",
    generate: async (schema) => {
      calls++;
      if (calls === 1) {
        enter();
        await held;
      }
      return schema.parse({
        groups: [
          {
            files: [fileId],
            destination: [],
            name: ["Gardening"],
            reason: "Plant care",
            evidence: [
              { id: fileId, version: 1, quote: "seedlings need water" },
            ],
          },
        ],
      });
    },
  };
  const batch = await f.subject.get(f.principal, id),
    input = { id: randomUUID(), expectedVersion: batch.version };
  const first = f.subject.suggest(
    f.principal,
    id,
    input,
    new AbortController().signal,
  );
  try {
    await entered;
    await assert.rejects(
      f.subject.suggest(f.principal, id, input, new AbortController().signal),
    );
  } finally {
    release();
    await first.catch(() => {});
  }
  assert.equal(calls, 1);
  await assert.rejects(
    f.subject.suggest(
      f.principal,
      id,
      { ...input, expectedVersion: input.expectedVersion + 1 },
      new AbortController().signal,
    ),
  );
});

for (const change of ["preference", "profile"] as const)
  test(`a ${change} cutover fences held import suggestions`, async () => {
    const f = await fixture(),
      id = randomUUID(),
      fileId = randomUUID();
    await f.subject.create(f.principal, { id });
    await f.subject.upload(
      f.principal,
      id,
      fileId,
      "garden.md",
      Buffer.from("Garden seedlings need water"),
    );
    const p = await f.subject.prepare(f.principal, id, randomUUID());
    await f.drain(p.taskId);
    let profile = "import-test";
    f.service.jobProfiles = async () => ({
      generation: profile,
      embedding: null,
      decision: null,
    });
    f.service.providers.generation = {
      profile,
      generate: async (schema) => {
        if (change === "preference") {
          await f.service.settings(f.principal, { filingEnabled: false });
          await f.service.settings(f.principal, { filingEnabled: true });
        } else profile = "new-profile";
        return schema.parse({
          groups: [
            {
              files: [fileId],
              destination: [],
              name: ["Gardening"],
              reason: "Plant care",
              evidence: [
                { id: fileId, version: 1, quote: "seedlings need water" },
              ],
            },
          ],
        });
      },
    };
    const batch = await f.subject.get(f.principal, id);
    await assert.rejects(
      f.subject.suggest(
        f.principal,
        id,
        { id: randomUUID(), expectedVersion: batch.version },
        new AbortController().signal,
      ),
    );
    assert.equal(
      (await f.subject.get(f.principal, id)).notes[0].destination,
      null,
    );
  });

test("expired imports schedule cleanup even without old rate buckets or expiring notes", async () => {
  const f = await fixture(),
    id = randomUUID();
  await f.subject.create(f.principal, { id });
  await f.subject.upload(
    f.principal,
    id,
    randomUUID(),
    "expired.txt",
    Buffer.from("Expired private staging"),
  );
  await admin("document_import_batches")
    .where({ id })
    .update({ expiresAt: admin.raw("now()-interval '1 day'") });
  await admin("rate_buckets").where({ accountId: f.account.id }).delete();
  await scheduleCleanup(worker);
  const task = await admin("background_tasks")
    .where({ accountId: f.account.id, kind: "retention_cleanup" })
    .first();
  assert(task);
  await runTask(
    worker,
    cleanupHandlers(worker, async () => {}),
    { id: task.id },
  );
  assert.equal(
    (await admin("document_import_files").where({ batchId: id }).first())
      .staging,
    null,
  );
});

test("retained source metadata is immutable and account deletion clears only unconfirmed drafts", async () => {
  const f = await fixture(),
    id = randomUUID();
  await f.subject.create(f.principal, { id });
  await f.subject.upload(
    f.principal,
    id,
    randomUUID(),
    "note.txt",
    Buffer.from("Original retained writing"),
  );
  const p = await f.subject.prepare(f.principal, id, randomUUID());
  await f.drain(p.taskId);
  const batch = await f.subject.get(f.principal, id);
  const c = await f.subject.confirm(f.principal, id, {
    id: randomUUID(),
    expectedVersion: batch.version,
  });
  await f.drain(c.taskId);
  const originalFile = (await f.subject.get(f.principal, id)).files[0];
  const app = createApp({
    memories: f.service,
    media: f.storage,
    auth: { principal: async () => f.principal },
    origin: "https://api.example.test",
    siteUrl: "https://example.test",
    issuer: "https://clerk.example.test",
    webhookSecret: "test",
    ready: async () => {},
  });
  const response = await app.request(
    `/v1/import-batches/${id}/files/${originalFile.id}/original`,
  );
  assert.match(
    response.headers.get("content-disposition") ?? "",
    /^attachment/,
  );
  assert.match(
    response.headers.get("content-security-policy") ?? "",
    /sandbox/,
  );
  await response.arrayBuffer();
  await assert.rejects(
    tenant(api, f.account.id, (trx) =>
      trx("document_import_files")
        .where({ batchId: id })
        .update({ sha256: "0".repeat(64) }),
    ),
    /immutable/,
  );
  const draft = randomUUID();
  await f.subject.create(f.principal, { id: draft });
  await f.subject.upload(
    f.principal,
    draft,
    randomUUID(),
    "unsaved.txt",
    Buffer.from("Temporary private draft"),
  );
  const preparation = await f.subject.prepare(f.principal, draft, randomUUID());
  await f.drain(preparation.taskId);
  await f.service.deleteAccount(f.principal);
  assert.equal(
    (await admin("document_import_files").where({ batchId: draft }).first())
      .staging,
    null,
  );
  assert.equal(
    (await admin("document_import_files").where({ batchId: id }).first())
      .originalReady,
    true,
  );
  assert.equal(
    (await admin("document_import_notes").where({ batchId: draft }).first())
      .content,
    "[Import draft unavailable]",
  );
});

test("cancel immediately releases unconfirmed staging and an old applying import still blocks a new batch", async () => {
  const f = await fixture(),
    id = randomUUID();
  await f.subject.create(f.principal, { id });
  await f.subject.upload(
    f.principal,
    id,
    randomUUID(),
    "cancel.txt",
    Buffer.from("Do not retain this draft"),
  );
  await f.subject.cancel(f.principal, id);
  assert.equal(
    (await admin("document_import_files").where({ batchId: id }).first())
      .staging,
    null,
  );
  const next = randomUUID();
  await f.subject.create(f.principal, { id: next });
  await admin("document_import_batches")
    .where({ id: next })
    .update({
      status: "applying",
      expiresAt: admin.raw("now()-interval '1 day'"),
    });
  await assert.rejects(
    f.subject.create(f.principal, { id: randomUUID() }),
    /current import/i,
  );
});

const url = process.env.TEST_MIGRATION_DATABASE_URL!;
if (!url || !new URL(url).pathname.endsWith("_test"))
  throw new Error("Use a disposable test database");
const authority = createDatabase(url);
const name = `grove_documents_${randomUUID().replaceAll("-", "")}_test`;
let admin: Knex, api: Knex, worker: Knex, directory: string;
before(async () => {
  await authority.raw("CREATE DATABASE ??", [name]);
  const target = (source: string) => {
    const u = new URL(source);
    u.pathname = `/${name}`;
    return u.href;
  };
  admin = createDatabase(target(url));
  await admin.migrate.latest();
  api = createDatabase(target(process.env.TEST_DATABASE_URL!));
  worker = createDatabase(target(process.env.TEST_WORKER_DATABASE_URL!));
  await mkdir("/tmp/opencode", { recursive: true });
  directory = await mkdtemp("/tmp/opencode/grove-import-");
});
after(async () => {
  await Promise.all([admin?.destroy(), api?.destroy(), worker?.destroy()]);
  await authority.raw("DROP DATABASE ?? WITH (FORCE)", [name]);
  await authority.destroy();
  if (directory) await rm(directory, { recursive: true, force: true });
});
async function fixture() {
  assert.equal(
    typeof imports.DocumentImports,
    "function",
    "reviewed document import service is missing",
  );
  const account = (
    await api.raw("SELECT * FROM grove_account(?)", [
      `documents_${randomUUID()}`,
    ])
  ).rows[0];
  const principal = sessionPrincipal(
    account.id,
    account.clerk_subject ?? account.clerkSubject,
  );
  const service = new MemoryService(api, "test-secret".repeat(4));
  const subject = new imports.DocumentImports(service);
  const storage = localMedia(directory);
  await storage.ready();
  const handlers = imports.documentImportHandlers(
    new MemoryService(worker, "test-secret".repeat(4)),
    extractDocument,
    storage,
  );
  const drain = async (id: string) => {
    for (let i = 0; i < 100; i++) {
      const task = await admin("background_tasks").where({ id }).first();
      if (["succeeded", "failed", "cancelled"].includes(task.status))
        return task;
      await runTask(worker, handlers, { id });
    }
    throw new Error("task did not complete");
  };
  return { account, principal, service, subject, storage, drain };
}

test("uploads create no library content; reviewed apply creates notebooks and notes exactly once", async () => {
  const f = await fixture(),
    id = randomUUID(),
    fileId = randomUUID();
  await f.subject.create(f.principal, { id });
  await f.subject.upload(
    f.principal,
    id,
    fileId,
    "Garden.md",
    Buffer.from("# Garden\n\nWater the seedlings."),
  );
  const prepared = await f.subject.prepare(f.principal, id, randomUUID());
  assert.equal((await f.drain(prepared.taskId)).status, "succeeded");
  assert.equal(
    (await admin("memories").where({ accountId: f.account.id })).length,
    0,
  );
  assert.equal(
    (await admin("projects").where({ accountId: f.account.id })).length,
    0,
  );
  let batch = await f.subject.get(f.principal, id);
  const draft = batch.notes[0];
  await f.subject.edit(f.principal, id, draft.id, {
    expectedVersion: batch.version,
    destination: { name: "Gardening", parentId: null },
  });
  batch = await f.subject.get(f.principal, id);
  const input = { id: randomUUID(), expectedVersion: batch.version };
  const confirmed = await f.subject.confirm(f.principal, id, input);
  assert.equal((await f.drain(confirmed.taskId)).status, "succeeded");
  assert.deepEqual(await f.subject.confirm(f.principal, id, input), confirmed);
  const result = await f.subject.get(f.principal, id);
  assert.equal(result.notes[0].memoryId !== null, true);
  assert.equal(
    (await admin("memories").where({ accountId: f.account.id })).length,
    1,
  );
  assert.equal(
    (await admin("projects").where({ accountId: f.account.id })).length,
    1,
  );
  const original = await f.subject.original(f.principal, id, fileId);
  const chunks = [];
  for await (const chunk of await f.storage.read(
    original.key,
    new AbortController().signal,
  ))
    chunks.push(chunk);
  assert.equal(
    Buffer.concat(chunks).toString(),
    "# Garden\n\nWater the seedlings.",
  );
});

test("tenant/session boundaries, changed upload replays and stale reviews fail closed", async () => {
  const a = await fixture(),
    b = await fixture(),
    id = randomUUID(),
    fileId = randomUUID();
  await a.subject.create(a.principal, { id });
  await a.subject.upload(
    a.principal,
    id,
    fileId,
    "note.txt",
    Buffer.from("Hello world"),
  );
  await assert.rejects(
    a.subject.upload(
      a.principal,
      id,
      fileId,
      "note.txt",
      Buffer.from("Changed text"),
    ),
    /already|changed/i,
  );
  await assert.rejects(b.subject.get(b.principal, id));
  assert.equal(
    (
      await tenant(api, b.account.id, (trx) =>
        trx("document_import_files").where({ batchId: id }),
      )
    ).length,
    0,
  );
  await assert.rejects(
    a.subject.get(
      { ...a.principal, type: "oauth", connectionId: randomUUID() },
      id,
    ),
  );
  const prep = await a.subject.prepare(a.principal, id, randomUUID());
  await a.drain(prep.taskId);
  const batch = await a.subject.get(a.principal, id);
  await a.subject.edit(a.principal, id, batch.notes[0].id, {
    expectedVersion: batch.version,
    content: "Reviewed",
  });
  await assert.rejects(
    a.subject.confirm(a.principal, id, {
      id: randomUUID(),
      expectedVersion: batch.version,
    }),
    /changed|review/i,
  );
});

test("failed files do not discard valid files and cancellation before confirm leaves no notebooks", async () => {
  const f = await fixture(),
    id = randomUUID();
  await f.subject.create(f.principal, { id });
  await f.subject.upload(
    f.principal,
    id,
    randomUUID(),
    "ok.txt",
    Buffer.from("A good note"),
  );
  await f.subject.upload(
    f.principal,
    id,
    randomUUID(),
    "bad.pdf",
    Buffer.from("%PDF-invalid"),
  );
  const p = await f.subject.prepare(f.principal, id, randomUUID());
  await f.drain(p.taskId);
  const batch = await f.subject.get(f.principal, id);
  assert.equal(batch.notes.length, 1);
  assert.equal(batch.files.filter((file) => file.error).length, 1);
  await f.subject.cancel(f.principal, id);
  await assert.rejects(
    f.subject.confirm(f.principal, id, {
      id: randomUUID(),
      expectedVersion: batch.version,
    }),
  );
  assert.equal(
    (await admin("projects").where({ accountId: f.account.id })).length,
    0,
  );
});

test("a deleted destination cannot receive a reviewed import or leak a retained original", async () => {
  const f = await fixture(),
    id = randomUUID(),
    fileId = randomUUID();
  const notebook = await f.service.project(f.principal, {
    name: "Garden",
    identity: randomUUID(),
  });
  await f.subject.create(f.principal, { id });
  await f.subject.upload(
    f.principal,
    id,
    fileId,
    "note.txt",
    Buffer.from("Some text"),
  );
  const p = await f.subject.prepare(f.principal, id, randomUUID());
  await f.drain(p.taskId);
  let batch = await f.subject.get(f.principal, id);
  await f.subject.edit(f.principal, id, batch.notes[0].id, {
    expectedVersion: batch.version,
    destination: { projectId: notebook.id, version: notebook.version },
  });
  batch = await f.subject.get(f.principal, id);
  await admin("projects")
    .where({ id: notebook.id })
    .update({ deletedAt: admin.fn.now() });
  await assert.rejects(
    f.subject.confirm(f.principal, id, {
      id: randomUUID(),
      expectedVersion: batch.version,
    }),
    /notebook|destination/i,
  );
  await assert.rejects(f.subject.original(f.principal, id, fileId));
});

test("HTTP import uploads authenticate first and enforce actual bytes and SHA-256", async () => {
  const f = await fixture();
  const app = createApp({
    memories: f.service,
    media: f.storage,
    auth: { principal: async () => f.principal },
    origin: "https://api.example.test",
    siteUrl: "https://example.test",
    issuer: "https://clerk.example.test",
    webhookSecret: "test",
    ready: async () => {},
  });
  const id = randomUUID(),
    fileId = randomUUID();
  const created = await app.request("/v1/import-batches", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id }),
  });
  assert.equal(created.status, 201);
  const response = await app.request(
    `/v1/import-batches/${id}/files/${fileId}`,
    {
      method: "PUT",
      headers: {
        "Content-Type": "application/octet-stream",
        "X-Grove-Filename": "notes.txt",
        "X-Grove-Content-Sha256": "0".repeat(64),
        "Content-Length": "4",
      },
      body: "Text",
    },
  );
  assert.equal(response.status, 400);
  assert.equal(
    (await admin("document_import_files").where({ batchId: id })).length,
    0,
  );
});

test("optional topic suggestions organize draft files only and recheck the filing preference", async () => {
  const f = await fixture(),
    id = randomUUID(),
    fileId = randomUUID();
  await f.subject.create(f.principal, { id });
  await f.subject.upload(
    f.principal,
    id,
    fileId,
    "garden.md",
    Buffer.from("# Garden\n\nWater the seedlings"),
  );
  const p = await f.subject.prepare(f.principal, id, randomUUID());
  await f.drain(p.taskId);
  let calls = 0;
  f.service.providers.generation = {
    profile: "import-test",
    generate: async (schema) => {
      calls++;
      return schema.parse({
        groups: [
          {
            files: [fileId],
            destination: [],
            name: ["Gardening"],
            reason: "Plant care notes",
            evidence: [
              { id: fileId, version: 1, quote: "Water the seedlings" },
            ],
          },
        ],
      });
    },
  };
  let batch = await f.subject.get(f.principal, id);
  const input = { id: randomUUID(), expectedVersion: batch.version };
  assert.equal(typeof f.subject.suggest, "function");
  await f.subject.suggest(f.principal, id, input, new AbortController().signal);
  batch = await f.subject.get(f.principal, id);
  assert.deepEqual(batch.notes[0].destination, {
    name: "Gardening",
    parentId: null,
  });
  assert.equal(batch.notes[0].content, "# Garden\n\nWater the seedlings");
  assert.equal(
    (await admin("projects").where({ accountId: f.account.id })).length,
    0,
  );
  await admin("accounts")
    .where({ id: f.account.id })
    .update({ filingEnabled: false });
  await assert.rejects(
    f.subject.suggest(
      f.principal,
      id,
      { id: randomUUID(), expectedVersion: batch.version },
      new AbortController().signal,
    ),
  );
  assert.equal(calls, 1);
});

test("original attempts are tracked before storage failure and cancelled workers cannot publish notes", async () => {
  const f = await fixture(),
    id = randomUUID();
  await f.subject.create(f.principal, { id });
  await f.subject.upload(
    f.principal,
    id,
    randomUUID(),
    "note.txt",
    Buffer.from("Retain this original"),
  );
  const p = await f.subject.prepare(f.principal, id, randomUUID());
  await f.drain(p.taskId);
  const batch = await f.subject.get(f.principal, id);
  const confirmed = await f.subject.confirm(f.principal, id, {
    id: randomUUID(),
    expectedVersion: batch.version,
  });
  const handlers = imports.documentImportHandlers(
    new MemoryService(worker, "test-secret".repeat(4)),
    extractDocument,
    {
      read: f.storage.read,
      writeDocument: async () => {
        assert.equal(
          (await admin("document_import_attempts").where({ batchId: id }))
            .length,
          1,
        );
        await f.subject.cancel(f.principal, id);
      },
    },
  );
  await runTask(worker, handlers, { id: confirmed.taskId });
  assert.equal(
    (await admin("memories").where({ accountId: f.account.id })).length,
    0,
  );
  assert.equal(
    (await admin("document_import_files").where({ batchId: id }).first())
      .originalReady,
    false,
  );
});

test("expired staging is cleared without deleting retained originals or imported notes", async () => {
  const f = await fixture(),
    id = randomUUID();
  await f.subject.create(f.principal, { id });
  await f.subject.upload(
    f.principal,
    id,
    randomUUID(),
    "draft.txt",
    Buffer.from("Unconfirmed private draft"),
  );
  await admin("document_import_batches")
    .where({ id })
    .update({ expiresAt: admin.raw("now()-interval '1 day'") });
  await assert.rejects(f.subject.get(f.principal, id), /expired/i);
  await f.subject.create(f.principal, { id: randomUUID() });
  assert.equal(
    (await admin("document_import_files").where({ batchId: id }).first())
      .staging,
    null,
  );
});

test("bulk placement changes only reviewed destinations and preserves every draft body", async () => {
  const f = await fixture(),
    id = randomUUID();
  await f.subject.create(f.principal, { id });
  await f.subject.upload(
    f.principal,
    id,
    randomUUID(),
    "long.md",
    Buffer.from("Long source paragraph\n\n".repeat(600)),
  );
  const p = await f.subject.prepare(f.principal, id, randomUUID());
  await f.drain(p.taskId);
  const before = await f.subject.get(f.principal, id);
  assert.equal(typeof f.subject.place, "function");
  await f.subject.place(f.principal, id, {
    expectedVersion: before.version,
    destination: { name: "Imported notes", parentId: null },
  });
  const batch = await f.subject.get(f.principal, id);
  assert.deepEqual(
    batch.notes.map((n) => n.content),
    before.notes.map((n) => n.content),
  );
  assert(
    batch.notes.every(
      (n) =>
        n.destination &&
        "name" in n.destination &&
        n.destination.name === "Imported notes",
    ),
  );
});

test("failed preparation retries keep the same task while cancelled batches cannot be retried", async () => {
  const f = await fixture(),
    id = randomUUID();
  await f.subject.create(f.principal, { id });
  await f.subject.upload(
    f.principal,
    id,
    randomUUID(),
    "note.txt",
    Buffer.from("Text"),
  );
  const p = await f.subject.prepare(f.principal, id, randomUUID());
  await admin("background_tasks")
    .where({ id: p.taskId })
    .update({ status: "failed", errorCode: "fixture_interrupted" });
  const task = await new Tasks(f.service, false).action(
    f.principal,
    p.taskId,
    "retry",
  );
  assert.equal(task.status, "pending");
  await f.subject.cancel(f.principal, id);
  await assert.rejects(
    new Tasks(f.service, false).action(f.principal, p.taskId, "retry"),
  );
});

test("media-complete exports include original document bytes and source-to-note provenance", async () => {
  const f = await fixture(),
    id = randomUUID(),
    fileId = randomUUID();
  await f.subject.create(f.principal, { id });
  const original = Buffer.from("# Source\n\nRetain this exact file.");
  await f.subject.upload(f.principal, id, fileId, "source.md", original);
  const p = await f.subject.prepare(f.principal, id, randomUUID());
  await f.drain(p.taskId);
  const batch = await f.subject.get(f.principal, id),
    c = await f.subject.confirm(f.principal, id, {
      id: randomUUID(),
      expectedVersion: batch.version,
    });
  await f.drain(c.taskId);
  const artifacts = localArtifacts(`${directory}/exports`);
  await artifacts.ready!();
  const tasks = new Tasks(f.service, true),
    job = await tasks.export(f.principal, {
      id: randomUUID(),
      includeMedia: true,
      includeDescendants: false,
    });
  const handlers = exportHandlers(worker, artifacts, f.storage);
  for (let i = 0; i < 100; i++) {
    const status = await tasks.get(f.principal, job.id);
    if (status.status === "succeeded") break;
    await runTask(worker, handlers, { id: job.id });
  }
  const artifact = await tasks.artifact(f.principal, job.id);
  const chunks = [];
  for await (const chunk of await artifacts.read(artifact.key))
    chunks.push(chunk);
  const records = Buffer.concat(chunks)
    .toString()
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  assert(
    records.some(
      (row) =>
        row.type === "document_binding" &&
        row.fileId === fileId &&
        row.memoryId,
    ),
  );
  const pieces = records
    .filter((row) => row.type === "document_chunk" && row.id === fileId)
    .sort((a, b) => a.offset - b.offset);
  assert.equal(
    Buffer.concat(
      pieces.map((row) => Buffer.from(row.data, "base64")),
    ).toString(),
    original.toString(),
  );
});
