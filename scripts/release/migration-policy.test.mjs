import assert from "node:assert/strict";
import test from "node:test";
import { migrationPlan } from "./migration-policy.mjs";

const names = [
  "20261018_001_initial",
  "20261122_048_lifecycle_reconciliation",
  "20261127_049_note_capacity",
  "20261127_050_note_embedding_chunks",
  "20261127_051_note_order",
  "20261127_052_share_navigation",
];
const registry = names.map((name) => ({ name }));

test("only an exact retained history prefix and reviewed online-compatible pending migrations are automated", () => {
  assert.deepEqual(migrationPlan(registry, names.slice(0, 2)), {
    applied: names.slice(0, 2),
    pending: names.slice(2),
  });
  assert.deepEqual(migrationPlan(registry, names), {
    applied: names,
    pending: [],
  });
  for (const history of [
    [],
    [names[0], names[2]],
    [...names].reverse(),
    [...names, "unknown"],
  ]) {
    assert.throws(() => migrationPlan(registry, history), /history|baseline/i);
  }
  assert.throws(
    () => migrationPlan([...registry, { name: "20261128_053_unknown" }], names),
    /review|manual/i,
  );
  assert.throws(
    () => migrationPlan([registry[0], registry[0]], []),
    /registry/i,
  );
  assert.throws(
    () =>
      migrationPlan(
        registry.map((m, i) =>
          i === 2 ? { ...m, config: { transaction: false } } : m,
        ),
        names.slice(0, 2),
      ),
    /transaction/i,
  );
});
