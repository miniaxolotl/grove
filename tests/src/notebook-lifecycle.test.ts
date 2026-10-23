import { after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createDatabase, tenant } from "@lib/database";
import { MemoryService, Sharing, sessionPrincipal } from "@lib/memory";
import {
  listSchema,
  recallSchema,
  rememberSchema,
  type Principal,
} from "@lib/shared/contracts";
import { notebookLifecycleSchema } from "@lib/shared/notebook-lifecycle";
import { shareEnableSchema } from "@lib/shared/sharing";
import { createApp } from "../../packages/api/src/app.ts";

const url = process.env.TEST_MIGRATION_DATABASE_URL!;
assert(
  url && new URL(url).pathname.endsWith("_test"),
  "Use a disposable test database",
);
const admin = createDatabase(url),
  db = createDatabase(process.env.TEST_DATABASE_URL!),
  worker = createDatabase(process.env.TEST_WORKER_DATABASE_URL!);
const service = new MemoryService(
  db,
  "notebook-lifecycle-test-secret-at-least-32",
);
after(async () => {
  await Promise.all([admin.destroy(), db.destroy(), worker.destroy()]);
});
async function fixture() {
  const subject = `notebook_lifecycle_${randomUUID()}`;
  const { rows } = await db.raw("SELECT * FROM grove_account(?)", [subject]);
  const principal = sessionPrincipal(rows[0].id, subject);
  const notebook = (name: string, parentId?: string) =>
    service.project(principal, { name, identity: randomUUID(), parentId });
  const root = await notebook("Root"),
    child = await notebook("Child", root.id),
    other = await notebook("Other");
  const save = (content: string, projectId = root.id, extra = {}) =>
    service.remember(
      principal,
      rememberSchema.parse({
        content,
        projectId,
        operationId: randomUUID(),
        ...extra,
      }),
    );
  const input = async (id = root.id) => {
    const preview = await service.previewProjectLifecycle(principal, id);
    return notebookLifecycleSchema.parse({
      operationId: randomUUID(),
      expectedVersion: preview.project.version,
      fingerprint: preview.fingerprint,
    });
  };
  return { principal, root, child, other, notebook, save, input };
}

test("notebook archive/restore covers descendants but preserves prior archives, expiry, IDs and revisions", async () => {
  const f = await fixture();
  const active = await f.save("Active source"),
    nested = await f.save("Nested source", f.child.id);
  const prior = await f.save("Previously archived", f.root.id, {
    archived: true,
  });
  const dated = await f.save("Time-limited progress", f.child.id, {
    kind: "handoff",
    taskId: "task",
    retentionDays: 3,
  });
  await service.projectLifecycle(
    f.principal,
    f.root.id,
    "archive",
    await f.input(),
  );
  assert.equal((await service.projects(f.principal)).length, 1);
  assert.equal((await service.projects(f.principal, "archived")).length, 2);
  assert.equal(
    (await service.list(f.principal, listSchema.parse({}))).items.length,
    0,
  );
  assert.equal(
    (
      await service.recall(
        f.principal,
        recallSchema.parse({ query: "source", projectId: f.root.id }),
      )
    ).items.length,
    0,
  );
  await assert.rejects(
    service.projectLifecycle(
      f.principal,
      f.child.id,
      "restore",
      await f.input(f.child.id),
    ),
    { code: "notebook_inactive" },
  );
  await service.projectLifecycle(
    f.principal,
    f.root.id,
    "restore",
    await f.input(),
  );
  for (const note of [active, nested, dated]) {
    const saved = await service.get(f.principal, note.id);
    assert.equal(saved.status, "active");
    assert.equal(saved.version, note.version + 2);
    assert.equal(saved.content, note.content);
    assert.equal(saved.expiresAt, note.expiresAt);
    assert.equal(saved.taskId, note.taskId);
    assert.equal(
      (await admin("memory_revisions").where({ memoryId: note.id })).length,
      3,
    );
  }
  assert.equal((await service.get(f.principal, prior.id)).status, "archived");
  assert.equal(
    (await service.get(f.principal, prior.id)).version,
    prior.version,
  );
});

test("a separately archived descendant remains archived after its ancestor is restored", async () => {
  const f = await fixture();
  const note = await f.save("Child content", f.child.id);
  await service.projectLifecycle(
    f.principal,
    f.child.id,
    "archive",
    await f.input(f.child.id),
  );
  await service.projectLifecycle(
    f.principal,
    f.root.id,
    "archive",
    await f.input(),
  );
  await service.projectLifecycle(
    f.principal,
    f.root.id,
    "restore",
    await f.input(),
  );
  assert.equal((await service.get(f.principal, note.id)).status, "archived");
  assert.equal(
    (await service.projects(f.principal, "archived"))[0].id,
    f.child.id,
  );
});

test("archive fences leased note jobs and restore queues current profiles without extending expired sources", async () => {
  const f = await fixture();
  const note = await f.save("Process this source");
  const expired = await f.save("Expired source", f.child.id, {
    retentionDays: 1,
  });
  await admin("memories")
    .where({ id: expired.id })
    .update({ expiresAt: admin.raw("now()-interval '1 day'") });
  const lease = randomUUID(),
    job = randomUUID();
  await admin("jobs").insert({
    id: job,
    accountId: f.principal.accountId,
    memoryId: note.id,
    version: note.version,
    target: note.id,
    kind: "embedding",
    profile: "old-profile",
    leaseId: lease,
    leaseUntil: admin.raw("now()+interval '1 hour'"),
  });
  await service.projectLifecycle(
    f.principal,
    f.root.id,
    "archive",
    await f.input(),
  );
  assert.equal(
    (await admin("jobs").where({ id: job, leaseId: lease })).length,
    0,
  );
  const current = new MemoryService(db, service.cursorSecret);
  current.jobProfiles = async () => ({
    embedding: "current-embedding",
    decision: "current-decision",
    generation: "current-generation",
  });
  await current.projectLifecycle(
    f.principal,
    f.root.id,
    "restore",
    await f.input(),
  );
  const jobs = await admin("jobs").where({ memoryId: note.id });
  assert.equal(jobs.length, 4);
  assert(
    jobs.every(
      (row) =>
        row.version === note.version + 2 &&
        row.leaseId === null &&
        row.profile !== "old-profile",
    ),
  );
  assert.equal((await admin("jobs").where({ memoryId: expired.id })).length, 0);
});

test("notebook deletion is atomic, retry-safe soft deletion of the entire subtree and its history", async () => {
  const f = await fixture();
  const first = await f.save("Retained original"),
    second = await f.save("Retained descendant", f.child.id),
    kept = await f.save("Unrelated", f.other.id);
  const input = await f.input();
  const result = await service.projectLifecycle(
    f.principal,
    f.root.id,
    "delete",
    input,
  );
  assert.deepEqual(
    await service.projectLifecycle(f.principal, f.root.id, "delete", input),
    result,
  );
  await assert.rejects(
    service.projectLifecycle(f.principal, f.root.id, "archive", input),
    { code: "operation_conflict" },
  );
  for (const note of [first, second]) {
    await assert.rejects(service.get(f.principal, note.id), {
      code: "not_found",
    });
    assert.equal(
      (await admin("memories").where({ id: note.id }).first()).content,
      note.content,
    );
    assert((await admin("memories").where({ id: note.id }).first()).deletedAt);
    assert.equal(
      (await admin("memory_revisions").where({ memoryId: note.id })).length,
      1,
    );
    assert.equal(
      (
        await tenant(db, f.principal.accountId, (trx) =>
          trx("memory_revisions").where({ memoryId: note.id }),
        )
      ).length,
      0,
    );
    assert.equal(
      (
        await tenant(worker, f.principal.accountId, (trx) =>
          trx("memories").where({ id: note.id }),
        )
      ).length,
      0,
    );
  }
  assert.equal((await service.get(f.principal, kept.id)).content, "Unrelated");
  for (const id of [f.root.id, f.child.id])
    assert((await admin("projects").where({ id }).first()).deletedAt);
  assert.equal((await service.projects(f.principal)).length, 1);
});

test("changed notes, new descendants and hierarchy moves require explicit scope review before deletion", async () => {
  const f = await fixture();
  const note = await f.save("Initial");
  let input = await f.input();
  await f.save("Changed", f.root.id, {
    id: note.id,
    expectedVersion: note.version,
  });
  await assert.rejects(
    service.projectLifecycle(f.principal, f.root.id, "delete", input),
    { code: "version_conflict" },
  );
  input = await f.input();
  await f.notebook("New descendant", f.child.id);
  await assert.rejects(
    service.projectLifecycle(f.principal, f.root.id, "delete", input),
    { code: "version_conflict" },
  );
  input = await f.input();
  await service.project(
    f.principal,
    { ...f.other, parentId: f.root.id, expectedVersion: f.other.version },
    f.other.id,
  );
  await assert.rejects(
    service.projectLifecycle(f.principal, f.root.id, "delete", input),
    { code: "version_conflict" },
  );
  assert.equal((await service.get(f.principal, note.id)).content, "Changed");
});

test("inactive notebook guards cover agents, direct tenant writes, note restoration and new descendants", async () => {
  const f = await fixture(),
    note = await f.save("Source");
  await service.projectLifecycle(
    f.principal,
    f.root.id,
    "archive",
    await f.input(),
  );
  await assert.rejects(f.save("New content"), { code: "notebook_inactive" });
  await assert.rejects(f.notebook("Hidden child", f.root.id), {
    code: "notebook_inactive",
  });
  await assert.rejects(
    service.lifecycle(f.principal, note.id, "restore", {
      operationId: randomUUID(),
      expectedVersion: note.version + 1,
    }),
    { code: "notebook_inactive" },
  );
  await assert.rejects(
    tenant(worker, f.principal.accountId, (trx) =>
      trx("memories")
        .where({ id: note.id })
        .update({ content: "Stale worker" }),
    ),
    (e: { code: string }) => e.code === "GNB01",
  );
  await assert.rejects(
    service.project(f.principal, { ...f.child, name: "Changed" }, f.child.id),
    { code: "notebook_inactive" },
  );
  await assert.rejects(
    service.project(
      f.principal,
      { ...f.other, parentId: f.root.id },
      f.other.id,
    ),
    { code: "notebook_inactive" },
  );
});

test("notebook lifecycle is owner-only and does not widen child grants or cross-account RLS", async () => {
  const f = await fixture(),
    second = await fixture();
  const grant = await service.grant(
    f.principal,
    {
      name: "Parent only",
      capabilities: ["memory:read", "memory:write", "memory:delete"],
      personal: false,
      allProjects: false,
      projectIds: [f.root.id],
    },
    { key: true },
  );
  const agent: Principal = {
    ...f.principal,
    type: "key",
    connectionId: grant.connection.id,
  };
  await assert.rejects(service.previewProjectLifecycle(agent, f.root.id), {
    code: "forbidden",
  });
  await assert.rejects(
    service.projectLifecycle(agent, f.root.id, "delete", await f.input()),
    { code: "forbidden" },
  );
  await assert.rejects(
    service.previewProjectLifecycle(second.principal, f.root.id),
    { code: "not_found" },
  );
  await assert.rejects(
    service.projectLifecycle(
      second.principal,
      f.root.id,
      "archive",
      await f.input(),
    ),
    { code: "not_found" },
  );
  assert.equal(
    (
      await tenant(db, second.principal.accountId, (trx) =>
        trx("projects").where({ id: f.root.id }),
      )
    ).length,
    0,
  );
});

test("archive revokes direct links and ancestor public scopes hide the subtree; restore never republishes", async () => {
  const f = await fixture();
  const note = await f.save("Shared source", f.child.id);
  const sharing = new Sharing(service, {
    key: "ab".repeat(32),
    siteUrl: "https://grove.example.test",
  });
  const enable = async (kind: "notebook" | "note", id: string) =>
    sharing.enable(
      f.principal,
      { kind, id },
      shareEnableSchema.parse({
        operationId: randomUUID(),
        expectedVersion: 0,
        expectedTargetVersion: 1,
        includeDescendants: kind === "notebook",
      }),
    );
  const parent = await enable("notebook", f.root.id),
    child = await enable("notebook", f.child.id),
    direct = await enable("note", note.id);
  await service.projectLifecycle(
    f.principal,
    f.child.id,
    "archive",
    await f.input(f.child.id),
  );
  for (const state of [child, direct])
    assert(
      (await admin("public_shares").where({ id: state.direct!.id }).first())
        .revokedAt,
    );
  const digest = (
    await admin("public_shares").where({ id: parent.direct!.id }).first()
  ).tokenDigest;
  const publicResult = await db.raw(
    "SELECT grove_public_share(?,'notebook',?,NULL,NULL,NULL,30) AS result",
    [digest, f.child.id],
  );
  assert.equal(publicResult.rows[0].result, null);
  assert.equal(
    (await sharing.get(f.principal, { kind: "notebook", id: f.child.id }))
      .canShare,
    false,
  );
  await service.projectLifecycle(
    f.principal,
    f.child.id,
    "restore",
    await f.input(f.child.id),
  );
  assert.equal(
    (await sharing.get(f.principal, { kind: "notebook", id: f.child.id }))
      .direct!.active,
    false,
  );
});

test("HTTP lifecycle validates strict snapshots, exposes archived listing and rejects post-archive writes", async () => {
  const f = await fixture();
  const app = createApp({
    memories: service,
    auth: { principal: async () => f.principal },
    origin: "https://api.example.test",
    siteUrl: "https://grove.example.test",
    issuer: "https://clerk.example.test",
    webhookSecret: "unused",
    ready: async () => {},
  });
  const path = `/v1/projects/${f.root.id}`;
  assert.equal((await app.request(`${path}/lifecycle`)).status, 200);
  const post = (body: unknown) =>
    app.request(`${path}/archive`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  assert.equal((await post({ operationId: randomUUID() })).status, 400);
  assert.equal((await post(await f.input())).status, 200);
  const response = await app.request("/v1/projects?status=archived");
  assert.equal((await response.json()).data.length, 2);
  const write = await app.request("/v1/memories", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(
      rememberSchema.parse({
        operationId: randomUUID(),
        projectId: f.child.id,
        content: "Not allowed",
      }),
    ),
  });
  assert.equal(write.status, 409);
  assert.equal((await write.json()).error.code, "notebook_inactive");
});
