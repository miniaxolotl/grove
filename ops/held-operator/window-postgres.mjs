import { need, hashJSON, canonical } from "./operator-control.mjs";
import { readSnapshot, semanticRows } from "./catalog.mjs";
import {
  barrierSql,
  boundedTransaction,
  verifyOwnerDatabase,
} from "./window-db.mjs";
import { isFixtureDatabase } from "./operator-restore.mjs";
import { inspectSafety, assertDatabaseQuiescence } from "./window-safety.mjs";
const same = (a, b) => hashJSON(a) === hashJSON(b);
const set = (rows) => rows.map(canonical).sort();
const delta = (a, b) => {
  const aa = set(a),
    bb = set(b);
  return {
    removed: aa.filter((r) => !bb.includes(r)),
    added: bb.filter((r) => !aa.includes(r)),
  };
};
export function preservationBlueprint(source, registry, before, after) {
  const changes = {};
  for (const group of ["metadata", "extras"]) {
    changes[group] = {};
    for (const key of Object.keys(before[group]))
      if (key !== "history")
        changes[group][key] = delta(
          semanticRows(key, before[group][key]),
          semanticRows(key, after[group][key]),
        );
  }
  return {
    schema: 1,
    source,
    registry,
    changes,
    newTables: after.tables.filter((t) => !before.tables.includes(t)),
  };
}
export function validatePreservation(before, after, blueprint) {
  need(
    same(after.metadata.history.slice(0, 44), before.metadata.history) &&
      same(
        after.metadata.history.map((r) => r.name),
        blueprint.registry,
      ),
    "HISTORY_DRIFT",
  );
  for (const key of Object.keys(before.rowsets))
    if (key !== "knex_migrations")
      need(
        same(after.rowsets[key], before.rowsets[key]),
        "PRESERVATION_ROWS_DRIFT",
      );
  need(after.mediaHash === before.mediaHash, "PRESERVATION_ORIGINALS_DRIFT");
  const oldColumns = new Set(
    before.extras.semanticColumns.map((r) => r.relname + "\0" + r.attname),
  );
  need(
    same(
      after.extras.semanticColumns.filter((r) =>
        oldColumns.has(r.relname + "\0" + r.attname),
      ),
      before.extras.semanticColumns,
    ),
    "PRESERVATION_EXISTING_COLUMNS_DRIFT",
  );
  for (const group of ["metadata", "extras"])
    for (const key of Object.keys(before[group]))
      if (key !== "history") {
        // Literal equality for unchanged objects is covered by the set difference;
        // only qualified cross-cluster internal pg_attver/owner ACL representations
        // normalize, with effective ACLs independently compared in full.
        need(
          same(
            delta(
              semanticRows(key, before[group][key]),
              semanticRows(key, after[group][key]),
            ),
            blueprint.changes[group][key],
          ),
          "PRESERVATION_CATALOG_DRIFT",
        );
      }
  need(
    same(
      after.tables.filter((t) => !before.tables.includes(t)),
      blueprint.newTables,
    ),
    "PRESERVATION_TABLE_DRIFT",
  );
  return true;
}
export function createWindow({ source, blueprint, verify }) {
  const migrations = (source.migrations ?? []).map((m) =>
    Object.freeze({ ...m }),
  );
  source = Object.freeze({
    ...source,
    registry: Object.freeze([...source.registry]),
    migrations: Object.freeze(migrations),
    migrationSource: Object.freeze({
      getMigrations: async () => migrations,
      getMigrationName: (m) => m.name,
      getMigration: async (m) => m,
    }),
  });
  blueprint = JSON.parse(JSON.stringify(blueprint));
  need(
    blueprint.source === source.source &&
      same(blueprint.registry, source.registry),
    "BLUEPRINT_SOURCE_DRIFT",
  );
  return {
    async applyUnderBarrier(db, before, { assertFresh = () => {} } = {}) {
      await verify();
      await verifyOwnerDatabase(db, { fixture: isFixtureDatabase(db) });
      assertFresh();
      need(
        same(
          before.metadata.history.map((r) => r.name),
          source.registry.slice(0, 44),
        ),
        "HISTORY_DRIFT",
      );
      assertFresh({ beginTransaction: true });
      return boundedTransaction(db, async (trx) => {
        await trx.raw(barrierSql(before.tables));
        assertDatabaseQuiescence(await inspectSafety((sql) => trx.raw(sql)));
        const locked = await readSnapshot(trx, before.columns);
        need(
          ["catalogHash", "rowsetsHash", "mediaHash"].every(
            (k) => locked[k] === before[k],
          ),
          "LOCKED_SNAPSHOT_DRIFT",
        );
        const [done, pending] = await trx.migrate.list({
          migrationSource: source.migrationSource,
        });
        need(
          same(
            done.map((r) => r.name),
            source.registry.slice(0, 44),
          ) &&
            same(
              pending.map((r) => r.name),
              source.registry.slice(44),
            ),
          "REGISTRY_DRIFT",
        );
        assertFresh();
        const [, applied] = await trx.migrate.latest({
          migrationSource: source.migrationSource,
        });
        need(same(applied, source.registry.slice(44)), "REGISTRY_DRIFT");
        const after = await readSnapshot(trx, before.columns);
        validatePreservation(before, after, blueprint);
        for (const name of blueprint.newTables)
          need(
            (
              await trx.raw(
                `SELECT count(*)::integer AS n FROM public."${name}"`,
              )
            ).rows[0].n === 0,
            "MIGRATION_SEEDED_AUTHORITY",
          );
        assertFresh();
        return { applied, after };
      });
    },
  };
}
