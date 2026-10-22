import type { Knex } from "@lib/database";

export const percentile = (values: number[], fraction: number) => {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return (
    Math.round(
      sorted[
        Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)
      ] * 100,
    ) / 100
  );
};

/** Numeric samples only: never retain SQL, bindings, identities or note content. */
export function observeDatabase(db: Knex) {
  const pool = db.client.pool;
  const waits = new Map<number, number>(),
    held = new Map<unknown, number>();
  const sql = new Map<string, number>();
  const waitMs: number[] = [],
    holdMs: number[] = [],
    sqlMs: number[] = [];
  const positions = new Map<number[], number>();
  const sample = (values: number[], value: number) => {
    const position = positions.get(values) ?? 0;
    values[position % 20000] = value;
    positions.set(values, position + 1);
  };
  let queries = 0,
    acquireFailures = 0;
  const start = (id: number) => {
    waits.set(id, performance.now());
  };
  const acquired = (id: number, resource: unknown) => {
    if (waits.has(id)) sample(waitMs, performance.now() - waits.get(id)!);
    waits.delete(id);
    held.set(resource, performance.now());
  };
  const failed = (id: number) => {
    waits.delete(id);
    acquireFailures++;
  };
  const release = (resource: unknown) => {
    if (held.has(resource))
      sample(holdMs, performance.now() - held.get(resource)!);
    held.delete(resource);
  };
  const query = (value: { __knexQueryUid?: string }) => {
    queries++;
    if (value.__knexQueryUid) sql.set(value.__knexQueryUid, performance.now());
  };
  const done = (_value: unknown, query: { __knexQueryUid?: string }) => {
    const id = query.__knexQueryUid;
    if (id && sql.has(id)) {
      sample(sqlMs, performance.now() - sql.get(id)!);
      sql.delete(id);
    }
  };
  pool.on("acquireRequest", start);
  pool.on("acquireSuccess", acquired);
  pool.on("acquireFail", failed);
  pool.on("release", release);
  db.on("query", query).on("query-response", done).on("query-error", done);
  return () => {
    pool.removeListener("acquireRequest", start);
    pool.removeListener("acquireSuccess", acquired);
    pool.removeListener("acquireFail", failed);
    pool.removeListener("release", release);
    db.off("query", query).off("query-response", done).off("query-error", done);
    return {
      queries,
      acquireFailures,
      sampleWindow: 20000,
      poolWaitP95Ms: percentile(waitMs, 0.95),
      poolHoldP95Ms: percentile(holdMs, 0.95),
      sqlP95Ms: percentile(sqlMs, 0.95),
    };
  };
}
