import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  createDatabase,
  tenant,
  camelRows,
  probeDatabase,
  type Knex,
} from "@lib/database";
import { migrations } from "../../lib/database/src/migrations.ts";
import {
  MemoryService,
  runTask,
  cleanupHandlers,
  scheduleCleanup,
} from "@lib/memory";
import { Authentication } from "../../packages/api/src/auth.ts";
import type { Principal } from "@lib/shared/contracts";
import { createApp } from "../../packages/api/src/app.ts";
import { createLaneExecutor } from "../../packages/api/src/worker-routing.ts";
import { JobBroker } from "../../packages/api/src/broker.ts";

const path = new URL("../../lib/memory/src/writing-jobs.ts", import.meta.url)
  .href;
test("writing tools require separate permission and durable encrypted single-sentence work", async (t) => {
  const writing = await import(path).catch(() => ({}));
  assert.equal(
    typeof writing.WritingTools,
    "function",
    "durable writing service must exist before AI tools can submit text",
  );
  const url = process.env.TEST_DATABASE_URL!;
  assert.ok(
    url && new URL(url).pathname.endsWith("_test"),
    "Use a disposable database",
  );
  const migrationUrl = process.env.TEST_MIGRATION_DATABASE_URL!;
  assert.ok(
    migrationUrl && new URL(migrationUrl).pathname.endsWith("_test"),
    "Use a disposable migration database",
  );
  const ownerDb = createDatabase(migrationUrl),
    database = `grove_writing_${randomUUID().replaceAll("-", "")}_test`;
  await ownerDb.raw("CREATE DATABASE ??", [database]);
  const target = (value: string) => {
    const url = new URL(value);
    url.pathname = `/${database}`;
    return url.href;
  };
  const migration = createDatabase(target(migrationUrl));
  const before = migrations.filter(
    (entry) => entry.name < "20261106_038_writing_tools",
  );
  const previousSource: Knex.MigrationSource<(typeof migrations)[number]> = {
    getMigrations: async () => before,
    getMigrationName: (entry) => entry.name,
    getMigration: async (entry) => entry,
  };
  await migration.migrate.latest({ migrationSource: previousSource });
  const previousRuntime = createDatabase(target(url));
  try {
    await assert.rejects(
      () => probeDatabase(previousRuntime),
      /writing|sentence_rewrites/i,
      "runtime readiness must reject the previous writing schema",
    );
  } catch (error) {
    await previousRuntime.destroy();
    await migration.destroy();
    await ownerDb.raw("DROP DATABASE ?? WITH (FORCE)", [database]);
    await ownerDb.destroy();
    throw error;
  } finally {
    await previousRuntime.destroy();
  }
  await migration.migrate.latest();
  await migration.destroy();
  const db = createDatabase(target(url)),
    worker = createDatabase(target(process.env.TEST_WORKER_DATABASE_URL!));
  const key = "31".repeat(32);
  let calls = 0;
  let gate: Promise<void> | undefined;
  const generation = {
    profile: "writing-fixture-v1",
    async generate<T>() {
      calls++;
      await gate;
      return {
        alternatives: ["I'm Elias.", "My name's Elias.", "I am Elias."],
      } as T;
    },
  };
  const service = new MemoryService(
    db,
    "writing-tools-test-cursor-secret-32-characters",
    undefined,
    { generation },
  );
  const auth = new Authentication(db, {
    async verify(token) {
      return { subject: token, type: "session" as const };
    },
  });
  const notice = "Synthetic provider; no live transmission.";
  const api = new writing.WritingTools(service, key, notice);
  const handlers = writing.writingHandlers(service, key, worker, notice);
  const owner = await auth.principal(
    new Request("http://localhost/v1/me", {
      headers: { authorization: `Bearer writing_${randomUUID()}` },
    }),
  );
  const makeClient = async (authorized = true) => {
    const clientId = randomUUID();
    const grant = {
      name: "Writing test",
      capabilities: ["memory:read"] as ["memory:read"],
      personal: true,
      allProjects: false,
      projectIds: [],
      writingEnabled: authorized,
    };
    const { connection } = await service.grant(owner, grant, { clientId });
    return {
      accountId: owner.accountId,
      subject: owner.subject,
      type: "oauth",
      clientId,
      connectionId: connection.id,
      issuedAt: Date.now(),
      capabilities: ["memory:read"],
    } as Principal;
  };
  const request = (tool = "concise") => ({
    id: randomUUID(),
    sessionId: randomUUID(),
    language: "en",
    tool,
    sentence: "My name is Elias.",
  });
  const policy = (await api.describe(await makeClient())).policy;
  try {
    await t.test(
      "cancellation before a delayed POST creates a tombstone rather than allowing late acceptance",
      async () => {
        const client = await makeClient();
        await api.consent(client, { policy, accepted: true });
        const input = request("rewrite");
        await api.cancel(client, input.id);
        await assert.rejects(() => api.request(client, input), /cancelled/i);
        assert.equal(calls, 0);
      },
    );
    await t.test(
      "memory permission alone is not rewrite authorization; consent is current and connection scoped",
      async () => {
        const client = await makeClient(false);
        assert.equal((await api.describe(client)).authorized, false);
        await assert.rejects(
          () => api.consent(client, { policy, accepted: true }),
          /Approve AI writing tools/,
        );
        await assert.rejects(
          () => api.request(client, request()),
          /Approve AI writing tools/,
        );
        assert.equal(calls, 0);
        const enabled = await makeClient();
        await assert.rejects(() => api.request(enabled, request()), /consent/i);
        await api.consent(enabled, { policy, accepted: true });
        assert.equal((await api.describe(enabled)).consented, true);
        assert.equal((await api.describe(await makeClient())).consented, false);
      },
    );
    await t.test(
      "acceptance commits encrypted staging and opaque work, replay does not regenerate",
      async () => {
        const client = await makeClient();
        await api.consent(client, { policy, accepted: true });
        const input = request();
        const queued = await api.request(client, input);
        assert.equal(queued.status, "queued");
        assert.equal(queued.result, null);
        assert.equal(calls, 0, "HTTP acceptance must not call a model");
        const row = await tenant(db, owner.accountId, (trx) =>
          trx("writing_requests").where({ id: input.id }).first(),
        );
        const task = await tenant(db, owner.accountId, (trx) =>
          trx("background_tasks").where({ id: input.id }).first(),
        );
        assert.ok(row.inputCiphertext);
        assert.ok(!JSON.stringify({ row, task }).includes(input.sentence));
        assert.deepEqual(task.payload, { writingId: input.id });
        await api.request(client, input);
        await assert.rejects(
          () => api.request(client, { ...input, tool: "verbose" }),
          /already used/i,
        );
        assert.equal(await runTask(worker, handlers, { id: input.id }), true);
        const complete = await api.get(client, input.id);
        assert.equal(complete.status, "completed");
        assert.equal(complete.result.tool, "concise");
        assert.equal(complete.result.alternatives.length, 3);
        const stored = await tenant(db, owner.accountId, (trx) =>
          trx("writing_requests").where({ id: input.id }).first(),
        );
        assert.equal(stored.inputCiphertext, null);
        assert.ok(stored.resultCiphertext);
        assert.ok(!JSON.stringify(stored).includes("Elias"));
        const before = calls;
        await api.request(client, input);
        assert.equal(await runTask(worker, handlers, { id: input.id }), false);
        assert.equal(calls, before);
        const other = await makeClient();
        await assert.rejects(() => api.get(other, input.id), /unavailable/i);
      },
    );
    await t.test(
      "disable during inference fences output and erases scratch; re-enable never restores it",
      async () => {
        const client = await makeClient();
        await api.consent(client, { policy, accepted: true });
        const input = request("humanize");
        await api.request(client, input);
        let release!: () => void;
        let started!: () => void;
        const entered = new Promise<void>((resolve) => {
          started = resolve;
        });
        gate = new Promise<void>((resolve) => {
          release = resolve;
        });
        const original = generation.generate;
        generation.generate = async <T>() => {
          started();
          return original<T>();
        };
        const running = runTask(worker, handlers, { id: input.id });
        await entered;
        await api.consent(client, { policy, accepted: false });
        release();
        await running;
        generation.generate = original;
        gate = undefined;
        await api.consent(client, { policy, accepted: true });
        const result = await api.get(client, input.id);
        assert.equal(result.status, "cancelled");
        assert.equal(result.result, null);
        const row = await tenant(db, owner.accountId, (trx) =>
          trx("writing_requests").where({ id: input.id }).first(),
        );
        assert.equal(row.inputCiphertext, null);
        assert.equal(row.resultCiphertext, null);
      },
    );
    await t.test(
      "expired or reclaimed provider attempts are never dispatched twice",
      async () => {
        const client = await makeClient();
        await api.consent(client, { policy, accepted: true });
        const input = request("verbose");
        await api.request(client, input);
        await tenant(db, owner.accountId, (trx) =>
          trx("writing_requests")
            .where({ id: input.id })
            .update({ status: "processing", providerStartedAt: trx.fn.now() }),
        );
        const before = calls;
        await runTask(worker, handlers, { id: input.id });
        assert.equal((await api.get(client, input.id)).status, "uncertain");
        assert.equal(calls, before);
        const expired = request();
        await api.request(client, expired);
        await tenant(db, owner.accountId, (trx) =>
          trx("writing_requests")
            .where({ id: expired.id })
            .update({ expiresAt: trx.raw("now()-interval '1 second'") }),
        );
        assert.equal((await api.get(client, expired.id)).status, "expired");
        const row = await tenant(db, owner.accountId, (trx) =>
          trx("writing_requests").where({ id: expired.id }).first(),
        );
        assert.equal(row.inputCiphertext, null);
        assert.equal(row.resultCiphertext, null);
      },
    );
    await t.test(
      "changed provider disclosure requires new consent; current non-owner RLS isolates staging",
      async () => {
        const client = await makeClient();
        await api.consent(client, { policy, accepted: true });
        const input = request();
        await api.request(client, input);
        const updated = new writing.WritingTools(
          service,
          key,
          "Different synthetic provider retention disclosure.",
        );
        assert.equal((await updated.describe(client)).consented, false);
        await assert.rejects(
          () => updated.request(client, request()),
          /consent/i,
        );
        const other = await auth.principal(
          new Request("http://localhost/v1/me", {
            headers: { authorization: `Bearer writing_other_${randomUUID()}` },
          }),
        );
        assert.equal(
          (
            await tenant(db, other.accountId, (trx) =>
              trx("writing_requests").where({ id: input.id }),
            )
          ).length,
          0,
        );
        await assert.rejects(
          () =>
            tenant(db, other.accountId, (trx) =>
              trx("writing_consents").insert({
                accountId: owner.accountId,
                connectionId: client.connectionId,
                version: 1,
                policy,
                profile: generation.profile,
                accepted: true,
              }),
            ),
          /row.level security/i,
        );
        await api.cancel(client, input.id);
      },
    );
    await t.test(
      "native OAuth HTTP requests acknowledge durable work, not model completion",
      async () => {
        const client = await makeClient();
        const app = createApp({
          memories: service,
          writingStagingKey: key,
          writingProviderNotice: notice,
          auth: {
            async principal(request) {
              return request.headers.get("Authorization") === "Bearer owner"
                ? owner
                : client;
            },
          },
          origin: "https://api.grove.example",
          siteUrl: "https://grove.example",
          issuer: "https://issuer.grove.example",
          webhookSecret: "fixture-only",
          ready: async () => {},
        });
        const call = (path: string, body?: unknown, token = "client") =>
          app.request(path, {
            method: body === undefined ? "GET" : "POST",
            headers: {
              Authorization: `Bearer ${token}`,
              Origin:
                token === "owner"
                  ? "https://grove.example"
                  : `chrome-extension://${"a".repeat(32)}`,
              "Content-Type": "application/json",
            },
            ...(body === undefined ? {} : { body: JSON.stringify(body) }),
          });
        const connect = await call("/v1/browser/connect", {});
        assert.equal(connect.status, 200);
        assert.equal((await connect.json()).data.writingTools.available, true);
        assert.equal(
          (
            await call("/v1/browser/writing/consent", {
              policy,
              accepted: true,
            })
          ).status,
          200,
        );
        const input = request("rewrite"),
          before = calls;
        const accepted = await call("/v1/browser/writing/requests", input);
        assert.equal(accepted.status, 202);
        assert.equal((await accepted.json()).data.status, "queued");
        assert.equal(calls, before);
        assert.equal(
          (await call("/v1/browser/writing/requests", request(), "owner"))
            .status,
          403,
          "owner session is not a substitute for connection-scoped AI authorization",
        );
        await runTask(worker, handlers, { id: input.id });
        const completed = await call(
          `/v1/browser/writing/requests/${input.id}`,
        );
        assert.equal(completed.status, 200);
        assert.equal(
          (await completed.json()).data.result.alternatives.length,
          3,
        );
        assert.equal(
          (await call(`/v1/browser/writing/requests/${input.id}/cancel`, {}))
            .status,
          200,
        );
      },
    );
    await t.test(
      "shutdown after provider dispatch erases staging without automatically retrying the effect",
      async () => {
        const client = await makeClient();
        await api.consent(client, { policy, accepted: true });
        const input = request();
        await api.request(client, input);
        let release!: () => void, entered!: () => void;
        const started = new Promise<void>((resolve) => {
          entered = resolve;
        });
        gate = new Promise<void>((resolve) => {
          release = resolve;
        });
        const original = generation.generate;
        generation.generate = async <T>() => {
          entered();
          return original<T>();
        };
        const abort = new AbortController();
        const running = runTask(worker, handlers, {
          id: input.id,
          signal: abort.signal,
        });
        await started;
        abort.abort();
        release();
        await running;
        generation.generate = original;
        gate = undefined;
        const row = await tenant(db, owner.accountId, (trx) =>
          trx("writing_requests").where({ id: input.id }).first(),
        );
        assert.equal(row.status, "uncertain");
        assert.equal(row.inputCiphertext, null);
        assert.equal(row.resultCiphertext, null);
        const before = calls;
        assert.equal(await runTask(worker, handlers, { id: input.id }), false);
        assert.equal(calls, before);
      },
    );
    await t.test(
      "confirmed broker publication and outage fallback share the same durable writing lease",
      { skip: !process.env.TEST_AMQP_URL, timeout: 30000 },
      async () => {
        const client = await makeClient();
        await api.consent(client, { policy, accepted: true });
        const input = request("rewrite");
        await api.request(client, input);
        const route = createLaneExecutor({
          memory: async () => false,
          email: async () => false,
          task: (lane, id) => runTask(worker, handlers, { lane, id }),
        });
        let complete!: () => void;
        let delivered = new Promise<void>((resolve) => {
          complete = resolve;
        });
        const broker = new JobBroker(
          process.env.TEST_AMQP_URL!,
          { enrichment: 1 },
          async (job, lane) => {
            await route(lane!, job.id, job.kind);
            complete();
          },
          false,
        );
        const claim = async (id: string) => {
          const rows = camelRows<{
            id: string;
            kind: "task";
            dispatchId: string;
          }>(
            await worker.raw(
              "SELECT * FROM grove_dispatch_claim('task','enrichment',?::text[],32)",
              [[]],
            ),
          );
          const work = rows.find((row) => row.id === id);
          assert.ok(
            work,
            "enrichment dispatch must include background writing tasks",
          );
          return work;
        };
        const before = calls;
        try {
          await broker.connect();
          const first = await claim(input.id);
          await broker.publish(
            { id: first.id, kind: first.kind },
            "enrichment",
          );
          await worker.raw(
            "SELECT grove_dispatch_finish('task',?::uuid,?::uuid,true)",
            [first.id, first.dispatchId],
          );
          await delivered;
          assert.equal((await api.get(client, input.id)).status, "completed");
          const offline = request();
          await api.request(client, offline);
          const second = await claim(offline.id);
          await broker.disconnect();
          await assert.rejects(
            () =>
              broker.publish(
                { id: second.id, kind: second.kind },
                "enrichment",
              ),
            /unavailable/,
          );
          await worker.raw(
            "SELECT grove_dispatch_finish('task',?::uuid,?::uuid,false)",
            [second.id, second.dispatchId],
          );
          assert.equal(
            await route("enrichment", offline.id),
            true,
            "database fallback must execute writing tasks while the broker is down",
          );
          assert.equal((await api.get(client, offline.id)).status, "completed");
          delivered = new Promise<void>((resolve) => {
            complete = resolve;
          });
          await broker.connect();
          await broker.publish({ id: input.id, kind: "task" }, "enrichment");
          await delivered;
          assert.equal(
            calls,
            before + 2,
            "duplicate broker delivery cannot regenerate a completed request",
          );
        } finally {
          await broker.close();
        }
      },
    );
    await t.test(
      "writing and memory work share the existing cross-replica provider limit",
      async () => {
        const client = await makeClient();
        await api.consent(client, { policy, accepted: true });
        const input = request();
        await api.request(client, input);
        const jobId = randomUUID();
        try {
          await tenant(db, owner.accountId, (trx) =>
            trx("jobs").insert({
              id: jobId,
              accountId: owner.accountId,
              kind: "brief",
              target: jobId,
              profile: generation.profile,
              scope: "{}",
              leaseId: randomUUID(),
              leaseUntil: trx.raw("now()+interval '120 seconds'"),
            }),
          );
          const options = {
            id: input.id,
            lane: "enrichment" as const,
            accountLimit: 2,
            providerLimit: 1,
          };
          assert.equal(
            await runTask(worker, handlers, options),
            false,
            "writing must not expand a provider lane that memory work already filled",
          );
          await tenant(db, owner.accountId, async (trx) => {
            await trx("jobs")
              .where({ id: jobId })
              .update({ leaseId: null, leaseUntil: null });
            await trx("background_tasks")
              .where({ id: input.id })
              .update({
                status: "running",
                leaseId: randomUUID(),
                leaseUntil: trx.raw("now()+interval '120 seconds'"),
              });
          });
          const claimed = camelRows(
            await worker.raw(
              "SELECT * FROM grove_claim_processing(?::text[],?::uuid,'enrichment',2,1)",
              [[generation.profile], jobId],
            ),
          );
          assert.equal(
            claimed.length,
            0,
            "memory work must also respect a writing reservation in the same provider lane",
          );
        } finally {
          await api.cancel(client, input.id);
          await tenant(db, owner.accountId, (trx) =>
            trx("jobs").where({ id: jobId }).delete(),
          );
        }
      },
    );
    await t.test(
      "status reflects persisted retry and expired-lease recovery instead of claiming queued success",
      async () => {
        const client = await makeClient();
        await api.consent(client, { policy, accepted: true });
        const input = request();
        await api.request(client, input);
        await tenant(db, owner.accountId, (trx) =>
          trx("background_tasks")
            .where({ id: input.id })
            .update({
              dueAt: trx.raw("now()+interval '1 minute'"),
              failures: 1,
            }),
        );
        assert.equal((await api.get(client, input.id)).status, "backoff");
        await tenant(db, owner.accountId, (trx) =>
          trx("background_tasks")
            .where({ id: input.id })
            .update({
              status: "running",
              dueAt: trx.fn.now(),
              leaseId: randomUUID(),
              leaseUntil: trx.raw("now()-interval '1 second'"),
            }),
        );
        assert.equal((await api.get(client, input.id)).status, "recovering");
        await api.cancel(client, input.id);
      },
    );
    await t.test(
      "expired writing scratch schedules cleanup without another user request",
      async () => {
        const client = await makeClient();
        await api.consent(client, { policy, accepted: true });
        const input = request();
        await api.request(client, input);
        await tenant(db, owner.accountId, (trx) =>
          trx("writing_requests")
            .where({ id: input.id })
            .update({ expiresAt: trx.raw("now()-interval '1 second'") }),
        );
        await scheduleCleanup(worker);
        const cleanup = await tenant(db, owner.accountId, (trx) =>
          trx("background_tasks")
            .where({ kind: "retention_cleanup", status: "pending" })
            .first(),
        );
        assert.ok(
          cleanup,
          "expired writing scratch alone must schedule the existing retention worker",
        );
        assert.equal(
          await runTask(
            worker,
            cleanupHandlers(worker, async () => {}),
            { id: cleanup.id },
          ),
          true,
        );
        const row = await tenant(db, owner.accountId, (trx) =>
          trx("writing_requests").where({ id: input.id }).first(),
        );
        assert.equal(row.status, "expired");
        assert.equal(row.inputCiphertext, null);
        assert.equal(row.resultCiphertext, null);
      },
    );
  } finally {
    await db.destroy();
    await worker.destroy();
    await ownerDb.raw("DROP DATABASE ?? WITH (FORCE)", [database]);
    await ownerDb.destroy();
  }
});
