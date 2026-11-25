import assert from "node:assert/strict";
import test from "node:test";
import { deploymentSpecMatches, providerInstanceInventory } from "./held-provider-response.mjs";

const desired = {
  name: "grove",
  services: [{ name: "api" }],
  workers: [{ name: "worker" }],
  ingress: { rules: [] },
  domains: [{ domain: "example.test" }],
  maintenance: { enabled: true, archive: true },
};
function archive() {
  const spec = globalThis.structuredClone(desired);
  const actual = globalThis.structuredClone(spec);
  for (const key of ["services", "workers", "ingress"]) delete actual[key];
  return { spec, active_deployment: { id: "archive-generation", phase: "ACTIVE", spec: actual } };
}
test("archive projection must preserve every non-resource field and both raw specs", () => {
  const app = archive(), before = globalThis.structuredClone(app);
  assert(deploymentSpecMatches(app));
  assert.deepEqual(providerInstanceInventory({}, app), []);
  assert.deepEqual(app, before);
  for (const field of ["name", "domains", "maintenance"]) {
    const changed = globalThis.structuredClone(app);
    delete changed.active_deployment.spec[field];
    assert.equal(deploymentSpecMatches(changed), false);
    assert.throws(() => providerInstanceInventory({}, changed), /INVENTORY/);
  }
});
test("empty protobuf roster requires a settled archive, not missing metadata or a running app", () => {
  const app = archive();
  for (const page of [null, true, 1, false, 0, "", [], { meta: { total: 0 } }, { next: "more" }, { instances: null }])
    assert.throws(() => providerInstanceInventory(page, app), /INVENTORY/);
  for (const change of [
    { pending_deployment: { id: "pending" } },
    { in_progress_deployment: { id: "pending" } },
    { active_deployment: { ...app.active_deployment, phase: "DEPLOYING" } },
    { spec: { ...app.spec, maintenance: { enabled: true, archive: false } } },
  ]) assert.throws(() => providerInstanceInventory({}, { ...app, ...change }), /INVENTORY/);
  assert.deepEqual(providerInstanceInventory({ instances: [], meta: { total: 0 } }, app), []);
});
