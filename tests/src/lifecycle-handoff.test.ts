import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { randomUUID } from "node:crypto";
import { createDatabase, type Knex } from "@lib/database";
import {
  createLifecycleStripe,
  reconcileLifecycleBilling,
} from "../../packages/api/src/lifecycle-billing.ts";
import { startLifecycleRuntime } from "../../packages/api/src/lifecycle-runtime.ts";
import { createHash } from "node:crypto";
import { Webhook } from "svix";
import { setTimeout as delay } from "node:timers/promises";

const ownerUrl = process.env.TEST_MIGRATION_DATABASE_URL!;
assert(new URL(ownerUrl).pathname.endsWith("_test"));
const authority = createDatabase(ownerUrl),
  name = `grove_handoff_${randomUUID().replaceAll("-", "")}_test`;
let admin: Knex, api: Knex, worker: Knex, accountId: string;
const release = "a".repeat(64),
  receipt = "b".repeat(64),
  approval = "e".repeat(64),
  subject = "user_handoff",
  customer = "cus_handoff";
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
  await admin("lifecycle_release_control").insert({
    releaseHash: release,
    receiptHash: receipt,
  });
  accountId = (await api.raw("SELECT id FROM grove_account(?)", [subject]))
    .rows[0].id;
  await admin("billing_customers").insert({ accountId, customerId: customer });
});
after(async () => {
  await Promise.all([admin?.destroy(), api?.destroy(), worker?.destroy()]);
  await authority.raw("DROP DATABASE IF EXISTS ??", [name]);
  await authority.destroy();
});
const status = async () =>
  (
    await worker.raw("SELECT grove_lifecycle_status(?,?) AS evidence", [
      release,
      receipt,
    ])
  ).rows[0].evidence;
const accept = () =>
  api.raw("SELECT grove_lifecycle_accept(?,?,?,?,?,?,?,?,?)", [
    release,
    receipt,
    "clerk",
    `msg_${randomUUID()}`,
    "c".repeat(64),
    "user.updated",
    subject,
    Date.now(),
    false,
  ]);
const handoff = (generation: string) =>
  admin.raw("SELECT grove_lifecycle_handoff(?,?,?,?) AS evidence", [
    release,
    receipt,
    generation,
    approval,
  ]);

test("handoff requires actual persisted remote evidence for every mapped customer, not zero-count attestation", async () => {
  assert.equal(
    (await status()).caughtUp,
    false,
    "Unenrolled restored customer must block handoff",
  );
  await assert.rejects(handoff("0"), /not reconciled/);
  assert.equal(
    (
      await worker.raw("SELECT grove_lifecycle_enroll(?,?) AS queued", [
        release,
        receipt,
      ])
    ).rows[0].queued,
    1,
  );
  assert.equal(
    (
      await worker.raw("SELECT grove_lifecycle_enroll(?,?) AS queued", [
        release,
        receipt,
      ])
    ).rows[0].queued,
    0,
    "Restored customer discovery is durable and idempotent",
  );
  await accept();
  assert.equal((await status()).caughtUp, false);
  const stripe = createLifecycleStripe("sk_test_handoff", async (url, init) => {
    assert.equal(new URL(String(url)).origin, "https://api.stripe.com");
    assert.equal(init?.method, "GET");
    return Response.json({ has_more: false, data: [] });
  });
  assert.equal(
    await reconcileLifecycleBilling(worker, stripe, { release, receipt }),
    true,
  );
  const evidence = await status();
  assert.equal(evidence.caughtUp, true);
  await admin("billing_customers")
    .where({ accountId })
    .update({ customerId: "cus_handoff_foreign" });
  assert.equal(
    (await status()).caughtUp,
    false,
    "Evidence for an old customer cannot qualify a new mapping",
  );
  await admin("billing_customers")
    .where({ accountId })
    .update({ customerId: customer });
  assert.match(evidence.authorityHash, /^[a-f0-9]{64}$/);
  assert.match(evidence.remoteHash, /^[a-f0-9]{64}$/);
  assert.equal(evidence.customers, 1);
  assert.equal(evidence.remoteVerified, 1);
  await handoff(evidence.generation);
  const control = await admin("lifecycle_release_control").first();
  assert.equal(control.phase, "handoff");
  assert.deepEqual(control.handoffEvidence, evidence);
  await assert.rejects(
    api.raw("SELECT grove_lifecycle_handoff(?,?,?,?)", [
      release,
      receipt,
      evidence.generation,
      approval,
    ]),
    /permission denied/,
  );
});
test("new event invalidates an earlier handoff and runtime approval across restart", async () => {
  const previous = await status();
  await accept();
  const released = await worker.raw(
    "SELECT grove_lifecycle_release(?,?,?) AS admitted",
    [release, receipt, approval],
  );
  assert.equal(released.rows[0].admitted, false);
  await assert.rejects(handoff(previous.generation), /generation fence/);
  const control = await admin("lifecycle_release_control").first();
  assert.equal(control.handoffEvidence, null);
  assert.equal(control.approvalHash, null);
});
test("only exact persisted handoff becomes released, atomically before any general runtime initialization", async () => {
  const stripe = createLifecycleStripe("sk_test_handoff", async () =>
    Response.json({ has_more: false, data: [] }),
  );
  assert.equal(
    await reconcileLifecycleBilling(worker, stripe, { release, receipt }),
    true,
  );
  await handoff((await status()).generation);
  const releaseRuntime = (hash = approval) =>
    worker.raw("SELECT grove_lifecycle_release(?,?,?) AS admitted", [
      release,
      receipt,
      hash,
    ]);
  assert.equal((await releaseRuntime("f".repeat(64))).rows[0].admitted, false);
  assert.equal((await releaseRuntime()).rows[0].admitted, true);
  assert.equal(
    (await admin("lifecycle_release_control").first()).phase,
    "released",
  );
  assert.equal(
    (await releaseRuntime()).rows[0].admitted,
    true,
    "Exact approved restart must be idempotent",
  );
  assert.equal(
    (
      await api.raw(
        "SELECT grove_lifecycle_release_approved(?,?) AS admitted",
        [release, approval],
      )
    ).rows[0].admitted,
    true,
  );
  assert.equal(
    (
      await api.raw("SELECT grove_lifecycle_bound(?,?) AS bound", [
        release,
        receipt,
      ])
    ).rows[0].bound,
    true,
  );
  assert.equal(
    (
      await api.raw("SELECT grove_lifecycle_bound(?,?) AS bound", [
        release,
        "f".repeat(64),
      ])
    ).rows[0].bound,
    false,
  );
});

test("actual narrow API restart preserves durable authority and rejects every general route", async () => {
  const identity = {
    schema: 1 as const,
    source: "1".repeat(40),
    production: "2".repeat(40),
    tag: "v1.11.30",
    run: 123,
    attempt: 1,
    digest: `sha256:${"3".repeat(64)}`,
    publication: "4".repeat(64),
  };
  const hash = createHash("sha256")
    .update(
      JSON.stringify(
        Object.fromEntries(
          Object.keys(identity)
            .sort()
            .map((key) => [key, identity[key as keyof typeof identity]]),
        ),
      ),
    )
    .digest("hex");
  await admin("lifecycle_release_control").update({
    releaseHash: hash,
    phase: "reconcile",
    approvalHash: null,
    approvedGeneration: null,
    handoffEvidence: null,
  });
  const secret = `whsec_${Buffer.from("synthetic-restart-clerk-key").toString("base64")}`;
  const env = {
    PORT: "0",
    CLERK_WEBHOOK_SIGNING_SECRET: secret,
    STRIPE_WEBHOOK_SECRET: "whsec_restart",
    STRIPE_SECRET_KEY: "sk_test_restart",
  };
  const start = startLifecycleRuntime;
  assert.equal(typeof start, "function");
  for (let attempt = 0; attempt < 2; attempt++) {
    const running = await start(identity, receipt, "api", env, {
      database: api,
    });
    const address = running.server.address();
    assert(address && typeof address !== "string");
    const origin = `http://127.0.0.1:${address.port}`;
    try {
      assert.equal((await fetch(`${origin}/health/ready`)).status, 503);
      assert.equal((await fetch(`${origin}/v1/me`)).status, 503);
      assert.equal(
        (await fetch(`${origin}/mcp`, { method: "POST" })).status,
        503,
      );
      const raw = JSON.stringify({
        type: "user.updated",
        timestamp: Date.now(),
        data: { id: subject },
      });
      const at = new Date(),
        key = `msg_restart_${attempt}`;
      const response = await fetch(`${origin}/v1/webhooks/clerk`, {
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
    } finally {
      await running.close();
    }
  }
  let providerReads = 0;
  const stripe = createLifecycleStripe(
    "sk_test_restart",
    async (_url, init) => {
      providerReads++;
      assert.equal(init?.method, "GET");
      assert.equal(
        (
          await admin.raw(
            "SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND application_name='grove' AND pid<>pg_backend_pid() AND xact_start IS NOT NULL",
          )
        ).rows.length,
        0,
      );
      return Response.json({ has_more: false, data: [] });
    },
  );
  assert(process.env.TEST_AMQP_URL, "Use the task-owned disposable broker");
  const running = await start(
    identity,
    receipt,
    "worker",
    { ...env, AMQP_URL: process.env.TEST_AMQP_URL },
    { database: worker, stripe },
  );
  try {
    for (let tries = 0; tries < 100; tries++) {
      const state = await admin("lifecycle_billing_state")
        .where({ accountId })
        .first();
      if (state.reconciledGeneration === state.generation) break;
      await delay(50);
    }
    const state = await admin("lifecycle_billing_state")
      .where({ accountId })
      .first();
    assert.equal(state.reconciledGeneration, state.generation);
    assert(providerReads >= 2);
    assert.equal(
      (
        await admin("transactional_emails")
          .where({ accountId })
          .whereNotNull("sent_at")
      ).length,
      0,
    );
  } finally {
    await running.close();
  }
});
