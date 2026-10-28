import { after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createDatabase, tenant } from "@lib/database";
import {
  MemoryService,
  sessionPrincipal,
  Tasks,
  exportHandlers,
  runTask,
  type ArtifactStore,
} from "@lib/memory";
import { Readable } from "node:stream";
import { createApp } from "../../packages/api/src/app.ts";
import { notebookLifecycleSchema } from "@lib/shared/notebook-lifecycle";

const url = process.env.TEST_MIGRATION_DATABASE_URL!;
assert(url && new URL(url).pathname.endsWith("_test"));
const admin = createDatabase(url);
const db = createDatabase(process.env.TEST_DATABASE_URL!);
const worker = createDatabase(process.env.TEST_WORKER_DATABASE_URL!);
const service = new MemoryService(
  db,
  "organization-test-secret-at-least-32-characters",
);
after(async () => {
  await Promise.all([admin.destroy(), db.destroy(), worker.destroy()]);
});
async function fixture() {
  const subject = `organization_${randomUUID()}`;
  const { rows } = await db.raw("SELECT * FROM grove_account(?)", [subject]);
  const principal = sessionPrincipal(rows[0].id, subject);
  const create = (name: string, parentId?: string) =>
    service.project(principal, { name, identity: randomUUID(), parentId });
  const a = await create("A"),
    b = await create("B"),
    c = await create("C");
  const catalog = () => service.projectCatalog(principal, {});
  const move = async (id: string, parentId: string | null, extra = {}) => {
    const page = await catalog();
    const project = page.items.find((item) => item.id === id)!;
    return service.organizeProject(principal, id, {
      parentId,
      expectedVersion: project.version!,
      expectedState: page.state,
      operationId: randomUUID(),
      ...extra,
    });
  };
  return { principal, create, a, b, c, catalog, move };
}

test("complete owner catalog retains parents beyond the legacy hundred-row slice", async () => {
  const f = await fixture();
  const parent = await f.create("Z parent");
  await tenant(db, f.principal.accountId, async (trx) => {
    await trx("projects").insert(
      Array.from({ length: 496 }, (_, i) => ({
        accountId: f.principal.accountId,
        name: `Child ${i}`,
        identity: randomUUID(),
        parentId: parent.id,
      })),
    );
  });
  const found = [];
  let cursor: string | undefined;
  let state: string | undefined;
  do {
    const page = await service.projectCatalog(f.principal, {
      limit: 17,
      cursor,
    });
    state ??= page.state;
    assert.equal(page.state, state);
    assert(page.items.length <= 17);
    found.push(...page.items);
    cursor = page.nextCursor ?? undefined;
  } while (cursor);
  assert.equal(found.length, 500);
  assert.equal(new Set(found.map((item) => item.id)).size, 500);
  assert.equal(found.filter((item) => item.parentId === parent.id).length, 496);
  assert.equal(
    (await service.projects(f.principal)).length,
    100,
    "legacy array stays compatible",
  );
});

test("reorder persists without renaming, source revisions or AI work and new notebooks append", async () => {
  const f = await fixture();
  const before = await admin("accounts")
    .where({ id: f.principal.accountId })
    .first();
  await f.move(f.c.id, null, { beforeId: f.a.id });
  const page = await f.catalog();
  assert.deepEqual(
    page.items.map((p) => p.name),
    ["C", "A", "B"],
  );
  assert.equal(page.items.find((p) => p.id === f.c.id)!.version, f.c.version);
  const after = await admin("accounts")
    .where({ id: f.principal.accountId })
    .first();
  assert.equal(after.contentVersion, before.contentVersion);
  await service.project(
    f.principal,
    { name: "Z renamed", identity: f.c.identity, expectedVersion: f.c.version },
    f.c.id,
  );
  const appended = await f.create("AA new");
  assert.deepEqual(
    (await f.catalog()).items.map((p) => p.id),
    [f.c.id, f.a.id, f.b.id, appended.id],
  );
  assert.equal(
    (await admin("jobs").where({ accountId: f.principal.accountId })).length,
    0,
  );
});

test("nest and move out are atomic, preserve descendants and can be reversed with a state-fenced move", async () => {
  const f = await fixture();
  const child = await f.create("Child", f.c.id);
  const nested = await f.move(f.c.id, f.a.id);
  assert.equal(nested.project.parentId, f.a.id);
  assert.equal(
    (await f.catalog()).items.find((p) => p.id === child.id)!.parentId,
    f.c.id,
  );
  await service.organizeProject(f.principal, f.c.id, {
    ...nested.undo,
    operationId: randomUUID(),
    expectedVersion: nested.project.version!,
    expectedState: nested.state,
  });
  assert.deepEqual(
    (await f.catalog()).items.filter((p) => !p.parentId).map((p) => p.id),
    [f.a.id, f.b.id, f.c.id],
  );
});

test("accepted lost-response replay has one result and changed payloads cannot reuse its identity", async () => {
  const f = await fixture();
  const request = {
    parentId: f.a.id,
    expectedVersion: f.c.version!,
    expectedState: (await f.catalog()).state,
    operationId: randomUUID(),
  };
  const [one, replay] = await Promise.all([
    service.organizeProject(f.principal, f.c.id, request),
    service.organizeProject(f.principal, f.c.id, request),
  ]);
  assert.deepEqual(replay, one);
  assert.equal(
    (await f.catalog()).items.find((p) => p.id === f.c.id)!.version,
    f.c.version! + 1,
  );
  await assert.rejects(
    service.organizeProject(f.principal, f.c.id, {
      ...request,
      parentId: f.b.id,
    }),
    { code: "operation_conflict" },
  );
});

test("concurrent sibling changes conflict and stale Undo never overwrites a newer layout", async () => {
  const f = await fixture();
  const state = (await f.catalog()).state;
  const attempts = await Promise.allSettled([
    service.organizeProject(f.principal, f.c.id, {
      parentId: null,
      beforeId: f.a.id,
      expectedVersion: f.c.version!,
      expectedState: state,
      operationId: randomUUID(),
    }),
    service.organizeProject(f.principal, f.b.id, {
      parentId: null,
      beforeId: f.a.id,
      expectedVersion: f.b.version!,
      expectedState: state,
      operationId: randomUUID(),
    }),
  ]);
  assert.equal(attempts.filter((r) => r.status === "fulfilled").length, 1);
  const success = attempts.find((r) => r.status === "fulfilled")!;
  assert.equal(success.status, "fulfilled");
  if (success.status !== "fulfilled") return;
  const previous = success.value;
  await f.create("Newer sibling");
  await assert.rejects(
    service.organizeProject(f.principal, previous.project.id, {
      ...previous.undo,
      expectedState: previous.state,
      expectedVersion: previous.project.version!,
      operationId: randomUUID(),
    }),
    { code: "notebook_order_conflict" },
  );
});

test("current position is a no-op and invalid anchors/cycles cannot write", async () => {
  const f = await fixture();
  const page = await f.catalog();
  const noop = await f.move(f.b.id, null, { beforeId: f.c.id });
  assert.equal(noop.state, page.state);
  await assert.rejects(f.move(f.a.id, f.a.id), { code: "invalid_request" });
  const child = await f.create("Nested", f.a.id);
  await assert.rejects(f.move(f.a.id, child.id), { code: "invalid_request" });
  await assert.rejects(f.move(f.b.id, null, { beforeId: child.id }), {
    code: "invalid_request",
  });
  await assert.rejects(f.move(f.b.id, null, { beforeId: randomUUID() }), {
    code: "not_found",
  });
});

test("owner catalog and organize are session-only and do not reveal foreign notebooks", async () => {
  const f = await fixture(),
    other = await fixture();
  const agent = {
    ...f.principal,
    type: "key" as const,
    connectionId: randomUUID(),
  };
  await assert.rejects(service.projectCatalog(agent, {}), {
    code: "forbidden",
  });
  await assert.rejects(
    service.organizeProject(agent, f.a.id, {
      parentId: null,
      expectedState: (await f.catalog()).state,
      expectedVersion: 1,
      operationId: randomUUID(),
    }),
    { code: "forbidden" },
  );
  await assert.rejects(f.move(f.a.id, other.a.id), { code: "not_found" });
  await assert.rejects(f.move(f.a.id, null, { beforeId: other.a.id }), {
    code: "not_found",
  });
  await assert.rejects(
    service.organizeProject(f.principal, other.a.id, {
      parentId: null,
      expectedState: (await f.catalog()).state,
      expectedVersion: other.a.version!,
      operationId: randomUUID(),
    }),
    { code: "not_found" },
  );
  assert.equal((await db("projects")).length, 0);
});

test("catalog cursors reject account mixing and layouts changed between pages", async () => {
  const f = await fixture(),
    other = await fixture();
  const first = await service.projectCatalog(f.principal, { limit: 1 });
  assert(first.nextCursor);
  await assert.rejects(
    service.projectCatalog(f.principal, {
      status: "archived",
      cursor: first.nextCursor!,
    }),
    { code: "invalid_cursor" },
  );
  await assert.rejects(
    service.projectCatalog(other.principal, { cursor: first.nextCursor! }),
    { code: "invalid_cursor" },
  );
  await f.create("new");
  await assert.rejects(
    service.projectCatalog(f.principal, { cursor: first.nextCursor! }),
    { code: "notebook_order_conflict" },
  );
});

test("HTTP catalog and organization enforce strict inputs and owning-session access", async () => {
  const f = await fixture();
  let principal = f.principal;
  const app = createApp({
    memories: service,
    auth: { principal: async () => principal },
    origin: "https://api.example.test",
    siteUrl: "https://grove.example.test",
    issuer: "https://clerk.example.test",
    webhookSecret: "unused",
    ready: async () => {},
  });
  const response = await app.request("/v1/projects/catalog?limit=2");
  assert.equal(response.status, 200);
  const page = (await response.json()).data;
  assert.equal(page.items.length, 2);
  const post = (body: unknown, id = f.c.id) =>
    app.request(`/v1/projects/${id}/organize`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  const request = {
    parentId: null,
    beforeId: f.a.id,
    expectedVersion: f.c.version!,
    expectedState: page.state,
    operationId: randomUUID(),
  };
  assert.equal((await post({ ...request, afterId: f.b.id })).status, 400);
  assert.equal(
    (await post({ ...request, expectedState: "forged" })).status,
    400,
  );
  assert.equal((await post({ ...request, extra: true })).status, 400);
  assert.equal((await post(request, "invalid")).status, 400);
  assert.equal(
    (await app.request("/v1/projects/catalog?limit=201")).status,
    400,
  );
  assert.equal(
    (await app.request("/v1/projects/catalog?unknown=1")).status,
    400,
  );
  const moved = await post(request);
  assert.equal(moved.status, 200);
  assert.deepEqual((await post(request)).status, 200);
  principal = { ...principal, type: "key", connectionId: randomUUID() };
  assert.equal((await app.request("/v1/projects/catalog")).status, 403);
  assert.equal((await post(request)).status, 403);
});

test("archived/deleted destinations and stale source versions cannot alter a layout", async () => {
  const f = await fixture();
  const preview = await service.previewProjectLifecycle(f.principal, f.a.id);
  await service.projectLifecycle(
    f.principal,
    f.a.id,
    "archive",
    notebookLifecycleSchema.parse({
      operationId: randomUUID(),
      expectedVersion: preview.project.version,
      fingerprint: preview.fingerprint,
    }),
  );
  const catalog = await f.catalog();
  assert(!catalog.items.some((p) => p.id === f.a.id));
  const archived = await service.projectCatalog(f.principal, {
    status: "archived",
  });
  assert.equal(archived.items[0].id, f.a.id);
  await assert.rejects(
    tenant(db, f.principal.accountId, (trx) =>
      trx("projects").where({ id: f.a.id }).update({ position: 1000 }),
    ),
    /notebook_inactive/,
    "the database must protect archived positions even from direct tenant writes",
  );
  await assert.rejects(f.move(f.b.id, f.a.id), { code: "not_found" });
  await assert.rejects(
    service.organizeProject(f.principal, f.b.id, {
      parentId: null,
      beforeId: f.c.id,
      operationId: randomUUID(),
      expectedState: catalog.state,
      expectedVersion: 999,
    }),
    { code: "notebook_order_conflict" },
  );
  const deletion = await service.previewProjectLifecycle(f.principal, f.a.id);
  await service.projectLifecycle(
    f.principal,
    f.a.id,
    "delete",
    notebookLifecycleSchema.parse({
      operationId: randomUUID(),
      expectedVersion: deletion.project.version,
      fingerprint: deletion.fingerprint,
    }),
  );
  await assert.rejects(f.move(f.b.id, f.a.id), { code: "not_found" });
});

test("returning to an identical order still invalidates earlier layout tokens", async () => {
  const f = await fixture();
  const initial = await f.catalog();
  const changed = await f.move(f.c.id, null, { beforeId: f.a.id });
  await service.organizeProject(f.principal, f.c.id, {
    ...changed.undo,
    expectedVersion: changed.project.version!,
    expectedState: changed.state,
    operationId: randomUUID(),
  });
  const restored = await f.catalog();
  assert.deepEqual(restored.items, initial.items);
  assert.notEqual(
    restored.state,
    initial.state,
    "layout tokens must reject ABA changes",
  );
  await assert.rejects(
    service.organizeProject(f.principal, f.b.id, {
      parentId: null,
      beforeId: f.a.id,
      expectedState: initial.state,
      expectedVersion: f.b.version!,
      operationId: randomUUID(),
    }),
    { code: "notebook_order_conflict" },
  );
});

test("private exports retain sibling positions and later reorders fence downloads", async () => {
  const f = await fixture();
  await f.move(f.c.id, null, { beforeId: f.a.id });
  const files = new Map<string, Buffer>();
  const store: ArtifactStore = {
    async write(key, data) {
      if (Buffer.isBuffer(data)) files.set(key, data);
      else {
        const chunks: Buffer[] = [];
        for await (const chunk of data) chunks.push(Buffer.from(chunk));
        files.set(key, Buffer.concat(chunks));
      }
    },
    async read(key) {
      assert(files.has(key));
      return Readable.from(files.get(key)!);
    },
    async remove(key) {
      files.delete(key);
    },
  };
  const tasks = new Tasks(service, true);
  const task = await tasks.export(f.principal, {
    id: randomUUID(),
    includeDescendants: false,
  });
  for (let i = 0; i < 30; i++)
    if (
      !(await runTask(worker, exportHandlers(worker, store), { id: task.id }))
    )
      break;
  const artifact = await tasks.artifact(f.principal, task.id);
  const records = files
    .get(artifact.key)!
    .toString()
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  const notebooks = records
    .filter((row) => row.type === "notebook")
    .sort((a, b) => a.position - b.position);
  assert.deepEqual(
    notebooks.map((p) => p.name),
    ["C", "A", "B"],
  );
  assert(notebooks.every((p) => Number.isInteger(p.position)));
  await f.move(f.b.id, null, { beforeId: f.c.id });
  assert.equal((await tasks.get(f.principal, task.id)).error, "export_changed");
});
