import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { MemoryService, sessionPrincipal } from "@lib/memory";
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
  for (let i = 0; i < 5; i++)
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
