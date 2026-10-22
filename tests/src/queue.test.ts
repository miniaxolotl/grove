import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { setTimeout } from "node:timers/promises";
import {
  MemoryService,
  sessionPrincipal,
  Tasks,
  exportHandlers,
  importHandlers,
  enqueueConnectorSync,
} from "@lib/memory";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { localArtifacts } from "../../packages/api/src/artifacts.ts";
import { rememberSchema, listSchema } from "@lib/shared/contracts";
import {
  cleanupHandlers,
  scheduleCleanup,
} from "../../lib/memory/src/cleanup.ts";
import { createDatabase, tenant, camelRows, type Knex } from "@lib/database";
import {
  checkpointTask,
  runTask,
  type ClaimedTask,
} from "../../lib/memory/src/task-runner.ts";

const url = process.env.TEST_MIGRATION_DATABASE_URL!;
if (!url || !new URL(url).pathname.endsWith("_test"))
  throw new Error("Use a disposable test database");
const authority = createDatabase(url);
const name = `grove_queue_${randomUUID().replaceAll("-", "")}_test`;
let admin: Knex, api: Knex, worker: Knex;
before(async () => {
  await mkdir("/tmp/opencode", { recursive: true, mode: 0o700 });
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
});

test("provider-lane reservations bound replicas while locked accounts do not block other owners", async () => {
  const fixtures = await Promise.all(
    Array.from({ length: 4 }, () => fixture()),
  );
  const profile = `capacity-${randomUUID()}`;
  const ids = fixtures.map(() => randomUUID());
  for (let i = 0; i < ids.length; i++)
    await admin("jobs").insert({
      id: ids[i],
      accountId: fixtures[i].accountId,
      kind: "brief",
      target: "personal",
      scope: JSON.stringify({ projectId: null }),
      profile,
    });
  const take = (id?: string) =>
    worker.raw(
      "SELECT * FROM grove_claim_processing(?::text[],?::uuid,'enrichment',2,2)",
      [[profile], id ?? null],
    );
  const lock = await admin.transaction();
  try {
    await lock("accounts")
      .where({ id: fixtures[0].accountId })
      .forUpdate()
      .first();
    await take();
    assert.equal(
      (await admin("jobs").whereIn("id", ids).whereNotNull("leaseId")).length,
      1,
    );
    assert.equal(
      (await admin("jobs").where({ id: ids[0] }).first()).leaseId,
      null,
    );
  } finally {
    await lock.rollback();
  }
  await Promise.all(ids.map((id) => take(id)));
  await take();
  assert.equal(
    (await admin("jobs").whereIn("id", ids).whereNotNull("leaseId")).length,
    2,
  );
  await admin("jobs").whereIn("id", ids).delete();
});
after(async () => {
  await Promise.all([admin?.destroy(), api?.destroy(), worker?.destroy()]);
  await authority.raw("DROP DATABASE ?? WITH (FORCE)", [name]);
  await authority.destroy();
});
async function fixture() {
  const { rows } = await api.raw("SELECT * FROM grove_account(?)", [
    `queue_${randomUUID()}`,
  ]);
  const accountId = rows[0].id as string;
  const enqueue = async (kind = "export") => {
    const id = randomUUID();
    await tenant(api, accountId, (trx) =>
      trx("background_tasks").insert({ id, accountId, kind, dedupeKey: id }),
    );
    return id;
  };
  return { accountId, enqueue };
}
const claim = async (id: string, lane = "bulk", limit = 1) =>
  camelRows<ClaimedTask>(
    await worker.raw("SELECT * FROM grove_claim_task(?::uuid,?,?)", [
      id,
      lane,
      limit,
    ]),
  )[0];

test("task claims are exclusive, account-bounded and inaccessible to API roles or other tenants", async () => {
  const a = await fixture(),
    b = await fixture();
  const id = await a.enqueue();
  assert.equal(
    (
      await tenant(api, b.accountId, (trx) =>
        trx("background_tasks").where({ id }),
      )
    ).length,
    0,
  );
  await assert.rejects(
    api.raw("SELECT * FROM grove_claim_task(?::uuid,?,?)", [id, "bulk", 1]),
    /permission denied/,
  );
  const claims = await Promise.all(Array.from({ length: 8 }, () => claim(id)));
  assert.equal(claims.filter(Boolean).length, 1);
  const blocked = await a.enqueue();
  assert.equal(await claim(blocked), undefined);
  const other = await b.enqueue();
  assert(await claim(other));
  assert(
    await checkpointTask(worker, claims.find(Boolean)!, {
      processed: 20,
      cursor: { page: 1 },
    }),
  );
  assert(await claim(blocked));
});

test("leases fence expired and cancelled completions; successful checkpoints reset the consecutive-failure budget", async () => {
  const f = await fixture();
  const id = await f.enqueue();
  const old = await claim(id);
  await admin("background_tasks")
    .where({ id })
    .update({ leaseUntil: admin.raw("now()-interval '1 second'") });
  const fresh = await claim(id);
  assert.notEqual(old.leaseId, fresh.leaseId);
  assert.equal(await checkpointTask(worker, old, { complete: true }), false);
  assert.equal(
    (
      await worker.raw(
        "SELECT grove_task_heartbeat(?::uuid,?::uuid) AS owned",
        [id, old.leaseId],
      )
    ).rows[0].owned,
    false,
  );
  assert(await checkpointTask(worker, fresh, { processed: 10 }));
  assert.equal(
    (await admin("background_tasks").where({ id }).first()).failures,
    0,
  );
  const cancelled = await claim(id);
  await tenant(api, f.accountId, (trx) =>
    trx("background_tasks")
      .where({ id })
      .update({ status: "cancelled", leaseId: null, leaseUntil: null }),
  );
  assert.equal(
    await checkpointTask(worker, cancelled, { complete: true }),
    false,
  );
});

test("task runner records bounded retries, resumes checkpoints and completes only once", async () => {
  const f = await fixture();
  const id = await f.enqueue();
  await runTask(
    worker,
    {
      export: async () => {
        throw new Error("private upstream content");
      },
    },
    { id },
  );
  let row = await admin("background_tasks").where({ id }).first();
  assert.equal(row.errorCode, "task_unavailable");
  assert.equal(row.status, "pending");
  assert(new Date(row.dueAt).getTime() > Date.now());
  await admin("background_tasks")
    .where({ id })
    .update({ dueAt: admin.fn.now() });
  let calls = 0;
  const handler = async () => {
    calls++;
    return { complete: true, processed: 100 };
  };
  await Promise.all([
    runTask(worker, { export: handler }, { id }),
    runTask(worker, { export: handler }, { id }),
  ]);
  row = await admin("background_tasks").where({ id }).first();
  assert.equal(calls, 1);
  assert.equal(row.status, "succeeded");
  assert.equal(row.processed, "100");
  assert.equal(await runTask(worker, { export: handler }, { id }), false);
});

test("heartbeats renew a running task, cancellation aborts its handler and crash exhaustion is swept without deliveries", async () => {
  const f = await fixture(),
    id = await f.enqueue();
  const account = await admin("accounts").where({ id: f.accountId }).first();
  const tasks = new Tasks(new MemoryService(api, "queue-tests"), true);
  let started!: () => void;
  const entered = new Promise<void>((resolve) => {
    started = resolve;
  });
  const running = runTask(
    worker,
    {
      export: async (_, signal) => {
        await admin("background_tasks")
          .where({ id })
          .update({ leaseUntil: admin.raw("now()+interval '2 seconds'") });
        started();
        await setTimeout(10000, undefined, { signal });
        return { complete: true };
      },
    },
    { id, heartbeatMs: 20 },
  );
  await entered;
  for (let i = 0; i < 100; i++) {
    if (
      new Date(
        (await admin("background_tasks").where({ id }).first()).leaseUntil,
      ).getTime() >
      Date.now() + 60000
    )
      break;
    await setTimeout(20);
  }
  assert(
    new Date(
      (await admin("background_tasks").where({ id }).first()).leaseUntil,
    ).getTime() >
      Date.now() + 60000,
  );
  await tasks.action(
    sessionPrincipal(f.accountId, account.clerkSubject),
    id,
    "cancel",
  );
  await running;
  assert.equal(
    (await admin("background_tasks").where({ id }).first()).status,
    "cancelled",
  );
  const crashed = await f.enqueue();
  await admin("background_tasks")
    .where({ id: crashed })
    .update({
      status: "running",
      failures: 5,
      leaseId: randomUUID(),
      leaseUntil: admin.raw("now()-interval '1 second'"),
    });
  await worker.raw("SELECT grove_sweep_deliveries()");
  assert.equal(
    (await admin("background_tasks").where({ id: crashed }).first()).errorCode,
    "lease_exhausted",
  );
});

test("expired exports release admission and artifact cleanup retries failed storage deletion", async () => {
  const f = await fixture(),
    account = await admin("accounts").where({ id: f.accountId }).first();
  const principal = sessionPrincipal(f.accountId, account.clerkSubject),
    tasks = new Tasks(new MemoryService(api, "queue-tests"), true);
  const task = await tasks.export(principal, {
    id: randomUUID(),
    includeDescendants: false,
  });
  const objectKey = `exports/${f.accountId}/${task.id}/${randomUUID()}.ndjson`;
  await admin("export_objects").insert({
    objectKey,
    accountId: f.accountId,
    taskId: task.id,
    expiresAt: admin.raw("now()-interval '1 second'"),
  });
  await admin("background_tasks")
    .where({ id: task.id })
    .update({ expiresAt: admin.raw("now()-interval '1 second'") });
  await worker.raw("SELECT grove_sweep_deliveries()");
  assert.equal((await tasks.get(principal, task.id)).error, "export_expired");
  await tasks.export(principal, {
    id: randomUUID(),
    includeDescendants: false,
  });
  await worker.raw("SELECT grove_schedule_artifacts()");
  const cleanup = await admin("background_tasks")
    .where({ accountId: f.accountId, kind: "artifact_cleanup" })
    .first();
  let fail = true;
  const handlers = exportHandlers(worker, {
    async write() {},
    async read() {
      throw new Error("unused");
    },
    async remove(key) {
      assert.equal(key, objectKey);
      if (fail) throw new Error("offline");
    },
  });
  await runTask(worker, handlers, { id: cleanup.id });
  assert.equal(
    (await admin("export_objects").where({ taskId: task.id })).length,
    1,
  );
  fail = false;
  await admin("background_tasks")
    .where({ id: cleanup.id })
    .update({ dueAt: admin.fn.now() });
  await runTask(worker, handlers, { id: cleanup.id });
  assert.equal(
    (await admin("export_objects").where({ taskId: task.id })).length,
    0,
  );
  assert.equal(
    (await admin("background_tasks").where({ id: cleanup.id }).first()).status,
    "succeeded",
  );
});

test("deleting accounts block exports but retain a claimable cleanup path", async () => {
  const f = await fixture();
  const exportId = await f.enqueue(),
    cleanupId = await f.enqueue("account_cleanup");
  await admin("accounts")
    .where({ id: f.accountId })
    .update({ status: "deleting" });
  assert.equal(await claim(exportId), undefined);
  assert(await claim(cleanupId, "maintenance"));
});

test("soft deletion retains note and conversation history while RLS hides them from normal and scoped reads", async () => {
  const f = await fixture();
  const account = await admin("accounts").where({ id: f.accountId }).first();
  const principal = sessionPrincipal(f.accountId, account.clerkSubject);
  const service = new MemoryService(api, "queue-tests");
  const note = await service.remember(
    principal,
    rememberSchema.parse({
      operationId: randomUUID(),
      content: "Keep this source and its history.",
    }),
  );
  const chat = await service.conversations.create(principal, {
    id: randomUUID(),
    includePersonal: false,
  });
  await service.forget(principal, {
    operationId: randomUUID(),
    items: [{ id: note.id, expectedVersion: note.version }],
  });
  await service.conversations.remove(principal, chat.id);
  assert((await admin("memories").where({ id: note.id }).first()).deletedAt);
  assert.equal(
    (await admin("memory_revisions").where({ memoryId: note.id })).length,
    1,
  );
  assert(
    (await admin("conversations").where({ id: chat.id }).first()).deletedAt,
  );
  assert.equal(
    (await service.list(principal, listSchema.parse({ status: "all" }))).items
      .length,
    0,
  );
  await assert.rejects(service.get(principal, note.id), { code: "not_found" });
  await assert.rejects(service.conversations.get(principal, chat.id), {
    code: "not_found",
  });
  assert.equal(
    (
      await tenant(worker, f.accountId, (trx) =>
        trx("memory_revisions").where({ memoryId: note.id }),
      )
    ).length,
    0,
  );
});

test("account cleanup checkpoints soft deletion independently of identity-provider failures", async () => {
  const f = await fixture();
  const account = await admin("accounts").where({ id: f.accountId }).first();
  const principal = sessionPrincipal(f.accountId, account.clerkSubject);
  const service = new MemoryService(api, "queue-tests");
  const note = await service.remember(
    principal,
    rememberSchema.parse({
      operationId: randomUUID(),
      content: "Retained after account closure.",
    }),
  );
  await service.deleteAccount(principal);
  await assert.rejects(service.get(principal, note.id), {
    code: "account_unavailable",
  });
  const task = await admin("background_tasks")
    .where({ accountId: f.accountId, kind: "account_cleanup" })
    .first();
  const handlers = cleanupHandlers(worker, async () => {
    throw new Error("provider offline");
  });
  for (let i = 0; i < 20; i++)
    await runTask(worker, handlers, { id: task.id, lane: "maintenance" });
  assert((await admin("memories").where({ id: note.id }).first()).deletedAt);
  assert.equal(
    (await admin("memory_revisions").where({ memoryId: note.id })).length,
    1,
  );
  assert.equal(
    (await admin("background_tasks").where({ id: task.id }).first()).errorCode,
    "identity_unavailable",
  );
  await admin("background_tasks")
    .where({ id: task.id })
    .update({ dueAt: admin.fn.now() });
  await runTask(
    worker,
    cleanupHandlers(worker, async () => {}),
    { id: task.id, lane: "maintenance" },
  );
  assert.equal(
    (await admin("accounts").where({ id: f.accountId }).first()).status,
    "deleted",
  );
});

test("exports page notes and history into private artifacts; source changes, cancellation and other tenants fence downloads", async () => {
  const f = await fixture();
  const account = await admin("accounts").where({ id: f.accountId }).first();
  const principal = sessionPrincipal(f.accountId, account.clerkSubject);
  const service = new MemoryService(api, "queue-tests");
  const root = await mkdtemp("/tmp/opencode/grove-exports-");
  try {
    const store = localArtifacts(root),
      tasks = new Tasks(service, true),
      handlers = exportHandlers(worker, store);
    const project = await service.project(principal, {
      identity: "export",
      name: "Export",
    });
    const note = await service.remember(
      principal,
      rememberSchema.parse({
        operationId: randomUUID(),
        content: "Export me",
        projectId: project.id,
      }),
    );
    await service.remember(
      principal,
      rememberSchema.parse({
        operationId: randomUUID(),
        id: note.id,
        expectedVersion: note.version,
        content: "Export revision",
        projectId: project.id,
      }),
    );
    const other = await service.remember(
      principal,
      rememberSchema.parse({
        operationId: randomUUID(),
        content: "Outside notebook",
      }),
    );
    const child = await service.project(principal, {
      identity: "export-child",
      name: "Child",
      parentId: project.id,
    });
    await service.remember(
      principal,
      rememberSchema.parse({
        operationId: randomUUID(),
        content: "Child writing",
        projectId: child.id,
      }),
    );
    const request = {
      id: randomUUID(),
      projectId: project.id,
      includeDescendants: true,
    };
    const task = await tasks.export(principal, request);
    assert.deepEqual(task.scope, {
      projectId: project.id,
      includeDescendants: true,
    });
    assert.equal((await tasks.export(principal, request)).id, task.id);
    for (let i = 0; i < 20; i++)
      if (!(await runTask(worker, handlers, { id: task.id }))) break;
    assert.equal(
      (await tasks.get(principal, task.id)).downloadable,
      true,
      JSON.stringify(await tasks.get(principal, task.id)),
    );
    const artifact = await tasks.artifact(principal, task.id);
    const chunks = [];
    for await (const chunk of await store.read(artifact.key))
      chunks.push(chunk);
    const content = Buffer.concat(chunks).toString();
    assert(content.includes("Export revision"));
    assert(content.includes("Child writing"));
    assert(!content.includes("Outside notebook"));
    assert.equal(
      content
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line))
        .filter((row) => row.type === "revision").length,
      3,
    );
    const stranger = await fixture();
    const strangerAccount = await admin("accounts")
      .where({ id: stranger.accountId })
      .first();
    await assert.rejects(
      tasks.artifact(
        sessionPrincipal(stranger.accountId, strangerAccount.clerkSubject),
        task.id,
      ),
    );
    await service.forget(principal, {
      operationId: randomUUID(),
      items: [{ id: other.id, expectedVersion: other.version }],
    });
    assert.equal((await tasks.get(principal, task.id)).error, "export_changed");
    await assert.rejects(tasks.artifact(principal, task.id));
    await tasks.action(principal, task.id, "retry");
    await runTask(worker, handlers, { id: task.id });
    await tasks.action(principal, task.id, "cancel");
    assert.equal(await runTask(worker, handlers, { id: task.id }), false);
    assert.equal((await tasks.get(principal, task.id)).status, "cancelled");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("imports and connector checkpoints commit with source mappings, avoid duplicates and preserve local edits", async () => {
  const f = await fixture(),
    account = await admin("accounts").where({ id: f.accountId }).first();
  const principal = sessionPrincipal(f.accountId, account.clerkSubject),
    service = new MemoryService(api, "queue-tests");
  const tasks = new Tasks(service, false),
    handlers = importHandlers(new MemoryService(worker, "queue-tests"));
  const submit = (content: string) =>
    tasks.import(principal, {
      id: randomUUID(),
      source: "fixture",
      records: [{ sourceId: "one", content, projectId: null }],
    });
  for (const content of ["First", "Second", "First", "First"]) {
    const task = await submit(content);
    const usage = () =>
      admin("rate_buckets")
        .where({ accountId: f.accountId })
        .sum({ count: "count" })
        .first();
    const before = await usage();
    await runTask(worker, handlers, { id: task.id });
    assert.deepEqual(
      await usage(),
      before,
      "Worker writes must not consume request quota",
    );
    assert.equal(
      (await tasks.get(principal, task.id)).status,
      "succeeded",
      JSON.stringify(await tasks.get(principal, task.id)),
    );
  }
  const notes = await service.list(principal, listSchema.parse({}));
  assert.equal(notes.items.length, 1);
  assert.equal(notes.items[0].version, 3);
  await service.remember(
    principal,
    rememberSchema.parse({
      operationId: randomUUID(),
      id: notes.items[0].id,
      expectedVersion: 3,
      content: "Local edit",
    }),
  );
  const conflict = await submit("Remote edit");
  await runTask(worker, handlers, { id: conflict.id });
  assert.equal(
    (await tasks.get(principal, conflict.id)).error,
    "import_conflict",
  );
  const id = await tenant(api, f.accountId, (trx) =>
    enqueueConnectorSync(trx, f.accountId, "connector"),
  );
  const adapter = {
    page: async () => ({
      records: [{ sourceId: "two", content: "Synced", projectId: null }],
      cursor: { page: 1 },
      complete: true,
    }),
  };
  await runTask(
    worker,
    importHandlers(
      new MemoryService(worker, "queue-tests"),
      new Map([["connector", adapter]]),
    ),
    { id },
  );
  assert.equal((await tasks.get(principal, id!)).status, "succeeded");
  assert.deepEqual(
    (
      await admin("connector_checkpoints")
        .where({ accountId: f.accountId, source: "connector" })
        .first()
    ).cursor,
    { page: 1 },
  );
});

test("retention cleanup marks expired records without physically removing source versions", async () => {
  const f = await fixture();
  const account = await admin("accounts").where({ id: f.accountId }).first();
  const service = new MemoryService(api, "queue-tests");
  const note = await service.remember(
    sessionPrincipal(f.accountId, account.clerkSubject),
    rememberSchema.parse({
      operationId: randomUUID(),
      content: "Expired history.",
      retentionDays: 1,
    }),
  );
  await admin("memories")
    .where({ id: note.id })
    .update({
      expiresAt: admin.raw("now()-interval '2 days'"),
      purgeAt: admin.raw("now()-interval '1 day'"),
    });
  await scheduleCleanup(worker);
  const task = await admin("background_tasks")
    .where({ accountId: f.accountId, kind: "retention_cleanup" })
    .first();
  await runTask(
    worker,
    cleanupHandlers(worker, async () => {}),
    { id: task.id, lane: "maintenance" },
  );
  assert((await admin("memories").where({ id: note.id }).first()).deletedAt);
  assert.equal(
    (await admin("memory_revisions").where({ memoryId: note.id })).length,
    1,
  );
});

test("dispatch claims are exclusive across replicas and publisher outcomes are token-fenced", async () => {
  const f = await fixture();
  const id = await f.enqueue();
  const dispatch = () =>
    worker.raw(
      "SELECT * FROM grove_dispatch_claim('task','bulk','{}'::text[],100)",
    );
  const results = await Promise.all([dispatch(), dispatch()]);
  const claims = results
    .flatMap((r) => r.rows)
    .filter((r: { id: string }) => r.id === id);
  assert.equal(claims.length, 1);
  await worker.raw(
    "SELECT grove_dispatch_finish('task',?::uuid,?::uuid,true)",
    [id, randomUUID()],
  );
  assert.equal(
    (await admin("background_tasks").where({ id }).first()).dispatchedAt,
    null,
  );
  await worker.raw(
    "SELECT grove_dispatch_finish('task',?::uuid,?::uuid,false)",
    [id, claims[0].dispatch_id],
  );
  const again = (await dispatch()).rows.find(
    (r: { id: string }) => r.id === id,
  );
  assert(again);
  await worker.raw(
    "SELECT grove_dispatch_finish('task',?::uuid,?::uuid,true)",
    [id, again.dispatch_id],
  );
  assert((await admin("background_tasks").where({ id }).first()).dispatchedAt);
});

test("model switches enqueue a constant-size backfill, fence old generations and resume bounded pages", async () => {
  const f = await fixture();
  const account = await admin("accounts").where({ id: f.accountId }).first();
  const principal = sessionPrincipal(f.accountId, account.clerkSubject);
  const embedding = {
    profile: "queue-old",
    model: "test",
    dimensions: 384,
    embed: async () => [1, ...Array(383).fill(0)],
  };
  const service = new MemoryService(api, "queue-tests", embedding);
  for (let i = 0; i < 7; i++)
    await service.remember(
      principal,
      rememberSchema.parse({
        operationId: randomUUID(),
        content: `Backfill note ${i}`,
      }),
    );
  await api.raw("SELECT grove_reprocess(?,NULL,NULL)", ["queue-new"]);
  assert.equal(
    (
      await admin("jobs").where({
        accountId: f.accountId,
        profile: "queue-new",
      })
    ).length,
    0,
    "settings do not fan out synchronously",
  );
  assert.equal(
    await new MemoryService(worker, "queue-tests", embedding).runJob(),
    false,
  );
  const task = await admin("background_tasks")
    .where({ kind: "model_backfill", status: "pending" })
    .first();
  for (let i = 0; i < 100; i++) {
    if (
      !(await runTask(
        worker,
        {
          model_backfill: async (claimed) => {
            await worker.raw("SELECT grove_backfill_batch(?::uuid,?::uuid,2)", [
              claimed.id,
              claimed.leaseId,
            ]);
          },
        },
        { id: task.id },
      ))
    )
      break;
  }
  assert.equal(
    (await admin("background_tasks").where({ id: task.id }).first()).status,
    "succeeded",
  );
  assert.equal(
    (
      await admin("jobs").where({
        accountId: f.accountId,
        profile: "queue-new",
      })
    ).length,
    7,
  );
  await api.raw("SELECT grove_reprocess(?,NULL,NULL)", ["queue-next"]);
  const older = await admin("background_tasks")
    .where({ kind: "model_backfill", status: "pending" })
    .first();
  await api.raw("SELECT grove_reprocess(?,NULL,NULL)", ["queue-final"]);
  assert.equal(
    (await admin("background_tasks").where({ id: older.id }).first()).status,
    "cancelled",
  );
});

test("large exports keep batches bounded while foreground reads remain available", async (t) => {
  const f = await fixture(),
    account = await admin("accounts").where({ id: f.accountId }).first();
  const principal = sessionPrincipal(f.accountId, account.clerkSubject),
    service = new MemoryService(api, "queue-tests");
  const content = "Synthetic export workload. ".repeat(220);
  for (let page = 0; page < 10; page++)
    await admin("memories").insert(
      Array.from({ length: 100 }, () => ({
        accountId: f.accountId,
        content,
        kind: "fact",
        source: {},
      })),
    );
  await admin.raw(
    "INSERT INTO memory_revisions(account_id,memory_id,version,content,source) SELECT account_id,id,version,content,source FROM memories WHERE account_id=?",
    [f.accountId],
  );
  const root = await mkdtemp("/tmp/opencode/grove-large-export-"),
    store = localArtifacts(root);
  let maxBatch = 0,
    peakRss = process.memoryUsage().rss;
  const handlers = exportHandlers(worker, {
    ...store,
    async write(key, data, signal) {
      if (Buffer.isBuffer(data)) {
        maxBatch = Math.max(maxBatch, data.length);
        assert(data.toString().trim().split("\n").length <= 100);
      }
      peakRss = Math.max(peakRss, process.memoryUsage().rss);
      await store.write(key, data, signal);
    },
  });
  const latency = async () => {
    const started = performance.now();
    await service.me(principal);
    return performance.now() - started;
  };
  const baseline = [];
  for (let i = 0; i < 10; i++) baseline.push(await latency());
  const tasks = new Tasks(service, true),
    task = await tasks.export(principal, {
      id: randomUUID(),
      includeDescendants: false,
    });
  const started = performance.now(),
    initialRss = process.memoryUsage().rss,
    underLoad = [];
  try {
    for (let i = 0; i < 40; i++) {
      const [worked, ms] = await Promise.all([
        runTask(worker, handlers, { id: task.id }),
        latency(),
      ]);
      underLoad.push(ms);
      if (!worked) break;
    }
    assert.equal((await tasks.get(principal, task.id)).processed, 2000);
    assert.equal((await tasks.get(principal, task.id)).downloadable, true);
    assert(maxBatch < 1024 * 1024);
    const p95 = (values: number[]) =>
      values.sort((a, b) => a - b)[Math.ceil(values.length * 0.95) - 1];
    t.diagnostic(
      JSON.stringify({
        notes: 1000,
        records: 2000,
        durationMs: Math.round(performance.now() - started),
        maxBatchBytes: maxBatch,
        peakRssGrowthBytes: peakRss - initialRss,
        baselineReadP95Ms: p95(baseline),
        concurrentReadP95Ms: p95(underLoad),
      }),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
