import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { zipSync, strToU8 } from "fflate";
import {
  publication,
  recordHeld,
  recordLifecycle,
  approve,
  advance,
  receiptHash,
} from "./held-state.mjs";
import * as artifacts from "./held-artifacts.mjs";
import { pendingPublication } from "./held-delivery.mjs";

const now = Date.parse("2026-11-19T10:00:00Z");
const context = {
  repository: "miniaxolotl/grove",
  source: "a".repeat(40),
  production: "b".repeat(40),
  tree: "c".repeat(40),
  tag: "v1.11.30",
  apiVersion: "1.11.29",
  run: 123,
  attempt: 1,
  actor: "miniaxolotl",
  protected: true,
};
const p = publication(context, `sha256:${"d".repeat(64)}`, now);
const releaseContext=context;
for(const operational of [false,true])test(`actual ${operational?'separate tooling':'legacy'} continuation artifacts load the entire seven-stage source chain`, async () => {
  const tooling={source:'4'.repeat(40),production:'5'.repeat(40),tree:'6'.repeat(40),tag:'v1.11.35',workflow:'.github/workflows/held-release-operator.yml'};
  const context={...releaseContext,...(operational?{tooling}:{})};
  const snapshot = {
    fingerprint: "1".repeat(64),
    generation: "fixture",
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
  let run = 123;
  const next = () => ({ ...context, run: ++run });
  const h = recordHeld(p, snapshot, next(), now);
  const evidence = {
    release: "1".repeat(64),
    receipt: receiptHash(h),
    generation: "1",
    customers: 1,
    remoteVerified: 1,
    pending: 0,
    uncertain: 0,
    caughtUp: true,
    authorityHash: "2".repeat(64),
    remoteHash: "3".repeat(64),
    control: { phase: "reconcile", approvalHash: null, publicHash: null },
  };
  const l = recordLifecycle(
    p,
    h,
    { ...snapshot, ingress: true, lifecycle: evidence },
    next(),
    now,
  );
  const e = approve(
    p,
    l,
    {
      held: receiptHash(l),
      authority: evidence.authorityHash,
      providers: evidence.remoteHash,
      pending: 0,
      uncertain: 0,
      reconciledAt: new Date(now).toISOString(),
      approved: true,
      command: "4".repeat(64),
    },
    next(),
    now,
    ({ source, held, authority, providers }) => ({
      source,
      held,
      authority,
      providers,
      manifest: "5".repeat(64),
      contract: "qualified-lifecycle-and-remote-reconciliation",
    }),
  );
  const r = advance(p, e, "runtime_verified", next(), now, {
    ...snapshot,
    ingress: true,
    lifecycle: {
      ...evidence,
      control: {
        phase: "released",
        approvalHash: "4".repeat(64),
        publicHash: null,
      },
    },
  });
  const pub = advance(p, r, "public_verified", next(), now, {
    ...snapshot,
    ingress: true,
    lifecycle: {
      ...evidence,
      control: {
        phase: "public",
        approvalHash: "4".repeat(64),
        publicHash: "6".repeat(64),
      },
    },
    command: "6".repeat(64),
    public: { status: "ready" },
  });
  const site = advance(p, pub, "website_verified", next(), now, {
    repository: context.repository,
    version: "1.11.30",
    sourceSha: context.source,
    productionSha: context.production,
    deploymentUrl: "https://grove-fixture.vercel.app",
  });
  const receipts = [p, h, l, e, r, pub, site];
  const bundles = new Map(
    receipts.map((receipt) => {
      const zip = zipSync({
        "held-state.json": strToU8(JSON.stringify(receipt)),
      });
      return [
        receipt.operator.run,
        {
          receipt,
          zip,
          artifact: {
            id: receipt.operator.run,
            name:
              receipt.phase === "published_held"
                ? "held-publication-1"
                : `held-${receipt.phase}-1`,
            expired: false,
            expires_at: new Date(now + 60000).toISOString(),
            workflow_run: { id: receipt.operator.run },
            size_in_bytes: zip.length,
            digest: `sha256:${createHash("sha256").update(zip).digest("hex")}`,
          },
        },
      ];
    }),
  );
  const io = {
    run: async (id) => ({
      id,
      run_attempt: 1,
      head_sha: operational&&id!==123?tooling.production:context.production,
      head_branch: "production",
      path:
        id === 123
          ? ".github/workflows/deploy.yml"
          : operational?tooling.workflow:".github/workflows/held-release.yml",
      event: id === 123 ? "push" : "workflow_dispatch",
      status: "completed",
      conclusion: "success",
      actor: { login: "miniaxolotl" },
      triggering_actor: { login: "miniaxolotl" },
      head_repository: { full_name: context.repository },
    }),
    artifacts: async (id) => [bundles.get(id).artifact],
    download: async (id) => bundles.get(id).zip,
    jobs: async (id) =>
      (id === 123 ? ["candidate", "publish"] : ["candidate", "record"]).map(
        (name) => ({
          name,
          run_id: id,
          run_attempt: 1,
          head_sha: operational&&id!==123?tooling.production:context.production,
          status: "completed",
          conclusion: "success",
        }),
      ),
  };
  assert.deepEqual(
    await artifacts.loadReceipt(
      {
        run: site.operator.run,
        attempt: 1,
        phase: "website_verified",
        publication: p,
      },
      context,
      io,
      now,
    ),
    site,
  );
  assert.deepEqual(
    await artifacts.loadPublication(123, 1, context, io, now),
    p,
  );
  await assert.rejects(
    artifacts.loadReceipt(
      {
        run: site.operator.run,
        attempt: 1,
        phase: "website_verified",
        publication: { ...p, at: new Date(now - 1).toISOString() },
      },
      context,
      io,
      now,
    ),
  );
  if(operational){
    for(const changed of [{...context,tooling:undefined},{...context,tooling:{...tooling,production:context.production}}])
      await assert.rejects(artifacts.loadReceipt({run:site.operator.run,attempt:1,phase:'website_verified',publication:p},changed,io,now));
  }
});
function fixture(change = () => {}) {
  const zip = zipSync({ "held-state.json": strToU8(JSON.stringify(p)) });
  const data = {
    run: {
      id: 123,
      run_attempt: 1,
      head_sha: context.production,
      head_branch: "production",
      path: ".github/workflows/deploy.yml",
      event: "push",
      status: "completed",
      conclusion: "success",
      actor: { login: "miniaxolotl" },
      triggering_actor: { login: "miniaxolotl" },
      head_repository: { full_name: "miniaxolotl/grove" },
    },
    artifact: {
      id: 456,
      name: "held-publication-1",
      expired: false,
      size_in_bytes: zip.length,
      expires_at: new Date(now + 60000).toISOString(),
      workflow_run: { id: 123 },
      digest: `sha256:${createHash("sha256").update(zip).digest("hex")}`,
    },
    jobs: ["candidate", "publish"].map((name) => ({
      name,
      run_id: 123,
      run_attempt: 1,
      head_sha: context.production,
      status: "completed",
      conclusion: "success",
    })),
    zip,
  };
  change(data);
  return {
    run: async () => data.run,
    artifacts: async () => [data.artifact],
    jobs: async () => data.jobs,
    download: async () => data.zip,
  };
}
test("publication is admitted only from its exact successful protected production workflow and verified artifact bytes", async () => {
  const loaded = await artifacts.loadHeldReceipt?.(
    123,
    1,
    "published_held",
    context,
    fixture(),
    now,
  );
  assert.deepEqual(loaded, p);
});

test("a completed failed publication can resume only from its verified pre-write artifact, never an in-flight or fabricated pending state", async () => {
  const decision = {
    schema: 1,
    mode: "held-publication-only",
    anchor: "9".repeat(40),
    app: "11111111-1111-4111-8111-111111111111",
    previousDigest: `sha256:${"d".repeat(64)}`,
  };
  const baseline = {
    app: decision.app,
    state: "e".repeat(64),
    settings: "f".repeat(64),
    digest: decision.previousDigest,
    health: { http_path: "/health/ready", port: 26080 },
  };
  const pending = pendingPublication(context, decision, baseline, now);
  const pendingIO = (change = () => {}) =>
    fixture((data) => {
      data.run.conclusion = "failure";
      data.jobs[1].conclusion = "failure";
      data.jobs[1].steps = [
        {
          name: "Preserve pending source-bound publication",
          status: "completed",
          conclusion: "success",
        },
      ];
      data.zip = zipSync({
        "held-pending.json": strToU8(JSON.stringify(pending)),
      });
      data.artifact.name = "held-pending-1";
      data.artifact.size_in_bytes = data.zip.length;
      data.artifact.digest = `sha256:${createHash("sha256").update(data.zip).digest("hex")}`;
      change(data);
    });
  assert.deepEqual(
    await artifacts.loadPendingPublication?.(
      123,
      1,
      context,
      decision,
      pendingIO(),
      now,
    ),
    pending,
  );
  for (const change of [
    (d) => {
      d.run.status = "in_progress";
    },
    (d) => {
      d.jobs[1].steps = [];
    },
    (d) => {
      d.artifact.expired = true;
    },
    (d) => {
      d.artifact.digest = `sha256:${"0".repeat(64)}`;
    },
  ])
    await assert.rejects(async () =>
      artifacts.loadPendingPublication?.(
        123,
        1,
        context,
        decision,
        pendingIO(change),
        now,
      ),
    );
});
test("foreign workflows/actors/heads, partial publication, expired/altered/oversized receipts cannot authorize resume", async () => {
  for (const change of [
    (d) => {
      d.run.path = ".github/workflows/ci.yml";
    },
    (d) => {
      d.run.actor.login = "other";
    },
    (d) => {
      d.run.event = "pull_request";
    },
    (d) => {
      d.run.head_sha = "e".repeat(40);
    },
    (d) => {
      d.jobs[1].conclusion = "failure";
    },
    (d) => {
      d.artifact.expired = true;
    },
    (d) => {
      d.artifact.expires_at = new Date(now).toISOString();
    },
    (d) => {
      d.artifact.workflow_run.id = 999;
    },
    (d) => {
      d.artifact.size_in_bytes = 10000000;
    },
    (d) => {
      d.artifact.digest = `sha256:${"f".repeat(64)}`;
    },
    (d) => {
      d.zip = zipSync({ "unexpected.json": strToU8("private-fixture") });
    },
  ]) {
    await assert.rejects(
      async () =>
        artifacts.loadHeldReceipt?.(
          123,
          1,
          "published_held",
          context,
          fixture(change),
          now,
        ),
      (error) => {
        assert.match(String(error), /receipt unavailable/i);
        assert.doesNotMatch(String(error), /private-fixture/);
        return true;
      },
    );
  }
});
