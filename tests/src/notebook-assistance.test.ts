import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import { createDatabase, tenant, type Knex } from "@lib/database";
import { MemoryService, sessionPrincipal } from "@lib/memory";
import type { Providers } from "@lib/ai";
import { policy } from "../../lib/config/src/index.ts";
import { rememberSchema, listSchema } from "@lib/shared/contracts";
import { exportHandlers } from "../../lib/memory/src/exports.ts";
import { Tasks } from "../../lib/memory/src/tasks.ts";
import { runTask } from "../../lib/memory/src/task-runner.ts";
import {
  actionListSchema,
  filingSchema,
  cleanupAssessmentSchema,
  digestSummarySchema,
  type AssistanceRequest,
} from "@lib/shared/assistance";

const url = process.env.TEST_MIGRATION_DATABASE_URL!;
if (!url || !new URL(url).pathname.endsWith("_test"))
  throw new Error("Use a disposable test database");
const authority = createDatabase(url),
  name = `grove_assistance_${randomUUID().replaceAll("-", "")}_test`;
let db: Knex, workerDb: Knex, admin: Knex;
before(async () => {
  await authority.raw("CREATE DATABASE ??", [name]);
  const target = (input: string) => {
    const parsed = new URL(input);
    parsed.pathname = `/${name}`;
    return parsed.href;
  };
  admin = createDatabase(target(url));
  await admin.migrate.latest();
  db = createDatabase(target(process.env.TEST_DATABASE_URL!));
  workerDb = createDatabase(target(process.env.TEST_WORKER_DATABASE_URL!));
});
after(async () => {
  await Promise.all([db?.destroy(), workerDb?.destroy(), admin?.destroy()]);
  await authority.raw("DROP DATABASE ?? WITH (FORCE)", [name]);
  await authority.destroy();
});
async function fixture() {
  const subject = `assistance_${randomUUID()}`,
    { rows } = await db.raw("SELECT * FROM grove_account(?)", [subject]);
  const principal = sessionPrincipal(rows[0].id, subject);
  const providers: Providers = {
    generation: {
      profile: `assist-${randomUUID()}`,
      generate: async (schema, _prompt, sources) => {
        if (Object.is(schema, digestSummarySchema))
          return schema.parse({ items: [] });
        if (Object.is(schema, actionListSchema))
          return schema.parse({
            items: sources
              .filter((s) => s.content.includes("Book"))
              .map((s) => ({
                text: s.content,
                sources: [{ id: s.id, version: s.version, quote: s.content }],
              })),
          });
        throw new Error("Unexpected generation");
      },
    },
  };
  const service = new MemoryService(
    db,
    "assistance-secret-at-least-32-chars",
    undefined,
    providers,
  );
  const worker = new MemoryService(
    workerDb,
    service.cursorSecret,
    undefined,
    providers,
  );
  await service.settings(principal, {
    titlesTagsEnabled: false,
    classificationEnabled: false,
    noteConnectionsEnabled: false,
    notebookConnectionsEnabled: false,
    notebookSummariesEnabled: false,
    personalSummaryEnabled: false,
    progressSummariesEnabled: false,
  });
  const project = await service.project(principal, {
    name: "Japan travel",
    identity: randomUUID(),
  });
  const save = (content: string, extra = {}) =>
    service.remember(
      principal,
      rememberSchema.parse({
        operationId: randomUUID(),
        content,
        projectId: project.id,
        ...extra,
      }),
    );
  const drain = async () => {
    for (let i = 0; i < 500; i++) {
      await admin("jobs")
        .where({ accountId: principal.accountId })
        .whereNull("failedAt")
        .update({ dueAt: admin.fn.now() });
      if (!(await worker.runJob())) return;
    }
    assert.fail("Assistance did not converge");
  };
  const request = async (input: AssistanceRequest) => {
    await service.assistance.request(principal, input);
    await drain();
    return service.assistance.get(principal, input.id);
  };
  const snapshot = async () =>
    (await service.list(principal, listSchema.parse({ projectId: project.id })))
      .visit!;
  const visit = async () => {
    const snap = await snapshot();
    return service.visits.acknowledge(principal, { id: randomUUID(), ...snap });
  };
  return {
    service,
    principal,
    providers,
    worker,
    project,
    save,
    drain,
    request,
    snapshot,
    visit,
  };
}
test("action previews read sources without writing them, replay once, preserve edits and support version-fenced Undo", async () => {
  const f = await fixture(),
    note = await f.save("Book the train tomorrow.");
  const input: AssistanceRequest = {
    id: randomUUID(),
    kind: "actions",
    sources: [{ id: note.id, version: 1 }],
    projectId: f.project.id,
  };
  const preview = await f.request(input);
  assert.equal(preview.status, "ready");
  assert.equal(preview.result?.items?.length, 1);
  const apply = { expectedVersion: preview.version };
  const result = await f.service.assistance.apply(f.principal, input.id, apply);
  const retry = await f.service.assistance.apply(f.principal, input.id, apply);
  assert.deepEqual(retry.applied, result.applied);
  assert.equal((await f.service.get(f.principal, note.id)).version, 1);
  const created = await f.service.get(f.principal, result.applied[0].id);
  assert(created.content.includes(`?revision=1`));
  assert(created.content.includes("- [ ] Book"));
  await f.service.settings(f.principal, { actionListsEnabled: false });
  await f.service.assistance.apply(
    f.principal,
    input.id,
    { expectedVersion: result.version },
    true,
  );
  assert.equal(
    (await f.service.get(f.principal, created.id)).status,
    "archived",
  );
  await f.service.settings(f.principal, { actionListsEnabled: true });
  const edited = await f.request({ ...input, id: randomUUID() });
  const changed = await f.service.assistance.apply(f.principal, edited.id, {
    expectedVersion: edited.version,
    edits: [{ index: 0, text: "Ask about train tickets." }],
  });
  const saved = await f.service.get(f.principal, changed.applied[0].id);
  assert(saved.content.includes("_(edited)_"));
  assert(!saved.content.includes("[source]"));
  await f.save("Changed checklist.", {
    id: saved.id,
    expectedVersion: saved.version,
  });
  await assert.rejects(
    f.service.assistance.apply(
      f.principal,
      edited.id,
      { expectedVersion: changed.version },
      true,
    ),
    { code: "sources_changed" },
  );
});
test("action-list saves enforce the account note limit without consuming their preview", async () => {
  const f = await fixture();
  const note = await f.save("Book the train tomorrow.");
  const preview = await f.request({
    id: randomUUID(),
    kind: "actions",
    sources: [{ id: note.id, version: note.version }],
    projectId: f.project.id,
  });
  assert.equal(preview.status, "ready");
  await admin.raw(
    `INSERT INTO memories(account_id, content, kind, source)
     SELECT ?::uuid, 'Capacity fixture ' || n, 'fact', '{}'::jsonb
     FROM generate_series(1, ?::integer) n`,
    [f.principal.accountId, policy.maxMemories - 1],
  );
  await assert.rejects(
    f.service.assistance.apply(f.principal, preview.id, {
      expectedVersion: preview.version,
    }),
    { code: "storage_limit" },
  );
  const retained = await f.service.assistance.get(f.principal, preview.id);
  assert.equal(retained.status, "ready");
  assert.equal(retained.version, preview.version);
  assert.deepEqual(retained.result, preview.result);
});

test("assistance is session-only, tenant-isolated and cannot apply stale selected sources", async () => {
  const f = await fixture(),
    note = await f.save("Book the hotel.");
  const input: AssistanceRequest = {
    id: randomUUID(),
    kind: "actions",
    sources: [{ id: note.id, version: 1 }],
    projectId: f.project.id,
  };
  const preview = await f.request(input),
    other = await fixture();
  await assert.rejects(
    other.service.assistance.get(other.principal, input.id),
    { code: "not_found" },
  );
  assert.equal((await db("assistance_requests")).length, 0);
  await assert.rejects(
    f.service.assistance.request({ ...f.principal, type: "key" }, input),
  );
  await f.save("Book a different hotel.", { id: note.id, expectedVersion: 1 });
  await assert.rejects(
    f.service.assistance.apply(f.principal, input.id, {
      expectedVersion: preview.version,
    }),
    { code: "sources_changed" },
  );
  assert.equal(
    (await f.service.assistance.get(f.principal, input.id)).status,
    "stale",
  );
  assert.equal(
    (await admin("memories").where({ accountId: f.principal.accountId }))
      .length,
    1,
  );
});
test("a settings toggle fences held assistance even when it is reenabled before generation returns", async () => {
  const f = await fixture(),
    note = await f.save("Book the tour.");
  let enter!: () => void, release!: () => void;
  const entered = new Promise<void>((resolve) => {
    enter = resolve;
  });
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const generate = f.providers.generation!.generate;
  f.providers.generation!.generate = async (...args) => {
    enter();
    await held;
    return generate(...args);
  };
  const input: AssistanceRequest = {
    id: randomUUID(),
    kind: "actions",
    sources: [{ id: note.id, version: 1 }],
    projectId: f.project.id,
  };
  await f.service.assistance.request(f.principal, input);
  const running = f.worker.runJob();
  await entered;
  await f.service.settings(f.principal, { actionListsEnabled: false });
  await f.service.settings(f.principal, { actionListsEnabled: true });
  release();
  await running;
  assert.equal(
    (await f.service.assistance.get(f.principal, input.id)).status,
    "stale",
  );
  assert.equal(
    (await f.service.assistance.get(f.principal, input.id)).result,
    null,
  );
});
test("filing builds profiles independently of connection settings and checks both sides of the recommendation", async () => {
  const f = await fixture();
  const supporting = await f.save("Japan travel: Kyoto train bookings.");
  const unfiled = await f.save("Book Japan travel train tickets.", {
    projectId: null,
  });
  f.providers.generation!.generate = async (schema, _prompt, sources) => {
    assert.equal(schema, filingSchema);
    return schema.parse({
      destination: [f.project.id],
      reason: "Both notes cover Japan train travel.",
      evidence: sources
        .filter((s) => [supporting.id, unfiled.id].includes(s.id))
        .map((s) => ({ id: s.id, version: s.version, quote: s.content })),
    });
  };
  const input: AssistanceRequest = {
    id: randomUUID(),
    kind: "filing",
    sources: [{ id: unfiled.id, version: 1 }],
  };
  const result = await f.request(input);
  assert.equal(result.status, "ready");
  assert.equal(result.result?.filing?.destination[0], f.project.id);
  const applied = await f.service.assistance.apply(f.principal, result.id, {
    expectedVersion: result.version,
  });
  assert.equal(
    (await f.service.get(f.principal, unfiled.id)).projectId,
    f.project.id,
  );
  await f.service.assistance.apply(
    f.principal,
    result.id,
    { expectedVersion: applied.version },
    true,
  );
  assert.equal((await f.service.get(f.principal, unfiled.id)).projectId, null);
  const again = await f.request({
    ...input,
    id: randomUUID(),
    sources: [{ id: unfiled.id, version: 3 }],
  });
  await admin("projects")
    .where({ id: f.project.id })
    .update({ name: "Different subject", version: 2 });
  assert.equal(
    (await f.service.assistance.get(f.principal, again.id)).status,
    "stale",
  );
});
test("cleanup keeps reviewed pairs stable, combines atomically, and restores both original notes", async () => {
  const f = await fixture(),
    a = await f.save("Japan train tickets cost 100 yen."),
    b = await f.save("Japan train tickets cost 100 yen.");
  f.providers.generation!.generate = async (schema, _prompt, sources) => {
    assert.equal(schema, cleanupAssessmentSchema);
    return schema.parse({
      kind: "duplicate",
      reason: "Same train fare.",
      replacement: [],
      content: "Japan train tickets cost 100 yen.",
      evidence: sources.map((s) => ({
        id: s.id,
        version: s.version,
        quote: s.content,
      })),
    });
  };
  const result = await f.request({
    id: randomUUID(),
    kind: "cleanup",
    projectId: f.project.id,
  });
  assert.equal(result.status, "ready");
  const candidate = result.result!.candidates![0];
  assert(candidate);
  await f.service.assistance.review(f.principal, result.id, {
    candidate: candidate.key,
    expectedVersion: 0,
    dismissed: true,
  });
  const again = await f.request({
    id: randomUUID(),
    kind: "cleanup",
    projectId: f.project.id,
  });
  assert.equal(again.result!.candidates![0].dismissed, true);
  await f.service.assistance.review(f.principal, again.id, {
    candidate: candidate.key,
    expectedVersion: 1,
    dismissed: false,
  });
  const applied = await f.service.assistance.apply(f.principal, again.id, {
    expectedVersion: again.version,
    candidate: candidate.key,
    action: "combine",
  });
  assert.equal(applied.applied.length, 2);
  assert.equal(
    [
      await f.service.get(f.principal, a.id),
      await f.service.get(f.principal, b.id),
    ].filter((r) => r.status === "archived").length,
    1,
  );
  await f.service.assistance.apply(
    f.principal,
    again.id,
    { expectedVersion: applied.version },
    true,
  );
  assert.equal((await f.service.get(f.principal, a.id)).status, "active");
  assert.equal((await f.service.get(f.principal, b.id)).status, "active");
});
test("visit windows are frozen and monotonic; digests compare historical revisions and omit removed content", async () => {
  const f = await fixture(),
    note = await f.save("Book the night train.");
  const first = await f.visit();
  assert(first.baseline);
  await f.save("Book the daytime train.", { id: note.id, expectedVersion: 1 });
  const loaded = await f.snapshot();
  await f.save("Book the ferry instead.", { id: note.id, expectedVersion: 2 });
  const window = await f.service.visits.acknowledge(f.principal, {
    id: randomUUID(),
    ...loaded,
  });
  const latest = await f.visit();
  await f.service.visits.acknowledge(f.principal, { id: window.id, ...loaded });
  const checkpoint = await admin("notebook_checkpoints")
    .where({ accountId: f.principal.accountId, projectId: f.project.id })
    .first();
  assert.equal(checkpoint.token, latest.to);
  const digest = await f.request({
    id: randomUUID(),
    kind: "digest",
    visitId: window.id,
  });
  assert.equal(digest.status, "ready");
  assert.deepEqual(
    digest.result!.changes!.map((c) => [c.before, c.after]),
    [[1, 2]],
  );
  assert.equal(
    digest.result!.changes![0].afterContent,
    "Book the daytime train.",
  );
  const next = await f.request({
    id: randomUUID(),
    kind: "digest",
    visitId: latest.id,
  });
  assert.equal(next.result!.changes![0].before, 2);
  assert.equal(next.result!.changes![0].after, 3);
  await f.service.forget(f.principal, {
    operationId: randomUUID(),
    items: [{ id: note.id, expectedVersion: 3 }],
  });
  const hidden = await f.service.assistance.get(f.principal, digest.id);
  assert.equal(hidden.result, null);
});
test("visit expiry recording is bounded and backdated imports use commit tokens", async () => {
  const f = await fixture();
  await f.visit();
  const note = await f.save("Imported old plans.", { retentionDays: 1 });
  await admin("memories")
    .where({ id: note.id })
    .update({
      createdAt: "2020-01-01T00:00:00Z",
      expiresAt: admin.raw("now()-interval '1 second'"),
    });
  const visit = await f.visit();
  const changes = await admin("notebook_changes")
    .where({ accountId: f.principal.accountId })
    .where("token", ">", visit.from)
    .where("token", "<=", visit.to);
  assert(changes.some((c) => c.kind === "created"));
  assert(changes.some((c) => c.kind === "expired"));
  const result = await f.request({
    id: randomUUID(),
    kind: "digest",
    visitId: visit.id,
  });
  assert.equal(result.result!.changes![0].afterContent, null);
  await tenant(db, f.principal.accountId, async (trx) => {
    const row = await trx("accounts")
      .where({ id: f.principal.accountId })
      .first();
    assert(BigInt(row.changeToken) >= BigInt(visit.to));
  });
});

test("private exports retain paged review/checkpoint/operation metadata and fence later reviews", async () => {
  const f = await fixture(),
    note = await f.save("Book the airport bus.");
  const preview = await f.request({
    id: randomUUID(),
    kind: "actions",
    sources: [{ id: note.id, version: 1 }],
    projectId: f.project.id,
  });
  await f.service.assistance.apply(f.principal, preview.id, {
    expectedVersion: preview.version,
  });
  await f.visit();
  await admin("assistance_reviews").insert(
    Array.from({ length: 105 }, (_, i) => ({
      accountId: f.principal.accountId,
      key: `review-${String(i).padStart(3, "0")}`,
      version: 1,
      dismissed: true,
    })),
  );
  const pieces = new Map<string, Buffer>();
  const handlers = exportHandlers(workerDb, {
    async write(key, data) {
      const chunks: Buffer[] = [];
      for await (const chunk of Buffer.isBuffer(data) ? [data] : data)
        chunks.push(Buffer.from(chunk));
      pieces.set(key, Buffer.concat(chunks));
    },
    async read(key) {
      return Readable.from([pieces.get(key)!]);
    },
    async remove(key) {
      pieces.delete(key);
    },
  });
  const tasks = new Tasks(f.service, true),
    task = await tasks.export(f.principal, {
      id: randomUUID(),
      includeDescendants: false,
    });
  for (let i = 0; i < 40; i++) {
    await runTask(workerDb, handlers, { id: task.id });
    if ((await tasks.get(f.principal, task.id)).status === "succeeded") break;
  }
  assert.equal((await tasks.get(f.principal, task.id)).status, "succeeded");
  const stored = await admin("background_tasks").where({ id: task.id }).first();
  const rows = pieces
    .get(stored.result.key)!
    .toString()
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  assert.equal(rows.filter((r) => r.type === "assistance_review").length, 105);
  assert.equal(rows.filter((r) => r.type === "notebook_checkpoint").length, 1);
  assert.equal(rows.filter((r) => r.type === "notebook_visit").length, 1);
  const operation = rows.find((r) => r.type === "assistance_operation");
  assert.equal(operation.id, preview.id);
  assert.equal(operation.status, "applied");
  assert.equal(operation.undo, undefined);
  await tasks.artifact(f.principal, task.id);
  await admin("assistance_reviews")
    .where({ accountId: f.principal.accountId, key: "review-000" })
    .update({ version: 2, dismissed: false });
  assert.equal((await tasks.get(f.principal, task.id)).error, "export_changed");
  await assert.rejects(tasks.artifact(f.principal, task.id), {
    code: "export_unavailable",
  });
});

test("applied previews clear generated excerpts and deleting a created personal note fences its Undo", async () => {
  const f = await fixture(),
    note = await f.save("Book the plane.", { projectId: null });
  const preview = await f.request({
    id: randomUUID(),
    kind: "actions",
    sources: [{ id: note.id, version: 1 }],
    projectId: null,
  });
  const applied = await f.service.assistance.apply(f.principal, preview.id, {
    expectedVersion: preview.version,
  });
  assert.equal(applied.result, null);
  await f.service.forget(f.principal, {
    operationId: randomUUID(),
    items: [{ id: applied.applied[0].id, expectedVersion: 1 }],
  });
  const stored = await admin("assistance_requests")
    .where({ id: preview.id })
    .first();
  assert.equal(stored.status, "stale");
  assert.equal(stored.undo, null);
  await assert.rejects(
    f.service.assistance.apply(
      f.principal,
      preview.id,
      { expectedVersion: applied.version },
      true,
    ),
  );
});

test("invalid action quotes and age-only replacement claims fail closed", async () => {
  const f = await fixture(),
    a = await f.save("Book Japan train tickets at 100 yen."),
    b = await f.save("Japan train tickets cost 200 yen.");
  f.providers.generation!.generate = async (schema, _prompt, sources) =>
    Object.is(schema, actionListSchema)
      ? schema.parse({
          items: [
            {
              text: "Invented owner must pay today.",
              sources: [{ id: a.id, version: 1, quote: "Not in the source" }],
            },
          ],
        })
      : schema.parse({
          kind: "superseded",
          reason: "The second note is newer.",
          replacement: [b.id],
          content: "Japan train tickets cost 200 yen.",
          evidence: sources.map((s) => ({
            id: s.id,
            version: s.version,
            quote: s.content,
          })),
        });
  const actions = await f.request({
    id: randomUUID(),
    kind: "actions",
    sources: [{ id: a.id, version: 1 }],
    projectId: f.project.id,
  });
  assert.equal(actions.status, "failed");
  assert.equal(actions.result, null);
  const cleanup = await f.request({
    id: randomUUID(),
    kind: "cleanup",
    projectId: f.project.id,
  });
  assert.equal(cleanup.status, "failed");
  assert.equal(cleanup.result, null);
});

test("a stale model replica cannot read or apply assistance after a committed profile switch", async () => {
  const f = await fixture(),
    note = await f.save("Book the train.");
  const preview = await f.request({
    id: randomUUID(),
    kind: "actions",
    sources: [{ id: note.id, version: 1 }],
    projectId: f.project.id,
  });
  f.service.jobProfiles = async () => ({
    embedding: null,
    decision: null,
    generation: "new-generation",
  });
  await assert.rejects(
    f.service.assistance.apply(f.principal, preview.id, {
      expectedVersion: preview.version,
    }),
    { code: "sources_changed" },
  );
  assert.equal(
    (await f.service.assistance.get(f.principal, preview.id)).status,
    "stale",
  );
  assert.equal(
    (await admin("memories").where({ accountId: f.principal.accountId }))
      .length,
    1,
  );
});

test("digest edits require both historical revisions even when labelled as ordinary changes", async () => {
  const f = await fixture(),
    note = await f.save("Book the night train.");
  await f.visit();
  await f.save("Book the daytime train.", { id: note.id, expectedVersion: 1 });
  const visit = await f.visit();
  f.providers.generation!.generate = async (schema) =>
    schema.parse({
      items: [
        {
          kind: "change",
          text: "The plan changed.",
          sources: [
            { id: note.id, version: 2, quote: "Book the daytime train." },
          ],
        },
      ],
    });
  const digest = await f.request({
    id: randomUUID(),
    kind: "digest",
    visitId: visit.id,
  });
  assert.equal(digest.status, "failed");
  assert.equal(digest.result, null);
});
