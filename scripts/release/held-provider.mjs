// Pure proposals plus bounded actual readback. Provider writes stay explicit
// operator operations; no recovery path blindly repeats an uncertain PUT.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import * as provider from "../deploy-digitalocean.mjs";
import { validateCompleteInstanceInventory } from "./held-instance-inventory.mjs";
import { deploymentSpecMatches } from "./held-provider-response.mjs";
import {
  receiptHash,
  validateHeldReceipt,
  validateLifecycleEvidence,
} from "./held-state.mjs";

const latch = "GROVE_RELEASE_HOLD";
const controls = [latch, "GROVE_RELEASE_RECONCILE", "GROVE_RELEASE_APPROVAL"];
function fingerprintDefault(app) {
  assert.equal(
    typeof provider.appStateFingerprint,
    "function",
    "Reviewed provider-state prerequisite is not integrated",
  );
  return provider.appStateFingerprint(app);
}
function settled(app) {
  assert(!app.pending_deployment && !app.in_progress_deployment);
  assert.equal(app.active_deployment?.phase, "ACTIVE");
  assert(deploymentSpecMatches(app), "DEPLOYMENT_SPEC_DRIFT");
  assert.equal(app.spec.name, "grove");
  assert(
    app.spec.services?.length === 1 && app.spec.services[0].name === "api",
  );
  assert(
    app.spec.workers?.length === 1 && app.spec.workers[0].name === "worker",
  );
  assert(
    parts(app.spec).every(
      (component) => component.instance_count === 1 && !component.autoscaling,
    ),
    "Existing fixed one-instance-per-component topology required",
  );
  assert(
    ["jobs", "static_sites", "functions", "databases"].every(
      (key) => !app.spec[key]?.length,
    ),
  );
}
const parts = (spec) => [spec.services[0], spec.workers[0]];
function captureBaseline(app, decision, fingerprint) {
  settled(app);
  assert.equal(app.id, decision.app);
  assert(
    parts(app.spec).every(
      (part) =>
        part.image.digest === decision.previousDigest &&
        !part.envs?.some((entry) =>
          [
            "GROVE_RELEASE_HOLD",
            "GROVE_RELEASE_RECONCILE",
            "GROVE_RELEASE_APPROVAL",
          ].includes(entry.key),
        ),
    ),
  );
  const health = globalThis.structuredClone(app.spec.services[0].health_check);
  assert.equal(health.http_path, "/health/ready");
  return {
    app: app.id,
    state: fingerprint(app),
    settings: fingerprint({ id: app.id, spec: app.spec }),
    digest: decision.previousDigest,
    health,
  };
}
export function captureArchivedBaseline(
  app,
  instances,
  decision,
  fingerprint = fingerprintDefault,
) {
  const baseline = captureBaseline(app, decision, fingerprint);
  assert.equal(instances.length, 0);
  assert(
    app.spec.maintenance?.archive === true &&
      app.spec.maintenance.enabled === true,
  );
  return baseline;
}
export function capturePublicationBaseline(
  app,
  instances,
  decision,
  fingerprint = fingerprintDefault,
) {
  const baseline = captureBaseline(app, decision, fingerprint);
  validateCompleteInstanceInventory({ instances });
  // Publication does not stop or deploy services. Bind the actual observed state,
  // and separately freeze the only settings change allowed before held restore.
  const archived = globalThis.structuredClone(app.spec);
  archived.maintenance = {
    ...archived.maintenance,
    archive: true,
    enabled: true,
  };
  return {
    ...baseline,
    settings: fingerprint({ id: app.id, spec: archived }),
    publicationOnly: true,
  };
}
export function holdIdentity(p) {
  const { source, production, tag, run, attempt, digest } = p.release;
  return {
    schema: 1,
    source,
    production,
    tag,
    run,
    attempt,
    digest,
    publication: receiptHash(p),
  };
}
function phaseShape(app, p, key, value, fingerprint, publicPhase = false) {
  settled(app);
  const baseline = p.evidence.baseline;
  assert.equal(app.id, baseline.app);
  assert(
    app.spec.maintenance?.archive === false &&
      typeof app.spec.maintenance.enabled === "boolean",
  );
  assert(!app.spec.envs?.some((entry) => controls.includes(entry.key)));
  for (const component of parts(app.spec)) {
    assert.equal(component.image.digest, p.release.digest);
    const holds = component.envs?.filter((entry) =>
      controls.includes(entry.key),
    );
    assert(
      holds?.length === 1 &&
        holds[0].key === key &&
        holds[0].scope === "RUN_TIME" &&
        holds[0].type === "GENERAL",
    );
    assert(isDeepStrictEqual(JSON.parse(holds[0].value), value));
  }
  assert(
    (publicPhase
      ? ["/health/live", "/health/ready"]
      : ["/health/live"]
    ).includes(app.spec.services[0].health_check?.http_path),
  );
  const reversed = provider.updateImageSpec(app.spec, baseline.digest);
  for (const component of parts(reversed))
    component.envs = component.envs.filter(
      (entry) => !controls.includes(entry.key),
    );
  reversed.maintenance.archive = true;
  reversed.maintenance.enabled = true;
  reversed.services[0].health_check = globalThis.structuredClone(
    baseline.health,
  );
  assert.equal(
    fingerprint({ id: app.id, spec: reversed }),
    baseline.settings,
    "Unrelated held settings changed",
  );
}
function heldShape(app, p, fingerprint) {
  phaseShape(app, p, latch, holdIdentity(p), fingerprint);
  assert.equal(app.spec.maintenance.enabled, true);
}
const reconcileValue = (p, held) => ({
  schema: 1,
  identity: holdIdentity(p),
  receipt: receiptHash(held),
});
const approvedValue = (p, approval) => ({
  schema: 1,
  identity: holdIdentity(p),
  approval: approval.evidence.reconciliation.command,
});
function observationFence(app, instances, observation, now, fingerprint) {
  const at = Date.parse(observation.observedAt);
  assert(at <= now && now - at <= 600000);
  assert.equal(fingerprint(app), observation.fingerprint);
  assert.equal(app.active_deployment.id, observation.generation);
  assert(isDeepStrictEqual(inventory(instances), observation.instances));
}
function replaceControl(spec, key, value) {
  const next = globalThis.structuredClone(spec);
  for (const component of parts(next))
    component.envs = [
      ...component.envs.filter((entry) => !controls.includes(entry.key)),
      { key, value: JSON.stringify(value), scope: "RUN_TIME", type: "GENERAL" },
    ];
  return next;
}
export function prepareReconcile(
  app,
  instances,
  p,
  held,
  now = Date.now(),
  fingerprint = fingerprintDefault,
) {
  validateHeldReceipt(held, p);
  assert.equal(held.phase, "held_verified");
  heldShape(app, p, fingerprint);
  observationFence(app, instances, held.evidence, now, fingerprint);
  return replaceControl(
    app.spec,
    "GROVE_RELEASE_RECONCILE",
    reconcileValue(p, held),
  );
}
export function prepareLifecycleIngress(
  app,
  instances,
  p,
  held,
  observation,
  now = Date.now(),
  fingerprint = fingerprintDefault,
) {
  validateHeldReceipt(held, p);
  assert.equal(held.phase, "held_verified");
  phaseShape(
    app,
    p,
    "GROVE_RELEASE_RECONCILE",
    reconcileValue(p, held),
    fingerprint,
  );
  observationFence(app, instances, observation, now, fingerprint);
  validateLifecycleEvidence(observation.lifecycle);
  assert.equal(observation.lifecycle.receipt, receiptHash(held));
  assert.equal(observation.lifecycle.release, receiptHash(holdIdentity(p)));
  assert.equal(observation.lifecycle.control.phase, "reconcile");
  const spec = globalThis.structuredClone(app.spec);
  spec.maintenance.enabled = false;
  return spec;
}
export function prepareHeld(
  app,
  instances,
  p,
  fingerprint = fingerprintDefault,
) {
  try {
    settled(app);
    const baseline = p.evidence.baseline;
    assert.equal(app.id, baseline.app);
    if (baseline.publicationOnly === true)
      assert.equal(
        fingerprint({ id: app.id, spec: app.spec }),
        baseline.settings,
        "Archived settings differ from the published source baseline",
      );
    else assert.equal(fingerprint(app), baseline.state);
    assert.equal(instances.length, 0);
    assert(
      app.spec.maintenance?.archive === true &&
        app.spec.maintenance.enabled === true,
    );
    assert(
      parts(app.spec).every(
        (component) =>
          component.image.digest === baseline.digest &&
          !component.envs?.some((entry) => entry.key === latch),
      ),
    );
    const spec = provider.updateImageSpec(app.spec, p.release.digest);
    for (const component of parts(spec)) {
      component.envs = [
        ...(component.envs ?? []),
        {
          key: latch,
          value: JSON.stringify(holdIdentity(p)),
          scope: "RUN_TIME",
          type: "GENERAL",
        },
      ];
    }
    spec.maintenance.archive = false;
    spec.services[0].health_check.http_path = "/health/live";
    return spec;
  } catch {
    throw new Error(
      "Held restore proposal rejected; reconcile source, archived state, zero instances and unchanged configuration",
    );
  }
}
function inventory(instances) {
  assert.equal(instances.length, 2);
  const result = instances
    .map((instance) => {
      assert(["api", "worker"].includes(instance.component_name));
      assert(
        typeof instance.instance_name === "string" &&
          /^[a-zA-Z0-9-]{1,160}$/.test(instance.instance_name),
      );
      return {
        component: instance.component_name,
        name: instance.instance_name,
      };
    })
    .sort((a, b) => a.component.localeCompare(b.component));
  assert.deepEqual(
    result.map((i) => i.component),
    ["api", "worker"],
  );
  return result;
}
export async function verifyHeld(p, io, now = Date.now()) {
  try {
    const fingerprint = io.fingerprint ?? fingerprintDefault;
    const before = await io.getApp(p.evidence.baseline.app);
    heldShape(before, p, fingerprint);
    const instances = inventory(await io.getInstances(before.id));
    const proofs = [];
    for (const instance of instances) {
      const challenge = randomBytes(32).toString("hex");
      const body = await io.probe({
        app: before.id,
        deployment: before.active_deployment.id,
        component: instance.component,
        instance: instance.name,
        challenge,
      });
      assert(
        isDeepStrictEqual(body, {
          status: "release_held",
          role: instance.component,
          identity: holdIdentity(p),
          schema: "verified",
          challenge,
        }),
      );
      proofs.push({ ...instance, challenge, response: receiptHash(body) });
    }
    const after = await io.getApp(before.id);
    heldShape(after, p, fingerprint);
    assert.equal(fingerprint(after), fingerprint(before));
    assert(
      isDeepStrictEqual(inventory(await io.getInstances(after.id)), instances),
    );
    return {
      fingerprint: fingerprint(after),
      generation: after.active_deployment.id,
      instances,
      proofs,
      observedAt: new Date(now).toISOString(),
    };
  } catch {
    throw new Error(
      "Held runtime verification failed; retain archive/maintenance/effect hold and reconcile read-only",
    );
  }
}

export function prepareApproved(
  app,
  instances,
  p,
  approval,
  now = Date.now(),
  fingerprint = fingerprintDefault,
) {
  try {
    validateHeldReceipt(approval, p);
    assert.equal(approval.phase, "effects_approved");
    const timestamp = Date.parse(approval.at);
    assert(timestamp <= now && now - timestamp <= 600000);
    const held = approval.parent.parent;
    phaseShape(
      app,
      p,
      "GROVE_RELEASE_RECONCILE",
      reconcileValue(p, held),
      fingerprint,
    );
    const observation = approval.parent.evidence;
    observationFence(app, instances, observation, now, fingerprint);
    assert.equal(observation.ingress, true);
    assert.equal(app.spec.maintenance.enabled, false);
    const spec = replaceControl(
      app.spec,
      "GROVE_RELEASE_APPROVAL",
      approvedValue(p, approval),
    );
    return spec;
  } catch {
    throw new Error(
      "Effect release proposal rejected; retain hold and requalify current instances, reconciliation and explicit approval",
    );
  }
}

async function verifyPhase(
  p,
  held,
  approval,
  io,
  now,
  publicHash = null,
  handoff = null,
) {
  const fingerprint = io.fingerprint ?? fingerprintDefault,
    mode = approval ? "runtime" : "lifecycle";
  const shape = (app) => {
    phaseShape(
      app,
      p,
      approval ? "GROVE_RELEASE_APPROVAL" : "GROVE_RELEASE_RECONCILE",
      approval ? approvedValue(p, approval) : reconcileValue(p, held),
      fingerprint,
      Boolean(publicHash),
    );
    if (approval) assert.equal(app.spec.maintenance.enabled, false);
  };
  const before = await io.getApp(p.evidence.baseline.app);
  shape(before);
  const instances = inventory(await io.getInstances(before.id)),
    proofs = [];
  let lifecycle;
  for (const instance of instances) {
    const challenge = randomBytes(32).toString("hex");
    const body = await io.probe({
      app: before.id,
      deployment: before.active_deployment.id,
      component: instance.component,
      instance: instance.name,
      challenge,
      mode,
      source: p.release.source,
    });
    const evidence = body.evidence;
    validateLifecycleEvidence(evidence);
    assert.equal(evidence.release, receiptHash(holdIdentity(p)));
    assert.equal(evidence.receipt, receiptHash(held));
    const expectedControl = approval
      ? {
          phase: publicHash ? "public" : "released",
          approvalHash: approval.evidence.reconciliation.command,
          publicHash,
        }
      : {
          phase: handoff ? "handoff" : "reconcile",
          approvalHash: handoff,
          publicHash: null,
        };
    assert.deepEqual(evidence.control, expectedControl);
    assert.deepEqual(body, {
      status: `${mode}_verified`,
      role: instance.component,
      identity: holdIdentity(p),
      ...(approval
        ? { approval: approval.evidence.reconciliation.command }
        : { receipt: receiptHash(held) }),
      schema: "verified",
      challenge,
      evidence,
    });
    if (lifecycle)
      assert.deepEqual(
        lifecycle,
        evidence,
        "Lifecycle changed between named-instance proofs",
      );
    lifecycle = evidence;
    proofs.push({ ...instance, challenge, response: receiptHash(body) });
  }
  const after = await io.getApp(before.id);
  shape(after);
  assert.equal(fingerprint(after), fingerprint(before));
  assert.deepEqual(inventory(await io.getInstances(after.id)), instances);
  return {
    fingerprint: fingerprint(after),
    generation: after.active_deployment.id,
    instances,
    proofs,
    observedAt: new Date(now).toISOString(),
    ingress: !after.spec.maintenance.enabled,
    lifecycle,
  };
}
export const verifyLifecycle = (p, held, io, now = Date.now()) =>
  verifyPhase(p, held, null, io, now);
export const verifyHandoff = (p, lifecycle, command, io, now = Date.now()) =>
  verifyPhase(p, lifecycle.parent, null, io, now, null, command);
export const verifyRuntime = (
  p,
  approval,
  io,
  now = Date.now(),
  publicHash = null,
) => verifyPhase(p, approval.parent.parent, approval, io, now, publicHash);
export function preparePublic(
  app,
  instances,
  p,
  approval,
  observation,
  publicHash,
  now = Date.now(),
  fingerprint = fingerprintDefault,
) {
  validateHeldReceipt(approval, p);
  assert.equal(approval.phase, "effects_approved");
  assert.match(publicHash, /^[a-f0-9]{64}$/);
  phaseShape(
    app,
    p,
    "GROVE_RELEASE_APPROVAL",
    approvedValue(p, approval),
    fingerprint,
    true,
  );
  observationFence(app, instances, observation, now, fingerprint);
  validateLifecycleEvidence(observation.lifecycle);
  assert.deepEqual(observation.lifecycle.control, {
    phase: "public",
    approvalHash: approval.evidence.reconciliation.command,
    publicHash,
  });
  const spec = globalThis.structuredClone(app.spec);
  spec.services[0].health_check = globalThis.structuredClone(
    p.evidence.baseline.health,
  );
  return spec;
}
export async function verifyPublic(
  p,
  approval,
  publicHash,
  io,
  now = Date.now(),
) {
  const snapshot = await verifyRuntime(p, approval, io, now, publicHash);
  const before = await io.getApp(p.evidence.baseline.app);
  assert.deepEqual(
    before.spec.services[0].health_check,
    p.evidence.baseline.health,
  );
  assert.equal(
    (io.fingerprint ?? fingerprintDefault)(before),
    snapshot.fingerprint,
  );
  const ready = await io.ready();
  assert.equal(ready.status, "ready");
  const after = await io.getApp(before.id);
  assert.equal(
    (io.fingerprint ?? fingerprintDefault)(after),
    snapshot.fingerprint,
  );
  return { ...snapshot, command: publicHash, public: { status: "ready" } };
}
