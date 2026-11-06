import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { createDatabase, tenant } from "@lib/database";
import {
  MemoryService,
  sessionPrincipal,
  executeMemoryTool,
} from "@lib/memory";
import { rememberSchema, type Principal } from "@lib/shared/contracts";
import {
  sourceEditsBetween,
  applySourceEdits,
} from "@lib/shared/document-edits";
import { revisionDocument } from "../../lib/memory/src/document-storage.ts";
import { createApp } from "../../packages/api/src/app.ts";

const db = createDatabase(process.env.TEST_DATABASE_URL!);
const service = new MemoryService(db, "document-integration-test-secret");
let owner: Principal, other: Principal;
before(async () => {
  async function account() {
    const subject = `documents_${randomUUID()}`;
    const { rows } = await db.raw("SELECT * FROM grove_account(?)", [subject]);
    return sessionPrincipal(rows[0].id, subject);
  }
  [owner, other] = await Promise.all([account(), account()]);
});
after(() => db.destroy());
const save = (content: string) =>
  service.remember(
    owner,
    rememberSchema.parse({ operationId: randomUUID(), content }),
  );
const tool = (name: string, input: unknown, principal = owner) =>
  executeMemoryTool(service, principal, name, input);

test("source splices preserve unchanged bytes and fence sequential old text", () => {
  const before = "# Title\r\n\r\nKeep 😀. Old sentence.\r\n\r\nLast\r\n";
  const after = before.replace("Old sentence.", "New sentence.");
  const edits = sourceEditsBetween(before, after);
  assert.equal(edits.length, 1);
  assert(edits[0].oldText.length < before.length);
  assert.equal(applySourceEdits(before, edits), after);
  assert.throws(() => applySourceEdits(before.replace("Old", "bad"), edits));
  assert.throws(() =>
    applySourceEdits("😀", [{ from: 1, to: 2, oldText: "\ude00", text: "x" }]),
  );
});

test("no-op partial saves do not rewrite notes or schedule new inference", async () => {
  const note = await save("Stable source");
  const state = () =>
    tenant(db, owner.accountId, async (trx) => ({
      account: await trx("accounts")
        .where({ id: owner.accountId })
        .first("contentVersion", "changeToken"),
      note: await trx("memories").where({ id: note.id }).first(),
      jobs: await trx("jobs").where({ memoryId: note.id }),
    }));
  const before = await state();
  const input = {
    id: note.id,
    expectedVersion: 1,
    operationId: randomUUID(),
    kind: note.kind,
    capture: "explicit" as const,
  };
  const result = await service.updateMemory(owner, input);
  assert.equal(result.version, 1);
  assert.equal((await service.revisions(owner, note.id)).length, 1);
  assert.deepEqual(await state(), before);
  assert.equal((await service.updateMemory(owner, input)).version, 1);
  assert.deepEqual(await state(), before);
});

test("rapid passage saves coalesce noninteractive inference into the latest durable job", async () => {
  let calls = 0;
  const processed: string[] = [];
  const embedding = {
    profile: `document-edit-${randomUUID()}`,
    model: "fixture",
    dimensions: 384,
    async embed(text: string) {
      calls++;
      processed.push(text);
      return [1, ...Array<number>(383).fill(0)];
    },
  };
  const writes = new MemoryService(db, "coalesce-test-secret", embedding);
  let note = await writes.remember(
    owner,
    rememberSchema.parse({ operationId: randomUUID(), content: "First" }),
  );
  for (const text of ["Second", "Third", "Latest"])
    note = await writes.updateMemory(owner, {
      id: note.id,
      expectedVersion: note.version,
      operationId: randomUUID(),
      capture: "explicit",
      edits: sourceEditsBetween(note.content, text),
    });
  const jobs = await tenant(db, owner.accountId, (trx) =>
    trx("jobs").where({ memoryId: note.id }),
  );
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].version, note.version);
  assert(
    new Date(jobs[0].dueAt).getTime() > Date.now(),
    "background inference waits for the editing burst",
  );
  assert.equal(calls, 0);
  const workerDb = createDatabase(process.env.TEST_WORKER_DATABASE_URL!);
  try {
    const worker = new MemoryService(workerDb, writes.cursorSecret, embedding);
    assert.equal(
      await worker.runJob(jobs[0].id),
      false,
      "a future-due job is not runnable",
    );
    await tenant(db, owner.accountId, (trx) =>
      trx("jobs").where({ id: jobs[0].id }).update({ dueAt: trx.fn.now() }),
    );
    assert.equal(await worker.runJob(jobs[0].id), true);
    assert.deepEqual(processed, ["Latest"]);
    assert.equal(calls, 1);
    assert.equal(
      (
        await tenant(db, owner.accountId, (trx) =>
          trx("jobs").where({ memoryId: note.id }),
        )
      ).length,
      0,
    );
    const vectors = await tenant(db, owner.accountId, (trx) =>
      trx("memory_embeddings").where({ memoryId: note.id }),
    );
    assert.equal(vectors.length, 1);
    assert.equal(vectors[0].version, note.version);
    assert.equal((await writes.get(owner, note.id)).indexing, "ready");
  } finally {
    await workerDb.destroy();
  }
});

test("competing edits from one base serialize atomically without overwriting the winner", async () => {
  const note = await save("First sentence. Second sentence.");
  const outcomes = await Promise.allSettled(
    ["First revised. Second sentence.", "First sentence. Second revised."].map(
      (text) =>
        service.updateMemory(owner, {
          id: note.id,
          expectedVersion: note.version,
          operationId: randomUUID(),
          capture: "explicit",
          edits: sourceEditsBetween(note.content, text),
        }),
    ),
  );
  assert.equal(outcomes.filter((o) => o.status === "fulfilled").length, 1);
  assert.equal((await service.get(owner, note.id)).version, 2);
  assert.equal((await service.revisions(owner, note.id)).length, 2);
});

test("every save persists a projection-matching structured revision with stable untouched nodes", async () => {
  const note = await save("# Title\n\nFirst.\n\nLast.");
  const before = (await tool("get_memory_document", {
    id: note.id,
  })) as Awaited<ReturnType<typeof revisionDocument>>;
  const edited = await service.updateMemory(owner, {
    id: note.id,
    operationId: randomUUID(),
    expectedVersion: note.version,
    capture: "explicit",
    edits: sourceEditsBetween(
      note.content,
      note.content.replace("First.", "Revised.\n\nInserted."),
    ),
  });
  const after = (await tool("get_memory_document", {
    id: note.id,
  })) as typeof before;
  assert.equal(after.blocks.map((b) => b.source).join(""), edited.content);
  assert.equal(after.blocks[0].id, before.blocks[0].id);
  assert.equal(after.blocks.at(-1)!.id, before.blocks.at(-1)!.id);
  await tenant(db, owner.accountId, async (trx) => {
    const row = await trx("memory_revisions")
      .where({ memoryId: note.id, version: edited.version })
      .first();
    assert.deepEqual(row.document, after);
    assert(row.change);
    assert.equal(row.actor.subject, owner.subject);
  });
  await assert.rejects(() =>
    tool("get_memory_document", { id: note.id }, other),
  );
});

test("MCP preview/apply binds exact edits, actor, version and retry payload", async () => {
  const note = await save("Preserve this. Change this. Preserve that.");
  const input = {
    id: note.id,
    expectedVersion: note.version,
    operationId: randomUUID(),
    edits: sourceEditsBetween(
      note.content,
      note.content.replace("Change", "Revise"),
    ),
  };
  const preview = (await tool("preview_memory_patch", input)) as {
    review: string;
    diff: unknown;
  };
  assert(preview.diff);
  assert.equal((await service.get(owner, note.id)).version, 1);
  const applied = (await tool("apply_memory_patch", {
    ...input,
    review: preview.review,
  })) as { version: number; content: string };
  assert.equal(applied.content, "Preserve this. Revise this. Preserve that.");
  assert.equal(applied.version, 2);
  await assert.rejects(() =>
    tool("apply_memory_patch", {
      ...input,
      review: `${preview.review}.invalid`,
    }),
  );
  assert.equal(
    (
      (await tool("apply_memory_patch", {
        ...input,
        review: preview.review,
      })) as typeof applied
    ).version,
    2,
  );
  await assert.rejects(() =>
    tool("apply_memory_patch", {
      ...input,
      edits: sourceEditsBetween(note.content, "Wrong"),
      review: preview.review,
    }),
  );
  await assert.rejects(() =>
    tool("apply_memory_patch", {
      ...input,
      operationId: randomUUID(),
      review: preview.review,
    }),
  );
  await assert.rejects(() =>
    tool("apply_memory_patch", { ...input, review: preview.review }, other),
  );
  const diff = (await tool("compare_memory_revisions", {
    id: note.id,
    beforeVersion: 1,
    afterVersion: 2,
  })) as { changes: unknown[] };
  assert(diff.changes.length);
});

test("metadata-only and legacy edits preserve structured history without changing legacy semantics", async () => {
  const note = await save("# Title\n\nOriginal.");
  const old = await tool("get_memory_document", { id: note.id });
  await service.updateMemory(owner, {
    id: note.id,
    expectedVersion: 1,
    operationId: randomUUID(),
    kind: "decision",
    capture: "explicit",
  });
  const same = (await tool("get_memory_document", { id: note.id })) as {
    blocks: unknown[];
  };
  assert.deepEqual(same.blocks, (old as typeof same).blocks);
  await service.updateMemory(owner, {
    id: note.id,
    expectedVersion: 2,
    operationId: randomUUID(),
    content: "  # Title\n\nLegacy replacement.  ",
    capture: "explicit",
  });
  assert.equal(
    (await service.get(owner, note.id)).content,
    "# Title\n\nLegacy replacement.",
  );
  const historical = await tool("get_memory_document", {
    id: note.id,
    revision: 1,
  });
  assert.deepEqual(historical, old);
});

test("revision projection checks reject corrupt documents and deletion hides structured history", async () => {
  const note = await save("Retained source");
  await assert.rejects(() =>
    tenant(db, owner.accountId, (trx) =>
      trx("memory_revisions")
        .where({ memoryId: note.id })
        .update({
          document: JSON.stringify({
            schemaVersion: 1,
            noteId: note.id,
            revision: 1,
            blocks: [{ source: "wrong" }],
          }),
        }),
    ),
  );
  await service.forget(owner, {
    operationId: randomUUID(),
    items: [{ id: note.id, expectedVersion: note.version }],
  });
  await assert.rejects(() =>
    tool("get_memory_document", { id: note.id, revision: 1 }),
  );
});

test("HTTP browser saves accept exact source splices and preserve source outside the range", async () => {
  const note = await save("# Title\n\nKeep this. Edit that.\n\nLast.");
  const app = createApp({
    memories: service,
    auth: { principal: async () => owner },
    origin: "http://localhost",
    siteUrl: "http://localhost:3000",
    issuer: "https://clerk.example.test",
    webhookSecret: "whsec_dGVzdA==",
    ready: async () => {},
  });
  const response = await app.request(`/v1/memories/${note.id}/edit`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      id: note.id,
      expectedVersion: note.version,
      operationId: randomUUID(),
      edits: sourceEditsBetween(
        note.content,
        note.content.replace("Edit that.", "Edited that."),
      ),
    }),
  });
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(
    result.data.content,
    note.content.replace("Edit that.", "Edited that."),
  );
  assert.deepEqual(result.data.source, note.source);
});

test("preview authorization and pending edits recheck revocation, paused capture and expiry", async () => {
  const note = await save("Exact scoped content");
  const input = {
    id: note.id,
    expectedVersion: note.version,
    operationId: randomUUID(),
    capture: "automatic",
    edits: sourceEditsBetween(note.content, "Changed scoped content"),
  };
  const granted = await service.grant(
    owner,
    {
      name: "Document tool",
      capabilities: ["memory:read", "memory:write"],
      personal: true,
      allProjects: false,
      projectIds: [],
    },
    { key: true },
  );
  const agent: Principal = {
    ...owner,
    type: "key",
    connectionId: granted.connection.id,
  };
  const preview = (await tool("preview_memory_patch", input, agent)) as {
    review: string;
  };
  await tenant(db, owner.accountId, (trx) =>
    trx("connections")
      .where({ id: granted.connection.id })
      .update({ revokedAt: trx.fn.now() }),
  );
  await assert.rejects(() =>
    tool("apply_memory_patch", { ...input, review: preview.review }, agent),
  );
  await tenant(db, owner.accountId, (trx) =>
    trx("accounts")
      .where({ id: owner.accountId })
      .update({ captureEnabled: false }),
  );
  await assert.rejects(() => tool("preview_memory_patch", input));
  await tenant(db, owner.accountId, (trx) =>
    trx("accounts")
      .where({ id: owner.accountId })
      .update({ captureEnabled: true }),
  );
  const ready = (await tool("preview_memory_patch", {
    ...input,
    capture: "explicit",
  })) as { review: string };
  await service.updateMemory(owner, {
    id: note.id,
    expectedVersion: 1,
    operationId: randomUUID(),
    content: "Newer content",
    capture: "explicit",
  });
  await assert.rejects(() =>
    tool("apply_memory_patch", {
      ...input,
      capture: "explicit",
      review: ready.review,
    }),
  );
  assert.equal((await service.get(owner, note.id)).content, "Newer content");
});
