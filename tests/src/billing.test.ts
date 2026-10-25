import { after, before, test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createHmac } from "node:crypto";
import { createServer } from "node:http";
import Stripe from "stripe";
import { InferenceError } from "@lib/ai";
import {
  billingLimits,
  billingUnits,
  resourceLimits,
} from "@lib/shared/billing";
import { rememberSchema } from "@lib/shared/contracts";
import * as application from "../../packages/api/src/app.ts";
import { readServerEnvironment } from "@lib/environment";
import { createDatabase, tenant, type Knex } from "@lib/database";
import * as memory from "@lib/memory";
import { budgetedInference } from "../../lib/memory/src/processing.ts";
import {
  billingAllows,
  reserveAction,
  settleAction,
} from "../../lib/memory/src/billing-quotas.ts";

const authorityUrl = process.env.TEST_MIGRATION_DATABASE_URL!;
if (!authorityUrl || !new URL(authorityUrl).pathname.endsWith("_test"))
  throw new Error("Use a disposable test database");
const authority = createDatabase(authorityUrl);
const name = `grove_billing_${randomUUID().replaceAll("-", "")}_test`;
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

// Real Stripe SDK over loopback: idempotent creates replay the original response,
// while retrieval returns the current session/subscription state.
async function lifecycle(t: TestContext) {
  const principal = await account();
  const customer = `cus_${principal.accountId}`;
  const subscriptions: Stripe.Subscription[] = [];
  const sessions = new Map<string, Stripe.Checkout.Session>();
  const replays = new Map<string, Stripe.Checkout.Session>();
  const state = { loseCheckout: false, failList: false, lists: 0, canceled: 0 };
  const remote = createServer(async (req, res) => {
    for await (const _chunk of req) {
      /* drain the SDK request */
    }
    res.setHeader("content-type", "application/json");
    const path = req.url!.split("?")[0];
    let result: unknown;
    if (path.startsWith("/v1/prices/")) {
      const id = path.split("/").at(-1)!;
      result = {
        id,
        active: true,
        type: "recurring",
        currency: "usd",
        unit_amount: 500,
        recurring: {
          interval: id === "price_year" ? "year" : "month",
          interval_count: 1,
          usage_type: "licensed",
        },
      };
    } else if (path === "/v1/customers") result = { id: customer };
    else if (path === "/v1/subscriptions") {
      state.lists++;
      if (state.failList) {
        res.statusCode = 503;
        result = { error: { message: "Synthetic provider outage" } };
      } else result = { data: subscriptions, has_more: false };
    } else if (
      path.startsWith("/v1/subscriptions/") &&
      req.method === "DELETE"
    ) {
      const subscription = subscriptions.find(
        (s) => s.id === path.split("/").at(-1),
      )!;
      subscription.status = "canceled";
      state.canceled++;
      result = subscription;
    } else if (path === "/v1/checkout/sessions") {
      const key = req.headers["idempotency-key"] as string;
      if (!replays.has(key)) {
        const id = `cs_${sessions.size + 1}`;
        const session = {
          id,
          status: "open",
          subscription: null,
          url: `https://checkout.stripe.com/c/pay/${id}`,
        } as Stripe.Checkout.Session;
        sessions.set(id, session);
        replays.set(key, { ...session });
      }
      result = replays.get(key);
      if (state.loseCheckout) {
        res.destroy();
        return;
      }
    } else if (path.startsWith("/v1/checkout/sessions/")) {
      const session = sessions.get(path.split("/")[4])!;
      if (path.endsWith("/expire") && session.status !== "open") {
        res.statusCode = 400;
        result = { error: { message: "Only open sessions can expire" } };
      } else {
        if (path.endsWith("/expire")) session.status = "expired";
        result = session;
      }
    } else {
      res.statusCode = 404;
      result = { error: { message: "Unknown fixture route" } };
    }
    res.end(JSON.stringify(result));
  });
  await new Promise<void>((resolve) => remote.listen(0, "127.0.0.1", resolve));
  t.after(
    () =>
      new Promise<void>((resolve, reject) =>
        remote.close((error) => (error ? reject(error) : resolve())),
      ),
  );
  const stripe = new Stripe("sk_test_fixture", {
    host: "127.0.0.1",
    port: (remote.address() as { port: number }).port,
    protocol: "http",
    maxNetworkRetries: 0,
  });
  const options = {
    stripe,
    webhookSecret: "whsec_fixture",
    siteUrl: "https://site.example",
    prices: { month: "price_pro", year: "price_year" },
    enabled: async () => true,
  };
  const billing = new application.Billing(
    new memory.MemoryService(db, "billing-fixture-cursor-secret-32-characters"),
    options,
  );
  const subscription = (status: Stripe.Subscription.Status) =>
    ({
      id: `sub_${principal.accountId}`,
      customer,
      status,
      cancel_at_period_end: false,
      items: {
        data: [
          {
            quantity: 1,
            current_period_end: Math.floor(Date.now() / 1000) + 86400,
            price: { id: "price_pro", product: "prod_grove" },
          },
        ],
      },
    }) as Stripe.Subscription;
  const webhook = (id: string, type = "customer.subscription.updated") => {
    const body = JSON.stringify({
      id,
      type,
      data: { object: { customer, status: "active" } },
    });
    return billing.webhook(
      body,
      stripe.webhooks.generateTestHeaderString({
        payload: body,
        secret: options.webhookSecret,
      }),
    );
  };
  return {
    principal,
    billing,
    options,
    sessions,
    subscriptions,
    state,
    subscription,
    webhook,
  };
}

for (const interval of ["month", "year"] as const) {
  for (const status of ["canceled", "incomplete_expired"] as const) {
    test(`a completed checkout permits ${interval} resubscription after ${status}`, async (t) => {
      const f = await lifecycle(t);
      const first = await f.billing.checkout(f.principal, "month");
      const ended = f.subscription(status);
      f.subscriptions.push(ended);
      Object.assign(f.sessions.get("cs_1")!, {
        status: "complete",
        subscription: ended.id,
        url: null,
      });
      const next = await f.billing.checkout(f.principal, interval);
      assert.notEqual(next.url, first.url);
      assert.equal(f.sessions.size, 2);
    });
  }
}

test("lost Checkout responses recover current expiry before returning a payment URL", async (t) => {
  const f = await lifecycle(t);
  f.state.loseCheckout = true;
  await assert.rejects(f.billing.checkout(f.principal, "month"));
  f.state.loseCheckout = false;
  f.sessions.get("cs_1")!.status = "expired";
  const next = await f.billing.checkout(f.principal, "month");
  assert.equal(next.url, "https://checkout.stripe.com/c/pay/cs_2");
  assert.equal(f.sessions.size, 2);
});

test("completed checkout without a canonical terminal subscription stays fenced", async (t) => {
  const f = await lifecycle(t);
  await f.billing.checkout(f.principal, "month");
  Object.assign(f.sessions.get("cs_1")!, {
    status: "complete",
    subscription: "sub_not_visible",
    url: null,
  });
  await assert.rejects(f.billing.checkout(f.principal, "month"), {
    code: "checkout_processing",
  });
  assert.equal(f.sessions.size, 1);
});

test("webhook retries only commit successful canonical reconciliation and handle payment/cancellation states", async (t) => {
  const f = await lifecycle(t);
  memory.configureBillingQuotas(db, {
    enabled: async () => true,
    priceIds: ["price_pro"],
  });
  await f.billing.checkout(f.principal, "month");
  f.subscriptions.push(f.subscription("active"));
  f.state.failList = true;
  await assert.rejects(f.webhook("evt_retry"));
  assert.equal(
    await admin("billing_events").where({ id: "evt_retry" }).first(),
    undefined,
  );
  f.state.failList = false;
  await f.webhook("evt_retry", "invoice.paid");
  const lists = f.state.lists;
  await f.webhook("evt_retry", "invoice.paid");
  assert.equal(f.state.lists, lists);
  const usage = () =>
    tenant(db, f.principal.accountId, (trx) =>
      memory.billingUsage(db, trx, f.principal.accountId),
    );
  assert.equal((await usage())!.plan, "pro");
  for (const status of [
    "past_due",
    "unpaid",
    "incomplete",
    "incomplete_expired",
    "paused",
    "canceled",
  ] as const) {
    f.subscriptions[0].status = status;
    await f.webhook(
      `evt_${status}`,
      status === "past_due"
        ? "invoice.payment_failed"
        : "customer.subscription.updated",
    );
    assert.equal((await usage())!.plan, "free", status);
  }
  f.subscriptions[0].status = "active";
  f.subscriptions[0].cancel_at_period_end = true;
  await f.webhook("evt_period_end");
  assert.equal((await usage())!.plan, "pro");
  await admin("accounts")
    .where({ id: f.principal.accountId })
    .update({ status: "deleting" });
  await f.webhook("evt_late_paid", "invoice.paid");
  assert.equal(f.state.canceled, 1);
  assert.equal((await usage())!.plan, "free");
});

test("non-owner worker cancellation expires checkout and stops renewal idempotently", async (t) => {
  const f = await lifecycle(t);
  await f.billing.checkout(f.principal, "month");
  f.subscriptions.push(f.subscription("active"));
  const billing = new application.Billing(
    new memory.MemoryService(
      worker,
      "billing-fixture-cursor-secret-32-characters",
    ),
    f.options,
  );
  await billing.cancelForDeletion(f.principal.accountId);
  await billing.cancelForDeletion(f.principal.accountId);
  assert.equal(f.state.canceled, 1);
  assert.equal(f.sessions.get("cs_1")!.status, "expired");
});

test("deletion recovers a completed lost checkout without trying to expire it", async (t) => {
  const f = await lifecycle(t);
  f.state.loseCheckout = true;
  await assert.rejects(f.billing.checkout(f.principal, "month"));
  f.state.loseCheckout = false;
  const paid = f.subscription("active");
  f.subscriptions.push(paid);
  Object.assign(f.sessions.get("cs_1")!, {
    status: "complete",
    subscription: paid.id,
    url: null,
  });
  const billing = new application.Billing(
    new memory.MemoryService(
      worker,
      "billing-fixture-cursor-secret-32-characters",
    ),
    f.options,
  );
  await billing.cancelForDeletion(f.principal.accountId);
  assert.equal(f.state.canceled, 1);
  assert.equal(f.sessions.get("cs_1")!.status, "complete");
});
after(async () => {
  await Promise.all([db?.destroy(), worker?.destroy(), admin?.destroy()]);
  await authority.raw("DROP DATABASE ?? WITH (FORCE)", [name]);
  await authority.destroy();
});
async function account() {
  const subject = `billing_${randomUUID()}`;
  const { rows } = await db.raw("SELECT * FROM grove_account(?)", [subject]);
  return memory.sessionPrincipal(rows[0].id, subject);
}

test("session plan identifies Free, paid and trial access using only eligible subscriptions", async () => {
  memory.configureBillingQuotas(db, {
    enabled: async () => true,
    priceIds: ["price_pro"],
    productId: "prod_grove",
  });
  const principal = await account();
  const service = new memory.MemoryService(
    db,
    "plan-fixture-cursor-secret-32-characters",
  );
  const plan = async () =>
    ((await service.me(principal)) as { plan?: unknown }).plan;
  assert.deepEqual(await plan(), { tier: "free", source: "free" });
  const id = `sub_plan_${randomUUID()}`;
  await tenant(db, principal.accountId, (trx) =>
    trx("billing_customers").insert({
      accountId: principal.accountId,
      customerId: "cus_plan",
    }),
  );
  await tenant(db, principal.accountId, (trx) =>
    trx("billing_subscriptions").insert({
      id,
      accountId: principal.accountId,
      customerId: "cus_plan",
      priceId: "price_pro",
      status: "active",
      periodEnd: new Date(Date.now() + 86400000),
      cancelAtPeriodEnd: true,
    }),
  );
  assert.deepEqual(await plan(), { tier: "pro", source: "paid" });
  await tenant(db, principal.accountId, (trx) =>
    trx("billing_subscriptions").where({ id }).update({ status: "trialing" }),
  );
  assert.deepEqual(await plan(), { tier: "pro", source: "trial" });
  for (const change of [
    { status: "past_due" },
    { status: "unpaid" },
    { status: "canceled" },
    { status: "active", periodEnd: new Date(Date.now() - 1000) },
    { periodEnd: new Date(Date.now() + 86400000), priceId: "price_unrelated" },
  ]) {
    await tenant(db, principal.accountId, (trx) =>
      trx("billing_subscriptions").where({ id }).update(change),
    );
    assert.deepEqual(await plan(), { tier: "free", source: "free" });
  }
  await tenant(db, principal.accountId, (trx) =>
    trx("billing_subscriptions")
      .where({ id })
      .update({ productId: "prod_grove" }),
  );
  assert.deepEqual(await plan(), { tier: "pro", source: "paid" });
  const other = await account();
  assert.deepEqual(((await service.me(other)) as { plan?: unknown }).plan, {
    tier: "free",
    source: "free",
  });
  await assert.rejects(service.me({ ...principal, type: "key" }), {
    status: 403,
  });
  await assert.rejects(service.me({ ...principal, type: "oauth" }), {
    status: 403,
  });
  const issued = await service.grant(
    principal,
    {
      name: "Plan fixture reader",
      capabilities: ["memory:read"],
      personal: true,
      allProjects: false,
      projectIds: [],
    },
    { key: true },
  );
  assert.equal(
    (
      (await service.me({
        ...principal,
        type: "key",
        connectionId: issued.connection.id,
      })) as { plan?: unknown }
    ).plan,
    undefined,
  );
});

test("complimentary plan is visible with billing off and takes precedence without changing a paid subscription", async (t) => {
  const f = await lifecycle(t);
  let enabled = true;
  memory.configureBillingQuotas(db, {
    enabled: async () => enabled,
    priceIds: ["price_pro"],
  });
  const service = new memory.MemoryService(
    db,
    "plan-fixture-cursor-secret-32-characters",
  );
  const plan = async () =>
    ((await service.me(f.principal)) as { plan?: unknown }).plan;
  await f.billing.checkout(f.principal, "month");
  f.subscriptions.push(f.subscription("active"));
  await f.webhook(`evt_plan_${randomUUID()}`);
  for (const tier of ["pro", "unlimited"] as const) {
    await admin("account_administration")
      .insert({ accountId: f.principal.accountId, access: tier })
      .onConflict("accountId")
      .merge({ access: tier });
    const expected = { tier, source: "complimentary" };
    const providerReads = f.state.lists;
    assert.deepEqual(await plan(), expected);
    assert.equal(
      f.state.lists,
      providerReads,
      "workspace reads do not contact Stripe",
    );
    assert.deepEqual(
      ((await f.billing.status(f.principal)) as { plan?: unknown }).plan,
      expected,
    );
    enabled = false;
    assert.deepEqual(await plan(), expected);
    enabled = true;
  }
  assert.equal(f.state.canceled, 0);
  await admin("account_administration")
    .where({ accountId: f.principal.accountId })
    .update({ access: "default" });
  assert.deepEqual(await plan(), { tier: "pro", source: "paid" });
  enabled = false;
  assert.equal(await plan(), null);
  enabled = true;
  assert.equal((await f.billing.status(f.principal)).usage?.plan, "pro");
  const unconfigured = new memory.MemoryService(
    worker,
    "plan-fixture-cursor-secret-32-characters",
  );
  assert.equal(
    ((await unconfigured.me(f.principal)) as { plan?: unknown }).plan,
    null,
  );
});

test("account usage exposes an owner-only local plan breakdown with actual used, pending and configured limits", async () => {
  memory.configureBillingQuotas(db, {
    enabled: async () => true,
    priceIds: ["price_pro"],
    resourceLimits: {
      free: { ...resourceLimits.free, ask: 7 },
      pro: resourceLimits.pro,
    },
  });
  const principal = await account();
  const service = new memory.MemoryService(
    db,
    "usage-fixture-cursor-secret-32-characters",
  );
  await service.remember(
    principal,
    rememberSchema.parse({
      operationId: randomUUID(),
      content: "Usage snapshot fixture",
    }),
  );
  await tenant(db, principal.accountId, async (trx) => {
    const completed = await reserveAction(
      db,
      trx,
      principal.accountId,
      "ask",
      randomUUID(),
    );
    await settleAction(trx, completed, "completed");
    await reserveAction(db, trx, principal.accountId, "ask", randomUUID());
    await trx("inference_usage").insert({
      accountId: principal.accountId,
      role: "generation",
      requests: 3,
      day: trx.raw("(now() AT TIME ZONE 'UTC')::date"),
    });
  });
  const result = await service.usage(principal);
  const snapshot = Reflect.get(result, "planUsage");
  assert.deepEqual(snapshot?.plan, { tier: "free", source: "free" });
  assert(snapshot.resources && snapshot.usage);
  assert.deepEqual(snapshot.resources.metrics.ask, {
    used: 1,
    reserved: 1,
    limit: 7,
  });
  assert.equal(snapshot.resources.metrics.notes.used, 1);
  assert.equal(snapshot.usage.metrics.generation.today, 3);
  assert.deepEqual(snapshot.units, billingUnits);
  assert.equal(typeof snapshot.resources.resetAt, "string");
  assert.equal(typeof snapshot.usage.monthlyResetAt, "string");
  const other = await account();
  const otherUsage = Reflect.get(await service.usage(other), "planUsage");
  assert(otherUsage.resources);
  assert.equal(otherUsage.resources.metrics.ask.used, 0);
  await assert.rejects(service.usage({ ...principal, type: "key" }), {
    status: 403,
  });
  await assert.rejects(service.usage({ ...principal, type: "oauth" }), {
    status: 403,
  });
});

test("usage breakdown preserves complimentary unlimited with purchases hidden and explicitly reports unconfigured policy", async () => {
  memory.configureBillingQuotas(db, {
    enabled: async () => false,
    priceIds: ["price_pro"],
  });
  const principal = await account();
  await admin("account_administration").insert({
    accountId: principal.accountId,
    access: "unlimited",
  });
  const service = new memory.MemoryService(
    db,
    "usage-fixture-cursor-secret-32-characters",
  );
  const snapshot = Reflect.get(await service.usage(principal), "planUsage");
  assert.deepEqual(snapshot?.plan, {
    tier: "unlimited",
    source: "complimentary",
  });
  assert(snapshot.resources && snapshot.usage);
  assert.equal(snapshot.resources.metrics.ask.limit, null);
  assert.equal(snapshot.usage.metrics.synthesis.monthlyLimit, null);
  const unconfigured = new memory.MemoryService(
    worker,
    "usage-fixture-cursor-secret-32-characters",
  );
  assert.deepEqual(
    Reflect.get(await unconfigured.usage(principal), "planUsage"),
    { plan: null, resources: null, usage: null, units: billingUnits },
  );
});

test("billing migration isolates customers and subscriptions from other tenants and worker writes", async () => {
  assert.equal(await admin.schema.hasTable("billing_customers"), true);
  const a = await account(),
    b = await account();
  await tenant(db, a.accountId, async (trx) => {
    await trx("billing_customers").insert({
      accountId: a.accountId,
      customerId: "cus_isolation",
    });
    await trx("billing_subscriptions").insert({
      accountId: a.accountId,
      customerId: "cus_isolation",
      id: "sub_isolation",
      priceId: "price_pro",
      status: "active",
      periodEnd: new Date(Date.now() + 86400000),
    });
  });
  assert.equal(
    (await tenant(db, b.accountId, (trx) => trx("billing_customers"))).length,
    0,
  );
  assert.equal(
    (await tenant(worker, b.accountId, (trx) => trx("billing_subscriptions")))
      .length,
    0,
  );
  await assert.rejects(
    tenant(worker, a.accountId, (trx) =>
      trx("billing_subscriptions").update({ status: "active" }),
    ),
    /permission denied/,
  );
  await assert.rejects(
    tenant(db, b.accountId, (trx) =>
      trx("billing_customers").insert({
        accountId: a.accountId,
        customerId: "cus_forged",
      }),
    ),
    /row-level security/,
  );
});

test("billing configuration is optional but activation requires cloud, flags and recognized prices", () => {
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
  assert.equal(defaults.BILLING_CONFIGURED, false);
  assert.throws(() =>
    readServerEnvironment({ ...env, BILLING_CONFIGURED: "true" }),
  );
  const configured = readServerEnvironment({
    ...env,
    GROVE_EDITION: "cloud",
    BILLING_CONFIGURED: "true",
    FLAGS: "flags_fixture",
    STRIPE_SECRET_KEY: "sk_test_fixture",
    STRIPE_WEBHOOK_SECRET: "whsec_fixture",
    STRIPE_PRO_MONTHLY_PRICE_ID: "price_pro",
  });
  assert.equal(configured.BILLING_FREE_GENERATION_MONTHLY, 31000);
  assert.equal(configured.BILLING_PRO_TRANSCRIPTION_MONTHLY_MS, 28800000);
  assert.equal(
    readServerEnvironment({
      ...env,
      GROVE_EDITION: "cloud",
      BILLING_CONFIGURED: "true",
      FLAGS: "flags_fixture",
      STRIPE_SECRET_KEY: "rk_live_fixture",
      STRIPE_WEBHOOK_SECRET: "whsec_fixture",
      STRIPE_PRO_PRODUCT_ID: "prod_grove",
    }).STRIPE_PRO_PRODUCT_ID,
    "prod_grove",
  );
});

test("webhook customer lookup works with a non-superuser migration owner without opening runtime table access", async () => {
  const a = await account();
  await tenant(db, a.accountId, (trx) =>
    trx("billing_customers").insert({
      accountId: a.accountId,
      customerId: "cus_owner_lookup",
    }),
  );
  const owner = `billing_owner_${randomUUID().replaceAll("-", "")}`;
  await authority.raw("CREATE ROLE ?? NOLOGIN NOSUPERUSER NOBYPASSRLS", [
    owner,
  ]);
  try {
    await admin.raw("GRANT USAGE, CREATE ON SCHEMA public TO ??", [owner]);
    await admin.raw("ALTER TABLE billing_customers OWNER TO ??", [owner]);
    await admin.raw("ALTER FUNCTION grove_billing_account(text) OWNER TO ??", [
      owner,
    ]);
    assert.equal(
      (
        await db.raw("SELECT grove_billing_account(?) AS id", [
          "cus_owner_lookup",
        ])
      ).rows[0].id,
      a.accountId,
    );
    assert.equal((await db("billing_customers")).length, 0);
  } finally {
    const user = (await admin.raw("SELECT current_user AS name")).rows[0].name;
    await admin.raw("ALTER TABLE billing_customers OWNER TO ??", [user]);
    await admin.raw("ALTER FUNCTION grove_billing_account(text) OWNER TO ??", [
      user,
    ]);
    await admin.raw("REVOKE ALL ON SCHEMA public FROM ??", [owner]);
    await authority.raw("DROP ROLE ??", [owner]);
  }
});

test("flagged generation enforces a concurrent daily Free cap without blocking basic embeddings", async () => {
  assert.equal(
    typeof memory.configureBillingQuotas,
    "function",
    "runtime must install the shared API/worker quota policy",
  );
  memory.configureBillingQuotas(db, {
    enabled: async () => true,
    priceIds: ["price_pro"],
    limits: {
      free: { ...billingLimits.free, generation: { daily: 10, monthly: 100 } },
      pro: billingLimits.pro,
    },
    // Isolate attempt accounting from the separately tested two-call admission cap.
    resourceLimits: {
      free: { ...resourceLimits.free, concurrency: 14 },
      pro: resourceLimits.pro,
    },
  });
  const a = await account();
  let calls = 0;
  const results = await Promise.allSettled(
    Array.from({ length: 14 }, () =>
      budgetedInference(
        db,
        a.accountId,
        "generation",
        2000,
        async () => ++calls,
      ),
    ),
  );
  assert.equal(calls, 10);
  assert.equal(results.filter((r) => r.status === "rejected").length, 4);
  await budgetedInference(
    db,
    a.accountId,
    "embedding",
    2000,
    async () => ++calls,
  );
  assert.equal(calls, 11);
});

test("monthly usage, subscription expiry, recognized prices and rollout pause determine the allowance", async () => {
  memory.configureBillingQuotas(db, {
    enabled: async () => true,
    priceIds: ["price_pro"],
    limits: {
      free: { ...billingLimits.free, generation: { daily: 10, monthly: 100 } },
      pro: billingLimits.pro,
    },
  });
  const a = await account();
  await tenant(db, a.accountId, async (trx) => {
    await trx("inference_usage").insert({
      accountId: a.accountId,
      role: "generation",
      requests: 100,
    });
    await trx("billing_customers").insert({
      accountId: a.accountId,
      customerId: "cus_month",
    });
    await trx("billing_subscriptions").insert({
      accountId: a.accountId,
      customerId: "cus_month",
      id: "sub_month",
      priceId: "price_unknown",
      status: "active",
      periodEnd: new Date(Date.now() + 86400000),
    });
  });
  const snapshot = () =>
    tenant(db, a.accountId, (trx) => memory.billingUsage(db, trx, a.accountId));
  assert.equal((await snapshot())?.plan, "free");
  await assert.rejects(
    budgetedInference(db, a.accountId, "generation", 2000, async () => true),
  );
  await tenant(db, a.accountId, (trx) =>
    trx("billing_subscriptions").update({
      priceId: "price_pro",
      cancelAtPeriodEnd: true,
    }),
  );
  assert.equal((await snapshot())?.plan, "pro");
  await budgetedInference(
    db,
    a.accountId,
    "generation",
    2000,
    async () => true,
  );
  await tenant(db, a.accountId, (trx) =>
    trx("billing_subscriptions").update({ periodEnd: new Date(0) }),
  );
  assert.equal((await snapshot())?.plan, "free");
  memory.configureBillingQuotas(db, {
    enabled: async () => false,
    priceIds: ["price_pro"],
  });
  assert.equal(await snapshot(), null);
  await budgetedInference(
    db,
    a.accountId,
    "generation",
    2000,
    async () => true,
  );
});

for (const plan of ["free", "pro"] as const) {
  test(`${plan} monthly generation cap serializes API and worker reservations`, async () => {
    const a = await account();
    const monthly = billingLimits[plan].generation.monthly;
    const configuration = {
      enabled: async () => true,
      priceIds: ["price_pro"],
      // Isolate the monthly boundary even on the first UTC day of the month.
      limits: {
        free: {
          ...billingLimits.free,
          generation: {
            daily: 300000,
            monthly: billingLimits.free.generation.monthly,
          },
        },
        pro: {
          ...billingLimits.pro,
          generation: {
            daily: 300000,
            monthly: billingLimits.pro.generation.monthly,
          },
        },
      },
    };
    memory.configureBillingQuotas(db, configuration);
    memory.configureBillingQuotas(worker, configuration);
    await tenant(db, a.accountId, async (trx) => {
      await trx("inference_usage").insert({
        accountId: a.accountId,
        role: "generation",
        requests: monthly - 1,
      });
      if (plan === "pro") {
        await trx("billing_customers").insert({
          accountId: a.accountId,
          customerId: `cus_${a.accountId}`,
        });
        await trx("billing_subscriptions").insert({
          accountId: a.accountId,
          customerId: `cus_${a.accountId}`,
          id: `sub_${a.accountId}`,
          priceId: "price_pro",
          status: "active",
          periodEnd: new Date(Date.now() + 86400000),
        });
      }
    });
    let calls = 0;
    const attempts = await Promise.allSettled(
      Array.from({ length: 6 }, (_, index) =>
        budgetedInference(
          index % 2 ? db : worker,
          a.accountId,
          "generation",
          10000,
          async () => ++calls,
        ),
      ),
    );
    assert.equal(calls, 1);
    assert.equal(
      attempts.filter((result) => result.status === "rejected").length,
      5,
    );
    await tenant(db, a.accountId, async (trx) => {
      const usage = (await memory.billingUsage(db, trx, a.accountId))!;
      assert.equal(usage.plan, plan);
      assert.equal(usage.metrics.generation.month, monthly);
    });
    const service = new memory.MemoryService(
      db,
      "billing-fixture-cursor-secret-32-characters",
    );
    const note = await service.remember(
      a,
      rememberSchema.parse({
        operationId: randomUUID(),
        content: "Writing still works at the monthly AI limit.",
      }),
    );
    assert.equal((await service.get(a, note.id)).content, note.content);
    assert((await service.exportPage(a)).some((item) => item.id === note.id));
  });
}

test("Pro product entitlement survives flag price changes and rejects another product", async () => {
  const a = await account();
  memory.configureBillingQuotas(db, {
    enabled: async () => true,
    priceIds: [],
    productId: "prod_grove",
  });
  await tenant(db, a.accountId, async (trx) => {
    await trx("billing_customers").insert({
      accountId: a.accountId,
      customerId: "cus_product",
    });
    await trx("billing_subscriptions").insert({
      id: "sub_product",
      accountId: a.accountId,
      customerId: "cus_product",
      priceId: "price_old_500",
      productId: "prod_other",
      status: "active",
      periodEnd: new Date(Date.now() + 86400000),
    });
    assert.equal(
      (await memory.billingUsage(db, trx, a.accountId))?.plan,
      "free",
    );
    await trx("billing_subscriptions")
      .where({ id: "sub_product" })
      .update({ productId: "prod_grove" });
    assert.equal(
      (await memory.billingUsage(db, trx, a.accountId))?.plan,
      "pro",
    );
  });
});

test("UTC monthly boundaries and per-metric allowances do not mix tenants or charge embeddings", async () => {
  memory.configureBillingQuotas(db, {
    enabled: async () => true,
    priceIds: ["price_pro"],
  });
  const a = await account(),
    b = await account();
  await admin("research_account_usage").insert({
    accountId: a.accountId,
    day: admin.raw("(now() AT TIME ZONE 'UTC')::date"),
    calls: billingLimits.free.research.daily,
  });
  await tenant(db, a.accountId, async (trx) => {
    await trx("inference_usage").insert([
      {
        accountId: a.accountId,
        role: "generation",
        day: trx.raw(
          "(date_trunc('month',now() AT TIME ZONE 'UTC') - interval '1 day')::date",
        ),
        requests: 10000,
      },
      {
        accountId: a.accountId,
        role: "embedding",
        day: trx.raw("(now() AT TIME ZONE 'UTC')::date"),
        requests: 800,
      },
    ]);
    await trx("speech_usage").insert([
      {
        accountId: a.accountId,
        kind: "speech_transcribe",
        units: billingLimits.free.transcription.monthly - 1,
        requests: 1,
      },
      {
        accountId: a.accountId,
        kind: "speech_synthesize",
        units: 9999,
        durationMs: billingLimits.free.synthesis.monthly - 1,
        requests: 1,
      },
    ]);
    const usage = await memory.billingUsage(db, trx, a.accountId);
    assert.equal(usage!.metrics.generation.month, 0);
    assert.equal(await billingAllows(db, trx, a.accountId, "research"), false);
    assert.equal(
      await billingAllows(db, trx, a.accountId, "transcription", 1),
      true,
    );
    assert.equal(
      await billingAllows(db, trx, a.accountId, "transcription", 2),
      false,
    );
    assert.equal(
      await billingAllows(db, trx, a.accountId, "synthesis", 2),
      false,
    );
    assert.match(usage!.monthlyResetAt, /T00:00:00.000Z$/);
  });
  await tenant(db, b.accountId, async (trx) => {
    assert.equal(
      (await memory.billingUsage(db, trx, b.accountId))!.metrics.research.month,
      0,
    );
  });
});

test("generation reservations use the advertised UTC day even with a non-UTC database session", async () => {
  const a = await account();
  await tenant(db, a.accountId, async (trx) => {
    await trx.raw("SET LOCAL TIME ZONE 'Pacific/Kiritimati'");
    const {
      rows: [clock],
    } = await trx.raw(
      "SELECT CURRENT_DATE = (now() AT TIME ZONE 'UTC')::date AS same",
    );
    if (clock.same) await trx.raw("SET LOCAL TIME ZONE 'Etc/GMT+12'");
    memory.configureBillingQuotas(trx, {
      enabled: async () => true,
      priceIds: [],
      limits: {
        free: {
          ...billingLimits.free,
          generation: { daily: 10, monthly: 100 },
        },
        pro: billingLimits.pro,
      },
    });
    let calls = 0;
    for (let index = 0; index < 12; index++) {
      try {
        await budgetedInference(
          trx,
          a.accountId,
          "generation",
          2000,
          async () => ++calls,
        );
      } catch (error) {
        assert.equal((error as { code: string }).code, "inference_budget");
      }
    }
    assert.equal(calls, 10);
  });
});

test("Stripe Checkout is owner-only, flag-gated and retry-safe; signed events reconcile canonical subscriptions", async () => {
  assert.equal(
    typeof application.Billing,
    "function",
    "billing integration must be available",
  );
  let enabled = false,
    checkoutCalls = 0,
    cancellations = 0,
    checkoutOpen = true,
    checkoutKey = "";
  const a = await account(),
    b = await account();
  const subscription = {
    id: "sub_http",
    customer: "cus_http",
    status: "active",
    cancel_at_period_end: false,
    items: {
      data: [
        {
          price: { id: "price_pro" },
          quantity: 1,
          current_period_end: Math.floor(Date.now() / 1000) + 86400,
        },
      ],
    },
  };
  let subscribed = false;
  const remote = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const fields = new URLSearchParams(Buffer.concat(chunks).toString());
    res.setHeader("content-type", "application/json");
    const path = req.url?.split("?")[0];
    let result: unknown;
    if (path === "/v1/prices/price_pro" || path === "/v1/prices/price_year")
      result = {
        id: path.split("/").at(-1),
        active: true,
        type: "recurring",
        recurring: {
          interval: path.endsWith("price_year") ? "year" : "month",
          interval_count: 1,
          usage_type: "licensed",
        },
        unit_amount: 1200,
        currency: "usd",
      };
    else if (path === "/v1/customers") {
      assert.equal(fields.get("metadata[groveAccountId]"), a.accountId);
      assert(req.headers["idempotency-key"]);
      result = { id: "cus_http" };
    } else if (path === "/v1/subscriptions")
      result = {
        data: subscribed
          ? [
              subscription,
              {
                ...subscription,
                id: "sub_old_canceled",
                status: "canceled",
                items: {
                  data: [
                    {
                      ...subscription.items.data[0],
                      current_period_end:
                        Math.floor(Date.now() / 1000) + 864000,
                    },
                  ],
                },
              },
            ]
          : [],
        has_more: false,
      };
    else if (path === "/v1/subscriptions/sub_http" && req.method === "DELETE") {
      cancellations++;
      subscribed = false;
      result = { ...subscription, status: "canceled" };
    } else if (path === "/v1/checkout/sessions/cs_http/expire") {
      checkoutOpen = false;
      result = { id: "cs_http", status: "expired" };
    } else if (
      path === "/v1/checkout/sessions" ||
      path === "/v1/checkout/sessions/cs_http"
    ) {
      if (req.method === "POST") {
        checkoutCalls++;
        const key = req.headers["idempotency-key"] as string;
        if (key !== checkoutKey) checkoutOpen = true;
        checkoutKey = key;
        assert.equal(fields.get("mode"), "subscription");
        assert(
          ["price_pro", "price_year"].includes(
            fields.get("line_items[0][price]")!,
          ),
        );
        assert.equal(fields.get("customer"), "cus_http");
        assert.equal(
          fields.get("success_url"),
          "https://site.example/app/settings/billing?checkout=success",
        );
      }
      result = {
        id: "cs_http",
        status: checkoutOpen ? "open" : "expired",
        url: "https://checkout.stripe.com/c/pay/test",
      };
    } else if (path === "/v1/billing_portal/sessions")
      result = { url: "https://billing.stripe.com/p/session/test" };
    else {
      res.statusCode = 404;
      result = { error: { message: "Unknown fixture route" } };
    }
    res.end(JSON.stringify(result));
  });
  await new Promise<void>((resolve) => remote.listen(0, "127.0.0.1", resolve));
  const port = (remote.address() as { port: number }).port;
  try {
    const stripe = new Stripe("sk_test_fixture", {
      host: "127.0.0.1",
      port,
      protocol: "http",
      maxNetworkRetries: 0,
    });
    const service = new memory.MemoryService(
      db,
      "billing-fixture-cursor-secret-32-characters",
    );
    const billing = new application.Billing(service, {
      stripe,
      webhookSecret: "whsec_fixture",
      siteUrl: "https://site.example",
      prices: { month: "price_pro", year: "price_year" },
      enabled: async () => enabled,
    });
    await assert.rejects(billing.checkout(a, "month"), {
      code: "billing_disabled",
    });
    enabled = true;
    await assert.rejects(billing.checkout({ ...a, type: "key" }, "month"));
    const sessions = await Promise.all([
      billing.checkout(a, "month"),
      billing.checkout(a, "month"),
    ]);
    assert.equal(sessions[0].url, sessions[1].url);
    assert.equal(checkoutCalls, 1);
    assert.deepEqual(
      (await billing.status(a)).proLimits,
      billingLimits.pro,
      "upgrade must disclose the actual Pro allowances",
    );
    await assert.rejects(billing.portal(b), {
      code: "billing_customer_missing",
    });
    subscribed = true;
    const event = JSON.stringify({
      id: "evt_http",
      type: "customer.subscription.updated",
      data: { object: { ...subscription, status: "canceled" } },
    });
    const timestamp = Math.floor(Date.now() / 1000);
    const signature = `t=${timestamp},v1=${createHmac("sha256", "whsec_fixture").update(`${timestamp}.${event}`).digest("hex")}`;
    await assert.rejects(billing.webhook(event, "invalid"), {
      code: "invalid_signature",
    });
    await billing.webhook(event, signature);
    await billing.webhook(event, signature);
    assert.equal(
      (await admin("billing_events").where({ id: "evt_http" })).length,
      1,
    );
    assert.equal(
      (await admin("billing_subscriptions").where({ id: "sub_http" }).first())
        .status,
      "active",
    );
    assert.equal(
      (await billing.status(a)).subscription?.status,
      "active",
      "an older canceled subscription must not hide the ongoing subscription",
    );
    await assert.rejects(billing.checkout(a, "month"), {
      code: "subscription_exists",
    });
    enabled = false;
    await assert.rejects(billing.portal(a), { code: "billing_disabled" });
    await assert.rejects(billing.status(a), { code: "billing_disabled" });
    const app = application.createApp({
      memories: service,
      billing,
      auth: { principal: async () => a },
      origin: "https://api.example",
      siteUrl: "https://site.example",
      issuer: "https://clerk.example",
      webhookSecret: "fixture",
      ready: async () => {},
    });
    const response = await app.request("/v1/webhooks/stripe", {
      method: "POST",
      headers: { "stripe-signature": signature },
      body: event,
    });
    assert.equal(response.status, 200);
    const budgetApp = application.createApp({
      memories: service,
      billing,
      auth: {
        principal: async () => {
          throw new InferenceError("inference_budget");
        },
      },
      origin: "https://api.example",
      siteUrl: "https://site.example",
      issuer: "https://clerk.example",
      webhookSecret: "fixture",
      ready: async () => {},
    });
    const exhausted = await budgetApp.request("/v1/ask", {
      method: "POST",
      body: "{}",
    });
    assert.equal(exhausted.status, 429);
    assert.doesNotMatch(
      (await exhausted.json()).error.message,
      /Billing|upgrade|subscription/i,
    );
    assert.equal(
      typeof billing.cancelForDeletion,
      "function",
      "account deletion must stop future renewal",
    );
    await billing.cancelForDeletion(a.accountId);
    await billing.cancelForDeletion(a.accountId);
    assert.equal(cancellations, 1);
    await tenant(db, a.accountId, (trx) =>
      trx("billing_customers")
        .where({ accountId: a.accountId })
        .update({ checkoutId: null }),
    );
    checkoutOpen = true;
    const beforeRecovery = checkoutCalls;
    await billing.cancelForDeletion(a.accountId);
    assert.equal(
      checkoutCalls,
      beforeRecovery + 1,
      "deletion recovers a lost checkout response using the same operation",
    );
    enabled = true;
    await tenant(db, a.accountId, (trx) =>
      trx("billing_customers")
        .where({ accountId: a.accountId })
        .update({ checkoutId: "cs_http" }),
    );
    assert.equal(
      (await billing.checkout(a, "year")).url,
      "https://checkout.stripe.com/c/pay/test",
      "an expired monthly checkout must not block yearly billing",
    );
    await tenant(db, a.accountId, (trx) =>
      trx("billing_customers")
        .where({ accountId: a.accountId })
        .update({ checkoutId: null, checkoutPrice: null }),
    );
    let checks = 0;
    const racing = new application.Billing(service, {
      stripe,
      webhookSecret: "whsec_fixture",
      siteUrl: "https://site.example",
      prices: { month: "price_pro", year: "price_year" },
      enabled: async () => {
        if (++checks === 2)
          await admin("billing_customers")
            .where({ accountId: a.accountId })
            .update({ checkoutPrice: "price_year" });
        return true;
      },
    });
    await assert.rejects(racing.checkout(a, "month"), {
      code: "checkout_pending",
    });
  } finally {
    await new Promise<void>((resolve, reject) =>
      remote.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
