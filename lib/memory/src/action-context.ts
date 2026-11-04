import { AsyncLocalStorage } from "node:async_hooks";

// Internal retrieval belongs to its parent action, not a second recall charge.
// This context is never derived from client input.
const internalRecall = new AsyncLocalStorage<boolean>();
export const withoutRecallCharge = <T>(run: () => T): T =>
  internalRecall.run(true, run);
export const recallIsInternal = () => internalRecall.getStore() === true;

type CacheWork = {
  reused: number;
  fresh: number;
  prepare: () => Promise<void>;
};
const cacheWork = new AsyncLocalStorage<CacheWork>();
export async function withActionCacheWork<T>(
  prepare: () => Promise<void>,
  run: () => Promise<T>,
) {
  const work = { reused: 0, fresh: 0, prepare };
  const value = await cacheWork.run(work, run);
  return {
    value,
    cached: work.reused > 0 && work.fresh === 0,
    mixed: work.reused > 0 && work.fresh > 0,
  };
}
export async function beforePaidWork() {
  const work = cacheWork.getStore();
  if (work) {
    await work.prepare();
    work.fresh++;
  }
}
export function recordCacheReuse() {
  const work = cacheWork.getStore();
  if (work) work.reused++;
}
export function actionCacheStatus(): "fresh" | "cached" | "mixed" {
  const work = cacheWork.getStore();
  return work && work.reused > 0
    ? work.fresh > 0
      ? "mixed"
      : "cached"
    : "fresh";
}
