import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createDatabase, tenant, type Knex } from "@lib/database";
import * as billing from "@lib/shared/billing";
import * as quotas from "../../lib/memory/src/billing-quotas.ts";
import { MemoryService } from "@lib/memory";
import { rememberSchema, recallSchema } from "@lib/shared/contracts";
import {
  conversationCreateSchema,
  conversationTurnSchema,
  conversationPlanSchema,
} from "@lib/shared/conversations";
import { runProcessingJob } from "../../lib/memory/src/processing.ts";
import { budgetedInference } from "../../lib/memory/src/processing.ts";
import { readServerEnvironment } from "@lib/environment";
import { Billing } from "../../packages/api/src/billing.ts";
import Stripe from "stripe";
import { createApp } from "../../packages/api/src/app.ts";

const authorityUrl = process.env.TEST_MIGRATION_DATABASE_URL!;
if (!authorityUrl || !new URL(authorityUrl).pathname.endsWith("_test"))
  throw new Error("Use a disposable test database");
const authority = createDatabase(authorityUrl);
const name = `grove_actions_${randomUUID().replaceAll("-", "")}_test`;
let db: Knex, worker: Knex, admin: Knex;
before(async () => {
  await authority.raw("CREATE DATABASE ??", [name]);
  const target = (url: string) => {
    const parsed = new URL(url);
    parsed.pathname = `/${name}`;
    return parsed.href;
  };
  admin = createDatabase(target(authorityUrl));
  await admin.migrate.latest();
  db = createDatabase(target(process.env.TEST_DATABASE_URL!));
  worker = createDatabase(target(process.env.TEST_WORKER_DATABASE_URL!));
});
after(async () => {
  await db?.destroy();
  await worker?.destroy();
  await admin?.destroy();
  await authority.raw("DROP DATABASE IF EXISTS ??", [name]);
  await authority.destroy();
});

const service = () =>
  new MemoryService(db, "action-fixture-secret-32-characters");
async function account(plan: "free" | "pro" = "free") {
  const id = randomUUID();
  await admin("accounts").insert({ id, clerkSubject: `actions_${id}` });
  await tenant(db, id, async (trx) => {
    if (plan === "pro") {
      await trx("billing_customers").insert({
        accountId: id,
        customerId: `cus_${id}`,
      });
      await trx("billing_subscriptions").insert({
        id: `sub_${id}`,
        accountId: id,
        customerId: `cus_${id}`,
        priceId: "price_pro",
        status: "active",
        periodEnd: new Date(Date.now() + 86400000),
      });
    }
  });
  return {
    accountId: id,
    type: "session" as const,
    subject: `actions_${id}`,
    capabilities: ["memory:read", "memory:write", "memory:delete"] as (
      | "memory:read"
      | "memory:write"
      | "memory:delete"
    )[],
  };
}
function configure(enabled = true, monthly = 2) {
  const limits = Reflect.get(billing, "resourceLimits");
  assert(limits, "separate user-action policies must exist");
  for (const database of [db, worker])
    quotas.configureBillingQuotas(database, {
      enabled: async () => enabled,
      priceIds: ["price_pro"],
      resourceLimits: {
        free: {
          ...limits.free,
          recall: monthly,
          ask: monthly,
          organization: monthly,
          assistance: monthly,
        },
        pro: {
          ...limits.pro,
          recall: monthly * 5,
          ask: monthly * 5,
          organization: monthly * 5,
          assistance: monthly * 5,
        },
      },
    });
}

test("account-wide generation slots cover API and worker, release on failure and isolate tenants", async () => {
  configure();
  const a = await account(),
    b = await account();
  assert.equal(typeof Reflect.get(quotas, "withGenerationSlot"), "function");
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let started = 0;
  let both!: () => void;
  const entered = new Promise<void>((resolve) => {
    both = resolve;
  });
  const run = async () => {
    if (++started === 2) both();
    await held;
  };
  const running = [
    quotas.withGenerationSlot(db, a.accountId, run),
    quotas.withGenerationSlot(worker, a.accountId, run),
  ];
  try {
    await entered;
    await assert.rejects(
      quotas.withGenerationSlot(worker, a.accountId, async () => true),
      { code: "ai_busy" },
    );
    await quotas.withGenerationSlot(db, b.accountId, async () => true);
  } finally {
    release();
    await Promise.all(running);
  }
  await assert.rejects(
    quotas.withGenerationSlot(db, a.accountId, async () => {
      throw new Error("synthetic");
    }),
    /synthetic/,
  );
  await quotas.withGenerationSlot(worker, a.accountId, async () => true);
  assert.equal(
    (await admin("ai_operation_leases").where({ accountId: a.accountId }))
      .length,
    0,
  );
});

test("tier storage checks cover nested notebook creation, archive and retained soft deletion", async () => {
  configure();
  const limits = Reflect.get(billing, "resourceLimits");
  quotas.configureBillingQuotas(db, {
    enabled: async () => true,
    priceIds: ["price_pro"],
    resourceLimits: {
      free: { ...limits.free, notes: 1, notebooks: 1 },
      pro: { ...limits.pro, notes: 5, notebooks: 5 },
    },
  });
  const p = await account(),
    s = service();
  const project = await s.createNotebook(p, {
    operationId: randomUUID(),
    name: "First",
  });
  await assert.rejects(
    s.createNotebook(p, { operationId: randomUUID(), name: "Second" }),
    { code: "usage_limit" },
  );
  const note = await s.remember(
    p,
    rememberSchema.parse({
      operationId: randomUUID(),
      content: "Retained first",
    }),
  );
  await assert.rejects(
    s.remember(
      p,
      rememberSchema.parse({ operationId: randomUUID(), content: "Over cap" }),
    ),
    { code: "usage_limit" },
  );
  const archived = await s.lifecycle(p, note.id, "archive", {
    operationId: randomUUID(),
    expectedVersion: note.version,
  });
  await assert.rejects(
    s.remember(
      p,
      rememberSchema.parse({
        operationId: randomUUID(),
        content: "Still over cap",
      }),
    ),
    { code: "usage_limit" },
  );
  await s.forget(p, {
    operationId: randomUUID(),
    items: [{ id: archived.id, expectedVersion: archived.version }],
  });
  await s.remember(
    p,
    rememberSchema.parse({ operationId: randomUUID(), content: "Replacement" }),
  );
  const retained = await tenant(admin, p.accountId, (trx) =>
    trx("memories").where({ id: note.id }).first(),
  );
  assert.equal(retained.content, "Retained first");
  assert(
    retained.deletedAt,
    "owner inspection proves authored data remains retained",
  );
  assert.equal(
    await tenant(db, p.accountId, (trx) =>
      trx("memories").where({ id: note.id }).first(),
    ),
    undefined,
  );
  assert(project.id);
});
async function reserve(
  database: Knex,
  accountId: string,
  operation = randomUUID(),
) {
  assert.equal(typeof Reflect.get(quotas, "reserveAction"), "function");
  return tenant(database, accountId, (trx) =>
    quotas.reserveAction(database, trx, accountId, "ask", operation),
  );
}

test("Free/Pro resource defaults are user actions, not provider requests", () => {
  assert.deepEqual(Reflect.get(billing, "resourceLimits"), {
    free: {
      notes: 10000,
      notebooks: 100,
      recall: 30000,
      ask: 300,
      organization: 1000,
      assistance: 50,
      concurrency: 2,
    },
    pro: {
      notes: 50000,
      notebooks: 500,
      recall: 150000,
      ask: 1500,
      organization: 5000,
      assistance: 250,
      concurrency: 2,
    },
  });
  assert.equal(billing.billingLimits.free.generation.monthly, 31000);
  assert.equal(billing.billingLimits.pro.generation.monthly, 155000);
});

test("resource configuration defaults and explicit zero overrides are independent of provider budgets", () => {
  const env = {
    DATABASE_URL: "postgresql://localhost/grove_test",
    API_ORIGIN: "https://api.example",
    SITE_URL: "https://site.example",
    CLERK_PUBLISHABLE_KEY: "pk_fixture",
    CLERK_SECRET_KEY: "sk_fixture",
    CLERK_ISSUER: "https://clerk.example",
    CLERK_WEBHOOK_SIGNING_SECRET: "fixture",
    CURSOR_SECRET: "billing-fixture-cursor-secret-32-characters",
  };
  const defaults = readServerEnvironment(env);
  assert.equal(Reflect.get(defaults, "BILLING_FREE_ASK_MONTHLY"), 300);
  assert.equal(Reflect.get(defaults, "BILLING_PRO_NOTES"), 50000);
  assert.equal(
    Reflect.get(
      readServerEnvironment({ ...env, BILLING_FREE_ASK_MONTHLY: "0" }),
      "BILLING_FREE_ASK_MONTHLY",
    ),
    0,
  );
  assert.equal(defaults.BILLING_FREE_GENERATION_MONTHLY, 31000);
});

test("existing owner-only Billing API exposes resource usage and Pro disclosure", async () => {
  configure();
  const p = await account();
  const endpoint = new Billing(service(), {
    stripe: new Stripe("sk_test_fixture"),
    webhookSecret: "whsec_fixture",
    siteUrl: "https://site.example",
    prices: {},
    enabled: async () => true,
  });
  const status = await endpoint.status(p);
  assert.equal(status.resources?.metrics.notes.limit, 10000);
  assert.equal(status.resources?.metrics.ask.limit, 2);
  assert.equal(status.proResources?.ask, 1500);
});

test("HTTP monthly exhaustion reports its actual reset, not a one-minute retry", async () => {
  configure(true, 0);
  const p = await account();
  const app = createApp({
    memories: service(),
    auth: { principal: async () => p },
    origin: "https://api.example",
    siteUrl: "https://site.example",
    issuer: "https://clerk.example",
    webhookSecret: "fixture",
    ready: async () => {},
  });
  const response = await app.request("https://api.example/v1/recall", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
  assert.equal(response.status, 429);
  const data = await response.json();
  assert.equal(data.error.resource, "recall");
  assert(data.error.resetAt);
  assert(Number(response.headers.get("retry-after")) > 60);
});

for (const plan of ["free", "pro"] as const) {
  test(`${plan} action reservations serialize across API and worker at the last slot`, async () => {
    configure();
    const p = await account(plan);
    const limit = plan === "free" ? 2 : 10;
    for (let i = 0; i < limit - 1; i++) await reserve(db, p.accountId);
    const results = await Promise.allSettled(
      Array.from({ length: 6 }, (_, i) =>
        reserve(i % 2 ? db : worker, p.accountId),
      ),
    );
    assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
    for (const result of results)
      if (result.status === "rejected")
        assert.equal(result.reason.code, "usage_limit");
  });
}

test("retry IDs deduplicate reservations; release and original-period settlement preserve usage", async () => {
  configure();
  const p = await account();
  const id = randomUUID();
  const first = await reserve(db, p.accountId, id);
  const retry = await reserve(worker, p.accountId, id);
  assert(first && retry);
  assert.equal(first.id, retry.id);
  await tenant(db, p.accountId, (trx) =>
    quotas.settleAction(trx, first, "completed"),
  );
  const pending = await reserve(db, p.accountId);
  await tenant(db, p.accountId, (trx) =>
    quotas.settleAction(trx, pending, "released"),
  );
  await reserve(db, p.accountId);
  await assert.rejects(reserve(db, p.accountId), { code: "usage_limit" });
  // Completion must never move a reservation into today's month.
  await admin("action_usage")
    .where({ id: first.id })
    .update({ period: "2000-01-01" });
  await tenant(db, p.accountId, (trx) =>
    quotas.settleAction(trx, first, "completed"),
  );
  assert.equal(
    (await admin("action_usage").where({ id: first.id }).first()).period
      .toISOString()
      .slice(0, 10),
    "2000-01-01",
  );
  await reserve(db, p.accountId);
});

test("expired pending actions recover capacity without deleting completed usage", async () => {
  configure();
  const p = await account();
  const completed = await reserve(db, p.accountId);
  await tenant(db, p.accountId, (trx) =>
    quotas.settleAction(trx, completed, "completed"),
  );
  const abandoned = await reserve(db, p.accountId);
  assert(abandoned);
  await admin("action_usage")
    .where({ id: abandoned.id })
    .update({ leaseUntil: new Date(0) });
  await reserve(worker, p.accountId);
  await assert.rejects(reserve(db, p.accountId), { code: "usage_limit" });
  assert.equal(
    await tenant(db, p.accountId, (trx) =>
      trx("action_usage").where({ status: "completed" }).count().first(),
    ).then((r) => Number(r!.count)),
    1,
  );
});

test("tenant isolation, flag-off and self-hosted behavior remain independent", async () => {
  configure();
  const a = await account(),
    b = await account();
  await reserve(db, a.accountId);
  await reserve(db, a.accountId);
  await reserve(worker, b.accountId);
  assert.equal(
    (
      await tenant(db, b.accountId, (trx) =>
        trx("action_usage").where({ accountId: a.accountId }),
      )
    ).length,
    0,
  );
  configure(false);
  assert.equal(await reserve(db, a.accountId), null);
});

test("ordinary recall is metered once; reading and keyword-only listing remain available", async () => {
  configure(true, 1);
  const p = await account();
  const s = service();
  const note = await s.remember(
    p,
    rememberSchema.parse({
      operationId: randomUUID(),
      content: "A synthetic memory about strawberries.",
    }),
  );
  await s.recall(p, recallSchema.parse({}));
  await assert.rejects(s.recall(p, recallSchema.parse({})), {
    code: "usage_limit",
  });
  assert.equal((await s.get(p, note.id)).content, note.content);
  assert(
    (
      await s.list(p, {
        status: "active",
        limit: 30,
        query: "strawberries",
        searchMode: "lexical",
      })
    ).items.some((n) => n.id === note.id),
  );
  assert((await s.exportPage(p)).some((n) => n.id === note.id));
});

test("a conversation turn charges one reply, not its planner, internal recall or retry", async () => {
  configure(true, 1);
  const p = await account();
  let calls = 0;
  const s = new MemoryService(
    db,
    "action-fixture-secret-32-characters",
    undefined,
    {
      generation: {
        profile: "actions-chat",
        generate: async (schema) => {
          calls++;
          return schema.parse(
            Object.is(schema, conversationPlanSchema)
              ? {
                  query: "hello",
                  intent: "answer",
                  references: [],
                  research: [],
                  organizeAfter: null,
                }
              : {
                  message: "Hello!",
                  statements: [],
                  webStatements: [],
                  proposals: [],
                  organization: [],
                  lifecycle: [],
                },
          );
        },
      },
    },
  );
  const conversation = await s.conversations.create(
    p,
    conversationCreateSchema.parse({ id: randomUUID() }),
  );
  const input = conversationTurnSchema.parse({
    id: randomUUID(),
    query: "Hello",
    expectedVersion: 0,
  });
  await s.conversations.turn(p, conversation.id, input);
  await s.conversations.turn(p, conversation.id, input);
  assert.equal(calls, 2);
  const usage = await tenant(db, p.accountId, (trx) =>
    quotas.resourceUsage(db, trx, p.accountId),
  );
  assert.equal(usage!.metrics.ask.used, 1);
  assert.equal(usage!.metrics.recall.used, 0);
  await assert.rejects(
    s.conversations.turn(
      p,
      conversation.id,
      conversationTurnSchema.parse({
        id: randomUUID(),
        query: "Again",
        expectedVersion: 1,
      }),
    ),
    { code: "usage_limit" },
  );
});

test("assistance reserves one result across request replays and worker fragments", async () => {
  configure(true, 1);
  const p = await account();
  const generation = {
    profile: "actions-assistance",
    generate: async <T>(schema: { parse: (v: unknown) => T }) =>
      schema.parse({ items: [] }),
  };
  const s = new MemoryService(
    db,
    "action-fixture-secret-32-characters",
    undefined,
    { generation },
  );
  await s.settings(p, {
    titlesTagsEnabled: false,
    noteConnectionsEnabled: false,
    personalSummaryEnabled: false,
    notebookSummariesEnabled: false,
    progressSummariesEnabled: false,
  });
  const note = await s.remember(
    p,
    rememberSchema.parse({
      operationId: randomUUID(),
      content: "Book a train",
    }),
  );
  const request = {
    id: randomUUID(),
    kind: "actions" as const,
    sources: [{ id: note.id, version: note.version }],
    projectId: null,
  };
  await s.assistance.request(p, request);
  await s.assistance.request(p, request);
  await assert.rejects(
    s.assistance.request(p, { ...request, id: randomUUID() }),
    { code: "usage_limit" },
  );
  for (let i = 0; i < 5; i++) {
    await admin("jobs")
      .where({ accountId: p.accountId })
      .update({ dueAt: new Date(0) });
    if (!(await runProcessingJob(worker, { generation }, 2000))) break;
  }
  assert.equal((await s.assistance.get(p, request.id)).status, "ready");
  const usage = await tenant(db, p.accountId, (trx) =>
    quotas.resourceUsage(db, trx, p.accountId),
  );
  assert.equal(usage!.metrics.assistance.used, 1);
  assert.equal(usage!.metrics.assistance.reserved, 0);
});

test("organization coalesces content revisions, shares retries and defers monthly exhaustion", async () => {
  configure(true, 1);
  const p = await account();
  const generation = {
    profile: "actions-organization",
    generate: async <T>(schema: { parse: (v: unknown) => T }) =>
      schema.parse({ title: "Synthetic title", tags: ["test"] }),
  };
  const s = new MemoryService(
    db,
    "action-fixture-secret-32-characters",
    undefined,
    { generation },
  );
  const first = await s.remember(
    p,
    rememberSchema.parse({
      operationId: randomUUID(),
      content: "Initial content",
    }),
  );
  const latest = await s.remember(
    p,
    rememberSchema.parse({
      operationId: randomUUID(),
      id: first.id,
      expectedVersion: first.version,
      content: "Latest content",
    }),
  );
  await admin("jobs")
    .where({ accountId: p.accountId, kind: "organization" })
    .update({ dueAt: new Date(0) });
  await runProcessingJob(worker, { generation }, 2000, undefined, undefined, {
    lane: "enrichment",
  });
  const usage = await tenant(db, p.accountId, (trx) =>
    quotas.resourceUsage(db, trx, p.accountId),
  );
  assert.equal(usage!.metrics.organization.used, 1);
  await s.retryProcessing(p, latest.id, latest.version);
  await admin("jobs")
    .where({ accountId: p.accountId, kind: "organization" })
    .update({ dueAt: new Date(0) });
  await runProcessingJob(worker, { generation }, 2000, undefined, undefined, {
    lane: "enrichment",
  });
  assert.equal(
    (await tenant(db, p.accountId, (trx) =>
      quotas.resourceUsage(db, trx, p.accountId),
    ))!.metrics.organization.used,
    1,
  );
  await s.remember(
    p,
    rememberSchema.parse({
      operationId: randomUUID(),
      content: "Another note, saving still succeeds",
    }),
  );
  await admin("jobs")
    .where({ accountId: p.accountId, kind: "organization" })
    .update({ dueAt: new Date(0) });
  await runProcessingJob(worker, { generation }, 2000, undefined, undefined, {
    lane: "enrichment",
  });
  const paused = await admin("jobs")
    .where({ accountId: p.accountId, kind: "organization" })
    .first();
  assert.equal(paused.errorCode, "usage_limit");
  assert.equal(paused.attempts, 0);
  assert.equal(new Date(paused.dueAt).toISOString(), usage!.resetAt);
});

test("explicit brief regeneration shares the assistance quota without charging cached reads", async () => {
  configure(true, 1);
  const p = await account();
  const generation = {
    profile: "actions-brief",
    generate: async <T>(schema: { parse: (v: unknown) => T }) =>
      schema.parse({ title: "Profile", sections: [] }),
  };
  const s = new MemoryService(
    db,
    "action-fixture-secret-32-characters",
    undefined,
    { generation },
  );
  await s.settings(p, {
    titlesTagsEnabled: false,
    noteConnectionsEnabled: false,
    notebookSummariesEnabled: false,
    progressSummariesEnabled: false,
  });
  await s.remember(
    p,
    rememberSchema.parse({
      operationId: randomUUID(),
      content: "I prefer small gardens",
    }),
  );
  await s.brief(p, { projectId: null }, true);
  await assert.rejects(s.brief(p, { projectId: null }, true), {
    code: "usage_limit",
  });
  for (let i = 0; i < 4; i++) {
    await admin("jobs")
      .where({ accountId: p.accountId })
      .update({ dueAt: new Date(0) });
    if (!(await runProcessingJob(worker, { generation }, 2000))) break;
  }
  assert.equal((await s.brief(p, { projectId: null })).status, "ready");
  assert.equal(
    (await tenant(db, p.accountId, (trx) =>
      quotas.resourceUsage(db, trx, p.accountId),
    ))!.metrics.assistance.used,
    1,
  );
});

test("flag-off organization retains immediate admission instead of the Cloud coalescing delay", async () => {
  configure(false);
  const p = await account();
  const generation = {
    profile: "unconfigured-organization",
    generate: async <T>(schema: { parse: (v: unknown) => T }) =>
      schema.parse({ title: "Title", tags: [] }),
  };
  const s = new MemoryService(
    db,
    "action-fixture-secret-32-characters",
    undefined,
    { generation },
  );
  const note = await s.remember(
    p,
    rememberSchema.parse({
      operationId: randomUUID(),
      content: "Self-hosted timing",
    }),
  );
  const job = await admin("jobs")
    .where({ memoryId: note.id, kind: "organization" })
    .first();
  assert(
    new Date(job.dueAt).getTime() <= Date.now(),
    "flag-off jobs must not acquire a new Cloud delay",
  );
});

test("unavailable generation does not turn ordinary Ask search into a quota failure", async () => {
  configure(true, 0);
  const p = await account(),
    s = service();
  await s.remember(
    p,
    rememberSchema.parse({
      operationId: randomUUID(),
      content: "A garden note",
    }),
  );
  const result = await s.ask(p, {
    query: "garden",
    mode: "answer",
    previousQuestions: [],
    includePersonal: true,
  });
  assert.equal(result.status, "generation_disabled");
});

test("library search degrades explicitly to keywords when semantic allowance is exhausted", async () => {
  configure(true, 0);
  const p = await account();
  let calls = 0;
  const s = new MemoryService(db, "action-fixture-secret-32-characters", {
    model: "synthetic",
    dimensions: 384,
    profile: "synthetic",
    embed: async () => {
      calls++;
      return Array(384).fill(0);
    },
  });
  await s.remember(
    p,
    rememberSchema.parse({
      operationId: randomUUID(),
      content: "Garden strawberries",
    }),
  );
  const result = await s.list(p, {
    query: "strawberries",
    status: "active",
    limit: 30,
  });
  assert.equal(result.items.length, 1);
  assert.equal(result.searchMode, "lexical");
  assert.equal(calls, 0);
});

test("failed replies refund user actions but retain provider-attempt evidence", async () => {
  configure(true, 1);
  const p = await account();
  const s = new MemoryService(
    db,
    "action-fixture-secret-32-characters",
    undefined,
    {
      generation: {
        profile: "failed-chat",
        generate: async () => {
          throw new Error("synthetic provider failure");
        },
      },
    },
  );
  const chat = await s.conversations.create(
    p,
    conversationCreateSchema.parse({ id: randomUUID() }),
  );
  const input = conversationTurnSchema.parse({
    id: randomUUID(),
    query: "Hello",
    expectedVersion: 0,
  });
  await assert.rejects(
    s.conversations.turn(p, chat.id, input),
    /synthetic provider failure/,
  );
  const usage = await tenant(db, p.accountId, (trx) =>
    quotas.resourceUsage(db, trx, p.accountId),
  );
  assert.equal(usage!.metrics.ask.used + usage!.metrics.ask.reserved, 0);
  const attempts = await tenant(db, p.accountId, (trx) =>
    trx("inference_usage").where({ role: "generation" }).first(),
  );
  assert.equal(attempts.requests, 1);
});

test("plan changes retain current-period actions and complimentary unlimited retains safety slots", async () => {
  configure(true, 1);
  const p = await account("pro");
  const first = await reserve(db, p.accountId);
  await tenant(db, p.accountId, (trx) =>
    quotas.settleAction(trx, first, "completed"),
  );
  await admin("billing_subscriptions")
    .where({ accountId: p.accountId })
    .update({ periodEnd: new Date(0) });
  await assert.rejects(reserve(worker, p.accountId), { code: "usage_limit" });
  await admin("account_administration").insert({
    accountId: p.accountId,
    access: "pro",
  });
  await reserve(worker, p.accountId);
  await admin("account_administration")
    .where({ accountId: p.accountId })
    .update({ access: "unlimited" });
  configure(false, 0);
  assert.equal(await reserve(worker, p.accountId), null);
  const state = await tenant(db, p.accountId, (trx) =>
    quotas.resourceUsage(db, trx, p.accountId),
  );
  assert.equal(state!.plan, "unlimited");
  assert.equal(state!.metrics.ask.limit, null);
  assert.equal(state!.metrics.ask.used, 1);
  const limits = await tenant(db, p.accountId, (trx) =>
    quotas.resourcePolicy(db, trx, p.accountId),
  );
  assert.equal(limits!.limits.concurrency, 2);
});

test("re-enabling organization cannot bypass an exhausted content-processing allowance", async () => {
  configure(true, 0);
  const p = await account();
  let calls = 0;
  const generation = {
    profile: "reenabled-organization",
    generate: async <T>(schema: { parse: (v: unknown) => T }) => {
      calls++;
      return schema.parse({ title: "Title", tags: [] });
    },
  };
  const s = new MemoryService(
    db,
    "action-fixture-secret-32-characters",
    undefined,
    { generation },
  );
  await s.settings(p, {
    titlesTagsEnabled: false,
    classificationEnabled: false,
    noteConnectionsEnabled: false,
    notebookConnectionsEnabled: false,
    personalSummaryEnabled: false,
    progressSummariesEnabled: false,
    notebookSummariesEnabled: false,
  });
  const note = await s.remember(
    p,
    rememberSchema.parse({
      operationId: randomUUID(),
      content: "Not yet organized",
    }),
  );
  await s.settings(p, { titlesTagsEnabled: true });
  await admin("jobs")
    .where({ accountId: p.accountId })
    .update({ dueAt: new Date(0) });
  await runProcessingJob(worker, { generation }, 2000);
  assert.equal(calls, 0);
  assert.equal(
    (
      await admin("jobs")
        .where({ memoryId: note.id, kind: "organization" })
        .first()
    ).errorCode,
    "usage_limit",
  );
});

test("action-covered semantic retrieval does not hit the smaller background embedding guard", async () => {
  configure();
  const p = await account("pro");
  const vector = [1, ...Array(383).fill(0)];
  const profile = `retrieval_${randomUUID()}`;
  const s = new MemoryService(db, "action-fixture-secret-32-characters", {
    model: "synthetic",
    profile,
    dimensions: 384,
    embed: async () => vector,
  });
  const note = await s.remember(
    p,
    rememberSchema.parse({
      operationId: randomUUID(),
      content: "Garden evidence",
    }),
  );
  await admin("embedding_profiles").insert({
    id: profile,
    model: "synthetic",
    dimensions: 384,
  });
  await tenant(db, p.accountId, async (trx) => {
    await trx("memory_embeddings").insert({
      accountId: p.accountId,
      memoryId: note.id,
      version: note.version,
      profile,
      dimensions: 384,
      embedding: JSON.stringify(vector),
    });
    await trx("inference_usage").insert({
      accountId: p.accountId,
      role: "embedding",
      requests: 2000,
    });
  });
  assert.equal(
    (await s.recall(p, recallSchema.parse({ query: "unmatched term" }))).mode,
    "hybrid",
  );
  await assert.rejects(
    budgetedInference(db, p.accountId, "embedding", 2000, async () => true),
    { code: "inference_budget" },
  );
  configure(false);
  assert.equal(
    (await s.recall(p, recallSchema.parse({ query: "unmatched term" }))).mode,
    "lexical",
  );
});

test("keyword fallback cursors survive an allowance upgrade without changing filter identity", async () => {
  configure(true, 0);
  const p = await account();
  const s = new MemoryService(db, "action-fixture-secret-32-characters", {
    model: "synthetic",
    dimensions: 384,
    profile: "cursor-synthetic",
    embed: async () => [1, ...Array(383).fill(0)],
  });
  for (const content of ["garden one", "garden two"])
    await s.remember(
      p,
      rememberSchema.parse({ operationId: randomUUID(), content }),
    );
  const first = await s.list(p, {
    query: "garden",
    status: "active",
    limit: 1,
  });
  assert(first.nextCursor);
  configure(true, 2);
  const second = await s.list(p, {
    query: "garden",
    status: "active",
    limit: 1,
    cursor: first.nextCursor,
  });
  assert.equal(second.items.length, 1);
  assert.notEqual(first.items[0].id, second.items[0].id);
});
