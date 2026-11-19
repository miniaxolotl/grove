import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { randomUUID } from "node:crypto";
import { createDatabase, migrationSource, type Knex } from "@lib/database";
import type { LifecycleEvent } from "../../packages/api/src/lifecycle-ingress.ts";
import { reconcileLifecycleBilling } from "../../packages/api/src/lifecycle-billing.ts";
import { createServer } from "node:http";
import { createLifecycleStripe } from "../../packages/api/src/lifecycle-billing.ts";
import { JobBroker } from "../../packages/api/src/broker.ts";

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
  assert.equal(all.at(-1)?.name, "20261119_048_lifecycle_reconciliation");
  await open();
  await assert.rejects(
    api("lifecycle_release_control").update({ phase: "released" }),
    /permission denied/,
  );
  await assert.rejects(api("lifecycle_events"), /permission denied/);
  await assert.rejects(worker("lifecycle_events"), /permission denied/);
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
    assert.equal(
      (await admin("billing_subscriptions").where({ accountId: id })).length,
      0,
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
