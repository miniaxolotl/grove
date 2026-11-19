// Pure proposals plus bounded actual readback. Provider writes stay explicit
// operator operations; no recovery path blindly repeats an uncertain PUT.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import * as provider from "../deploy-digitalocean.mjs";
import { receiptHash, validateHeldReceipt } from "./held-state.mjs";

const latch = "GROVE_RELEASE_HOLD";
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
  assert(isDeepStrictEqual(app.spec, app.active_deployment.spec));
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
function heldShape(app, p, fingerprint) {
  settled(app);
  const baseline = p.evidence.baseline;
  assert.equal(app.id, baseline.app);
  assert(
    app.spec.maintenance?.archive === false &&
      app.spec.maintenance.enabled === true,
  );
  for (const component of parts(app.spec)) {
    assert.equal(component.image.digest, p.release.digest);
    const holds = component.envs?.filter((entry) => entry.key === latch);
    assert(
      holds?.length === 1 &&
        holds[0].scope === "RUN_TIME" &&
        holds[0].type === "GENERAL",
    );
    assert(isDeepStrictEqual(JSON.parse(holds[0].value), holdIdentity(p)));
  }
  assert.equal(app.spec.services[0].health_check?.http_path, "/health/live");
  const reversed = provider.updateImageSpec(app.spec, baseline.digest);
  for (const component of parts(reversed))
    component.envs = component.envs.filter((entry) => entry.key !== latch);
  reversed.maintenance.archive = true;
  reversed.services[0].health_check = globalThis.structuredClone(
    baseline.health,
  );
  assert.equal(
    fingerprint({ id: app.id, spec: reversed }),
    baseline.settings,
    "Unrelated held settings changed",
  );
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
    assert.equal(fingerprint(app), baseline.state);
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
    heldShape(app, p, fingerprint);
    const observation = approval.parent.evidence;
    assert.equal(fingerprint(app), observation.fingerprint);
    assert.equal(app.active_deployment.id, observation.generation);
    assert(isDeepStrictEqual(inventory(instances), observation.instances));
    const spec = globalThis.structuredClone(app.spec);
    for (const component of parts(spec)) {
      assert(
        !component.envs.some((entry) => entry.key === "GROVE_RELEASE_APPROVAL"),
      );
      component.envs = component.envs.filter((entry) => entry.key !== latch);
      component.envs.push({
        key: "GROVE_RELEASE_APPROVAL",
        value: JSON.stringify({
          schema: 1,
          identity: holdIdentity(p),
          approval: receiptHash(approval),
        }),
        scope: "RUN_TIME",
        type: "GENERAL",
      });
    }
    spec.services[0].health_check = globalThis.structuredClone(
      p.evidence.baseline.health,
    );
    return spec;
  } catch {
    throw new Error(
      "Effect release proposal rejected; retain hold and requalify current instances, reconciliation and explicit approval",
    );
  }
}
