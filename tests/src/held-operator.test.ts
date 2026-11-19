import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { randomUUID } from "node:crypto";
import { createDatabase, type Knex } from "@lib/database";
import {
  publication,
  recordHeld,
  recordLifecycle,
  approve,
  advance,
  receiptHash,
} from "../../scripts/release/held-state.mjs";
import { holdIdentity } from "../../scripts/release/held-provider.mjs";
import {
  applyLifecycleTransition,
  verifyLifecycleTransition,
} from "../../scripts/release/held-lifecycle.mjs";
import {
  createLifecycleStripe,
  reconcileLifecycleBilling,
} from "../../packages/api/src/lifecycle-billing.ts";
const url = process.env.TEST_MIGRATION_DATABASE_URL!;
assert(new URL(url).pathname.endsWith("_test"));
const owner = createDatabase(url),
  name = `grove_operator_${randomUUID().replaceAll("-", "")}_test`;
let admin: Knex, worker: Knex;
before(async () => {
  await owner.raw("CREATE DATABASE ??", [name]);
  const connect = (input: string) => {
    const u = new URL(input);
    u.pathname = `/${name}`;
    return createDatabase(u.href);
  };
  admin = connect(url);
  worker = connect(process.env.TEST_WORKER_DATABASE_URL!);
  await admin.migrate.latest();
});
after(async () => {
  await Promise.all([admin?.destroy(), worker?.destroy()]);
  await owner.raw("DROP DATABASE IF EXISTS ??", [name]);
  await owner.destroy();
});
test("source controller composes owner admission, actual reconciliation, exact handoff and public authority without deleting billing history", async () => {
  const now = Date.now(),
    context = {
      repository: "miniaxolotl/grove",
      actor: "miniaxolotl",
      protected: true,
      source: "a".repeat(40),
      production: "b".repeat(40),
      tree: "c".repeat(40),
      tag: "v1.11.30",
      apiVersion: "1.11.30",
      run: 123,
      attempt: 1,
    };
  const p = publication(context, `sha256:${"d".repeat(64)}`, now);
  const snapshot = {
    fingerprint: "1".repeat(64),
    generation: "fixture-generation",
    instances: [
      { component: "api", name: "api-1" },
      { component: "worker", name: "worker-1" },
    ],
    proofs: [
      {
        component: "api",
        name: "api-1",
        challenge: "5".repeat(64),
        response: "6".repeat(64),
      },
      {
        component: "worker",
        name: "worker-1",
        challenge: "7".repeat(64),
        response: "8".repeat(64),
      },
    ],
    observedAt: new Date(now).toISOString(),
  };
  const h = recordHeld(p, snapshot, context, now),
    release = receiptHash(holdIdentity(p)),
    receipt = receiptHash(h);
  const base = {
    schema: 1,
    id: randomUUID(),
    source: context.source,
    publication: receiptHash(p),
    manifest: "3".repeat(64),
    issuedAt: now,
    expiresAt: now + 60000,
    approved: true,
  };
  const transaction = (
    db: Knex,
    run: (trx: Knex.Transaction) => Promise<unknown>,
  ) =>
    db.transaction(async (trx) => {
      await trx.raw(
        "SET LOCAL lock_timeout='1500ms'; SET LOCAL statement_timeout='10000ms'",
      );
      return run(trx);
    });
  const admission = {
    ...base,
    action: "admit",
    parent: receiptHash(h),
    expected: receiptHash(null),
    proposed: receiptHash({ release, receipt, phase: "reconcile" }),
  };
  await applyLifecycleTransition(admin, transaction, p, h, admission);
  await applyLifecycleTransition(admin, transaction, p, h, admission);
  assert.equal(
    (await verifyLifecycleTransition(admin, p, h, admission)).control.phase,
    "reconcile",
  );
  const subject = `user_${randomUUID()}`,
    id = (await admin.raw("SELECT id FROM grove_account(?)", [subject])).rows[0]
      .id;
  await admin("billing_customers").insert({
    accountId: id,
    customerId: "cus_controller",
  });
  await worker.raw("SELECT grove_lifecycle_enroll(?,?)", [release, receipt]);
  assert.equal(
    await reconcileLifecycleBilling(
      worker,
      createLifecycleStripe("sk_test_controller", async () =>
        Response.json({ data: [], has_more: false }),
      ),
      { release, receipt },
    ),
    true,
  );
  const evidence = (
    await admin.raw("SELECT grove_lifecycle_proof(?,?) AS evidence", [
      release,
      receipt,
    ])
  ).rows[0].evidence;
  const l = recordLifecycle(
    p,
    h,
    { ...snapshot, ingress: true, lifecycle: evidence },
    context,
    now,
  );
  const { control, ...raw } = evidence;
  assert.equal(control.phase, "reconcile");
  const handoff = {
    ...base,
    id: randomUUID(),
    action: "handoff",
    parent: receiptHash(l),
    expected: receiptHash(raw),
    proposed: receiptHash({
      release,
      receipt,
      phase: "handoff",
      evidence: raw,
    }),
  };
  await assert.rejects(
    applyLifecycleTransition(worker, transaction, p, l, handoff),
  );
  await applyLifecycleTransition(admin, transaction, p, l, handoff);
  await applyLifecycleTransition(admin, transaction, p, l, handoff);
  assert.equal(
    (await verifyLifecycleTransition(admin, p, l, handoff)).control
      .approvalHash,
    receiptHash(handoff),
  );
  const e = approve(
    p,
    l,
    {
      held: receiptHash(l),
      authority: raw.authorityHash,
      providers: raw.remoteHash,
      pending: 0,
      uncertain: 0,
      reconciledAt: new Date(now).toISOString(),
      approved: true,
      command: receiptHash(handoff),
    },
    context,
    now,
    ({
      source,
      held,
      authority,
      providers,
    }: {
      source: string;
      held: string;
      authority: string;
      providers: string;
    }) => ({
      source,
      held,
      authority,
      providers,
      manifest: base.manifest,
      contract: "qualified-lifecycle-and-remote-reconciliation",
    }),
  );
  assert.equal(
    (
      await worker.raw(
        "SELECT grove_lifecycle_release_approved(?,?) AS allowed",
        [release, receiptHash(handoff)],
      )
    ).rows[0].allowed,
    true,
  );
  const runtimeEvidence = (
    await admin.raw("SELECT grove_lifecycle_proof(?,?) AS evidence", [
      release,
      receipt,
    ])
  ).rows[0].evidence;
  const r = advance(p, e, "runtime_verified", context, now, {
    ...snapshot,
    ingress: true,
    lifecycle: runtimeEvidence,
  });
  const { control: released, ...publicRaw } = runtimeEvidence;
  assert.equal(released.phase, "released");
  const open = {
    ...base,
    id: randomUUID(),
    action: "open-public",
    parent: receiptHash(r),
    expected: receiptHash(publicRaw),
    proposed: receiptHash({
      release,
      receipt,
      phase: "public",
      evidence: publicRaw,
    }),
  };
  await applyLifecycleTransition(admin, transaction, p, r, open);
  await applyLifecycleTransition(admin, transaction, p, r, open);
  assert.equal(
    (await verifyLifecycleTransition(admin, p, r, open)).control.publicHash,
    receiptHash(open),
  );
});
