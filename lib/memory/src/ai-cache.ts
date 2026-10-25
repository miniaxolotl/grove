import { createHash, randomUUID } from "node:crypto";
import { setTimeout } from "node:timers/promises";
import {
  databaseSignal,
  tenant,
  withDatabaseSignal,
  type Knex,
} from "@lib/database";
import { InferenceError } from "@lib/ai";
import { currentTelemetry } from "@lib/telemetry/context";
import { recordCacheReuse } from "./action-context.ts";

export type CacheFeature =
  | "query_embedding"
  | "document_embedding"
  | "organization"
  | "classification"
  | "planning"
  | "answer"
  | "research";
export type CacheResult<T> = {
  value: T;
  status: "fresh" | "cached" | "coalesced";
};
export const exactCacheKey = (input: unknown) =>
  createHash("sha256")
    .update(
      JSON.stringify(input, (_key, value) =>
        value && typeof value === "object" && !Array.isArray(value)
          ? Object.fromEntries(
              Object.entries(value).sort(([a], [b]) => a.localeCompare(b)),
            )
          : value,
      ),
    )
    .digest("hex");

const maxEntries = 512;
const maxBytes = 32 * 1024 * 1024;
const maxValueBytes = 240 * 1024;
const leaseSeconds = 120;

async function lock(trx: Knex.Transaction, accountId: string) {
  await trx.raw("SELECT pg_advisory_xact_lock(hashtextextended(?,39))", [
    accountId,
  ]);
  if (
    !(await trx("accounts")
      .where({ id: accountId, status: "active" })
      .first("id"))
  )
    throw new InferenceError("account_unavailable", false);
}

/** Evict completed values only. Live leases are never evicted to make space. */
async function makeRoom(
  trx: Knex.Transaction,
  extraBytes: number,
  extraRows: number,
  except?: { feature: string; key: string },
) {
  const totals = await trx("ai_cache")
    .select(
      trx.raw(
        "count(*) AS count, COALESCE(sum(octet_length(value::text)),0) AS bytes",
      ),
    )
    .first();
  let count = Number(totals.count) + extraRows;
  let bytes = Number(totals.bytes) + extraBytes;
  if (count <= maxEntries && bytes <= maxBytes) return true;
  const candidates = await trx("ai_cache")
    .whereNotNull("value")
    .modify((q) => {
      if (except) q.whereNot(except);
    })
    .select("feature", "key", trx.raw("octet_length(value::text) AS bytes"))
    .orderBy("createdAt")
    .limit(maxEntries);
  for (const candidate of candidates) {
    await trx("ai_cache")
      .where({ feature: candidate.feature, key: candidate.key })
      .delete();
    count--;
    bytes -= Number(candidate.bytes);
    if (count <= maxEntries && bytes <= maxBytes) return true;
  }
  return false;
}

/** Caches computation, never authorization or side effects. Callers must recheck
 * permissions and all source dependencies before publishing both fresh and reused
 * output. Claims are short SQL transactions; inference holds no connection/lock. */
export async function cachedWork<T>(
  db: Knex,
  accountId: string,
  feature: CacheFeature,
  input: unknown,
  options: {
    ttlMs: number;
    refreshId?: string;
    providerProfile?: string;
    signal?: AbortSignal;
    validate: (value: unknown) => T;
    run: (signal: AbortSignal) => Promise<T>;
  },
): Promise<CacheResult<T>> {
  const started = performance.now();
  const result = (
    value: T,
    status: CacheResult<T>["status"],
  ): CacheResult<T> => {
    if (status !== "fresh") recordCacheReuse();
    currentTelemetry().capture("ai_cache", {
      cache_feature: feature,
      cache_status: status,
      requests_avoided: status === "fresh" ? 0 : 1,
      duration_ms: performance.now() - started,
    });
    return { value, status };
  };
  const key = exactCacheKey(["exact-v1", input]);
  const identity = { accountId, feature, key };
  const provider = options.providerProfile
    ? { accountId, profile: exactCacheKey(options.providerProfile) }
    : undefined;
  const leaseId = randomUUID();
  const signal = AbortSignal.any([
    ...(databaseSignal() ? [databaseSignal()!] : []),
    ...(options.signal ? [options.signal] : []),
  ]);
  let waited = false;
  for (;;) {
    signal.throwIfAborted();
    const claim = await tenant(db, accountId, async (trx) => {
      await lock(trx, accountId);
      const { epoch } = await trx("processing_control").first("epoch");
      const row = await trx("ai_cache")
        .where(identity)
        .where({ epoch })
        .where("expiresAt", ">", trx.fn.now())
        .select("value", "refreshId", trx.raw("lease_until>now() AS leased"))
        .first();
      if (
        row?.value != null &&
        (!options.refreshId || row.refreshId === options.refreshId)
      ) {
        try {
          return { hit: { value: options.validate(row.value) } };
        } catch {
          await trx("ai_cache").where(identity).delete();
        }
      } else if (row?.leased) return { wait: true };
      if (provider) {
        const backoff = await trx("ai_provider_backoff")
          .where(provider)
          .where({ epoch })
          .select("profile", trx.raw("retry_at>now() AS cooling"))
          .first();
        if (backoff?.cooling) throw new InferenceError("provider_cooling_down");
        if (backoff)
          await trx("ai_provider_backoff")
            .where(provider)
            .update({
              probing: true,
              probeId: leaseId,
              retryAt: trx.raw("now()+interval '120 seconds'"),
            });
      }
      await trx("ai_cache").where(identity).delete();
      await trx("ai_cache")
        .where((q) =>
          q.where("expiresAt", "<=", trx.fn.now()).orWhereNot({ epoch }),
        )
        .delete();
      if (!(await makeRoom(trx, maxValueBytes, 1)))
        throw new InferenceError("cache_capacity");
      await trx("ai_cache").insert({
        ...identity,
        epoch,
        leaseId,
        refreshId: options.refreshId ?? null,
        leaseUntil: trx.raw("now()+(? * interval '1 second')", [leaseSeconds]),
        expiresAt: trx.raw("now()+(? * interval '1 second')", [leaseSeconds]),
      });
      return { epoch };
    });
    if (claim.hit) {
      signal.throwIfAborted();
      return result(claim.hit.value, waited ? "coalesced" : "cached");
    }
    if (claim.wait) {
      waited = true;
      await setTimeout(40, undefined, { signal });
      continue;
    }
    const stop = new AbortController(),
      lost = new AbortController();
    const workSignal = AbortSignal.any([signal, lost.signal]);
    const heartbeat = (async () => {
      try {
        while (!stop.signal.aborted) {
          await setTimeout(30_000, undefined, { signal: stop.signal });
          const renewed = await withDatabaseSignal(undefined, () =>
            tenant(db, accountId, (trx) =>
              trx("ai_cache")
                .where({ ...identity, leaseId, epoch: claim.epoch })
                .where("leaseUntil", ">", trx.fn.now())
                .whereRaw(
                  "epoch=(SELECT epoch FROM processing_control WHERE singleton)",
                )
                .whereExists(
                  trx("accounts")
                    .select("id")
                    .where({ id: accountId, status: "active" }),
                )
                .update({
                  leaseUntil: trx.raw("now()+(? * interval '1 second')", [
                    leaseSeconds,
                  ]),
                  expiresAt: trx.raw("now()+(? * interval '1 second')", [
                    leaseSeconds,
                  ]),
                }),
            ),
          );
          if (!renewed) {
            lost.abort();
            return;
          }
        }
      } catch {
        if (!stop.signal.aborted) lost.abort();
      }
    })();
    try {
      const value = options.validate(
        await withDatabaseSignal(workSignal, () => options.run(workSignal)),
      );
      workSignal.throwIfAborted();
      const encoded = JSON.stringify(value);
      await tenant(db, accountId, async (trx) => {
        await lock(trx, accountId);
        if (provider)
          await trx("ai_provider_backoff")
            .where({ ...provider, probeId: leaseId })
            .delete();
        const owned = trx("ai_cache")
          .where({ ...identity, leaseId, epoch: claim.epoch })
          .where("leaseUntil", ">", trx.fn.now())
          .whereRaw(
            "epoch=(SELECT epoch FROM processing_control WHERE singleton)",
          );
        if (!(await owned.clone().first("key")))
          throw new InferenceError("cache_lease_lost");
        if (
          Buffer.byteLength(encoded) > maxValueBytes ||
          !(await makeRoom(trx, Buffer.byteLength(encoded), 0, {
            feature,
            key,
          }))
        ) {
          await owned.delete();
          return;
        }
        await owned.update({
          value: encoded,
          expiresAt: trx.raw("now()+(? * interval '1 millisecond')", [
            Math.max(1, options.ttlMs),
          ]),
          leaseUntil: trx.fn.now(),
        });
      });
      workSignal.throwIfAborted();
      return result(value, "fresh");
    } catch (error) {
      await withDatabaseSignal(undefined, () =>
        tenant(db, accountId, async (trx) => {
          await trx("ai_cache")
            .where({ ...identity, leaseId })
            .delete();
          if (
            provider &&
            !workSignal.aborted &&
            error instanceof InferenceError &&
            [
              "provider_unavailable",
              "provider_rate_limited",
              "provider_timeout",
              "provider_authentication",
            ].includes(error.code)
          ) {
            await lock(trx, accountId);
            const current = await trx("ai_provider_backoff")
              .where(provider)
              .first();
            if (!current?.probing || current.probeId === leaseId)
              await trx("ai_provider_backoff")
                .insert({
                  ...provider,
                  epoch: claim.epoch,
                  probeId: leaseId,
                  probing: false,
                  retryAt: trx.raw("now()+interval '10 seconds'"),
                })
                .onConflict(["accountId", "profile"])
                .merge();
          }
        }),
      ).catch(() => {});
      throw error;
    } finally {
      stop.abort();
      await heartbeat;
    }
  }
}
