import assert from "node:assert/strict";
import test from "node:test";
import process from "node:process";
import { mkdtemp, rm } from "node:fs/promises";
import { createControl, hashJSON } from "./operator-control.mjs";
import * as sql from "./window-db.mjs";
const module = await import("./window-policy.mjs").catch((e) => {
  if (e.code === "ERR_MODULE_NOT_FOUND") return {};
  throw e;
});
test("migration command rejects fixture custody and stale source before SQL, and never writes during reconciliation", async () => {
  assert.equal(typeof module.createMigrationOperator, "function");
  const root = await mkdtemp(process.cwd() + "/.operator-window-");
  try {
    const source = { source: "a".repeat(40), registry: [] },
      manifest = {
        source: source.source,
        hash: "b".repeat(64),
        executionAdmitted: true,
        contract: "source-bound-held-release-v1",
      };
    const before = {},
      plan = {
        source: source.source,
        manifestHash: manifest.hash,
        before,
        provider: {},
      },
      approval = {
        id: "11111111-1111-4111-8111-111111111111",
        schema: 1,
        purpose: "migrate-045-048",
        approved: true,
        source: source.source,
        manifest: manifest.hash,
        custody: "c".repeat(64),
        planHash: hashJSON(plan),
        issuedAt: Date.now(),
        expiresAt: Date.now() + 60000,
      };
    const operator = module.createMigrationOperator({
      control: createControl(root),
      source,
      blueprint: { source: source.source, registry: [] },
      manifest: async () => manifest,
      validateCustody: async () => ({ fixtureOnly: true }),
      observe: () => assert.fail("no provider read"),
      verify: () => assert.fail("no source or database effect"),
    });
    await assert.rejects(
      operator.execute({ db: {}, plan, approval }),
      /LIVE_BACKUP_REQUIRED/,
    );
    await assert.rejects(
      operator.execute({
        db: {},
        plan,
        approval: { ...approval, source: "d".repeat(40) },
      }),
      /SOURCE/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test("owner boundary rejects runtime role, unverified TLS and wrong toolchain", async () => {
  assert.equal(typeof sql.verifyOwnerDatabase, "function");
  const valid = {
    database: "grove",
    role: "grove_owner",
    server: "170012",
    mismatch: "error",
    superuser: false,
  };
  for (const change of [
    { role: "grove_api" },
    { server: "170010" },
    { superuser: true },
  ])
    await assert.rejects(
      sql.verifyOwnerDatabase({
        client: {
          acquireConnection: async () => ({
            connection: { stream: { encrypted: true, authorized: true } },
            query: async () => ({ rows: [{ ...valid, ...change }] }),
          }),
          releaseConnection: async () => {},
        },
      }),
      /IDENTITY/,
    );
});
