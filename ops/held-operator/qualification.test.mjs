import assert from "node:assert/strict";
import test from "node:test";
import process from "node:process";
import { mkdtemp, rm, appendFile } from "node:fs/promises";
import { join } from "node:path";
import { createControl, hashJSON } from "./operator-control.mjs";
const module = await import("./qualification.mjs").catch((e) => {
  if (e.code === "ERR_MODULE_NOT_FOUND") return {};
  throw e;
});

test("independent qualifier consumes exactly once; readback never writes and source/custody/torn state fail closed", async () => {
  assert.equal(typeof module.createQualifier, "function");
  const root = await mkdtemp(join(process.cwd(), ".operator-qualification-"));
  try {
    const control = createControl(root),
      manifest = {
        schema: 1,
        source: "a".repeat(40),
        hash: "b".repeat(64),
        executionAdmitted: true,
        contract: "source-bound-held-release-v1",
      };
    let clock = Date.now();
    const command = {
      schema: 1,
      approved: true,
      issuedAt: clock,
      expiresAt: clock + 60000,
      id: "11111111-1111-4111-8111-111111111111",
      source: manifest.source,
      manifest: manifest.hash,
      custody: "c".repeat(64),
      publication: "d".repeat(64),
      action: "restore",
    };
    const scope = {
      source: command.source,
      publication: command.publication,
      command: hashJSON(command),
      action: command.action,
      consume: true,
    };
    let checks = 0;
    const qualify = module.createQualifier({
      control,
      manifest: async () => manifest,
      now: () => clock,
      validateCustody: async (c) => {
        assert.equal(c.custody, command.custody);
        checks++;
      },
    });
    assert.equal((await qualify(scope, { command })).custody, command.custody);
    assert.equal(checks, 1);
    await assert.rejects(qualify(scope, { command }), /ALREADY_CONSUMED/);
    const path = root + "/qualifications/" + command.id + ".jsonl";
    const { readFile } = await import("node:fs/promises");
    const bytes = await readFile(path);
    await qualify({ ...scope, consume: false }, { command });
    assert.deepEqual(await readFile(path), bytes);
    clock += 300001;
    await assert.rejects(qualify(scope, { command }), /EXPIRED/);
    await qualify({ ...scope, consume: false }, { command });
    assert.deepEqual(await readFile(path), bytes);
    for (const change of [
      { source: "e".repeat(40) },
      { custody: "e".repeat(64) },
      { manifest: "e".repeat(64) },
    ]) {
      const bad = { ...command, ...change };
      await assert.rejects(
        qualify(
          { ...scope, command: hashJSON(bad), consume: false },
          { command: bad },
        ),
      );
    }
    await appendFile(path, '{"torn":');
    await assert.rejects(
      qualify({ ...scope, consume: false }, { command }),
      /TORN/,
    );
    manifest.hardBlock = "FROZEN_V11129_COMPOSITION_BLOCKED";
    await assert.rejects(qualify(scope, { command }), /NOT_QUALIFIED/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("configuration cannot qualify execution using caller booleans or unsigned reports", async () => {
  assert.equal(typeof module.verifyReview, "function");
  await assert.rejects(
    module.verifyReview({
      executionAdmitted: true,
      source: "a".repeat(40),
      hash: "b".repeat(64),
    }),
  );
  assert.equal(typeof module.inspectInstallation, "function");
  await assert.rejects(
    module.inspectInstallation({ config: { executionAdmitted: true } }),
    /NOT_QUALIFIED/,
  );
  assert.equal(typeof module.verifyFixtureEvidence, "function");
  await assert.rejects(
    module.verifyFixtureEvidence({
      report: { fixtureOnly: true, cases: { backup_restore: "pass" } },
    }),
    /FIXTURE_EVIDENCE_REQUIRED/,
  );
});
test("qualification binds installed dependency source bytes, not only package versions or the lockfile", async () => {
  assert.equal(typeof module.dependencyHashes, "function");
  const files = await module.dependencyHashes(process.cwd());
  assert(Object.keys(files).some((k) => k.startsWith("pg@")));
  assert(Object.keys(files).some((k) => k.startsWith("knex@")));
  assert(Object.keys(files).some((k) => k.startsWith("objection@")));
  for (const hash of Object.values(files)) assert.match(hash, /^[a-f0-9]{64}$/);
});
test("qualifier rechecks expiry after awaited custody and forwards the deadline into serialized consumption", async () => {
  const manifest = {
    source: "a".repeat(40),
    hash: "b".repeat(64),
    executionAdmitted: true,
    contract: module.CONTRACT,
  };
  let clock = 100,
    opened = 0,
    expire = false;
  const command = {
    schema: 1,
    approved: true,
    id: "11111111-1111-4111-8111-111111111111",
    source: manifest.source,
    manifest: manifest.hash,
    custody: "c".repeat(64),
    publication: "d".repeat(64),
    action: "restore",
    issuedAt: 100,
    expiresAt: 200,
  };
  const scope = {
    source: command.source,
    publication: command.publication,
    command: hashJSON(command),
    action: command.action,
    consume: true,
  };
  const qualify = module.createQualifier({
    manifest: async () => manifest,
    now: () => clock,
    validateCustody: async () => {
      if (expire) clock = 201;
    },
    control: {
      root: "/fixture",
      openJournal: async (_dir, _id, _initial, options) => {
        opened++;
        assert.equal(options?.expiresAt, command.expiresAt);
        return { append: async () => {}, close: async () => {} };
      },
    },
  });
  await qualify(scope, { command });
  assert.equal(opened, 1);
  expire = true;
  await assert.rejects(qualify(scope, { command }), /EXPIRED/);
  assert.equal(opened, 1);
});
