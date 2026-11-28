import assert from "node:assert/strict";

// Reviewed for old/new API and worker overlap. Everything else defaults to the
// operator procedure: names alone must never opt future migrations into rollout.
// Existing relations only; new tables are private to the pending transaction.
// Include FK parents and trigger/index targets, not just ALTER TABLE targets.
const online = new Map([
  [
    "20261127_049_note_capacity",
    {
      memories: "ACCESS EXCLUSIVE",
      document_import_notes: "ACCESS EXCLUSIVE",
    },
  ],
  [
    "20261127_050_note_embedding_chunks",
    {
      memories: "SHARE ROW EXCLUSIVE",
      memory_revisions: "SHARE ROW EXCLUSIVE",
      embedding_profiles: "SHARE ROW EXCLUSIVE",
    },
  ],
  [
    "20261127_051_note_order",
    {
      accounts: "ACCESS EXCLUSIVE",
      memories: "SHARE ROW EXCLUSIVE",
    },
  ],
  ["20261127_052_share_navigation", {}],
]);

export function migrationLocks(pending) {
  const locks = new Map();
  for (const name of pending) {
    assert(
      online.has(name),
      "Migration locks require online compatibility review",
    );
    for (const [table, mode] of Object.entries(online.get(name))) {
      if (!locks.has(table) || mode === "ACCESS EXCLUSIVE")
        locks.set(table, mode);
    }
  }
  return [...locks]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([table, mode]) => ({ table, mode }));
}

export function migrationPlan(registry, history) {
  const names = registry.map((migration) => migration.name);
  assert(
    new Set(names).size === names.length,
    "Migration registry contains duplicate names",
  );
  assert(
    history.length > 0,
    "A retained migration baseline is required; use the operator procedure for bootstrap",
  );
  assert(
    history.length <= names.length &&
      history.every((name, index) => name === names[index]),
    "Retained migration history must be an exact registry prefix; do not rewrite or skip history",
  );
  const pending = registry.slice(history.length);
  assert(
    pending.every((migration) => online.has(migration.name)),
    "Pending migrations need online compatibility review or the manual owner procedure",
  );
  assert(
    pending.every((migration) => migration.config?.transaction !== false),
    "Automatic migrations must support transactional execution",
  );
  return {
    applied: history,
    pending: pending.map((migration) => migration.name),
  };
}
