import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createHmac } from "node:crypto";
import { createServer } from "node:http";
import Stripe from "stripe";
import { InferenceError } from "@lib/ai";
import { billingLimits } from "@lib/shared/billing";
import * as application from "../../packages/api/src/app.ts";
import { readServerEnvironment } from "@lib/environment";
import { createDatabase, tenant, type Knex } from "@lib/database";
import * as memory from "@lib/memory";
import { budgetedInference } from "../../lib/memory/src/processing.ts";
import { billingAllows } from "../../lib/memory/src/billing-quotas.ts";

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
  assert.equal(configured.BILLING_FREE_GENERATION_MONTHLY, 100);
  assert.equal(configured.BILLING_PRO_TRANSCRIPTION_MONTHLY_MS, 7200000);
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
    calls: 3,
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
        units: 599999,
        requests: 1,
      },
      {
        accountId: a.accountId,
        kind: "speech_synthesize",
        units: 9999,
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
    checkoutOpen = true;
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
