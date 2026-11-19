import assert from "node:assert/strict";

// A completed exact-source rollout may be reused after a later website failure.
// Pending/uncertain provider acceptance must be reconciled, not retried here.
export function selectedServiceReadback(app, baseline, admittedDigest = null) {
  assert(
    !app.pending_deployment && !app.in_progress_deployment,
    "Reconcile pending service delivery before retry",
  );
  const active = app.active_deployment;
  assert.equal(active?.phase, "ACTIVE");
  if (admittedDigest !== null)
    assert.match(admittedDigest, /^sha256:[a-f0-9]{64}$/);
  const complete =
    admittedDigest !== null &&
    [
      active.spec?.services?.find((p) => p.name === "api"),
      active.spec?.workers?.find((p) => p.name === "worker"),
    ].every((p) => p?.image?.digest === admittedDigest);
  if (!complete)
    assert.equal(
      active.id,
      baseline.deploymentId,
      "Unrelated service deployment",
    );
  const expected = complete ? admittedDigest : baseline.imageDigest;
  for (const [kind, name] of [
    ["services", "api"],
    ["workers", "worker"],
  ]) {
    const entries = active.spec[kind];
    assert.equal(
      entries.length,
      1,
      "Selected delivery preserves the two-component topology",
    );
    assert.equal(entries[0].name, name);
    assert.equal(entries[0].image.digest, expected);
  }
  return complete;
}
