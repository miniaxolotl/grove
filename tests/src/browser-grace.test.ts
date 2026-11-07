import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ensureGrace,
  graceStatus,
  readGrace,
} from "../../packages/browser-extension/src/grace.ts";
import { anonymousGraceDays } from "@lib/shared/billing";

const area = (initial: Record<string, unknown> = {}) => {
  const store = new Map(Object.entries(initial));
  return {
    async get(keys: string | null) {
      if (keys === null) return Object.fromEntries(store);
      return { [keys]: store.get(keys) };
    },
    async set(values: Record<string, unknown>) {
      for (const [key, value] of Object.entries(values)) store.set(key, value);
    },
    async remove(keys: string | string[]) {
      for (const key of [keys].flat()) store.delete(key);
    },
    async clear() {
      store.clear();
    },
  };
};

test("grace counts full days left and expires after the window", () => {
  const now = Date.parse("2026-11-07T00:00:00.000Z");
  assert.equal(graceStatus(null, now).state, "active");
  assert.equal(graceStatus(null, now).daysLeft, anonymousGraceDays);
  const started = new Date(now - 13 * 86400000).toISOString();
  assert.equal(graceStatus(started, now).state, "active");
  assert.equal(graceStatus(started, now).daysLeft, 1);
  const expired = new Date(now - 14 * 86400000).toISOString();
  assert.equal(graceStatus(expired, now).state, "expired");
  assert.equal(graceStatus("not-a-date", now).state, "active");
});

test("grace keeps the earliest install date across local and sync", async () => {
  const local = area();
  const sync = area();
  const now = new Date("2026-11-07T00:00:00.000Z");
  const first = await ensureGrace(local, sync, now);
  assert.equal(first, now.toISOString());
  // A later local reinstall must not move the synced original forward.
  const localOnly = area();
  await ensureGrace(localOnly, sync, new Date(now.getTime() + 86400000));
  const status = await readGrace(
    localOnly,
    sync,
    now.getTime() + 2 * 86400000,
  );
  assert.equal(status.firstSeenAt, now.toISOString());
  assert.equal(status.daysLeft, anonymousGraceDays - 2);
});
