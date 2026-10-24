import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { createDatabase } from "@lib/database";
import { MemoryService, sessionPrincipal } from "@lib/memory";
import { rememberSchema, type Principal } from "@lib/shared/contracts";
import { createApp } from "../../packages/api/src/app.ts";

const url = process.env.TEST_DATABASE_URL!;
assert(url && new URL(url).pathname.endsWith("_test"));
const db = createDatabase(url);
const service = new MemoryService(db, "memory-tools-test-secret");
let owner: Principal, foreign: Principal;
before(async () => {
  async function account() {
    const subject = `tools_${randomUUID()}`;
    const { rows } = await db.raw("SELECT * FROM grove_account(?)", [subject]);
    return sessionPrincipal(rows[0].id, subject);
  }
  [owner, foreign] = await Promise.all([account(), account()]);
});
after(() => db.destroy());
const app = createApp({
  memories: service,
  auth: { principal: async () => owner },
  origin: "http://localhost",
  siteUrl: "http://localhost:3000",
  issuer: "https://clerk.example.test",
  webhookSecret: "whsec_dGVzdA==",
  ready: async () => {},
});
async function tool(name: string, input: unknown, principal = owner) {
  const target = createApp({
    memories: service,
    auth: { principal: async () => principal },
    origin: "http://localhost",
    siteUrl: "http://localhost:3000",
    issuer: "https://clerk.example.test",
    webhookSecret: "whsec_dGVzdA==",
    ready: async () => {},
  });
  const response = await target.request(`/v1/tools/${name}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  return { status: response.status, body: await response.json() };
}
const save = (rest = {}) =>
  service.remember(
    owner,
    rememberSchema.parse({
      operationId: randomUUID(),
      content: "Garden schedule",
      ...rest,
    }),
  );

test("partial tool edits preserve scope, provenance and lifetime across retries", async () => {
  const notebook = await service.project(owner, {
    name: "Garden",
    identity: randomUUID(),
  });
  const note = await save({
    projectId: notebook.id,
    kind: "decision",
    retentionDays: 14,
    source: { agent: "cli", verification: "Confirmed by owner" },
  });
  const input = {
    operationId: randomUUID(),
    id: note.id,
    expectedVersion: note.version,
    content: "Water twice weekly",
  };
  const result = await tool("update_memory", input);
  assert.equal(result.status, 200);
  const updated = result.body.data;
  assert.equal(updated.projectId, notebook.id);
  assert.equal(updated.kind, note.kind);
  assert.deepEqual(updated.source, note.source);
  assert.equal(updated.retentionDays, note.retentionDays);
  assert.equal(updated.expiresAt, note.expiresAt);
  assert.equal(updated.version, 2);
  assert.equal((await tool("update_memory", input)).body.data.version, 2);
  assert.equal(
    (await tool("update_memory", { ...input, content: "Different" })).status,
    409,
  );
  assert.equal(
    (await tool("update_memory", { ...input, operationId: randomUUID() }))
      .status,
    409,
  );
  assert.equal(
    (await tool("get_memory", { id: note.id })).body.data.content,
    input.content,
  );
  assert.equal(
    (await tool("memory_history", { id: note.id })).body.data.length,
    2,
  );
  assert.equal(
    (await tool("get_memory", { id: note.id, revision: 1 })).body.data.content,
    note.content,
  );
  assert.equal(
    (await tool("get_memory", { id: note.id }, foreign)).status,
    404,
  );
});

test("batch moves are atomic, retry-safe and check source and destination grants", async () => {
  const origin = await service.project(owner, {
    name: "Origin",
    identity: randomUUID(),
  });
  const destination = await service.project(owner, {
    name: "Destination",
    identity: randomUUID(),
  });
  const one = await save({ projectId: origin.id }),
    two = await save({ projectId: origin.id });
  const input = {
    operationId: randomUUID(),
    projectId: destination.id,
    items: [one, two].map((n) => ({ id: n.id, expectedVersion: n.version })),
  };
  const stale = await tool("move_memories", {
    ...input,
    items: [input.items[0], { ...input.items[1], expectedVersion: 999 }],
  });
  assert.equal(stale.status, 409);
  assert.equal((await service.get(owner, one.id)).projectId, origin.id);
  const granted = await service.grant(
    owner,
    {
      name: "Scoped",
      capabilities: ["memory:read", "memory:write"],
      personal: false,
      allProjects: false,
      projectIds: [origin.id],
    },
    { key: true },
  );
  const agent: Principal = {
    ...owner,
    type: "key",
    connectionId: granted.connection.id,
  };
  assert.equal((await tool("move_memories", input, agent)).status, 403);
  assert.equal((await tool("move_memories", input)).status, 200);
  assert.equal((await tool("move_memories", input)).status, 200);
  assert.equal((await service.get(owner, one.id)).version, 2);
  assert.equal((await service.get(owner, two.id)).projectId, destination.id);
  assert.equal(
    (
      await tool(
        "update_memory",
        {
          operationId: randomUUID(),
          id: one.id,
          expectedVersion: 2,
          content: "Denied",
        },
        agent,
      )
    ).status,
    404,
  );
});

test("notebook tools support discovery, idempotent creation and partial hierarchy edits", async () => {
  const input = { operationId: randomUUID(), name: "Research" };
  const created = await tool("create_notebook", input);
  assert.equal(created.status, 200);
  const notebook = created.body.data;
  assert.equal(
    (await tool("create_notebook", input)).body.data.id,
    notebook.id,
  );
  const child = (
    await tool("create_notebook", {
      operationId: randomUUID(),
      name: "Child",
      parentId: notebook.id,
    })
  ).body.data;
  const update = {
    operationId: randomUUID(),
    id: child.id,
    expectedVersion: child.version,
    name: "Renamed",
  };
  const renamed = await tool("update_notebook", update);
  assert.equal(renamed.status, 200);
  assert.equal(renamed.body.data.parentId, notebook.id);
  assert.equal(
    (await tool("update_notebook", update)).body.data.version,
    renamed.body.data.version,
  );
  assert.equal(
    (
      await tool("update_notebook", {
        operationId: randomUUID(),
        id: notebook.id,
        expectedVersion: notebook.version,
        parentId: child.id,
      })
    ).status,
    400,
  );
  const moved = await tool("update_notebook", {
    operationId: randomUUID(),
    id: child.id,
    expectedVersion: renamed.body.data.version,
    parentId: null,
  });
  assert.equal(moved.body.data.name, "Renamed");
  assert.equal(moved.body.data.parentId, null);
  const page = await tool("notebooks", { limit: 1 });
  assert.equal(page.status, 200);
  assert.equal(page.body.data.items.length, 1);
  assert(page.body.data.nextCursor);
  const next = await tool("notebooks", {
    limit: 1,
    cursor: page.body.data.nextCursor,
  });
  assert.notEqual(next.body.data.items[0].id, page.body.data.items[0].id);
  assert.equal(
    (
      await tool(
        "notebooks",
        { limit: 1, cursor: page.body.data.nextCursor },
        foreign,
      )
    ).status,
    400,
  );
});

test("lifecycle tools hide archived/deleted notes and retain owner-only notebook lifecycle", async () => {
  const note = await save();
  const archived = await tool("archive_memory", {
    operationId: randomUUID(),
    id: note.id,
    expectedVersion: note.version,
  });
  assert.equal(archived.status, 200);
  assert.equal(archived.body.data.status, "archived");
  const restored = await tool("restore_memory", {
    operationId: randomUUID(),
    id: note.id,
    expectedVersion: archived.body.data.version,
  });
  assert.equal(restored.body.data.status, "active");
  const notebook = await service.project(owner, {
    name: "Lifecycle",
    identity: randomUUID(),
  });
  const grant = await service.grant(
    owner,
    {
      name: "Agent",
      capabilities: ["memory:read", "memory:write", "memory:delete"],
      personal: true,
      allProjects: true,
      projectIds: [],
    },
    { key: true },
  );
  const agent: Principal = {
    ...owner,
    type: "key",
    connectionId: grant.connection.id,
  };
  assert.equal(
    (
      await tool(
        "notebook_lifecycle",
        { id: notebook.id, action: "preview" },
        agent,
      )
    ).status,
    403,
  );
  const preview = await tool("notebook_lifecycle", {
    id: notebook.id,
    action: "preview",
  });
  assert.equal(preview.status, 200);
  const change = await tool("notebook_lifecycle", {
    id: notebook.id,
    action: "archive",
    operationId: randomUUID(),
    expectedVersion: notebook.version,
    fingerprint: preview.body.data.fingerprint,
  });
  assert.equal(change.status, 200);
  const deleted = await tool("forget", {
    operationId: randomUUID(),
    items: [{ id: note.id, expectedVersion: restored.body.data.version }],
  });
  assert.equal(deleted.body.data.results[0].outcome, "deleted");
  assert.equal((await tool("get_memory", { id: note.id })).status, 404);
  const missing = await app.request("/v1/tools/not-a-tool", {
    method: "POST",
    body: "{}",
  });
  assert.equal(missing.status, 404);
});
