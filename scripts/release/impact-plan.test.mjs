import assert from "node:assert/strict";
import test from "node:test";
import { plan } from "./impact-plan.mjs";
import * as inventory from "./impact-snapshot.mjs";

test("source inventory includes rendered docs and shared website config; unmapped library inputs need review", () => {
  const docs = new Set(["documentation/server.md"]);
  assert.equal(typeof inventory.inputBucket, "function");
  for (const path of [
    "documentation/server.md",
    "lib/typescript-config/base.json",
    "packages/website/public/brand/wordmark-primary.svg",
  ])
    assert.equal(inventory.inputBucket(path, docs), "website");
  for (const path of [
    "pnpm-lock.yaml",
    "lib/unclassified/runtime.json",
    ".claude-plugin/marketplace.json",
  ])
    assert.equal(inventory.inputBucket(path, docs), "watch");
  for (const path of [
    "LICENSE",
    "documentation/deploy.md",
    "packages/website/tests/site.spec.ts",
  ])
    assert.equal(inventory.inputBucket(path, docs), null);
});

const a = "a".repeat(40),
  b = "b".repeat(40),
  c = "c".repeat(40);
const snap = (source, targets) => ({
  policy: 1,
  mode: "comparison",
  source,
  toolchain: "same",
  targets,
  watch: {},
});
const baseline = snap(a, {
  website: { "page.tsx": "v1" },
  "npm:grove-server": { "dist/server.js": "v1" },
  service: { runtime: "v1" },
});
const candidate = snap(c, {
  website: { "page.tsx": "v2" },
  "npm:grove-server": { "dist/server.js": "v2" },
  service: { runtime: "v2" },
});
const receipt = (source) => ({
  source,
  identity: { version: "1.4.2" },
  evidence: "verified destination",
});

test("compares each channel against its own successful delivery, including pending earlier changes", () => {
  const intermediate = snap(b, {
    ...baseline.targets,
    website: candidate.targets.website,
  });
  const report = plan(candidate, [baseline, intermediate], {
    website: receipt(b),
    service: receipt(a),
    "npm:grove-server": receipt(a),
  });
  assert.equal(report.targets.website.state, "unchanged");
  assert.deepEqual(
    report.targets.website.proposedIdentity,
    receipt(b).identity,
  );
  assert.equal(report.targets.service.state, "selected");
  assert.equal(report.targets["npm:grove-server"].state, "review"); // packed bytes alone are not a consumer effect
  assert.deepEqual(report.targets["npm:grove-server"].changes, [
    "dist/server.js",
  ]);
});

test("missing receipt, missing snapshot, policy mismatch or unknown input never yields unchanged", () => {
  const receipts = { website: receipt(a) };
  for (const snapshots of [
    [],
    [{ ...baseline, policy: 2 }],
    [{ ...baseline, toolchain: "other" }],
    [{ ...baseline, watch: { "unmapped-file": "1" } }],
  ]) {
    const report = plan(candidate, snapshots, receipts);
    assert.equal(report.targets.website.state, "review");
    assert.equal(report.targets.service.state, "review");
  }
});

test("selects installable server changes only with the package-specific consumer effect", () => {
  const name = "npm:grove-server",
    receipts = { [name]: receipt(a) },
    decision = {
      candidate: c,
      baseline: a,
      effect: "Installed worker handles expired jobs",
    };
  const result = plan(candidate, [baseline], receipts, null, {
    [name]: decision,
  }).targets[name];
  assert.equal(result.state, "selected");
  assert.equal(result.proposedIdentity.version, "1.4.3");
  assert.equal(
    plan(candidate, [baseline], receipts, null, {
      [name]: { ...decision, baseline: b },
    }).targets[name].state,
    "review",
  );
  assert.throws(() =>
    plan({ ...candidate, mode: "stamped" }, [baseline], receipts),
  );
});

test("renames and deletions affect shipped files; replay never asserts a provider identity", () => {
  const before = snap(a, { website: { old: "same", gone: "removed" } });
  const after = snap(c, { website: { new: "same" } });
  const result = plan(after, [before], {}, a).targets.website;
  assert.deepEqual(result.changes, ["gone", "new", "old"]);
  assert.equal(result.oldIdentity, null);
  assert.equal(result.state, "selected");
});
