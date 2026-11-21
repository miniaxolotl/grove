import assert from "node:assert/strict";
import test from "node:test";
import * as held from "./held-provider.mjs";
import { publicationReadback } from "./held-production.mjs";
import {
  publication,
  receiptHash,
  recordHeld,
  approve,
  recordLifecycle,
} from "./held-state.mjs";

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
const digest = `sha256:${"d".repeat(64)}`;
const previous = `sha256:${"e".repeat(64)}`;
const appId = "11111111-1111-4111-8111-111111111111";
function archived() {
  const spec = {
    name: "grove",
    maintenance: { archive: true, enabled: true },
    domains: [{ domain: "retained.example" }],
    services: [
      {
        name: "api",
        image: {
          registry_type: "DOCKER_HUB",
          registry: "miniaxolotl",
          repository: "grove",
          digest: previous,
        },
        health_check: { http_path: "/health/ready", port: 26080 },
        instance_count: 1,
        instance_size_slug: "retained",
        envs: [{ key: "PRIVATE", value: "secret-fixture", type: "SECRET" }],
      },
    ],
    workers: [
      {
        name: "worker",
        image: {
          registry_type: "DOCKER_HUB",
          registry: "miniaxolotl",
          repository: "grove",
          digest: previous,
        },
        instance_count: 1,
        envs: [{ key: "PRIVATE", value: "secret-fixture", type: "SECRET" }],
      },
    ],
  };
  return {
    id: appId,
    spec,
    active_deployment: {
      id: "old-generation",
      phase: "ACTIVE",
      spec: globalThis.structuredClone(spec),
    },
  };
}
const fingerprint = receiptHash;
function fixture() {
  const app = archived();
  const baseline = {
    app: app.id,
    state: fingerprint(app),
    settings: fingerprint({ id: app.id, spec: app.spec }),
    digest: previous,
    health: app.spec.services[0].health_check,
  };
  const p = publication({ ...context, baseline }, digest, now);
  return { app, p, baseline };
}
test("publication retains the observed old settings fingerprint/healthcheck without exposing private spec", () => {
  const { p, baseline } = fixture();
  assert.deepEqual(p.evidence.baseline, baseline);
  assert.doesNotMatch(
    JSON.stringify(p),
    /secret-fixture|PRIVATE|retained.example/,
  );
});

test("publication baseline is a fresh settled archived two-component snapshot, never ordinary active-state admission", () => {
  const { app, baseline } = fixture();
  const decision = { app: app.id, previousDigest: previous };
  assert.deepEqual(
    held.captureArchivedBaseline?.(app, [], decision, fingerprint),
    baseline,
  );
  assert.throws(() =>
    held.captureArchivedBaseline?.(
      {
        ...app,
        spec: { ...app.spec, maintenance: { archive: false, enabled: false } },
      },
      [],
      decision,
      fingerprint,
    ),
  );
  assert.throws(() =>
    held.captureArchivedBaseline?.(
      app,
      [{ component_name: "worker", instance_name: "still-running" }],
      decision,
      fingerprint,
    ),
  );
});
test("compatible held restore changes only both images, startup latch, archive and API liveness check", () => {
  const { app, p } = fixture();
  const result = held.prepareHeld?.(app, [], p, fingerprint);
  assert.equal(result?.maintenance.archive, false);
  assert.equal(result?.maintenance.enabled, true);
  for (const component of [result?.services[0], result?.workers[0]]) {
    assert.equal(component?.image.digest, digest);
    assert.deepEqual(component?.envs[0], app.spec.services[0].envs[0]);
    assert.equal(component?.envs[1].key, "GROVE_RELEASE_HOLD");
    assert.deepEqual(
      JSON.parse(component.envs[1].value),
      held.holdIdentity?.(p),
    );
  }
  assert.equal(result.services[0].health_check.http_path, "/health/live");
  assert.deepEqual(result.domains, app.spec.domains);
  assert.equal(app.spec.maintenance.archive, true);
  assert.throws(() =>
    held.prepareHeld?.(
      app,
      [{ component_name: "worker", instance_name: "old-worker" }],
      p,
      fingerprint,
    ),
  );
  for (const changed of [
    { ...app, pending_deployment: { id: "pending" } },
    { ...app, spec: { ...app.spec, region: "unexpected" } },
  ])
    assert.throws(() => held.prepareHeld?.(changed, [], p, fingerprint));
});

test("publication accepts a running app without admitting a running restore", async () => {
  const app = archived();
  delete app.spec.maintenance;
  app.active_deployment.spec = globalThis.structuredClone(app.spec);
  const instances = [
    { component_name: "api", instance_name: "api-old" },
    { component_name: "worker", instance_name: "worker-old" },
  ];
  const baseline = held.capturePublicationBaseline(
    app,
    instances,
    { app: app.id, previousDigest: previous },
    fingerprint,
  );
  assert.equal(baseline.publicationOnly, true);
  assert.equal(baseline.state, fingerprint(app));
  assert.equal(app.spec.maintenance, undefined);
  assert.doesNotMatch(JSON.stringify(baseline), /secret-fixture|PRIVATE/);
  const p = publication({ ...context, baseline }, digest, now);
  assert.throws(() => held.prepareHeld(app, instances, p, fingerprint));
  assert.throws(() => held.prepareHeld(app, [], p, fingerprint));

  const stopped = globalThis.structuredClone(app);
  stopped.spec.maintenance = { archive: true, enabled: true };
  stopped.active_deployment = {
    id: "archived-generation",
    phase: "ACTIVE",
    spec: globalThis.structuredClone(stopped.spec),
  };
  const spec = held.prepareHeld(stopped, [], p, fingerprint);
  const running = {
    ...stopped,
    spec,
    active_deployment: { id: "held-generation", phase: "ACTIVE", spec },
  };
  const evidence = await held.verifyHeld(
    p,
    {
      fingerprint,
      getApp: async () => running,
      getInstances: async () => instances,
      probe: async (scope) => ({
        status: "release_held",
        role: scope.component,
        identity: held.holdIdentity(p),
        schema: "verified",
        challenge: scope.challenge,
      }),
    },
    now,
  );
  assert.equal(recordHeld(p, evidence, context, now).phase, "held_verified");
  stopped.spec.region = "unexpected";
  stopped.active_deployment.spec = globalThis.structuredClone(stopped.spec);
  assert.throws(() => held.prepareHeld(stopped, [], p, fingerprint));
});

test("publication readback retains live inventory and rejects pagination or same-count drift", async () => {
  const app = archived();
  delete app.spec.maintenance;
  app.active_deployment.spec = globalThis.structuredClone(app.spec);
  const decision = { app: app.id, previousDigest: previous };
  const instances = [
    { component_name: "api", instance_name: "api-old", state: "RUNNING" },
    { component_name: "worker", instance_name: "worker-old", state: "RUNNING" },
  ];
  const read = (change) => {
    let reads = 0;
    return async (path) => {
      if (!path.endsWith("/instances")) return { app };
      reads++;
      const page = { instances: globalThis.structuredClone(instances) };
      return reads === 2 && change ? change(page) : page;
    };
  };
  const baseline = await publicationReadback(decision, read());
  assert.equal(baseline.publicationOnly, true);
  await assert.rejects(
    publicationReadback(
      decision,
      read((page) => {
        page.instances[0].state = "REPLACED";
        return page;
      }),
    ),
    /Publication instance inventory drift/,
  );
  await assert.rejects(
    publicationReadback(
      decision,
      read((page) => ({ ...page, links: { pages: { next: "more" } } })),
    ),
    /INSTANCE_INVENTORY_REJECTED/,
  );
});

test("the existing one-API/one-worker instance contract cannot certify a partial larger generation", () => {
  const { app, p } = fixture();
  app.spec.services[0].instance_count = 2;
  app.active_deployment.spec.services[0].instance_count = 2;
  p.evidence.baseline.state = fingerprint(app);
  p.evidence.baseline.settings = fingerprint({ id: app.id, spec: app.spec });
  assert.throws(() => held.prepareHeld?.(app, [], p, fingerprint));
});
test("held verification performs fresh named-instance probes and rejects identity, generation, inventory or provider drift", async () => {
  const { app, p } = fixture();
  const spec = held.prepareHeld?.(app, [], p, fingerprint);
  const running = {
    ...app,
    spec,
    active_deployment: { id: "new-generation", phase: "ACTIVE", spec },
  };
  const instances = [
    { component_name: "api", instance_name: "api-new" },
    { component_name: "worker", instance_name: "worker-new" },
  ];
  let reads = 0,
    probes = 0;
  const io = {
    fingerprint,
    getApp: async () => {
      reads++;
      return running;
    },
    getInstances: async () => instances,
    probe: async (scope) => {
      probes++;
      assert.equal(scope.deployment, "new-generation");
      assert(
        instances.some(
          (i) =>
            i.instance_name === scope.instance &&
            i.component_name === scope.component,
        ),
      );
      return {
        status: "release_held",
        role: scope.component,
        identity: held.holdIdentity?.(p),
        challenge: scope.challenge,
        schema: "verified",
      };
    },
  };
  const evidence = await held.verifyHeld?.(p, io, now);
  assert.equal(evidence?.generation, "new-generation");
  assert.equal(reads, 2);
  assert.equal(probes, 2);
  assert.doesNotMatch(JSON.stringify(evidence), /secret-fixture|PRIVATE/);
  const heldReceipt = recordHeld(p, evidence, context, now);
  assert.equal(typeof held.prepareReconcile, "function");
  const narrowSpec = held.prepareReconcile?.(
    running,
    instances,
    p,
    heldReceipt,
    now,
    fingerprint,
  );
  assert.equal(narrowSpec.maintenance.enabled, true);
  const narrow = {
    ...running,
    spec: narrowSpec,
    active_deployment: {
      id: "narrow-generation",
      phase: "ACTIVE",
      spec: narrowSpec,
    },
  };
  const lifecycleEvidence = {
    release: receiptHash(held.holdIdentity(p)),
    receipt: receiptHash(heldReceipt),
    generation: "2",
    customers: 1,
    remoteVerified: 1,
    pending: 0,
    uncertain: 0,
    caughtUp: true,
    authorityHash: "2".repeat(64),
    remoteHash: "3".repeat(64),
    control: { phase: "reconcile", approvalHash: null, publicHash: null },
  };
  const narrowIO = {
    ...io,
    getApp: async () => narrow,
    probe: async (scope) => ({
      status: "lifecycle_verified",
      role: scope.component,
      identity: held.holdIdentity(p),
      receipt: receiptHash(heldReceipt),
      schema: "verified",
      challenge: scope.challenge,
      evidence: lifecycleEvidence,
    }),
  };
  const privateNarrow = await held.verifyLifecycle?.(
    p,
    heldReceipt,
    narrowIO,
    now,
  );
  assert.equal(privateNarrow?.ingress, false);
  const ingressSpec = held.prepareLifecycleIngress?.(
    narrow,
    instances,
    p,
    heldReceipt,
    privateNarrow,
    now,
    fingerprint,
  );
  narrow.spec = ingressSpec;
  narrow.active_deployment = {
    id: "ingress-generation",
    phase: "ACTIVE",
    spec: ingressSpec,
  };
  const lifecycleSnapshot = await held.verifyLifecycle?.(
    p,
    heldReceipt,
    narrowIO,
    now,
  );
  assert.equal(lifecycleSnapshot?.ingress, true);
  const lifecycle = recordLifecycle(
    p,
    heldReceipt,
    lifecycleSnapshot,
    context,
    now,
  );
  const handoff = await held.verifyHandoff(
    p,
    lifecycle,
    "4".repeat(64),
    {
      ...narrowIO,
      probe: async (scope) => ({
        ...(await narrowIO.probe(scope)),
        evidence: {
          ...lifecycleEvidence,
          control: {
            phase: "handoff",
            approvalHash: "4".repeat(64),
            publicHash: null,
          },
        },
      }),
    },
    now,
  );
  assert.equal(handoff.lifecycle.control.phase, "handoff");
  await assert.rejects(
    held.verifyHandoff(p, lifecycle, "f".repeat(64), narrowIO, now),
  );
  const approval = approve(
    p,
    lifecycle,
    {
      held: receiptHash(lifecycle),
      authority: "2".repeat(64),
      providers: "3".repeat(64),
      pending: 0,
      uncertain: 0,
      reconciledAt: new Date(now).toISOString(),
      approved: true,
      command: "4".repeat(64),
    },
    context,
    now,
    ({ source, held, authority, providers }) => ({
      source,
      held,
      authority,
      providers,
      manifest: "9".repeat(64),
      contract: "qualified-lifecycle-and-remote-reconciliation",
    }),
  );
  const active = held.prepareApproved?.(
    narrow,
    instances,
    p,
    approval,
    now,
    fingerprint,
  );
  assert.equal(active?.maintenance.archive, false);
  assert.equal(active?.maintenance.enabled, false);
  for (const component of [active?.services[0], active?.workers[0]]) {
    assert(
      !component?.envs.some((entry) => entry.key === "GROVE_RELEASE_HOLD"),
    );
    const entry = component?.envs.find(
      (entry) => entry.key === "GROVE_RELEASE_APPROVAL",
    );
    assert.deepEqual(entry && JSON.parse(entry.value), {
      schema: 1,
      identity: held.holdIdentity?.(p),
      approval: "4".repeat(64),
    });
  }
  assert.equal(
    active.services[0].health_check.http_path,
    "/health/live",
    "Real readiness stays held until public approval",
  );
  assert.equal(
    active.maintenance.enabled,
    false,
    "General routes remain source-gated while lifecycle ingress continues",
  );
  assert.deepEqual(active.domains, app.spec.domains);
  const approvedApp = {
    ...running,
    spec: active,
    active_deployment: {
      id: "approved-generation",
      phase: "ACTIVE",
      spec: active,
    },
  };
  let publicHash = null;
  const runtimeIO = {
    ...io,
    getApp: async () => approvedApp,
    probe: async (scope) => ({
      status: "runtime_verified",
      role: scope.component,
      identity: held.holdIdentity(p),
      approval: "4".repeat(64),
      schema: "verified",
      challenge: scope.challenge,
      evidence: {
        ...lifecycleEvidence,
        control: {
          phase: publicHash ? "public" : "released",
          approvalHash: "4".repeat(64),
          publicHash,
        },
      },
    }),
  };
  const runtime = await held.verifyRuntime?.(p, approval, runtimeIO, now);
  assert.equal(runtime?.lifecycle.control.phase, "released");
  publicHash = "5".repeat(64);
  const publicPrivate = await held.verifyRuntime?.(
    p,
    approval,
    runtimeIO,
    now,
    publicHash,
  );
  const publicSpec = held.preparePublic?.(
    approvedApp,
    instances,
    p,
    approval,
    publicPrivate,
    publicHash,
    now,
    fingerprint,
  );
  assert.deepEqual(
    publicSpec?.services[0].health_check,
    p.evidence.baseline.health,
  );
  approvedApp.spec = publicSpec;
  approvedApp.active_deployment = {
    id: "public-generation",
    phase: "ACTIVE",
    spec: publicSpec,
  };
  assert.equal(
    (
      await held.verifyPublic?.(
        p,
        approval,
        publicHash,
        { ...runtimeIO, ready: async () => ({ status: "ready" }) },
        now,
      )
    )?.public.status,
    "ready",
  );
  await assert.rejects(async () =>
    held.verifyPublic?.(
      p,
      approval,
      publicHash,
      { ...runtimeIO, ready: async () => ({ status: "release_held" }) },
      now,
    ),
  );
  assert.throws(() =>
    held.prepareApproved?.(
      running,
      instances,
      p,
      heldReceipt,
      now,
      fingerprint,
    ),
  );
  assert.throws(() =>
    held.prepareApproved?.(
      running,
      instances,
      p,
      approval,
      now + 600001,
      fingerprint,
    ),
  );
  assert.throws(() =>
    held.prepareApproved?.(
      { ...running, pending_deployment: { id: "pending" } },
      instances,
      p,
      approval,
      now,
      fingerprint,
    ),
  );
  await assert.rejects(async () =>
    held.verifyHeld?.(
      p,
      { ...io, probe: async () => ({ status: "release_held" }) },
      now,
    ),
  );
  let n = 0;
  await assert.rejects(async () =>
    held.verifyHeld?.(
      p,
      {
        ...io,
        getApp: async () =>
          ++n === 1
            ? running
            : { ...running, pending_deployment: { id: "racing" } },
      },
      now,
    ),
  );
  await assert.rejects(async () =>
    held.verifyHeld?.(
      p,
      {
        ...io,
        getInstances: async () => [
          ...instances,
          { component_name: "worker", instance_name: "stale" },
        ],
      },
      now,
    ),
  );
});
