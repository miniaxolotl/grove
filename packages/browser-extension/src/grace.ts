import { z } from "zod";
import { anonymousGraceDays } from "@lib/shared/billing";
import type { StorageArea } from "./webextension.ts";

export const graceKey = "grace:firstSeenAt";
const graceValue = z.object({ firstSeenAt: z.string().datetime() }).strict();

export function graceStatus(
  firstSeenAt: string | null,
  now = Date.now(),
): {
  state: "active" | "expired";
  daysLeft: number;
  firstSeenAt: string | null;
} {
  if (!firstSeenAt) return { state: "active", daysLeft: anonymousGraceDays, firstSeenAt: null };
  const started = Date.parse(firstSeenAt);
  if (Number.isNaN(started))
    return { state: "active", daysLeft: anonymousGraceDays, firstSeenAt: null };
  const elapsedDays = (now - started) / 86400000;
  const remaining = anonymousGraceDays - Math.floor(elapsedDays);
  if (remaining <= 0) return { state: "expired", daysLeft: 0, firstSeenAt };
  return { state: "active", daysLeft: remaining, firstSeenAt };
}

async function readFirstSeen(area?: StorageArea): Promise<string | null> {
  if (!area) return null;
  try {
    const raw = (await area.get(graceKey))[graceKey];
    const parsed = graceValue.safeParse(raw);
    return parsed.success ? parsed.data.firstSeenAt : null;
  } catch {
    return null;
  }
}

async function writeFirstSeen(area: StorageArea, firstSeenAt: string) {
  try {
    await area.set({ [graceKey]: { firstSeenAt } });
  } catch {
    // Best-effort only: anonymous grace must never break local features.
  }
}

/**
 * Anonymous grace marker. Local-first; sync (when the browser exposes it)
 * holds the earliest backup so reinstalls keep the original install date
 * while sync is on. Without sync this is best-effort and documented as such.
 * Local spell/grammar never consult this — only the signup nudge does.
 */
export async function ensureGrace(
  local: StorageArea,
  sync?: StorageArea,
  now = new Date(),
): Promise<string> {
  const [fromLocal, fromSync] = await Promise.all([
    readFirstSeen(local),
    readFirstSeen(sync),
  ]);
  const candidates = [fromLocal, fromSync].filter(
    (value): value is string => typeof value === "string",
  );
  if (candidates.length) {
    const earliest = candidates.sort()[0];
    if (fromLocal !== earliest) await writeFirstSeen(local, earliest);
    if (sync && fromSync !== earliest) await writeFirstSeen(sync, earliest);
    return earliest;
  }
  const firstSeenAt = now.toISOString();
  await writeFirstSeen(local, firstSeenAt);
  if (sync) await writeFirstSeen(sync, firstSeenAt);
  return firstSeenAt;
}

export async function readGrace(
  local: StorageArea,
  sync?: StorageArea,
  now = Date.now(),
) {
  const [fromLocal, fromSync] = await Promise.all([
    readFirstSeen(local),
    readFirstSeen(sync),
  ]);
  const firstSeenAt = [fromLocal, fromSync]
    .filter((value): value is string => typeof value === "string")
    .sort()[0] ?? null;
  return graceStatus(firstSeenAt, now);
}
