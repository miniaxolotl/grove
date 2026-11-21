// Real synthetic PG17.12/vector0.8.0 only. No Doppler, live archive or provider.
import assert from "node:assert/strict";
import test from "node:test";
import process from "node:process";
import console from "node:console";
import { Buffer } from "node:buffer";
import { generateKeyPairSync, sign } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createControl, hashJSON, canonical } from "./operator-control.mjs";
import {
  qualifyInstallation,
  CONTRACT,
  verifySource,
} from "./qualification.mjs";
const module = await import("./rehearsal.mjs").catch((e) => {
  if (e.code === "ERR_MODULE_NOT_FOUND") return {};
  throw e;
});
test(
  "real populated 044 -> encrypted retained restore -> exact 045–048 and fault qualification",
  { timeout: 240000 },
  async () => {
    assert.equal(typeof module.rehearse, "function");
    const result = await module.rehearse({
      repository: process.cwd(),
      source:
        process.env.GROVE_REHEARSAL_SOURCE ??
        "bae8decfd3865db837299b1ad81af9b71d67c158",
    });
    assert.equal(result.fixtureOnly, true);
    assert.equal(result.liveReadiness, false);
    assert.equal(result.registry.length, 48);
    assert.equal(result.pending.length, 4);
    for (const outcome of Object.values(result.cases))
      assert.equal(outcome, "pass");
    assert(result.tables >= 80);
    assert(result.rows > 0);
    const control = createControl(result.root),
      inventory = JSON.parse(await readFile(result.root + "/inventory.json"));
    const policy = {
      appId: "3aef47f9-3724-4f21-9cad-8c4eb5644af0",
      parentSession: "synthetic-fixture-reviewer",
      deployedImage: "sha256:" + "a".repeat(64),
      deployedSource: "b".repeat(40),
      originalsReviewDue: "2026-12-19",
      originalsEncryptedSha256: "f".repeat(64),
    };
    const identity = {
      schema: 1,
      contract: CONTRACT,
      source: result.source,
      tree: result.tree,
      sourceFiles: inventory.files,
      operatorFiles: result.operatorFiles,
      dependencyFiles: result.dependencyFiles,
      registry: result.registry,
      blueprintHash: result.blueprintHash,
      reportHash: hashJSON(
        JSON.parse(await readFile(result.root + "/report.json")),
      ),
      policy,
      authority: null,
    };
    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    const payload = {
      schema: 1,
      contract: CONTRACT,
      scope: "fixture",
      identity: hashJSON(identity),
      reviewer: "synthetic-independent-reviewer",
      issuedAt: Date.now(),
      expiresAt: Date.now() + 60000,
    };
    const review = {
      payload,
      signature: sign(
        null,
        Buffer.from(canonical(payload)),
        privateKey,
      ).toString("base64"),
    };
    await control.durableWrite(
      result.root + "/fixture-review.json",
      JSON.stringify(review),
    );
    const config = {
      schema: 2,
      contract: CONTRACT,
      sourceRoot: result.root + "/source",
      inventory,
      report: result.root + "/report.json",
      blueprint: result.root + "/blueprint.json",
      review: result.root + "/fixture-review.json",
      policy,
      authority: null,
      window: null,
    };
    const admitted = await qualifyInstallation({
      control,
      config,
      publicKey: publicKey.export({ format: "pem", type: "spki" }),
    });
    assert.equal(admitted.manifest.fixtureQualified, true);
    assert.equal(admitted.manifest.executionAdmitted, false);
    await assert.rejects(
      qualifyInstallation({
        control,
        config: { ...config, policy: { ...policy, parentSession: "changed" } },
        publicKey: publicKey.export({ format: "pem", type: "spki" }),
      }),
      /REVIEW_BINDING/,
    );
    await assert.rejects(
      qualifyInstallation({
        control,
        config: {
          ...config,
          executionAdmitted: true,
          hardBlock: "FROZEN_V11129_COMPOSITION_BLOCKED",
        },
        publicKey: publicKey.export({ format: "pem", type: "spki" }),
      }),
      /NOT_QUALIFIED/,
    );
    const badInventory = globalThis.structuredClone(inventory);
    delete badInventory.files["package.json"];
    await assert.rejects(
      verifySource(config.sourceRoot, badInventory),
      /SOURCE_TREE/,
    );
    await assert.rejects(
      verifySource(config.sourceRoot, { ...inventory, source: "f".repeat(40) }),
      /SOURCE_COMMIT/,
    );
    const tampered = {
      ...result,
      cases: { ...result.cases, lost_commit_ack: "pass-but-not-exercised" },
    };
    await control.durableWrite(
      result.root + "/tampered-report.json",
      JSON.stringify(tampered),
    );
    await assert.rejects(
      qualifyInstallation({
        control,
        config: { ...config, report: result.root + "/tampered-report.json" },
        publicKey: publicKey.export({ format: "pem", type: "spki" }),
      }),
      /FIXTURE_CASES_INCOMPLETE/,
    );
    const output = {
      fixtureOnly: true,
      liveReadiness: false,
      source: result.source,
      root: result.root,
      cases: result.cases,
      totalMs: result.totalMs,
    };
    console.log(JSON.stringify(output));
  },
);
