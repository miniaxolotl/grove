import test from "node:test";
import assert from "node:assert/strict";
import process from "node:process";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { setTimeout as wait } from "node:timers/promises";
import { openAuthority, provisionAuthority } from "./authority.mjs";
test("one SQLite app lock spans sources and expired/crashed owners stay quarantined without an effect intent", async () => {
  const base = await mkdtemp(process.cwd() + "/.app-window-");
  try {
    await mkdir(base + "/a", { mode: 0o700 });
    await mkdir(base + "/w", { mode: 0o700 });
    await mkdir(base + "/w2", { mode: 0o700 });
    const d = await provisionAuthority({
      root: base + "/a",
      workRoot: base + "/w",
      source: "a".repeat(40),
      codeHash: "b".repeat(64),
      id: randomUUID(),
      custodyId: randomUUID(),
    });
    const a = openAuthority(d),
      d2 = await a.registerInstallation({
        source: "b".repeat(40),
        codeHash: "c".repeat(64),
        workRoot: base + "/w2",
        custodyId: randomUUID(),
      }),
      a2 = openAuthority(d2),
      at = Date.now(),
      binding = {
        source: d.source,
        authorityId: d.id,
        custodyId: d.custodyId,
        app: d.app,
        digest: "sha256:" + "d".repeat(64),
        issuedAt: at,
        expiresAt: at + 60000,
        leaseMs: 1000,
      };
    const request = {
      binding,
      certificateHash: "c".repeat(64),
      owner: randomUUID(),
      commandHash: "e".repeat(64),
      observed: {
        state: "1".repeat(64),
        settings: "2".repeat(64),
        instances: "3".repeat(64),
        generation: "one",
      },
    };
    const lease = await a.call("window-assert", request);
    const other = {
      ...request,
      binding: { ...binding, source: d2.source, custodyId: d2.custodyId },
      owner: randomUUID(),
      commandHash: "f".repeat(64),
    };
    await assert.rejects(a2.call("window-assert", other), /WINDOW_BUSY/);
    await wait(1100);
    await assert.rejects(a2.call("window-assert", other), /QUARANTINED/);
    await assert.rejects(a.call("window-assert", request), /QUARANTINED/);
    await assert.rejects(
      a.call("window-resolve-idle", { ...request, ...lease }),
      /RESOLUTION/,
    );
    const renewed = {
      ...request,
      binding: {
        ...binding,
        issuedAt: Date.now(),
        expiresAt: Date.now() + 60000,
      },
      certificateHash: "4".repeat(64),
    };
    await a.call("window-resolve-idle", renewed);
    const next = await a2.call("window-assert", other);
    assert(next.fence > lease.fence);
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});
