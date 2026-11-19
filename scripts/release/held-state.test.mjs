import assert from "node:assert/strict";
import test from "node:test";
import * as state from "./held-state.mjs";

const now = Date.parse("2026-11-19T10:00:00Z");
const source = "a".repeat(40),
  production = "b".repeat(40),
  tree = "c".repeat(40);
const digest = `sha256:${"d".repeat(64)}`;
const context = {
  repository: "miniaxolotl/grove",
  source,
  production,
  tree,
  tag: "v1.11.30",
  apiVersion: "1.11.29",
  run: 123,
  attempt: 1,
  actor: "miniaxolotl",
  protected: true,
};
const publish = () => state.publication?.(context, digest, now);
const fixtureQualification = ({ source, held, authority, providers }) => ({
  source,
  held,
  authority,
  providers,
  manifest: "9".repeat(64),
  contract: "qualified-lifecycle-and-remote-reconciliation",
});
test("publication is exact-source/protected-production/run/attempt bound and does not imply activation", () => {
  const p = publish();
  assert.equal(p?.phase, "published_held");
  assert.deepEqual(p?.release, {
    source,
    production,
    tree,
    tag: "v1.11.30",
    apiVersion: "1.11.29",
    digest,
    run: 123,
    attempt: 1,
  });
  assert.equal(p?.previous, null);
  assert.throws(() =>
    state.publication?.({ ...context, apiVersion: undefined }, digest, now),
  );
  for (const bad of [
    { protected: false },
    { actor: "other" },
    { repository: "other/grove" },
    { run: 0 },
    { attempt: 0 },
  ]) {
    assert.throws(() =>
      state.publication?.({ ...context, ...bad }, digest, now),
    );
  }
});
test("expired, foreign-run, stale-production and content-conflicting publication artifacts fail closed", () => {
  const p = publish();
  const artifact = {
    name: "held-publication-1",
    expired: false,
    expires_at: new Date(now + 60000).toISOString(),
    workflow_run: { id: 123 },
    digest: `sha256:${"e".repeat(64)}`,
  };
  assert.equal(
    state.admitPublication?.(p, artifact, context, now)?.phase,
    "published_held",
  );
  for (const bad of [
    { expired: true },
    { workflow_run: { id: 124 } },
    { expires_at: new Date(now).toISOString() },
  ]) {
    assert.throws(() =>
      state.admitPublication?.(p, { ...artifact, ...bad }, context, now),
    );
  }
  assert.throws(() =>
    state.admitPublication?.(
      p,
      artifact,
      { ...context, production: "f".repeat(40) },
      now,
    ),
  );
  assert.throws(() =>
    state.admitPublication?.(
      p,
      artifact,
      { ...context, apiVersion: "1.11.28" },
      now,
    ),
  );
});
test("approval requires a fresh exact-generation held receipt and explicit completed lifecycle/provider reconciliation", () => {
  const p = publish();
  const held = state.recordHeld?.(
    p,
    {
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
    },
    context,
    now,
  );
  const reconciliation = {
    held: state.receiptHash?.(held),
    authority: "2".repeat(64),
    providers: "3".repeat(64),
    pending: 0,
    uncertain: 0,
    reconciledAt: new Date(now).toISOString(),
    approved: true,
  };
  const approved = state.approve?.(
    p,
    held,
    reconciliation,
    context,
    now,
    fixtureQualification,
  );
  assert.equal(approved?.phase, "effects_approved");
  assert.equal(approved?.previous, state.receiptHash?.(held));
  assert.throws(
    () => state.approve?.(p, held, reconciliation, context, now),
    /qualified lifecycle/i,
  );
  for (const bad of [
    { pending: 1 },
    { uncertain: 1 },
    { approved: false },
    { held: "4".repeat(64) },
    { reconciledAt: new Date(now - 600001).toISOString() },
  ]) {
    assert.throws(() =>
      state.approve?.(
        p,
        held,
        { ...reconciliation, ...bad },
        context,
        now,
        fixtureQualification,
      ),
    );
  }
  assert.throws(() =>
    state.approve?.(
      p,
      held,
      reconciliation,
      context,
      now + 600001,
      fixtureQualification,
    ),
  );
});

test("a held observation needs both named-instance proofs and a fresh observation clock", () => {
  const p = publish();
  const partial = {
    fingerprint: "1".repeat(64),
    generation: "fixture-generation",
    instances: [
      { component: "api", name: "api-1" },
      { component: "worker", name: "worker-1" },
    ],
  };
  assert.throws(() => state.recordHeld?.(p, partial, context, now));
  assert.throws(() =>
    state.recordHeld?.(
      p,
      {
        ...partial,
        proofs: [],
        observedAt: new Date(now - 600001).toISOString(),
      },
      context,
      now,
    ),
  );
});
test("receipts cannot jump held verification/approval/runtime/public stages or change their publication", () => {
  const p = publish();
  assert.throws(() => state.advance?.(p, p, "public_verified", context, now));
  assert.throws(() =>
    state.advance?.(
      p,
      { ...p, phase: "effects_approved", previous: "f".repeat(64) },
      "runtime_verified",
      context,
      now,
    ),
  );
});
