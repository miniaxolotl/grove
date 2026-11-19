import assert from "node:assert/strict";
import test from "node:test";
import * as delivery from "./held-delivery.mjs";
import { receiptHash } from "./held-state.mjs";

const context = {
  repository: "miniaxolotl/grove",
  actor: "miniaxolotl",
  protected: true,
  source: "a".repeat(40),
  production: "b".repeat(40),
  tree: "c".repeat(40),
  tag: "v1.11.30",
  apiVersion: "1.11.30",
  run: 123,
  attempt: 1,
};
const decision = {
  schema: 1,
  mode: "held-publication-only",
  anchor: "9".repeat(40),
  app: "11111111-1111-4111-8111-111111111111",
  previousDigest: `sha256:${"d".repeat(64)}`,
};
const baseline = {
  app: decision.app,
  state: "e".repeat(64),
  settings: "f".repeat(64),
  digest: decision.previousDigest,
  health: { http_path: "/health/ready", port: 26080 },
};
const now = Date.parse("2026-11-19T10:00:00Z");
test("only an exact opt-in source decision selects held delivery; absence does not silently change normal releases", () => {
  assert.equal(delivery.parseHeldDecision?.(null), null);
  assert.deepEqual(
    delivery.parseHeldDecision?.(JSON.stringify(decision)),
    decision,
  );
  for (const change of [
    { schema: 2 },
    { mode: "deploy-now" },
    { extra: true },
    { app: "" },
    { previousDigest: "latest" },
  ])
    assert.throws(() =>
      delivery.parseHeldDecision?.(JSON.stringify({ ...decision, ...change })),
    );
});

test("held intent cannot float onto another moving source head or accept extra source edits", () => {
  const source = "1".repeat(40),
    declared = "2".repeat(40);
  const api = {
    exists: () => true,
    read: (ref, path) =>
      path === delivery.heldDecisionPath
        ? JSON.stringify(decision)
        : JSON.stringify({ version: "1.11.29" }),
    git: (...args) =>
      args[0] === "rev-parse"
        ? args[1] === `${source}^1`
          ? declared
          : decision.anchor
        : delivery.heldDecisionPath,
  };
  assert.equal(
    delivery.resolveHeldDecision?.(declared, false, api)?.hash,
    receiptHash(decision),
  );
  assert.throws(() =>
    delivery.resolveHeldDecision?.(declared, false, {
      ...api,
      git: (...args) =>
        args[0] === "diff"
          ? `${delivery.heldDecisionPath}\npackages/api/src/server.ts`
          : decision.anchor,
    }),
  );
  assert.throws(() =>
    delivery.resolveHeldDecision?.(declared, false, {
      ...api,
      git: () => "3".repeat(40),
    }),
  );
  assert.equal(
    delivery.resolveHeldDecision?.(declared, false, {
      ...api,
      exists: () => false,
    }),
    null,
  );
});

test("released held intent admits only the upstream coordinated version stamp on its exact declaration", () => {
  const source = "1".repeat(40),
    declared = "2".repeat(40);
  const api = {
    exists: () => true,
    read: (ref, path) =>
      JSON.stringify(
        path === delivery.heldDecisionPath
          ? decision
          : path === "release-please-config.json"
            ? { packages: { ".": { "extra-files": [] } } }
            : path === ".release-please-manifest.json"
              ? { ".": ref === source ? "1.11.30" : "1.11.29" }
              : { version: ref === source ? "1.11.30" : "1.11.29" },
      ),
    git: (...args) =>
      args[0] === "rev-parse"
        ? args[1] === `${source}^1`
          ? declared
          : decision.anchor
        : args[0] === "log"
          ? ""
          : args.at(-1) === declared
            ? delivery.heldDecisionPath
            : "CHANGELOG.md\npackage.json\n.release-please-manifest.json",
  };
  assert.equal(
    delivery.resolveHeldDecision?.(source, true, api)?.hash,
    receiptHash(decision),
  );
  assert.equal(
    delivery.resolveHeldSource?.(declared, api)?.hash,
    receiptHash(decision),
    "Source Release must discover an exact declaration",
  );
  assert.equal(
    delivery.resolveHeldSource?.(source, api)?.hash,
    receiptHash(decision),
    "Source Release must discover the same strict stamp without a released flag",
  );
  assert.throws(() =>
    delivery.resolveHeldDecision?.(source, true, {
      ...api,
      read: (ref, path) =>
        path === "package.json" && ref === source
          ? JSON.stringify({ version: "1.11.30", extra: "unreviewed" })
          : api.read(ref, path),
    }),
  );
  assert.throws(() =>
    delivery.resolveHeldSource?.(source, {
      ...api,
      read: (ref, path) =>
        path === "package.json" && ref === source
          ? JSON.stringify({ version: "1.11.30", extra: "unreviewed" })
          : api.read(ref, path),
    }),
  );
  assert.throws(() =>
    delivery.resolveHeldSource?.(source, {
      ...api,
      read: (ref, path) =>
        path === "package.json"
          ? JSON.stringify({ version: "1.11.29" })
          : api.read(ref, path),
    }),
    "An inherited decision without a version stamp must remain rejected",
  );
});
test("pending publication durably binds the archived baseline and exact source/run before irreversible writes", () => {
  const pending = delivery.pendingPublication?.(
    context,
    decision,
    baseline,
    now,
  );
  assert.equal(pending?.phase, "publication_pending");
  assert.equal(pending?.publicReleased, false);
  assert.equal(pending?.decisionHash, receiptHash(decision));
  assert.deepEqual(pending?.baseline, baseline);
  assert.equal(pending?.release.source, context.source);
  assert.equal(pending?.release.production, context.production);
  assert.equal(pending?.release.run, 123);
  assert.equal(pending?.release.attempt, 1);
  assert(!("digest" in pending.release));
  assert.throws(() =>
    delivery.pendingPublication?.(
      { ...context, protected: false },
      decision,
      baseline,
      now,
    ),
  );
  assert.throws(() =>
    delivery.pendingPublication?.(
      context,
      decision,
      { ...baseline, digest: `sha256:${"0".repeat(64)}` },
      now,
    ),
  );
});
test("publication completes only after actual package/image verification; failures or changed identities cannot make a receipt", async () => {
  const pending = delivery.pendingPublication?.(
    context,
    decision,
    baseline,
    now,
  );
  let verified = 0;
  const digest = `sha256:${"1".repeat(64)}`;
  const completed = await delivery.completePublication?.(
    pending,
    context,
    decision,
    digest,
    async () => {
      verified++;
      return { packages: "2".repeat(64), images: "3".repeat(64) };
    },
    now,
  );
  assert.equal(verified, 1);
  assert.equal(completed?.phase, "published_held");
  assert.equal(completed?.release.digest, digest);
  assert.equal(completed?.evidence.pendingHash, receiptHash(pending));
  assert.equal(completed?.evidence.decisionHash, receiptHash(decision));
  assert.equal(completed?.evidence.publicReleased, false);
  await assert.rejects(async () =>
    delivery.completePublication?.(
      pending,
      context,
      decision,
      digest,
      async () => {
        throw new Error("registry unavailable");
      },
      now,
    ),
  );
  await assert.rejects(async () =>
    delivery.completePublication?.(
      pending,
      { ...context, production: "4".repeat(40) },
      decision,
      digest,
      async () => ({}),
      now,
    ),
  );
});
