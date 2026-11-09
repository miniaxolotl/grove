import type { QueueLane } from "@lib/shared/jobs";
type Source = "memory" | "task" | "email";
export const laneSources = (lane: QueueLane): Source[] =>
  lane === "enrichment"
    ? ["memory", "task"]
    : lane === "indexing"
      ? ["memory"]
      : lane === "email"
        ? ["email"]
        : ["task"];

/** Share the existing capacity pool, rotating database fallback across its sources. */
export function createLaneExecutor(
  runners: Record<Source, (lane: QueueLane, id?: string) => Promise<boolean>>,
) {
  const next = new Map<QueueLane, number>();
  return async (lane: QueueLane, id?: string, kind?: Source) => {
    const sources = laneSources(lane);
    if (kind) return sources.includes(kind) ? runners[kind](lane, id) : false;
    const start = next.get(lane) ?? 0;
    next.set(lane, (start + 1) % sources.length);
    for (let i = 0; i < sources.length; i++)
      if (await runners[sources[(start + i) % sources.length]](lane, id))
        return true;
    return false;
  };
}
