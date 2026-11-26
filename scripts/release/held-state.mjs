// Pure, source-bound receipt protocol. Provider/runtime observations are collected
// by the operator transport, never invented by this state machine.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

const sha = /^[a-f0-9]{40}$/;
const hash = /^[a-f0-9]{64}$/;
const phases = [
  "published_held",
  "held_verified",
  "lifecycle_verified",
  "effects_approved",
  "runtime_verified",
  "public_verified",
  "website_verified",
];
const lifetime = 600000;
export function assertHeldRecorderActors(actor,triggeringActor){
  assert.equal(actor,'miniaxolotl');assert.equal(triggeringActor,'miniaxolotl');
}
const canonical = (value) =>
  Array.isArray(value)
    ? value.map(canonical)
    : value && typeof value === "object"
      ? Object.fromEntries(
          Object.keys(value)
            .sort()
            .map((key) => [key, canonical(value[key])]),
        )
      : value;
export const receiptHash = (value) =>
  createHash("sha256")
    .update(JSON.stringify(canonical(value)))
    .digest("hex");
const exact = (value, keys) =>
  assert.deepEqual(
    Object.keys(value).sort(),
    keys.toSorted(),
    "Unknown/missing held-release fields",
  );
function operator(context) {
  assert.equal(context.repository, "miniaxolotl/grove");
  assert.equal(context.actor, "miniaxolotl");
  assert.equal(context.protected, true);
  for (const key of ["run", "attempt"])
    assert(Number.isSafeInteger(context[key]) && context[key] > 0);
  for (const key of ["source", "production", "tree"])
    assert.match(context[key], sha);
  assert.match(context.tag, /^v\d+\.\d+\.\d+$/);
  assert.match(context.apiVersion, /^\d+\.\d+\.\d+$/);
  if(context.tooling){
    exact(context.tooling,['source','production','tree','tag','workflow']);
    for(const key of ['source','production','tree'])assert.match(context.tooling[key],sha);
    assert.match(context.tooling.tag,/^v\d+\.\d+\.\d+$/);
    assert.equal(context.tooling.workflow,'.github/workflows/held-release-operator.yml');
  }
  return { run: context.run, attempt: context.attempt, actor: context.actor, ...(context.tooling ? {tooling:context.tooling}: {}) };
}
export const validateHeldContext = operator;
function fresh(at, now) {
  const timestamp = Date.parse(at);
  assert(
    Number.isFinite(timestamp) &&
      timestamp <= now &&
      now - timestamp <= lifetime,
    "Expired/future held-release observation; requalify read-only",
  );
}
function assertReceipt(receipt, publication) {
  exact(receipt, [
    "schema",
    "phase",
    "release",
    "at",
    "operator",
    "previous",
    "parent",
    "evidence",
  ]);
  assert.equal(receipt.schema, 1);
  assert(phases.includes(receipt.phase));
  assert.deepEqual(
    receipt.release,
    publication.release,
    "Publication identity changed",
  );
  if (receipt.phase === phases[0]) {
    assert.equal(receipt.previous, null);
    assert.equal(receipt.parent, null);
    if (receipt.evidence.baseline) {
      exact(
        receipt.evidence,
        receipt.evidence.decisionHash
          ? [
              "baseline",
              "decisionHash",
              "pendingHash",
              "verification",
              "publicReleased",
            ]
          : ["baseline"],
      );
      if (receipt.evidence.decisionHash) {
        for (const value of [
          receipt.evidence.decisionHash,
          receipt.evidence.pendingHash,
          receipt.evidence.verification?.packages,
          receipt.evidence.verification?.images,
        ])
          assert.match(value, hash);
        assert.equal(receipt.evidence.publicReleased, false);
      }
      assertBaseline(receipt.evidence.baseline);
    } else assert.deepEqual(receipt.evidence, {});
    assert.equal(receiptHash(receipt), receiptHash(publication));
  } else {
    assert(receipt.parent, "Missing preceding held-release receipt");
    assertReceipt(receipt.parent, publication);
    assert.equal(receipt.previous, receiptHash(receipt.parent));
    assert.equal(
      phases.indexOf(receipt.phase),
      phases.indexOf(receipt.parent.phase) + 1,
      "Held-release phase jump",
    );
  }
}
function record(p, parent, phase, evidence, context, now) {
  const approvedOperator = operator(context);
  assert.deepEqual(
    [
      context.source,
      context.production,
      context.tree,
      context.tag,
      context.apiVersion,
    ],
    [
      p.release.source,
      p.release.production,
      p.release.tree,
      p.release.tag,
      p.release.apiVersion,
    ],
    "Source/production changed",
  );
  assertReceipt(parent, p);
  assert.equal(
    phases.indexOf(phase),
    phases.indexOf(parent.phase) + 1,
    "Held-release phase jump",
  );
  if (parent.phase !== "published_held") {
    // Operational observations retain immutable parent approval/history; a slow
    // rollout is not permission to reuse an old actual named-instance proof.
    if(context.tooling&&['lifecycle_verified','runtime_verified','public_verified'].includes(phase))fresh(evidence.observedAt,now);
    else if(context.tooling&&phase==='website_verified')fresh(evidence.parentVerification.observedAt,now);
    else fresh(parent.at, now);
  }
  return {
    schema: 1,
    phase,
    release: p.release,
    at: new Date(now).toISOString(),
    operator: approvedOperator,
    previous: receiptHash(parent),
    parent,
    evidence,
  };
}
export function publication(context, digest, now) {
  const approvedOperator = operator(context);
  assert.match(digest, /^sha256:[a-f0-9]{64}$/);
  if (context.baseline) assertBaseline(context.baseline);
  return {
    schema: 1,
    phase: phases[0],
    release: {
      source: context.source,
      production: context.production,
      tree: context.tree,
      tag: context.tag,
      apiVersion: context.apiVersion,
      digest,
      run: context.run,
      attempt: context.attempt,
    },
    at: new Date(now).toISOString(),
    operator: approvedOperator,
    previous: null,
    parent: null,
    evidence: context.baseline ? { baseline: context.baseline } : {},
  };
}
function assertBaseline(baseline) {
  exact(baseline, [
    "app",
    "state",
    "settings",
    "digest",
    "health",
    ...(Object.hasOwn(baseline, "publicationOnly") ? ["publicationOnly"] : []),
  ]);
  if (Object.hasOwn(baseline, "publicationOnly"))
    assert.equal(baseline.publicationOnly, true);
  assert.match(baseline.app, /^[a-f0-9-]{36}$/);
  for (const value of [baseline.state, baseline.settings])
    assert.match(value, hash);
  assert.match(baseline.digest, /^sha256:[a-f0-9]{64}$/);
  assert.equal(baseline.health.http_path, "/health/ready");
  assert(
    Object.keys(baseline.health).every((key) =>
      [
        "http_path",
        "port",
        "initial_delay_seconds",
        "period_seconds",
        "timeout_seconds",
        "success_threshold",
        "failure_threshold",
      ].includes(key),
    ),
  );
  assert(
    Object.entries(baseline.health).every(
      ([key, value]) =>
        key === "http_path" || (Number.isSafeInteger(value) && value > 0),
    ),
  );
}
export const validateHeldBaseline = assertBaseline;
export function admitPublication(p, artifact, context, now) {
  operator(context);
  assert.equal(p.phase, phases[0]);
  assertReceipt(p, p);
  assert.equal(artifact.name, `held-publication-${p.release.attempt}`);
  assert.equal(artifact.expired, false);
  assert(
    Date.parse(artifact.expires_at) > now,
    "Publication artifact expired; reconcile, never fabricate a replacement",
  );
  assert.equal(artifact.workflow_run?.id, p.release.run);
  assert.match(artifact.digest, /^sha256:[a-f0-9]{64}$/);
  assert.deepEqual(
    [
      context.source,
      context.production,
      context.tree,
      context.tag,
      context.apiVersion,
    ],
    [
      p.release.source,
      p.release.production,
      p.release.tree,
      p.release.tag,
      p.release.apiVersion,
    ],
  );
  return p;
}
export function recordHeld(p, snapshot, context, now) {
  validateSnapshot(snapshot, now);
  return record(p, p, "held_verified", snapshot, context, now);
}
function validateSnapshot(snapshot, now) {
  exact(snapshot, [
    "fingerprint",
    "generation",
    "instances",
    "proofs",
    "observedAt",
  ]);
  assert.match(snapshot.fingerprint, hash);
  assert(
    typeof snapshot.generation === "string" && snapshot.generation.length > 0,
  );
  assert.deepEqual(snapshot.instances.map((i) => i.component).sort(), [
    "api",
    "worker",
  ]);
  assert(
    snapshot.instances.every(
      (i) => typeof i.name === "string" && i.name.length > 0,
    ),
  );
  fresh(snapshot.observedAt, now);
  assert.equal(snapshot.proofs.length, 2);
  assert.equal(
    new Set(snapshot.proofs.map((proof) => proof.challenge)).size,
    2,
  );
  for (const proof of snapshot.proofs) {
    exact(proof, ["component", "name", "challenge", "response"]);
    assert(
      snapshot.instances.some(
        (instance) =>
          instance.component === proof.component &&
          instance.name === proof.name,
      ),
    );
    assert.match(proof.challenge, hash);
    assert.match(proof.response, hash);
  }
}
export function validateLifecycleEvidence(evidence) {
  exact(evidence, [
    "release",
    "receipt",
    "generation",
    "customers",
    "remoteVerified",
    "pending",
    "uncertain",
    "caughtUp",
    "authorityHash",
    "remoteHash",
    "control",
  ]);
  for (const key of ["release", "receipt", "authorityHash", "remoteHash"])
    assert.match(evidence[key], hash);
  assert.match(evidence.generation, /^[0-9]{1,19}$/);
  for (const key of ["customers", "remoteVerified", "pending", "uncertain"])
    assert(Number.isSafeInteger(evidence[key]) && evidence[key] >= 0);
  assert.equal(evidence.customers, evidence.remoteVerified);
  assert.equal(evidence.pending, 0);
  assert.equal(evidence.uncertain, 0);
  assert.equal(evidence.caughtUp, true);
  exact(evidence.control, ["phase", "approvalHash", "publicHash"]);
  assert(
    ["reconcile", "handoff", "released", "public"].includes(
      evidence.control.phase,
    ),
  );
  for (const key of ["approvalHash", "publicHash"])
    if (evidence.control[key] !== null)
      assert.match(evidence.control[key], hash);
}
export function recordLifecycle(p, held, snapshot, context, now) {
  assert.equal(held.phase, "held_verified");
  const { lifecycle, ingress, ...observation } = snapshot;
  validateSnapshot(observation, now);
  validateLifecycleEvidence(lifecycle);
  assert.equal(ingress, true);
  assert.equal(lifecycle.receipt, receiptHash(held));
  assert.deepEqual(lifecycle.control, {
    phase: "reconcile",
    approvalHash: null,
    publicHash: null,
  });
  return record(p, held, "lifecycle_verified", snapshot, context, now);
}
export function approve(p, held, reconciliation, context, now, qualify) {
  assert.equal(held.phase, "lifecycle_verified");
  exact(reconciliation, [
    "held",
    "authority",
    "providers",
    "pending",
    "uncertain",
    "reconciledAt",
    "approved",
    "command",
  ]);
  assert.equal(reconciliation.held, receiptHash(held));
  assert.match(reconciliation.command, hash);
  validateLifecycleEvidence(held.evidence.lifecycle);
  assert.equal(reconciliation.authority, held.evidence.lifecycle.authorityHash);
  assert.equal(reconciliation.providers, held.evidence.lifecycle.remoteHash);
  for (const value of [reconciliation.authority, reconciliation.providers])
    assert.match(value, hash);
  assert.equal(reconciliation.pending, 0);
  assert.equal(reconciliation.uncertain, 0);
  assert.equal(
    reconciliation.approved,
    true,
    "Explicit operator reconciliation/release approval required",
  );
  fresh(reconciliation.reconciledAt, now);
  assert.equal(
    typeof qualify,
    "function",
    "Qualified lifecycle ingestion/reconciliation adapter is required; hashes and attestation booleans alone do not release effects",
  );
  const qualification = qualify({
    source: p.release.source,
    held: receiptHash(held),
    authority: reconciliation.authority,
    providers: reconciliation.providers,
    now,
  });
  exact(qualification, [
    "source",
    "held",
    "authority",
    "providers",
    "manifest",
    "contract",
  ]);
  assert.equal(qualification.source, p.release.source);
  assert.equal(qualification.held, receiptHash(held));
  assert.equal(qualification.authority, reconciliation.authority);
  assert.equal(qualification.providers, reconciliation.providers);
  assert.match(qualification.manifest, hash);
  assert.equal(
    qualification.contract,
    "qualified-lifecycle-and-remote-reconciliation",
  );
  return record(
    p,
    held,
    "effects_approved",
    { reconciliation, qualification },
    context,
    now,
  );
}
export function advance(p, parent, phase, context, now, evidence) {
  assert(
    ["runtime_verified", "public_verified", "website_verified"].includes(phase),
  );
  assert(
    evidence && Object.keys(evidence).length,
    "Actual verification evidence required",
  );
  if (phase === "runtime_verified" || phase === "public_verified") {
    const {
      lifecycle,
      ingress,
      command,
      public: publicEvidence,
      ...snapshot
    } = evidence;
    validateSnapshot(snapshot, now);
    validateLifecycleEvidence(lifecycle);
    assert.equal(ingress, true);
    const approval = phase === "runtime_verified" ? parent : parent.parent;
    assert.equal(
      lifecycle.control.approvalHash,
      approval.evidence.reconciliation.command,
    );
    assert.equal(
      lifecycle.control.phase,
      phase === "runtime_verified" ? "released" : "public",
    );
    assert.equal(lifecycle.receipt, receiptHash(approval.parent.parent));
    if (phase === "public_verified") {
      assert.match(command, hash);
      assert.equal(lifecycle.control.publicHash, command);
      assert.deepEqual(publicEvidence, { status: "ready" });
    } else {
      assert.equal(command, undefined);
      assert.equal(publicEvidence, undefined);
      assert.equal(lifecycle.control.publicHash, null);
    }
  } else {
    exact(evidence, [
      "repository",
      "version",
      "sourceSha",
      "productionSha",
      "deploymentUrl",
      ...(context.tooling?['parentVerification']:[]),
    ]);
    if(context.tooling){
      const {lifecycle,ingress,command,public:publicEvidence,...snapshot}=evidence.parentVerification;
      validateSnapshot(snapshot,now);validateLifecycleEvidence(lifecycle);
      assert.equal(ingress,true);assert.equal(lifecycle.control.phase,'public');
      assert.equal(command,parent.evidence.command);assert.equal(lifecycle.control.publicHash,command);
      assert.equal(lifecycle.control.approvalHash,parent.evidence.lifecycle.control.approvalHash);
      assert.equal(lifecycle.release,parent.evidence.lifecycle.release);assert.equal(lifecycle.receipt,parent.evidence.lifecycle.receipt);
      assert.deepEqual(publicEvidence,{status:'ready'});
    }
    assert.equal(evidence.repository, "miniaxolotl/grove");
    assert.equal(evidence.sourceSha, p.release.source);
    assert.equal(evidence.productionSha, p.release.production);
    assert.equal(`v${evidence.version}`, p.release.tag);
    assert.match(
      evidence.deploymentUrl,
      /^https:\/\/[a-zA-Z0-9-]+\.vercel\.app$/,
    );
  }
  return record(p, parent, phase, evidence, context, now);
}

export async function recordObservation(verify, record, now = Date.now) {
  const evidence = await verify();
  return record(evidence, now());
}

export function validateHeldReceipt(receipt, p) {
  assertReceipt(receipt, p);
  return receipt;
}
