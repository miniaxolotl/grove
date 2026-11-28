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

test("reviewed pending migrations declare all existing DDL and foreign-key lock targets without locking an unchanged schema", async () => {
  const { migrationLocks } = await import("./migration-policy.mjs");
  assert.deepEqual(migrationLocks([]), []);
  assert.deepEqual(migrationLocks(names.slice(2)), [
    { table: "accounts", mode: "ACCESS EXCLUSIVE" },
    { table: "document_import_notes", mode: "ACCESS EXCLUSIVE" },
    { table: "embedding_profiles", mode: "SHARE ROW EXCLUSIVE" },
    { table: "memories", mode: "ACCESS EXCLUSIVE" },
    { table: "memory_revisions", mode: "SHARE ROW EXCLUSIVE" },
  ]);
  assert.deepEqual(migrationLocks([names[3]]), [
    { table: "embedding_profiles", mode: "SHARE ROW EXCLUSIVE" },
    { table: "memories", mode: "SHARE ROW EXCLUSIVE" },
    { table: "memory_revisions", mode: "SHARE ROW EXCLUSIVE" },
  ]);
  assert.deepEqual(migrationLocks([names[5]]), []);
  assert.throws(() => migrationLocks(["unreviewed"]), /review/);
});

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
