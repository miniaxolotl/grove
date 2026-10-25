import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createDatabase, tenant, type Knex } from "@lib/database";
import { InferenceError, type Embedder } from "@lib/ai";
import { queryEmbedding } from "../../lib/memory/src/processing.ts";
import { cachedWork } from "../../lib/memory/src/ai-cache.ts";
import { withTelemetry, type TelemetrySink } from "@lib/telemetry/context";
import {
  MemoryService,
  sessionPrincipal,
  cleanupHandlers,
  runTask,
} from "@lib/memory";
import {
  configureBillingQuotas,
  resourceUsage,
} from "../../lib/memory/src/billing-quotas.ts";
import { resourceLimits } from "@lib/shared/billing";
import { recallSchema } from "@lib/shared/contracts";
import { resetModelData } from "../../scripts/database/models.ts";

const ownerUrl = process.env.TEST_MIGRATION_DATABASE_URL!;
assert(
  ownerUrl && new URL(ownerUrl).pathname.endsWith("_test"),
  "Use a disposable test database",
);
const owner = createDatabase(ownerUrl);
const database = `grove_cache_${randomUUID().replaceAll("-", "")}_test`;
let db: Knex, worker: Knex, admin: Knex;
before(async () => {
  await owner.raw("CREATE DATABASE ??", [database]);
  const target = (value: string) => {
    const uri = new URL(value);
    uri.pathname = `/${database}`;
    return uri.href;
  };
  admin = createDatabase(target(ownerUrl));
  await admin.migrate.latest();
  db = createDatabase(target(process.env.TEST_DATABASE_URL!));
  worker = createDatabase(target(process.env.TEST_WORKER_DATABASE_URL!));
});
after(async () => {
  await Promise.all([db?.destroy(), worker?.destroy(), admin?.destroy()]);
  await owner.raw("DROP DATABASE ?? WITH (FORCE)", [database]);
  await owner.destroy();
});
async function fixture() {
  const { rows } = await db.raw("SELECT * FROM grove_account(?)", [
    randomUUID(),
  ]);
  let calls = 0;
  const embedder: Embedder = {
    profile: `embedding-${randomUUID()}`,
    model: "synthetic",
    dimensions: 3,
    async embed(_text, _purpose, options) {
      calls++;
      options?.onUsage?.({ inputTokens: 12, outputTokens: 0 });
      return [1, 0, 0];
    },
  };
  return { accountId: rows[0].id as string, embedder, calls: () => calls };
}

test("query reuse skips paid dispatch and inference reservation across API/worker replicas", async () => {
  const f = await fixture();
  assert.deepEqual(
    await queryEmbedding(db, f.accountId, f.embedder, "garden", 1),
    [1, 0, 0],
  );
  assert.deepEqual(
    await queryEmbedding(worker, f.accountId, f.embedder, "garden", 1),
    [1, 0, 0],
  );
  assert.equal(f.calls(), 1);
  const usage = await tenant(db, f.accountId, (trx) =>
    trx("inference_usage").first(),
  );
  assert.equal(usage.requests, 1);
  assert.equal(Number(usage.inputTokens), 12);
});

test("concurrent exact queries coalesce across database connections", async () => {
  const f = await fixture();
  await Promise.all(
    Array.from({ length: 6 }, (_, i) =>
      queryEmbedding(i % 2 ? worker : db, f.accountId, f.embedder, "same", 20),
    ),
  );
  assert.equal(f.calls(), 1);
});

test("exact cache does not merge different case, accounts, profiles or model settings", async () => {
  const f = await fixture(),
    other = await fixture();
  for (const [accountId, embedder, text] of [
    [f.accountId, f.embedder, "garden"],
    [f.accountId, f.embedder, "Garden"],
    [other.accountId, f.embedder, "garden"],
    [f.accountId, { ...f.embedder, profile: "new-profile" }, "garden"],
    [f.accountId, { ...f.embedder, model: "new-model" }, "garden"],
  ] as const)
    await queryEmbedding(db, accountId, embedder, text, 20);
  assert.equal(f.calls(), 5);
});

test("invalid query vectors are rejected rather than served or stored", async () => {
  const f = await fixture();
  f.embedder.embed = async () => [0, 0, 0];
  await assert.rejects(
    queryEmbedding(db, f.accountId, f.embedder, "bad", 20),
    (error) =>
      error instanceof InferenceError &&
      error.code === "embedding_profile_mismatch",
  );
});

test("expiry and corrupt cached vectors cause a fresh paid dispatch", async () => {
  const f = await fixture();
  await queryEmbedding(db, f.accountId, f.embedder, "garden", 20);
  await admin("ai_cache")
    .where({ accountId: f.accountId })
    .update({ expiresAt: admin.raw("now()-interval '1 second'") });
  await queryEmbedding(worker, f.accountId, f.embedder, "garden", 20);
  assert.equal(f.calls(), 2);
  await admin("ai_cache")
    .where({ accountId: f.accountId })
    .update({ value: "[0,0,0]" });
  await queryEmbedding(db, f.accountId, f.embedder, "garden", 20);
  assert.equal(f.calls(), 3);
});

test("non-owner RLS denies cross-account cache reads and writes", async () => {
  const f = await fixture(),
    other = await fixture();
  await queryEmbedding(db, f.accountId, f.embedder, "private query", 20);
  assert.deepEqual(
    await tenant(worker, other.accountId, (trx) =>
      trx("ai_cache").where({ accountId: f.accountId }),
    ),
    [],
  );
  const row = await admin("ai_cache").where({ accountId: f.accountId }).first();
  await assert.rejects(
    tenant(worker, other.accountId, (trx) =>
      trx("ai_cache").insert({
        ...row,
        value: JSON.stringify(row.value),
        key: "f".repeat(64),
      }),
    ),
    /row-level security/,
  );
});

test("cancelled followers leave the shared owner running", async () => {
  const f = await fixture();
  let release!: () => void, entered!: () => void;
  const hold = new Promise<void>((done) => {
    release = done;
  });
  const started = new Promise<void>((done) => {
    entered = done;
  });
  let calls = 0;
  const work = () => {
    calls++;
    entered();
    return hold.then(() => "result");
  };
  const options = {
    ttlMs: 60_000,
    validate: (value: unknown) => String(value),
    run: work,
  };
  const first = cachedWork(db, f.accountId, "answer", "held", options);
  await started;
  const controller = new AbortController();
  const follower = cachedWork(worker, f.accountId, "answer", "held", {
    ...options,
    signal: controller.signal,
  });
  controller.abort();
  await assert.rejects(follower);
  release();
  assert.equal((await first).value, "result");
  assert.equal(calls, 1);
  assert.equal(
    (await cachedWork(worker, f.accountId, "answer", "held", options)).status,
    "cached",
  );
});

test("expired owners cannot publish after a new replica takes ownership", async () => {
  const f = await fixture();
  let release!: () => void, entered!: () => void;
  const hold = new Promise<void>((done) => {
    release = done;
  });
  const started = new Promise<void>((done) => {
    entered = done;
  });
  const options = {
    ttlMs: 60_000,
    validate: (value: unknown) => String(value),
  };
  const first = cachedWork(db, f.accountId, "answer", "fenced", {
    ...options,
    run: async () => {
      entered();
      await hold;
      return "old";
    },
  });
  // Attach rejection handling before the deliberately stale owner is released.
  const rejected = assert.rejects(
    first,
    (error) =>
      error instanceof InferenceError && error.code === "cache_lease_lost",
  );
  await started;
  await admin("ai_cache")
    .where({ accountId: f.accountId })
    .update({
      leaseUntil: admin.raw("now()-interval '1 second'"),
      expiresAt: admin.raw("now()-interval '1 second'"),
    });
  assert.equal(
    (
      await cachedWork(worker, f.accountId, "answer", "fenced", {
        ...options,
        run: async () => "new",
      })
    ).value,
    "new",
  );
  release();
  await rejected;
  assert.equal(
    (
      await cachedWork(db, f.accountId, "answer", "fenced", {
        ...options,
        run: async () => "wrong",
      })
    ).value,
    "new",
  );
});

test("failed provider work remains retryable and is never a successful cache entry", async () => {
  const f = await fixture();
  const options = {
    ttlMs: 60_000,
    validate: (value: unknown) => String(value),
  };
  await assert.rejects(
    cachedWork(db, f.accountId, "answer", "failed", {
      ...options,
      run: async () => {
        throw new Error("synthetic outage");
      },
    }),
  );
  assert.equal(
    (
      await cachedWork(worker, f.accountId, "answer", "failed", {
        ...options,
        run: async () => "recovered",
      })
    ).status,
    "fresh",
  );
});

test("cache reuse emits content-free hit and avoided-request metrics", async () => {
  const f = await fixture();
  const events: { event: string; properties: unknown }[] = [];
  const sink: TelemetrySink = {
    capture: (event, properties) => {
      events.push({ event, properties });
    },
    operation() {},
  };
  await withTelemetry(sink, async () => {
    await queryEmbedding(
      db,
      f.accountId,
      f.embedder,
      "private canary query",
      20,
    );
    await queryEmbedding(
      worker,
      f.accountId,
      f.embedder,
      "private canary query",
      20,
    );
  });
  const cache = events.filter((event) => event.event === "ai_cache");
  assert.equal(cache.length, 2);
  assert.deepEqual(
    cache.map(
      (event) => (event.properties as { cache_status: string }).cache_status,
    ),
    ["fresh", "cached"],
  );
  assert.equal(
    (cache[1].properties as { requests_avoided: number }).requests_avoided,
    1,
  );
  assert(!JSON.stringify(events).includes("private canary"));
  assert(!JSON.stringify(events).includes(f.accountId));
});

test("cache data is purged by the account's durable deletion task", async () => {
  const f = await fixture();
  await queryEmbedding(db, f.accountId, f.embedder, "private query", 20);
  const account = await admin("accounts").where({ id: f.accountId }).first();
  const service = new MemoryService(db, "cache-tests");
  await service.deleteAccount(
    sessionPrincipal(f.accountId, account.clerkSubject),
  );
  await assert.rejects(
    queryEmbedding(db, f.accountId, f.embedder, "private query", 20),
    { code: "account_unavailable" },
  );
  const task = await admin("background_tasks")
    .where({ accountId: f.accountId, kind: "account_cleanup" })
    .first();
  for (let i = 0; i < 25; i++)
    await runTask(
      worker,
      cleanupHandlers(worker, async () => {}),
      { id: task.id, lane: "maintenance" },
    );
  assert.equal(
    (await admin("accounts").where({ id: f.accountId }).first()).status,
    "deleted",
  );
  assert.deepEqual(
    await admin("ai_cache").where({ accountId: f.accountId }),
    [],
  );
});

test("cache entries cannot survive a processing-generation cutover", async () => {
  const f = await fixture();
  await queryEmbedding(db, f.accountId, f.embedder, "garden", 20);
  await admin("processing_control").increment("epoch", 1);
  await queryEmbedding(worker, f.accountId, f.embedder, "garden", 20);
  assert.equal(f.calls(), 2);
});

test("fully cached recalls use one fifth of their own allowance without pooling or extra provider calls", async () => {
  const f = await fixture();
  configureBillingQuotas(db, {
    enabled: async () => true,
    priceIds: [],
    resourceLimits: {
      free: { ...resourceLimits.free, recall: 2 },
      pro: resourceLimits.pro,
    },
  });
  const account = await admin("accounts").where({ id: f.accountId }).first();
  const principal = sessionPrincipal(f.accountId, account.clerkSubject);
  const service = new MemoryService(db, "cache-tests", f.embedder);
  const input = recallSchema.parse({ query: "garden" });
  for (let i = 0; i < 6; i++) await service.recall(principal, input);
  const usage = await tenant(db, f.accountId, (trx) =>
    resourceUsage(db, trx, f.accountId),
  );
  assert.equal(usage!.metrics.recall.used, 2);
  assert.equal(usage!.metrics.ask.used, 0);
  assert.equal(usage!.metrics.recall.limit, 2);
  assert.equal(f.calls(), 1);
  await assert.rejects(service.recall(principal, input), {
    code: "usage_limit",
    resource: "recall",
  });
});

test("one fifth remaining admits cache hits but cannot dispatch fresh paid work", async () => {
  const f = await fixture();
  configureBillingQuotas(db, {
    enabled: async () => true,
    priceIds: [],
    resourceLimits: {
      free: { ...resourceLimits.free, recall: 2 },
      pro: resourceLimits.pro,
    },
  });
  const account = await admin("accounts").where({ id: f.accountId }).first();
  const principal = sessionPrincipal(f.accountId, account.clerkSubject);
  const service = new MemoryService(db, "cache-tests", f.embedder);
  const input = recallSchema.parse({ query: "garden" });
  for (let i = 0; i < 5; i++) await service.recall(principal, input);
  // The last0.2 is not enough to upgrade a cache miss into a paid provider call.
  await assert.rejects(
    service.recall(principal, recallSchema.parse({ query: "new topic" })),
    { code: "usage_limit" },
  );
  assert.equal(f.calls(), 1);
  await service.recall(principal, input);
  const usage = await tenant(db, f.accountId, (trx) =>
    resourceUsage(db, trx, f.accountId),
  );
  assert.equal(usage!.metrics.recall.used, 2);
  assert.deepEqual(usage!.metrics.recall.cache, { cached: 5, fresh: 1 });
});

test("provider outage cooldown prevents different paid queries while valid cached work stays available", async () => {
  const f = await fixture();
  await queryEmbedding(db, f.accountId, f.embedder, "warm", 20);
  let failedCalls = 0;
  f.embedder.embed = async () => {
    failedCalls++;
    throw new InferenceError("provider_unavailable");
  };
  await assert.rejects(
    queryEmbedding(db, f.accountId, f.embedder, "outage", 20),
    { code: "provider_unavailable" },
  );
  await assert.rejects(
    queryEmbedding(worker, f.accountId, f.embedder, "different query", 20),
    { code: "provider_cooling_down" },
  );
  assert.equal(failedCalls, 1);
  assert.deepEqual(
    await queryEmbedding(worker, f.accountId, f.embedder, "warm", 20),
    [1, 0, 0],
  );
});

test("explicit model reset clears derived caches and fences old cache generations", async () => {
  const f = await fixture();
  await queryEmbedding(db, f.accountId, f.embedder, "garden", 20);
  await resetModelData(admin);
  assert.deepEqual(await admin("ai_cache"), []);
  assert.deepEqual(await admin("ai_provider_backoff"), []);
  await queryEmbedding(worker, f.accountId, f.embedder, "garden", 20);
  assert.equal(f.calls(), 2);
});
