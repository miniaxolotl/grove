import { loadInstallation } from "./installation.mjs";
import { need, hashJSON } from "./operator-control.mjs";
import { readSnapshot } from "./catalog.mjs";
import { inspectSafety, assertDatabaseQuiescence } from "./window-safety.mjs";
export async function observePlan({ source, manifest, observe, target }) {
  const first = await observe(),
    client = target.connect();
  let before;
  try {
    await client.connect();
    await target.verify(client);
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    assertDatabaseQuiescence(await inspectSafety((sql) => client.query(sql)));
    before = await readSnapshot(client);
    await client.query("ROLLBACK");
  } finally {
    await client.end().catch(() => {});
  }
  const last = await observe();
  need(
    first.fingerprint === last.fingerprint &&
      first.deploymentId === last.deploymentId,
    "PROVIDER_DRIFT",
  );
  need(
    hashJSON(before.metadata.history.map((r) => r.name)) ===
      hashJSON(source.registry.slice(0, 44)),
    "HISTORY_DRIFT",
  );
  return {
    schema: 1,
    source: source.source,
    manifestHash: manifest.hash,
    observedAt: Date.now(),
    provider: last,
    before,
    database: {
      catalogHash: before.catalogHash,
      rowsetsHash: before.rowsetsHash,
      mediaHash: before.mediaHash,
      historyHash: hashJSON(before.metadata.history),
    },
  };
}
export async function operatorManifest(options = {}) {
  try {
    return await (await loadInstallation(options)).manifest();
  } catch {
    return {
      schema: 1,
      executionAdmitted: false,
      source: null,
      hash: null,
      hardBlock: "OPERATOR_NOT_QUALIFIED",
    };
  }
}
