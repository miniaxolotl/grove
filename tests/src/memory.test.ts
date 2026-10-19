import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, writeFile, readFile, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { serve } from "@hono/node-server";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createDatabase, probeDatabase, tenant } from "@lib/database";
import { MemoryService, sessionPrincipal } from "@lib/memory";
import {
  rememberSchema,
  recallSchema,
  listSchema,
  type Principal,
} from "@lib/shared/contracts";
import { Authentication } from "../../packages/api/src/auth.ts";
import { createApp } from "../../packages/api/src/app.ts";

const url = process.env.TEST_DATABASE_URL;
const workerUrl = process.env.TEST_WORKER_DATABASE_URL;
const adminUrl = process.env.TEST_MIGRATION_DATABASE_URL;
if (!url || !workerUrl || !adminUrl)
  throw new Error(
    "Tests require disposable TEST_DATABASE_URL, TEST_WORKER_DATABASE_URL and TEST_MIGRATION_DATABASE_URL; see documentation/development/testing.md",
  );
const db = createDatabase(url);
const workerDb = createDatabase(workerUrl);
const admin = createDatabase(adminUrl);
const service = new MemoryService(
  db,
  "test-cursor-secret-with-at-least-32-characters",
);
let a: Principal;
let b: Principal;
const subjects = {
  alice: `user_test_${randomUUID()}`,
  bob: `user_test_${randomUUID()}`,
};
const auth = new Authentication(db, {
  async verify(token) {
    if (!(token in subjects)) throw new Error("provider down");
    return {
      subject: subjects[token as keyof typeof subjects],
      type: "session",
      sessionId: `sess_${token}`,
    };
  },
});
const app = createApp({
  memories: service,
  auth,
  origin: "http://127.0.0.1:26080",
  siteUrl: "http://127.0.0.1:3000",
  issuer: "https://clerk.example.test",
  webhookSecret: "whsec_dGVzdA==",
  ready: () => probeDatabase(db),
});
const input = (content: string, options = {}) =>
  rememberSchema.parse({ operationId: randomUUID(), content, ...options });

before(async () => {
  await probeDatabase(db);
  a = await auth.principal(
    new Request("http://localhost/v1/me", {
      headers: { authorization: "Bearer alice" },
    }),
  );
  b = await auth.principal(
    new Request("http://localhost/v1/me", {
      headers: { authorization: "Bearer bob" },
    }),
  );
});
after(async () => {
  await Promise.all([db.destroy(), workerDb.destroy(), admin.destroy()]);
});

test("runtime RLS blocks missing tenant context and pooled cross-account reuse", async () => {
  const memory = await service.remember(
    a,
    input("I prefer concise explanations."),
  );
  assert.equal((await db("memories").where({ id: memory.id })).length, 0);
  await assert.rejects(service.get(b, memory.id), { code: "not_found" });
  for (let i = 0; i < 8; i++) {
    const [one, two] = await Promise.all([
      service.list(a, listSchema.parse({})),
      service.list(b, listSchema.parse({})),
    ]);
    assert(one.items.some((m) => m.id === memory.id));
    assert(!two.items.some((m) => m.id === memory.id));
  }
  await assert.rejects(
    tenant(db, b.accountId, (trx) =>
      trx("memories").insert({
        id: randomUUID(),
        accountId: a.accountId,
        content: "forged owner",
        kind: "fact",
        source: {},
      }),
    ),
    /row-level security/,
  );
});

test("idempotency, concurrent corrections, history, archive search and permanent deletion", async () => {
  const save = input("Use PostgreSQL for the memory database.", {
    kind: "decision",
  });
  const [first, retry] = await Promise.all([
    service.remember(a, save),
    service.remember(a, save),
  ]);
  assert.equal(first.id, retry.id);
  await assert.rejects(
    service.remember(a, { ...save, content: "different request" }),
    { code: "operation_conflict" },
  );
  const attempts = await Promise.allSettled([
    service.remember(
      a,
      input("Use PostgreSQL with pgvector.", {
        id: first.id,
        expectedVersion: first.version,
        kind: "decision",
      }),
    ),
    service.remember(
      a,
      input("Use another database.", {
        id: first.id,
        expectedVersion: first.version,
        kind: "decision",
      }),
    ),
  ]);
  assert.equal(attempts.filter((r) => r.status === "fulfilled").length, 1);
  const corrected = await service.get(a, first.id);
  assert.equal(corrected.version, 2);
  assert.equal((await service.revisions(a, first.id)).length, 2);
  const archived = await service.lifecycle(a, first.id, "archive", {
    operationId: randomUUID(),
    expectedVersion: 2,
  });
  assert(
    !(
      await service.recall(a, recallSchema.parse({ query: "database" }))
    ).items.some((m) => m.id === first.id),
  );
  assert(
    (
      await service.list(a, listSchema.parse({ status: "archived" }))
    ).items.some((m) => m.id === first.id),
  );
  const restored = await service.lifecycle(a, first.id, "restore", {
    operationId: randomUUID(),
    expectedVersion: archived.version,
    revision: 1,
  });
  assert.equal(restored.content, save.content);
  const deletion = {
    operationId: randomUUID(),
    items: [{ id: first.id, expectedVersion: restored.version }],
  };
  assert.equal(
    (await service.forget(a, deletion)).results[0].outcome,
    "deleted",
  );
  assert.equal(
    (await service.forget(a, deletion)).results[0].outcome,
    "deleted",
  );
  await assert.rejects(service.remember(a, save), { code: "gone" });
  for (const table of ["memory_revisions", "memory_embeddings", "jobs"])
    assert.equal((await admin(table).where({ memoryId: first.id })).length, 0);
});

test("scoped keys cannot cross projects, widen grants or administer accounts; revocation is immediate", async () => {
  const project = await service.project(a, {
    name: "Project A",
    identity: "git:example/a",
  });
  const other = await service.project(a, {
    name: "Project B",
    identity: "git:example/b",
  });
  const issued = await service.grant(
    a,
    {
      name: "Test reader",
      capabilities: ["memory:read"],
      personal: false,
      allProjects: false,
      projectIds: [project.id],
    },
    { key: true },
  );
  assert(issued.secret);
  const key = await auth.principal(
    new Request("http://localhost", {
      headers: { authorization: `Bearer ${issued.secret}` },
    }),
  );
  const privateMemory = await service.remember(
    a,
    input("Private project B facts", { projectId: other.id }),
  );
  await assert.rejects(service.get(key, privateMemory.id), {
    code: "not_found",
  });
  await assert.rejects(
    service.remember(key, input("not allowed", { projectId: project.id })),
    { code: "forbidden" },
  );
  await assert.rejects(service.connections(key), { code: "forbidden" });
  await service.revoke(a, issued.connection.id);
  await assert.rejects(service.me(key), { code: "forbidden" });
  await assert.rejects(
    auth.principal(
      new Request("http://localhost", {
        headers: { authorization: `Bearer ${issued.secret}` },
      }),
    ),
    { code: "unauthorized" },
  );
});

test("bounded pagination cursors bind account/filter and recall does not fill irrelevant matches", async () => {
  for (let i = 0; i < 3; i++)
    await service.remember(a, input(`Pagination unique fact ${i}`));
  const page = await service.list(a, listSchema.parse({ limit: 1 }));
  assert(page.nextCursor);
  const next = await service.list(
    a,
    listSchema.parse({ limit: 1, cursor: page.nextCursor }),
  );
  assert.notEqual(page.items[0].id, next.items[0].id);
  await assert.rejects(
    service.list(b, listSchema.parse({ cursor: page.nextCursor })),
    { code: "invalid_cursor" },
  );
  await assert.rejects(
    service.list(
      a,
      listSchema.parse({ status: "archived", cursor: page.nextCursor }),
    ),
    { code: "invalid_cursor" },
  );
  assert.equal(
    (
      await service.recall(
        a,
        recallSchema.parse({ query: "zzzxylophonequokka" }),
      )
    ).items.length,
    0,
  );
});

test("a leased embedding completed after deletion cannot resurrect content", async () => {
  const row = await service.remember(
    b,
    input("A uniquely leased embedding job."),
  );
  await admin("jobs")
    .whereNot({ memoryId: row.id })
    .update({ dueAt: admin.raw("now() + interval '1 hour'") });
  let started!: () => void;
  let release!: (value: number[]) => void;
  const waiting = new Promise<void>((resolve) => {
    started = resolve;
  });
  const vector = new Promise<number[]>((resolve) => {
    release = resolve;
  });
  const worker = new MemoryService(workerDb, service.cursorSecret, {
    profile: "test-profile",
    embed: async () => {
      started();
      return vector;
    },
  });
  const running = worker.runJob();
  await waiting;
  await service.forget(b, {
    operationId: randomUUID(),
    items: [{ id: row.id, expectedVersion: row.version }],
  });
  release([1, ...Array(383).fill(0)]);
  await running;
  assert.equal(
    (await admin("memory_embeddings").where({ memoryId: row.id })).length,
    0,
  );
  assert.equal((await admin("memories").where({ id: row.id })).length, 0);
});

test("temporary handoffs expire; restoring renews dates; durable facts survive maintenance", async () => {
  const handoff = await service.remember(
    b,
    input("Next: verify the deployment.", {
      kind: "handoff",
      taskId: randomUUID(),
    }),
  );
  const durable = await service.remember(b, input("I use metric units."));
  await admin("memories")
    .where({ id: handoff.id })
    .update({
      expiresAt: admin.raw("now() - interval '1 day'"),
      purgeAt: admin.raw("now() + interval '1 day'"),
    });
  assert(
    !(await service.recall(b, recallSchema.parse({ query: "deployment" })))
      .items.length,
  );
  const restored = await service.lifecycle(b, handoff.id, "restore", {
    operationId: randomUUID(),
    expectedVersion: handoff.version,
    durable: true,
  });
  assert.equal(restored.kind, "fact");
  assert.equal(restored.purgeAt, null);
  await new MemoryService(workerDb, service.cursorSecret).maintenance(
    async () => {},
  );
  assert.equal((await service.get(b, durable.id)).content, durable.content);
});

test("HTTP authorization, validation, and official MCP initialize/tools/errors", async () => {
  const anonymous = await app.request("/v1/memories");
  assert.equal(anonymous.status, 401);
  assert.match(
    anonymous.headers.get("www-authenticate")!,
    /oauth-protected-resource/,
  );
  const invalid = await app.request("/v1/memories", {
    method: "POST",
    headers: {
      authorization: "Bearer alice",
      "content-type": "application/json",
    },
    body: JSON.stringify({ content: "", ownerId: b.accountId }),
  });
  assert.equal(invalid.status, 400);
  const server = serve({ fetch: app.fetch, hostname: "127.0.0.1", port: 0 });
  await new Promise<void>((resolve) =>
    server.listening ? resolve() : server.once("listening", resolve),
  );
  const address = server.address();
  assert(address && typeof address !== "string");
  const client = new Client({ name: "grove-integration-test", version: "1" });
  try {
    await client.connect(
      new StreamableHTTPClientTransport(
        new URL(`http://127.0.0.1:${address.port}/mcp`),
        { requestInit: { headers: { Authorization: "Bearer alice" } } },
      ),
    );
    const tools = await client.listTools();
    assert.deepEqual(
      tools.tools.map((t) => t.name),
      ["remember", "recall", "memories", "forget"],
    );
    const saved = await client.callTool({
      name: "remember",
      arguments: input("MCP initialization really works."),
    });
    assert.notEqual(saved.isError, true);
    assert(saved.structuredContent);
    const foreign = await service.remember(b, input("Bob owns this memory."));
    const result = await client.callTool({
      name: "remember",
      arguments: input("forged correction", {
        id: foreign.id,
        expectedVersion: foreign.version,
      }),
    });
    assert.equal(result.isError, true);
  } finally {
    await client.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("deleted Clerk subject and stale webhook cannot reprovision an account", async () => {
  const subject = `user_deleted_${randomUUID()}`;
  const { rows } = await db.raw("SELECT * FROM grove_account(?)", [subject]);
  const principal = sessionPrincipal(rows[0].id, subject);
  await service.remember(
    principal,
    input("Content to erase with its account."),
  );
  await db.raw("SELECT grove_webhook(?, 'user.deleted', ?, ?)", [
    randomUUID(),
    subject,
    Date.now(),
  ]);
  await db.raw("SELECT grove_webhook(?, 'user.created', ?, ?)", [
    randomUUID(),
    subject,
    Date.now() - 100,
  ]);
  assert.equal(
    (await db.raw("SELECT * FROM grove_account(?)", [subject])).rows.length,
    0,
  );
  await assert.rejects(service.list(principal, listSchema.parse({})), {
    code: "account_unavailable",
  });
  await new MemoryService(workerDb, service.cursorSecret).maintenance(
    async () => {},
  );
  assert.equal(
    (await admin("memories").where({ accountId: principal.accountId })).length,
    0,
  );
  assert.equal(
    (await admin("accounts").where({ id: principal.accountId }).first()).status,
    "deleted",
  );
});

test("OAuth grants bind account and client identity, narrow capabilities and reject pre-revocation tokens", async () => {
  const clientId = randomUUID();
  let issuedAt = Date.now();
  let subject = subjects.alice;
  const oauth = new Authentication(db, {
    verify: async () => ({
      subject,
      type: "oauth",
      clientId,
      issuedAt,
      scopes: ["openid"],
    }),
  });
  const request = new Request("http://localhost", {
    headers: { authorization: "Bearer test-oauth" },
  });
  const pending = await oauth.principal(request);
  assert.equal((await service.me(pending)).capabilities.length, 0);
  const grant = {
    name: "OAuth reader",
    capabilities: ["memory:read"] as "memory:read"[],
    personal: true,
    allProjects: false,
    projectIds: [],
  };
  await service.grant(a, grant, { id: pending.connectionId });
  const connected = await oauth.principal(request);
  assert.deepEqual((await service.me(connected)).capabilities, ["memory:read"]);
  await assert.rejects(
    service.remember(connected, input("OAuth scope cannot widen itself")),
    { code: "forbidden" },
  );
  await assert.rejects(service.grant(connected, grant), { code: "forbidden" });
  subject = subjects.bob;
  const second = await oauth.principal(request);
  assert.equal((await service.me(second)).capabilities.length, 0);
  assert.notEqual(second.connectionId, connected.connectionId);
  subject = subjects.alice;
  await service.revoke(a, connected.connectionId!);
  await assert.rejects(oauth.principal(request), {
    code: "connection_revoked",
  });
  await service.grant(a, grant, { id: connected.connectionId });
  await assert.rejects(oauth.principal(request), {
    code: "connection_revoked",
  });
  await assert.rejects(service.me(connected), { code: "connection_revoked" });
  issuedAt = Date.now() + 2000;
  assert((await oauth.principal(request)).connectionId);
});

test("capture pause is enforced on automatic saves while explicit memories persist", async () => {
  await service.settings(b, { captureEnabled: false, recallEnabled: false });
  await assert.rejects(
    service.remember(
      b,
      input("automatic capture denied", { capture: "automatic" }),
    ),
    { code: "capture_paused" },
  );
  const explicit = await service.remember(
    b,
    input("The user explicitly asked to save this."),
  );
  assert.equal(explicit.kind, "fact");
  await service.settings(b, { captureEnabled: true, recallEnabled: true });
});

test("deletion purges application content even while the identity provider is unavailable", async () => {
  const subject = `user_pending_delete_${randomUUID()}`;
  const { rows } = await db.raw("SELECT * FROM grove_account(?)", [subject]);
  const principal = sessionPrincipal(rows[0].id, subject);
  const saved = await service.remember(
    principal,
    input("Do not retain me during a provider outage."),
  );
  await service.deleteAccount(principal);
  const worker = new MemoryService(workerDb, service.cursorSecret);
  await worker.maintenance(async () => {
    throw new Error("provider offline");
  });
  assert.equal((await admin("memories").where({ id: saved.id })).length, 0);
  assert.equal(
    (await admin("accounts").where({ id: principal.accountId }).first()).status,
    "deleting",
  );
  await worker.maintenance(async () => {});
  assert.equal(
    (await admin("accounts").where({ id: principal.accountId }).first()).status,
    "deleted",
  );
});

test("signed webhook ordering protects banned users before first access", async () => {
  const subject = `user_banned_${randomUUID()}`;
  const now = Date.now();
  await db.transaction(async (trx) => {
    await trx.raw("SELECT grove_webhook(?, 'user.updated', ?, ?)", [
      randomUUID(),
      subject,
      now,
    ]);
    await trx.raw("SELECT grove_user_state(?, ?, true)", [subject, now]);
  });
  assert.equal(
    (await db.raw("SELECT * FROM grove_account(?)", [subject])).rows.length,
    0,
  );
  await db.transaction(async (trx) => {
    await trx.raw("SELECT grove_webhook(?, 'user.created', ?, ?)", [
      randomUUID(),
      subject,
      now - 100,
    ]);
    await trx.raw("SELECT grove_user_state(?, ?, false)", [subject, now - 100]);
  });
  assert.equal(
    (await db.raw("SELECT * FROM grove_account(?)", [subject])).rows.length,
    0,
  );
  const badSignature = await app.request("/v1/webhooks/clerk", {
    method: "POST",
    body: JSON.stringify({
      type: "user.deleted",
      data: { id: subjects.alice },
      timestamp: now,
    }),
  });
  assert.equal(badSignature.status, 400);
  assert((await service.me(a)).accountId);
});

test("hybrid semantic matches are tenant/project filtered and exclude stale revisions", async () => {
  const profile = "semantic-contract-test";
  const vector = [1, ...Array(383).fill(0)];
  const semantic = new MemoryService(db, service.cursorSecret, {
    profile,
    embed: async () => vector,
  });
  const project = await service.project(a, {
    name: "Semantic test",
    identity: `git:test/${randomUUID()}`,
  });
  const own = await service.remember(
    a,
    input("Prefer concise replies", { projectId: project.id }),
  );
  const foreign = await service.remember(b, input("Foreign matched vector"));
  for (const [principal, row] of [
    [a, own],
    [b, foreign],
  ] as const)
    await tenant(db, principal.accountId, (trx) =>
      trx("memory_embeddings").insert({
        accountId: principal.accountId,
        memoryId: row.id,
        version: row.version,
        profile,
        embedding: JSON.stringify(vector),
      }),
    );
  const result = await semantic.recall(
    a,
    recallSchema.parse({ query: "Brevity is useful", projectId: project.id }),
  );
  assert.equal(result.mode, "hybrid");
  assert.deepEqual(
    result.items.map((m) => m.id),
    [own.id],
  );
  await service.remember(
    a,
    input("Prefer detailed replies", {
      id: own.id,
      expectedVersion: own.version,
      projectId: project.id,
    }),
  );
  assert.equal(
    (
      await semantic.recall(
        a,
        recallSchema.parse({
          query: "Brevity is useful",
          projectId: project.id,
        }),
      )
    ).items.length,
    0,
  );
});

test("legacy import is source-read-only, ownership-checked, atomically archived and repeatable", async () => {
  const directory = await mkdtemp(join(tmpdir(), "grove-import-"));
  const project = await service.project(b, {
    name: "Legacy fixture",
    identity: `git:legacy/${randomUUID()}`,
  });
  const key = await service.grant(
    b,
    {
      name: "Import fixture",
      capabilities: ["memory:read", "memory:write"],
      personal: false,
      allProjects: false,
      projectIds: [project.id],
    },
    { key: true },
  );
  const calls: string[] = [];
  const source = createServer((request, response) => {
    calls.push(`${request.method} ${request.url}`);
    assert.equal(request.method, "POST");
    assert.match(
      request.url!,
      /^\/collections\/grove_(memories|entities|relations)\/points\/scroll$/,
    );
    response.setHeader("Content-Type", "application/json");
    response.end(
      JSON.stringify({
        result: {
          points: [
            {
              id: "legacy-1",
              vector: [0.5],
              payload: {
                text: "Legacy migration fixture fact",
                metadata: { project: "legacy-repo" },
              },
            },
          ],
          next_page_offset: null,
        },
      }),
    );
  });
  await new Promise<void>((done) => source.listen(0, "127.0.0.1", done));
  const sourceAddress = source.address();
  assert(sourceAddress && typeof sourceAddress !== "string");
  const api = serve({ fetch: app.fetch, port: 0, hostname: "127.0.0.1" });
  await new Promise<void>((done) => api.once("listening", done));
  const address = api.address();
  assert(address && typeof address !== "string");
  const mapping = join(directory, "ownership.json");
  await writeFile(
    mapping,
    JSON.stringify({
      sourceId: randomUUID(),
      collectionPrefix: "grove",
      apiOrigin: `http://127.0.0.1:${address.port}`,
      owners: [
        {
          legacyProject: "legacy-repo",
          accountId: b.accountId,
          projectId: project.id,
          keyEnv: "IMPORT_FIXTURE_KEY",
        },
      ],
    }),
  );
  try {
    for (let i = 0; i < 3; i++) {
      const snapshot = join(directory, `${i}.ndjson`);
      const result = await promisify(execFile)(
        process.execPath,
        [
          "--import",
          "tsx",
          resolve(
            import.meta.dirname,
            "../../scripts/migrate-legacy/src/index.ts",
          ),
          "--mapping",
          mapping,
          "--snapshot",
          snapshot,
          ...(i ? ["--apply"] : []),
        ],
        {
          env: {
            ...process.env,
            LEGACY_QDRANT_URL: `http://127.0.0.1:${sourceAddress.port}`,
            IMPORT_FIXTURE_KEY: key.secret!,
          },
        },
      );
      const counts = JSON.parse(result.stdout);
      assert.equal(counts.imported, i ? 1 : 0);
      assert.equal(counts.graphsPreserved, 2);
      assert.equal((await stat(snapshot)).mode & 0o777, 0o600);
      assert.equal(
        (await readFile(snapshot, "utf8")).trim().split("\n").length,
        3,
      );
      const rows = (
        await service.list(
          b,
          listSchema.parse({ projectId: project.id, status: "all" }),
        )
      ).items;
      assert.equal(rows.length, i ? 1 : 0);
      if (i) {
        assert.equal(rows[0].status, "archived");
        assert.equal(rows[0].version, 1);
      }
      assert.equal(
        (
          await service.recall(
            b,
            recallSchema.parse({
              projectId: project.id,
              includePersonal: false,
            }),
          )
        ).items.length,
        0,
      );
    }
    assert.equal(calls.length, 9);
  } finally {
    source.closeAllConnections();
    await Promise.all([
      new Promise<void>((done) => source.close(() => done())),
      new Promise<void>((done) => api.close(() => done())),
    ]);
  }
});
