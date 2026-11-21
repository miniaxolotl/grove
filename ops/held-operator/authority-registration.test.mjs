import test from "node:test";
import assert from "node:assert/strict";
import process from "node:process";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import {
  provisionAuthority,
  openAuthority,
  appAuthorityIdentity,
} from "./authority.mjs";
import { hashJSON } from "./operator-control.mjs";
const api = await import("./authority.mjs");
test("separate source/code/custody registrations share one independently pinned app authority and old uncertain intent", async () => {
  const base = await mkdtemp(process.cwd() + "/.registrations-");
  try {
    for (const p of ["a", "one", "two"])
      await mkdir(base + "/" + p, { mode: 0o700 });
    const d = await provisionAuthority({
      root: base + "/a",
      workRoot: base + "/one",
      source: "a".repeat(40),
      codeHash: "1".repeat(64),
      id: randomUUID(),
      custodyId: randomUUID(),
    });
    const one = openAuthority(d);
    assert.equal(typeof one.registerInstallation, "function");
    const next = await one.registerInstallation({
      source: "b".repeat(40),
      workRoot: base + "/two",
      custodyId: randomUUID(),
      codeHash: "2".repeat(64),
    });
    assert.equal(next.dbIdentity, d.dbIdentity);
    assert.equal(next.id, d.id);
    assert.equal(
      hashJSON(appAuthorityIdentity(next)),
      hashJSON(appAuthorityIdentity(d)),
    );
    assert.notEqual(next.workIdentity, d.workIdentity);
    await openAuthority(next).status();
    await assert.rejects(
      openAuthority({ ...next, source: "c".repeat(40) }).status(),
      /IDENTITY/,
    );
    const at = Date.now(),
      binding = {
        source: d.source,
        authorityId: d.id,
        custodyId: d.custodyId,
        app: d.app,
        digest: "sha256:" + "d".repeat(64),
        issuedAt: at,
        expiresAt: at + 60000,
        leaseMs: 60000,
      };
    const req = {
      binding,
      certificateHash: "3".repeat(64),
      owner: randomUUID(),
      commandHash: "4".repeat(64),
      observed: {
        state: "5".repeat(64),
        settings: "6".repeat(64),
        instances: "7".repeat(64),
        generation: "old",
      },
      expected: "5".repeat(64),
      proposed: "8".repeat(64),
    };
    const lease = await one.call("window-assert", req);
    await one.call("window-prepare", { ...req, fence: lease.fence });
    const second = {
      ...req,
      binding: { ...binding, source: next.source, custodyId: next.custodyId },
      owner: randomUUID(),
      commandHash: "9".repeat(64),
    };
    await assert.rejects(
      openAuthority(next).call("window-assert", second),
      /UNCERTAIN|BUSY/,
    );
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});
test("the actual independent pin guard refuses a new app database or unregistered code closure", () => {
  assert.equal(typeof api.assertPinnedAuthority, "function");
  const d = {
    schema: 2,
    id: randomUUID(),
    app: randomUUID(),
    root: "/fixture/a",
    rootIdentity: "1:2",
    dbIdentity: "1:3",
    source: "a".repeat(40),
    codeHash: "b".repeat(64),
  };
  const pin = {
    appAuthoritySha256: hashJSON(appAuthorityIdentity(d)),
    closureSha256: d.codeHash,
  };
  api.assertPinnedAuthority(d, pin);
  for (const change of [
    { id: randomUUID() },
    { dbIdentity: "1:4" },
    { codeHash: "c".repeat(64) },
  ])
    assert.throws(
      () => api.assertPinnedAuthority({ ...d, ...change }, pin),
      /NOT_PINNED/,
    );
});
