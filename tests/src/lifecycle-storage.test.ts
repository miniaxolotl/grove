import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { randomUUID } from "node:crypto";
import {
  createDatabase,
  migrationSource,
  probeDatabase,
  tenant,
  type Knex,
} from "@lib/database";
import { billingEntitlement, configureBillingQuotas } from "@lib/memory";
import type { LifecycleEvent } from "../../packages/api/src/lifecycle-ingress.ts";
import { reconcileLifecycleBilling } from "../../packages/api/src/lifecycle-billing.ts";
import { createServer } from "node:http";
import { createLifecycleStripe } from "../../packages/api/src/lifecycle-billing.ts";
import { JobBroker } from "../../packages/api/src/broker.ts";
import Stripe from "stripe";
import { Billing } from "../../packages/api/src/billing.ts";
import { MemoryService, sessionPrincipal } from "@lib/memory";
import { createApp } from "../../packages/api/src/app.ts";
import { Webhook } from "svix";

const ownerUrl = process.env.TEST_MIGRATION_DATABASE_URL!;
assert(new URL(ownerUrl).pathname.endsWith("_test"));
const authority = createDatabase(ownerUrl),
  name = `grove_lifecycle_${randomUUID().replaceAll("-", "")}_test`;
let admin: Knex, api: Knex, worker: Knex;
const release = "a".repeat(64),
  receipt = "b".repeat(64);
before(async () => {
  await authority.raw("CREATE DATABASE ??", [name]);
  const connect = (source: string) => {
    const url = new URL(source);
    url.pathname = `/${name}`;
    return createDatabase(url.href);
  };
  admin = connect(ownerUrl);
  api = connect(process.env.TEST_DATABASE_URL!);
  worker = connect(process.env.TEST_WORKER_DATABASE_URL!);
  const all = await migrationSource.getMigrations([]);
  await admin.migrate.latest({
    migrationSource: {
      ...migrationSource,
      getMigrations: async () => all.filter((m) => m.name < "20261119_048"),
    },
  });
  await assert.rejects(probeDatabase(api), /lifecycle migration/);
  await admin.migrate.latest();
});
after(async () => {
  await Promise.all([admin?.destroy(), api?.destroy(), worker?.destroy()]);
  await authority.raw("DROP DATABASE IF EXISTS ??", [name]);
  await authority.destroy();
});
async function open() {
  await admin("lifecycle_release_control")
    .insert({ singleton: true, releaseHash: release, receiptHash: receipt })
    .onConflict("singleton")
    .merge({
      phase: "reconcile",
      approvalHash: null,
      approvedGeneration: null,
    });
}
const event = (
  subject: string,
  extra: Partial<LifecycleEvent> = {},
): LifecycleEvent => ({
  provider: "clerk",
  id: `msg_${randomUUID()}`,
  type: "user.updated",
  subject,
  eventAt: Date.now(),
  fingerprint: "c".repeat(64),
  disabled: false,
  ...extra,
});
const accept = (e: LifecycleEvent, r = release) =>
  api.raw("SELECT grove_lifecycle_accept(?,?,?,?,?,?,?,?,?) AS accepted", [
    r,
    receipt,
    e.provider,
    e.id,
    e.fingerprint,
    e.type,
    e.subject,
    e.eventAt,
    e.disabled,
  ]);
async function account() {
  const subject = `user_${randomUUID()}`;
  const id = (await api.raw("SELECT id FROM grove_account(?)", [subject]))
    .rows[0].id as string;
  const customer = `cus_${randomUUID()}`;
  await admin("billing_customers").insert({
    accountId: id,
    customerId: customer,
  });
  return { id, subject, customer };
}
test("048 is additive; runtime roles cannot author release admission or enumerate lifecycle inbox", async () => {
  const all = await migrationSource.getMigrations([]);
  assert.equal(
    all.filter(
      (migration) => migration.name === "20261119_048_lifecycle_reconciliation",
    ).length,
    1,
    "the lifecycle migration remains registered exactly once after additive upgrades",
  );
  await open();
  await assert.rejects(
    api("lifecycle_release_control").update({ phase: "released" }),
    /permission denied/,
  );
  await assert.rejects(api("lifecycle_events"), /permission denied/);
  await assert.rejects(worker("lifecycle_events"), /permission denied/);
});

test("canonical reconciliation preserves exact single-unit entitlement semantics under real RLS", async () => {
  await open();
  configureBillingQuotas(api, {
    enabled: async () => true,
    priceIds: ["price_fixture"],
    productId: "prod_fixture",
  });
  const item = {
    price: { id: "price_fixture", product: "prod_fixture" },
    quantity: 1,
    current_period_end: Math.floor(Date.now() / 1000) + 86400,
  };
  for (const scenario of [
    { name: "single", items: { data: [item] }, tier: "pro", completed: true },
    {
      name: "disabled",
      items: { data: [item] },
      tier: "free",
      completed: true,
    },
    {
      name: "multi-item",
      items: {
        data: [
          item,
          { ...item, price: { id: "price_other", product: "prod_other" } },
        ],
      },
      tier: "free",
      completed: true,
    },
    {
      name: "multi-quantity",
      items: { data: [{ ...item, quantity: 2 }] },
      tier: "free",
      completed: true,
    },
    {
      name: "missing-quantity",
      items: { data: [{ ...item, quantity: undefined }] },
      tier: "free",
      completed: true,
    },
    {
      name: "expanded-product",
      items: {
        data: [
          {
            ...item,
            price: { id: "price_other", product: { id: "prod_fixture" } },
          },
        ],
      },
      tier: "pro",
      completed: true,
    },
    {
      name: "partial-items",
      items: { has_more: true, data: [item] },
      tier: "free",
      completed: false,
    },
    {
      name: "malformed-quantity",
      items: { data: [{ ...item, quantity: "1" }] },
      tier: "free",
      completed: false,
    },
    {
      name: "empty-items",
      items: { data: [] },
      tier: "free",
      completed: false,
    },
    {
      name: "malformed-product",
      items: {
        data: [{ ...item, price: { id: "price_fixture", product: {} } }],
      },
      tier: "free",
      completed: false,
    },
  ]) {
    const { id, customer } = await account();
    if (scenario.name === "disabled")
      await admin("accounts").where({ id }).update({ status: "disabled" });
    await accept(
      event(customer, {
        provider: "stripe",
        type: "customer.subscription.updated",
      }),
    );
    const task = await admin("background_tasks")
      .where({ accountId: id, kind: "billing_reconcile" })
      .first();
    const stripe = createLifecycleStripe("sk_test_entitlement", async (input) =>
      Response.json({
        has_more: false,
        data:
          new URL(String(input)).pathname === "/v1/subscriptions"
            ? [
                {
                  id: `sub_${randomUUID()}`,
                  customer,
                  status: "active",
                  cancel_at_period_end: false,
                  items: scenario.items,
                },
              ]
            : [],
      }),
    );
    const completed = await reconcileLifecycleBilling(
      worker,
      stripe,
      { release, receipt },
      task.id,
    );
    const plan = await tenant(api, id, (trx) =>
      billingEntitlement(api, trx, id),
    );
    assert.equal(plan?.tier, scenario.tier, scenario.name);
    assert.equal(completed, scenario.completed, scenario.name);
    if (completed && scenario.tier === "free" && scenario.name !== "disabled") {
      const saved = await admin("billing_subscriptions")
        .where({ accountId: id })
        .first();
      assert.equal(saved.priceId, "unsupported", scenario.name);
      assert.equal(saved.productId, null, scenario.name);
    }
  }
});

test("reconciliation retains populated billing history and existing trial consumption/linkage", async () => {
  await open();
  const { id, subject, customer } = await account();
  const old = {
    accountId: id,
    customerId: customer,
    priceId: "price_fixture",
    productId: "prod_fixture",
    periodEnd: new Date(Date.now() + 86400000),
    cancelAtPeriodEnd: false,
  };
  await admin("billing_subscriptions").insert([
    { ...old, id: `sub_old_${id}`, status: "active" },
    { ...old, id: `sub_history_${id}`, status: "canceled" },
  ]);
  const consumedAt = new Date("2026-01-02T03:04:05Z");
  await admin("billing_trials").insert({ accountId: id, consumedAt });
  const trialBefore = await admin("billing_trials")
    .where({ accountId: id })
    .first();
  let status = "trialing";
  const stripe = createLifecycleStripe("sk_test_history", async (input) =>
    Response.json({
      has_more: false,
      data:
        new URL(String(input)).pathname === "/v1/subscriptions"
          ? [
              {
                id: `sub_trial_${id}`,
                customer,
                status,
                cancel_at_period_end: false,
                items: {
                  data: [
                    {
                      quantity: 1,
                      price: { id: "price_fixture", product: "prod_fixture" },
                      current_period_end: Math.floor(Date.now() / 1000) + 86400,
                    },
                  ],
                },
              },
            ]
          : [],
    }),
  );
  const reconcile = async () => {
    await accept(
      event(customer, {
        provider: "stripe",
        type: "customer.subscription.updated",
      }),
    );
    const task = await admin("background_tasks")
      .where({ accountId: id, kind: "billing_reconcile", status: "pending" })
      .orderBy("created_at", "desc")
      .first();
    assert.equal(
      await reconcileLifecycleBilling(
        worker,
        stripe,
        { release, receipt },
        task.id,
      ),
      true,
    );
  };
  await reconcile();
  const history = await admin("billing_subscriptions").where({ accountId: id });
  assert.equal(
    history.length,
    3,
    "A canonical read must not delete historical subscriptions",
  );
  assert.equal(
    history.find((s) => s.id === `sub_old_${id}`)?.status,
    "canceled",
  );
  assert.equal(
    history.find((s) => s.id === `sub_history_${id}`)?.priceId,
    "price_fixture",
  );
  assert.deepEqual(
    await admin("billing_trials").where({ accountId: id }).first(),
    { ...trialBefore, subscriptionId: `sub_trial_${id}` },
  );
  await accept(event(subject, { type: "user.deleted" }));
  status = "canceled";
  await reconcile();
  assert.equal(
    (await admin("billing_subscriptions").where({ accountId: id })).length,
    3,
  );
  assert.equal(
    (await tenant(api, id, (trx) => billingEntitlement(api, trx, id)))?.tier,
    "free",
  );
  assert.deepEqual(
    await admin("billing_trials").where({ accountId: id }).first(),
    { ...trialBefore, subscriptionId: `sub_trial_${id}` },
  );
});

test("ordinary billing acceptance and deletion intent use the same durable work after release", async () => {
  await open();
  await admin("lifecycle_release_control").update({ phase: "released" });
  const { id, customer } = await account();
  let remote = 0;
  const stripe = new Stripe("sk_test_ordinary", {
    maxNetworkRetries: 0,
    httpClient: Stripe.createFetchHttpClient(async () => {
      remote++;
      return Response.json({ data: [], has_more: false });
    }),
  });
  const billing = new Billing(
    new MemoryService(api, "synthetic-lifecycle-ordinary-secret"),
    {
      stripe,
      webhookSecret: "whsec_ordinary",
      siteUrl: "https://example.invalid",
      prices: {},
      enabled: async () => true,
    },
  );
  const raw = JSON.stringify({
    id: `evt_${randomUUID()}`,
    type: "customer.subscription.updated",
    created: Math.floor(Date.now() / 1000),
    livemode: false,
    data: { object: { customer } },
  });
  const signature = stripe.webhooks.generateTestHeaderString({
    payload: raw,
    secret: "whsec_ordinary",
  });
  await billing.webhook(raw, signature);
  await billing.webhook(raw, signature);
  assert.equal(remote, 0, "Ordinary ACK cannot perform Stripe I/O");
  const tasks = await admin("background_tasks").where({
    accountId: id,
    kind: "billing_reconcile",
  });
  assert.equal(tasks.length, 1);
  const canonical = createLifecycleStripe("sk_test_ordinary", async () =>
    Response.json({ data: [], has_more: false }),
  );
  assert.equal(
    await reconcileLifecycleBilling(worker, canonical, undefined, tasks[0].id),
    true,
  );
  await tenant(api, id, async (trx) => {
    await trx("accounts")
      .where({ id })
      .update({ status: "deleting", deletedAt: trx.fn.now() });
    await billing.cancelForDeletion(id, trx);
  });
  assert.equal(remote, 0);
  const cleanup = new Billing(
    new MemoryService(worker, "synthetic-lifecycle-ordinary-secret"),
    {
      stripe,
      webhookSecret: "whsec_ordinary",
      siteUrl: "https://example.invalid",
      prices: {},
      enabled: async () => true,
    },
  );
  await assert.rejects(cleanup.cancelForDeletion(id), {
    code: "billing_reconciliation_pending",
  });
  const deletion = await admin("background_tasks")
    .where({ accountId: id, kind: "billing_reconcile", status: "pending" })
    .first();
  assert(deletion);
  assert.equal(
    await reconcileLifecycleBilling(worker, canonical, undefined, deletion.id),
    true,
  );
  await cleanup.cancelForDeletion(id);
  assert.equal(
    (
      await admin("background_tasks").where({
        accountId: id,
        kind: "billing_reconcile",
      })
    ).length,
    2,
    "Cleanup retries must not reset reconciliation",
  );
  await open();
});

test("ordinary signed Clerk notifications commit through the same durable lifecycle inbox", async () => {
  await open();
  await admin("lifecycle_release_control").update({ phase: "released" });
  const { id, subject } = await account();
  const secret = `whsec_${Buffer.from("ordinary-signed-clerk-fixture").toString("base64")}`;
  const app = createApp({
    memories: new MemoryService(api, "ordinary-clerk-fixture-secret"),
    auth: {
      principal: async () => {
        throw new Error("Unexpected auth");
      },
    },
    origin: "https://api.example.invalid",
    siteUrl: "https://example.invalid",
    issuer: "https://clerk.example.invalid",
    webhookSecret: secret,
    ready: async () => {},
  });
  const at = new Date(),
    key = `msg_${randomUUID()}`;
  const raw = JSON.stringify({
    type: "user.deleted",
    timestamp: at.getTime(),
    data: { id: subject },
  });
  const response = await app.request("/v1/webhooks/clerk", {
    method: "POST",
    body: raw,
    headers: {
      "content-type": "application/json",
      "svix-id": key,
      "svix-timestamp": String(Math.floor(at.getTime() / 1000)),
      "svix-signature": new Webhook(secret).sign(key, at, raw),
    },
  });
  assert.equal(response.status, 202);
  assert.equal(
    (await admin("lifecycle_events").where({ eventId: key })).length,
    1,
  );
  assert.equal(
    (
      await admin("background_tasks").where({
        accountId: id,
        kind: "billing_reconcile",
      })
    ).length,
    1,
  );
  assert.equal(
    (await admin("accounts").where({ id }).first()).status,
    "deleting",
  );
  await open();
});
test("lost acknowledgement replay commits authority and one task exactly once; conflicting replay fails", async () => {
  await open();
  const { id, subject } = await account();
  const e = event(subject);
  await accept(e);
  await accept(e);
  assert.equal(
    (await admin("lifecycle_events").where({ eventId: e.id })).length,
    1,
  );
  assert.equal(
    (
      await admin("background_tasks").where({
        accountId: id,
        kind: "billing_reconcile",
      })
    ).length,
    1,
  );
  assert.equal(
    (await admin("lifecycle_billing_state").where({ accountId: id }).first())
      .generation,
    "1",
  );
  await assert.rejects(
    accept({ ...e, fingerprint: "e".repeat(64) }),
    /replay conflict/,
  );
  await assert.rejects(accept(event(subject), "f".repeat(64)), /release fence/);
});
test("ingress rollback cannot acknowledge authority without durable work; unknown Stripe tenants fail closed", async () => {
  await open();
  const { id, subject } = await account();
  const e = event(subject, { type: "user.deleted" });
  await admin.raw(
    `CREATE FUNCTION fixture_reject_lifecycle() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.kind='billing_reconcile' THEN RAISE EXCEPTION 'fixture outbox failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER fixture_reject_lifecycle BEFORE INSERT ON background_tasks FOR EACH ROW EXECUTE FUNCTION fixture_reject_lifecycle()`,
  );
  try {
    await assert.rejects(accept(e), /fixture outbox failure/);
  } finally {
    await admin.raw(
      "DROP TRIGGER fixture_reject_lifecycle ON background_tasks; DROP FUNCTION fixture_reject_lifecycle()",
    );
  }
  assert.equal(
    (await admin("accounts").where({ id }).first()).status,
    "active",
  );
  assert.equal(
    (await admin("lifecycle_events").where({ eventId: e.id })).length,
    0,
  );
  const unknown = event("cus_unknown", {
    provider: "stripe",
    type: "customer.subscription.updated",
  });
  await assert.rejects(accept(unknown), /unknown billing tenant/);
  assert.equal(
    (await admin("lifecycle_events").where({ eventId: unknown.id })).length,
    0,
  );
});
test("deletion and disabled authority outrank delayed billing and same-time reactivation", async () => {
  await open();
  const { id, subject, customer } = await account();
  const at = Date.now();
  await accept(event(subject, { eventAt: at, disabled: true }));
  await accept(event(subject, { eventAt: at, disabled: false }));
  assert.equal(
    (await admin("accounts").where({ id }).first()).status,
    "disabled",
  );
  await accept(event(subject, { type: "user.deleted", eventAt: at - 10000 }));
  await accept(
    event(customer, {
      provider: "stripe",
      type: "customer.subscription.updated",
      eventAt: at - 20000,
    }),
  );
  await accept(event(subject, { eventAt: at + 1 }));
  assert.equal(
    (await admin("accounts").where({ id }).first()).status,
    "deleting",
  );
  assert.equal(
    (await api.raw("SELECT * FROM grove_account(?)", [subject])).rows.length,
    0,
  );
});
test("new unique events invalidate persisted handoff, but retries do not advance its generation", async () => {
  await open();
  const { subject } = await account();
  const e = event(subject);
  await accept(e);
  const before = await admin("lifecycle_release_control").first();
  await admin("lifecycle_release_control").update({
    phase: "handoff",
    approvalHash: "e".repeat(64),
    approvedGeneration: before.generation,
  });
  await accept(e);
  assert.equal(
    (await admin("lifecycle_release_control").first()).phase,
    "handoff",
  );
  await accept(event(subject));
  const invalidated = await admin("lifecycle_release_control").first();
  assert.equal(invalidated.phase, "reconcile");
  assert.equal(invalidated.approvalHash, null);
  assert.equal(invalidated.approvedGeneration, null);
  assert.equal(BigInt(invalidated.generation), BigInt(before.generation) + 1n);
});

test("ordinary dispatch, claim and SQL-bound heartbeat never admit lifecycle-only billing tasks", async () => {
  await open();
  const { id, subject } = await account();
  await accept(event(subject));
  const task = await admin("background_tasks")
    .where({ accountId: id, kind: "billing_reconcile" })
    .first();
  assert.equal(
    (await worker.raw("SELECT * FROM grove_claim_task(?,NULL,1)", [task.id]))
      .rows.length,
    0,
  );
  const token = randomUUID();
  await admin("background_tasks")
    .where({ id: task.id })
    .update({
      status: "running",
      leaseId: token,
      leaseUntil: new Date(Date.now() + 30000),
    });
  assert.equal(
    (
      await worker.raw("SELECT grove_task_heartbeat(?,?) AS renewed", [
        task.id,
        token,
      ])
    ).rows[0].renewed,
    false,
  );
});

test("narrow claims fence release, tenant generation, stale lease and deletion state", async () => {
  await open();
  const { id, subject } = await account();
  await accept(event(subject));
  const task = await admin("background_tasks")
    .where({ accountId: id, kind: "billing_reconcile" })
    .first();
  const claim = () =>
    worker.raw("SELECT * FROM grove_lifecycle_claim(?,?,?)", [
      release,
      receipt,
      task.id,
    ]);
  const first = (await claim()).rows[0];
  assert(first);
  assert.equal(first.account_id, id);
  assert.equal((await claim()).rows.length, 0);
  const valid = (row: typeof first) =>
    worker.raw("SELECT grove_lifecycle_valid(?,?,?,?,?) AS valid", [
      release,
      receipt,
      task.id,
      row.lease_id,
      row.account_status,
    ]);
  assert.equal((await valid(first)).rows[0].valid, true);
  await admin("background_tasks")
    .where({ id: task.id })
    .update({ leaseUntil: new Date(Date.now() - 1) });
  const second = (await claim()).rows[0];
  assert(second);
  assert.notEqual(second.lease_id, first.lease_id);
  assert.equal((await valid(first)).rows[0].valid, false);
  assert.equal((await valid(second)).rows[0].valid, true);
  await accept(event(subject, { type: "user.deleted" }));
  assert.equal((await valid(second)).rows[0].valid, false);
  await assert.rejects(
    worker.raw("SELECT * FROM grove_lifecycle_claim(?,?,NULL)", [
      "f".repeat(64),
      receipt,
    ]),
    /release fence/,
  );
});

test("crashed exhausted leases become persisted failed work without running general sweepers", async () => {
  await open();
  const { id, subject } = await account();
  await accept(event(subject));
  const task = await admin("background_tasks")
    .where({ accountId: id, kind: "billing_reconcile" })
    .first();
  await admin("background_tasks")
    .where({ id: task.id })
    .update({
      attempts: 5,
      status: "running",
      leaseId: randomUUID(),
      leaseUntil: new Date(Date.now() - 1),
    });
  assert.equal(
    (
      await worker.raw("SELECT * FROM grove_lifecycle_claim(?,?,?)", [
        release,
        receipt,
        task.id,
      ])
    ).rows.length,
    0,
  );
  const failed = await admin("background_tasks").where({ id: task.id }).first();
  assert.equal(failed.status, "failed");
  assert.equal(failed.errorCode, "lifecycle_exhausted");
  assert.equal(failed.leaseId, null);
});

test("actual provider reads occur outside SQL transactions; only complete paginated reads commit entitlement evidence", async () => {
  await open();
  const { id, customer } = await account();
  await accept(
    event(customer, {
      provider: "stripe",
      type: "customer.subscription.updated",
    }),
  );
  const task = await admin("background_tasks")
    .where({ accountId: id, kind: "billing_reconcile" })
    .first();
  const requests: string[] = [];
  const server = createServer(async (request, response) => {
    requests.push(request.url!);
    assert.equal(
      request.headers.authorization,
      "Bearer sk_test_lifecycle_fixture",
    );
    const transactions = (
      await admin.raw(
        "SELECT query FROM pg_stat_activity WHERE datname=current_database() AND application_name='grove' AND pid<>pg_backend_pid() AND xact_start IS NOT NULL",
      )
    ).rows;
    assert.equal(transactions.length, 0, JSON.stringify(transactions));
    const url = new URL(request.url!, "http://localhost");
    assert.equal(url.searchParams.get("customer"), customer);
    const subscription = {
      id: "sub_lifecycle",
      customer,
      status: "active",
      cancel_at_period_end: false,
      items: {
        data: [
          {
            price: { id: "price_fixture", product: "prod_fixture" },
            current_period_end: Math.floor(Date.now() / 1000) + 86400,
          },
        ],
      },
    };
    response.setHeader("Content-Type", "application/json");
    if (url.pathname === "/v1/subscriptions")
      response.end(
        JSON.stringify({
          object: "list",
          has_more: !url.searchParams.has("starting_after"),
          data: url.searchParams.has("starting_after") ? [] : [subscription],
        }),
      );
    else {
      assert.equal(url.pathname, "/v1/checkout/sessions");
      response.end(
        JSON.stringify({ object: "list", has_more: false, data: [] }),
      );
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert(address && typeof address !== "string");
  const stripe = createLifecycleStripe(
    "sk_test_lifecycle_fixture",
    (input, init) => {
      const url = new URL(String(input));
      url.protocol = "http:";
      url.host = `127.0.0.1:${address.port}`;
      return fetch(url, init);
    },
  );
  try {
    const run = reconcileLifecycleBilling;
    assert.equal(typeof run, "function");
    await run(worker, stripe, { release, receipt }, task.id);
    assert.equal(
      (await admin("background_tasks").where({ id: task.id }).first()).status,
      "succeeded",
    );
    assert.equal(
      (await admin("billing_subscriptions").where({ accountId: id }).first())
        .id,
      "sub_lifecycle",
    );
    const evidence = await admin("lifecycle_billing_state")
      .where({ accountId: id })
      .first();
    assert.equal(evidence.reconciledGeneration, evidence.generation);
    assert.match(evidence.remoteHash, /^[a-f0-9]{64}$/);
    assert(
      requests.filter((r) => r.startsWith("/v1/subscriptions")).length >= 2,
    );
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("lost cancellation acceptance is persisted and reconciled by reads, never blindly repeated", async () => {
  await open();
  const { id, subject, customer } = await account();
  await accept(event(subject, { type: "user.deleted" }));
  const task = await admin("background_tasks")
    .where({ accountId: id, kind: "billing_reconcile" })
    .first();
  let status = "active",
    cancellations = 0;
  const server = createServer(async (request, response) => {
    assert.equal(
      request.headers.authorization,
      "Bearer sk_test_lifecycle_fixture",
    );
    const transactions = (
      await admin.raw(
        "SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND application_name='grove' AND pid<>pg_backend_pid() AND xact_start IS NOT NULL",
      )
    ).rows;
    assert.equal(transactions.length, 0);
    const url = new URL(request.url!, "http://localhost");
    response.setHeader("Content-Type", "application/json");
    if (request.method === "DELETE") {
      assert.equal(url.pathname, "/v1/subscriptions/sub_delete_fixture");
      const marker = await admin("lifecycle_billing_effects")
        .where({ accountId: id })
        .first();
      assert.equal(marker.state, "uncertain");
      cancellations++;
      status = "canceled";
      request.socket.destroy();
      return;
    }
    if (url.pathname === "/v1/subscriptions")
      response.end(
        JSON.stringify({
          has_more: false,
          data: [
            {
              id: "sub_delete_fixture",
              customer,
              status,
              cancel_at_period_end: false,
              items: {
                data: [
                  {
                    price: { id: "price_fixture", product: "prod_fixture" },
                    current_period_end: Math.floor(Date.now() / 1000) + 86400,
                  },
                ],
              },
            },
          ],
        }),
      );
    else {
      assert.equal(url.pathname, "/v1/checkout/sessions");
      response.end(JSON.stringify({ has_more: false, data: [] }));
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert(address && typeof address !== "string");
  const stripe = createLifecycleStripe(
    "sk_test_lifecycle_fixture",
    (input, init) => {
      const url = new URL(String(input));
      url.protocol = "http:";
      url.host = `127.0.0.1:${address.port}`;
      return fetch(url, init);
    },
  );
  const run = reconcileLifecycleBilling;
  try {
    assert.equal(
      await run(worker, stripe, { release, receipt }, task.id),
      false,
    );
    assert.equal(cancellations, 1);
    assert.equal(
      (await admin("background_tasks").where({ id: task.id }).first()).status,
      "pending",
    );
    await admin("background_tasks")
      .where({ id: task.id })
      .update({ dueAt: new Date() });
    assert.equal(
      await run(worker, stripe, { release, receipt }, task.id),
      true,
    );
    assert.equal(cancellations, 1);
    assert.equal(
      (
        await admin("lifecycle_billing_effects")
          .where({ accountId: id })
          .first()
      ).state,
      "confirmed",
    );
    const retained = await admin("billing_subscriptions").where({
      accountId: id,
    });
    assert.equal(retained.length, 1);
    assert.equal(retained[0].id, "sub_delete_fixture");
    assert.equal(retained[0].status, "canceled");
    assert.equal(
      (await tenant(api, id, (trx) => billingEntitlement(api, trx, id)))?.tier,
      "free",
    );
    assert.equal(
      (await admin("accounts").where({ id }).first()).status,
      "deleting",
    );
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("partial/foreign provider reads, stale leases and deletion races cannot commit remote evidence", async () => {
  const run = reconcileLifecycleBilling;
  for (const fault of [
    "partial",
    "foreign",
    "stale",
    "deleted",
    "remapped",
    "tombstoned",
  ]) {
    await open();
    const { id, subject, customer } = await account();
    await accept(
      event(customer, {
        provider: "stripe",
        type: "customer.subscription.updated",
      }),
    );
    const task = await admin("background_tasks")
      .where({ accountId: id, kind: "billing_reconcile" })
      .first();
    const server = createServer(async (request, response) => {
      assert.equal(request.method, "GET");
      assert.equal(
        request.headers.authorization,
        "Bearer sk_test_lifecycle_fixture",
      );
      if (fault === "stale")
        await admin("background_tasks")
          .where({ id: task.id })
          .update({ leaseUntil: new Date(Date.now() - 1) });
      if (fault === "deleted")
        await accept(event(subject, { type: "user.deleted" }));
      if (fault === "remapped")
        await admin("billing_customers")
          .where({ accountId: id })
          .update({ customerId: "cus_remapped" });
      if (fault === "tombstoned")
        await admin("subject_authority")
          .insert({ subject, eventAt: Date.now(), deleted: true })
          .onConflict("subject")
          .merge({ deleted: true });
      response.setHeader("Content-Type", "application/json");
      response.end(
        JSON.stringify({
          has_more: fault === "partial",
          data:
            fault === "foreign"
              ? [
                  {
                    id: "sub_foreign",
                    customer: "cus_foreign",
                    status: "active",
                    cancel_at_period_end: false,
                    items: {
                      data: [
                        {
                          price: {
                            id: "price_fixture",
                            product: "prod_fixture",
                          },
                          current_period_end:
                            Math.floor(Date.now() / 1000) + 86400,
                        },
                      ],
                    },
                  },
                ]
              : [],
        }),
      );
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address();
    assert(address && typeof address !== "string");
    const stripe = createLifecycleStripe(
      "sk_test_lifecycle_fixture",
      (input, init) => {
        const url = new URL(String(input));
        url.protocol = "http:";
        url.host = `127.0.0.1:${address.port}`;
        return fetch(url, init);
      },
    );
    try {
      assert.equal(
        await run(worker, stripe, { release, receipt }, task.id),
        false,
        fault,
      );
      assert.equal(
        (
          await admin("lifecycle_billing_state")
            .where({ accountId: id })
            .first()
        ).remoteHash,
        null,
      );
      assert.equal(
        (await admin("billing_subscriptions").where({ accountId: id })).length,
        0,
      );
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }
});

test("a crash marker before cancellation stays uncertain across worker restart without another write", async () => {
  await open();
  const { id, subject, customer } = await account();
  await accept(event(subject, { type: "user.deleted" }));
  const task = await admin("background_tasks")
    .where({ accountId: id, kind: "billing_reconcile" })
    .first();
  const claim = (
    await worker.raw("SELECT * FROM grove_lifecycle_claim(?,?,?)", [
      release,
      receipt,
      task.id,
    ])
  ).rows[0];
  assert.equal(
    (
      await worker.raw(
        "SELECT grove_lifecycle_effect(?,?,?,?,?,?,?,false) AS reserved",
        [
          release,
          receipt,
          task.id,
          claim.lease_id,
          claim.account_status,
          "cancel",
          "sub_not_accepted",
        ],
      )
    ).rows[0].reserved,
    true,
  );
  await admin("background_tasks")
    .where({ id: task.id })
    .update({ leaseUntil: new Date(Date.now() - 1) });
  let writes = 0;
  const server = createServer((request, response) => {
    if (request.method !== "GET") writes++;
    const sub = {
      id: "sub_not_accepted",
      customer,
      status: "active",
      cancel_at_period_end: false,
      items: {
        data: [
          {
            price: { id: "price_fixture", product: "prod_fixture" },
            current_period_end: Math.floor(Date.now() / 1000) + 86400,
          },
        ],
      },
    };
    response.setHeader("Content-Type", "application/json");
    response.end(
      JSON.stringify({
        has_more: false,
        data: request.url!.startsWith("/v1/subscriptions") ? [sub] : [],
      }),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert(address && typeof address !== "string");
  const stripe = createLifecycleStripe(
    "sk_test_lifecycle_fixture",
    (input, init) => {
      const url = new URL(String(input));
      url.protocol = "http:";
      url.host = `127.0.0.1:${address.port}`;
      return fetch(url, init);
    },
  );
  try {
    const run = reconcileLifecycleBilling;
    assert.equal(
      await run(worker, stripe, { release, receipt }, task.id),
      false,
    );
    assert.equal(writes, 0);
    assert.equal(
      (
        await admin("lifecycle_billing_effects")
          .where({ accountId: id })
          .first()
      ).state,
      "uncertain",
    );
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("durable dispatcher reserves only lifecycle IDs and a failed broker publication is redispatchable", async () => {
  await open();
  const { id, subject } = await account();
  await accept(event(subject));
  const task = await admin("background_tasks")
    .where({ accountId: id, kind: "billing_reconcile" })
    .first();
  const dispatch = () =>
    worker.raw("SELECT * FROM grove_lifecycle_dispatch(?,?)", [
      release,
      receipt,
    ]);
  const first = (await dispatch()).rows.find(
    (r: { id: string }) => r.id === task.id,
  );
  assert(first);
  assert.deepEqual(Object.keys(first).sort(), ["dispatch_id", "id"]);
  assert(
    !(await dispatch()).rows.some((r: { id: string }) => r.id === task.id),
  );
  await worker.raw("SELECT grove_dispatch_finish('task',?,?,false)", [
    task.id,
    first.dispatch_id,
  ]);
  const retry = (await dispatch()).rows.find(
    (r: { id: string }) => r.id === task.id,
  );
  assert(retry);
  assert.notEqual(retry.dispatch_id, first.dispatch_id);
  await worker.raw("SELECT grove_dispatch_finish('task',?,?,true)", [
    task.id,
    first.dispatch_id,
  ]);
  assert.equal(
    (await admin("background_tasks").where({ id: task.id }).first())
      .dispatchedAt,
    null,
    "Stale publisher cannot mark a newer reservation",
  );
  await worker.raw("SELECT grove_dispatch_finish('task',?,?,true)", [
    task.id,
    retry.dispatch_id,
  ]);
  assert(
    (await admin("background_tasks").where({ id: task.id }).first())
      .dispatchedAt,
  );
});

test("real confirmed broker delivery carries only an opaque ID; disconnection recovers from PostgreSQL", async () => {
  assert(process.env.TEST_AMQP_URL, "Use the task-owned disposable broker");
  await open();
  const { id, subject } = await account();
  await accept(event(subject));
  const task = await admin("background_tasks")
    .where({ accountId: id, kind: "billing_reconcile" })
    .first();
  let resolveDelivery!: () => void;
  const delivered = new Promise<void>((resolve) => {
    resolveDelivery = resolve;
  });
  const stripe = createLifecycleStripe("sk_test_broker_fixture", async () =>
    Response.json({ has_more: false, data: [] }),
  );
  const broker = new JobBroker(
    process.env.TEST_AMQP_URL,
    { bulk: 1 },
    async (job) => {
      assert.deepEqual(Object.keys(job).sort(), ["id", "kind"]);
      if (job.id === task.id) {
        assert.equal(
          await reconcileLifecycleBilling(
            worker,
            stripe,
            { release, receipt },
            job.id,
          ),
          true,
        );
        resolveDelivery();
      }
    },
    false,
  );
  const reserve = async () =>
    (
      await worker.raw("SELECT * FROM grove_lifecycle_dispatch(?,?)", [
        release,
        receipt,
      ])
    ).rows.find((r: { id: string }) => r.id === task.id);
  const row = await reserve();
  assert(row);
  await broker.connect();
  await broker.disconnect();
  await assert.rejects(
    broker.publish({ kind: "task", id: task.id }, "bulk"),
    /broker_unavailable/,
  );
  await worker.raw("SELECT grove_dispatch_finish('task',?,?,false)", [
    task.id,
    row.dispatch_id,
  ]);
  const retry = await reserve();
  assert(retry);
  try {
    await broker.connect();
    await broker.publish({ kind: "task", id: task.id }, "bulk");
    await worker.raw("SELECT grove_dispatch_finish('task',?,?,true)", [
      task.id,
      retry.dispatch_id,
    ]);
    await Promise.race([
      delivered,
      new Promise<never>((_, reject) => {
        const timer = setTimeout(
          () => reject(new Error("Broker fixture delivery deadline")),
          10000,
        );
        timer.unref();
      }),
    ]);
    assert.equal(
      (await admin("background_tasks").where({ id: task.id }).first()).status,
      "succeeded",
    );
  } finally {
    await broker.close();
  }
});

test("scoped recovery creates bounded readback work, preserving uncertainty and failed evidence", async () => {
  await open();
  const { id, subject } = await account();
  const foreign = await account();
  await accept(event(subject, { type: "user.deleted" }));
  const task = await admin("background_tasks")
    .where({ accountId: id, kind: "billing_reconcile" })
    .first();
  const claim = (
    await worker.raw("SELECT * FROM grove_lifecycle_claim(?,?,?)", [
      release,
      receipt,
      task.id,
    ])
  ).rows[0];
  await worker.raw("SELECT grove_lifecycle_effect(?,?,?,?,?,?,?,false)", [
    release,
    receipt,
    task.id,
    claim.lease_id,
    claim.account_status,
    "cancel",
    "sub_recovery_unknown",
  ]);
  await admin("background_tasks")
    .where({ id: task.id })
    .update({ status: "failed", leaseId: null, leaseUntil: null, attempts: 5 });
  const operation = randomUUID();
  await assert.rejects(
    tenant(api, foreign.id, (trx) =>
      trx.raw("SELECT grove_lifecycle_retry(?,?)", [task.id, operation]),
    ),
    /tenant fence/,
  );
  const retry = async () =>
    (
      await tenant(api, id, (trx) =>
        trx.raw("SELECT grove_lifecycle_retry(?,?) AS id", [
          task.id,
          operation,
        ]),
      )
    ).rows[0].id;
  const newId = await retry();
  assert.notEqual(newId, task.id);
  assert.equal(await retry(), newId);
  assert.equal(
    (await admin("background_tasks").where({ id: task.id }).first()).status,
    "failed",
  );
  assert.equal(
    (await admin("background_tasks").where({ id: newId }).first()).attempts,
    0,
  );
  assert.equal(
    (await admin("lifecycle_billing_effects").where({ accountId: id }).first())
      .state,
    "uncertain",
  );
  await assert.rejects(
    tenant(api, id, (trx) =>
      trx.raw("SELECT grove_lifecycle_retry(?,?)", [task.id, randomUUID()]),
    ),
    /generation fence/,
  );
  await admin("lifecycle_billing_effects")
    .where({ accountId: id })
    .update({ createdAt: new Date("2020-01-01") });
  await worker.raw("SELECT grove_lifecycle_retention(?,?)", [release, receipt]);
  assert.equal(
    (await admin("lifecycle_billing_effects").where({ accountId: id }).first())
      .remoteId,
    "sub_recovery_unknown",
    "Retention cannot erase unresolved provider acceptance",
  );
  await assert.rejects(
    tenant(worker, id, (trx) =>
      trx.raw("SELECT grove_lifecycle_erase(?)", [id]),
    ),
    /unresolved lifecycle/,
  );
});

test("privacy erasure redacts confirmed staging identifiers, preserves history and prevents replay restoration", async () => {
  await open();
  const { id, subject, customer } = await account();
  const delivery = event(subject, { type: "user.deleted" });
  await accept(delivery);
  const task = await admin("background_tasks")
    .where({ accountId: id, kind: "billing_reconcile" })
    .first();
  const claim = (
    await worker.raw("SELECT * FROM grove_lifecycle_claim(?,?,?)", [
      release,
      receipt,
      task.id,
    ])
  ).rows[0];
  await worker.raw("SELECT grove_lifecycle_effect(?,?,?,?,?,?,?,false)", [
    release,
    receipt,
    task.id,
    claim.lease_id,
    claim.account_status,
    "cancel",
    "sub_erasure",
  ]);
  await admin("background_tasks")
    .where({ id: task.id })
    .update({ leaseUntil: new Date(Date.now() - 1) });
  const stripe = createLifecycleStripe("sk_test_erasure", async (input) =>
    Response.json({
      has_more: false,
      data:
        new URL(String(input)).pathname === "/v1/subscriptions"
          ? [
              {
                id: "sub_erasure",
                customer,
                status: "canceled",
                cancel_at_period_end: false,
                items: {
                  data: [
                    {
                      quantity: 1,
                      price: { id: "price_fixture", product: "prod_fixture" },
                      current_period_end: Math.floor(Date.now() / 1000) + 86400,
                    },
                  ],
                },
              },
            ]
          : [],
    }),
  );
  assert.equal(
    await reconcileLifecycleBilling(
      worker,
      stripe,
      { release, receipt },
      task.id,
    ),
    true,
  );
  await admin("accounts").where({ id }).update({ status: "deleted" });
  await tenant(worker, id, (trx) =>
    trx.raw("SELECT grove_lifecycle_erase(?)", [id]),
  );
  const marker = await admin("lifecycle_billing_effects")
    .where({ accountId: id })
    .first();
  assert.equal(marker.remoteId, null);
  assert.match(marker.targetHash, /^[a-f0-9]{64}$/);
  const saved = await admin("lifecycle_events")
    .where({ fingerprint: delivery.fingerprint, provider: "clerk" })
    .whereNull("event_id")
    .where({ accountId: id })
    .first();
  assert(saved);
  await accept(delivery);
  assert.equal(
    (
      await admin("lifecycle_events")
        .where({ eventHash: saved.eventHash })
        .first()
    ).eventId,
    null,
  );
  assert.equal(
    (await admin("lifecycle_billing_effects").where({ accountId: id }).first())
      .remoteId,
    null,
  );
  assert.equal(
    (await admin("billing_subscriptions").where({ accountId: id }).first())
      .status,
    "canceled",
  );
  assert.equal(
    (await api.raw("SELECT * FROM grove_account(?)", [subject])).rows.length,
    0,
  );
});

test("ordinary owners can inspect persisted failure and request scoped recovery without Stripe I/O", async () => {
  await open();
  await admin("lifecycle_release_control").update({ phase: "released" });
  const { id, subject, customer } = await account();
  const other = await account();
  await accept(
    event(customer, {
      provider: "stripe",
      type: "customer.subscription.updated",
    }),
  );
  const task = await admin("background_tasks")
    .where({ accountId: id, kind: "billing_reconcile" })
    .first();
  await admin("background_tasks").where({ id: task.id }).update({
    status: "failed",
    errorCode: "lifecycle_reconciliation_failed",
    attempts: 5,
  });
  const stripe = new Stripe("sk_test_status", {
    httpClient: Stripe.createFetchHttpClient(async () => {
      throw new Error("Recovery must not call Stripe");
    }),
  });
  const billing = new Billing(
    new MemoryService(api, "scoped-recovery-fixture-secret"),
    {
      stripe,
      webhookSecret: "whsec_status",
      siteUrl: "https://example.invalid",
      prices: {},
      enabled: async () => true,
    },
  );
  assert.equal(typeof billing.reconciliation, "function");
  const owner = sessionPrincipal(id, subject),
    foreign = sessionPrincipal(other.id, other.subject);
  assert.equal((await billing.reconciliation(owner))?.status, "failed");
  assert.equal(await billing.reconciliation(foreign), null);
  await assert.rejects(
    billing.retryReconciliation(foreign, task.id, randomUUID()),
  );
  const result = await billing.retryReconciliation(
    owner,
    task.id,
    randomUUID(),
  );
  assert.notEqual(result.id, task.id);
  assert.equal((await billing.reconciliation(owner))?.status, "pending");
  await open();
});
