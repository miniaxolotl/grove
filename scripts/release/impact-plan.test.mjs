import assert from "node:assert/strict";
import test from "node:test";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import process from "node:process";
import { plan } from "./impact-plan.mjs";
import * as inventory from "./impact-snapshot.mjs";

const ledger = JSON.parse(readFileSync("scripts/release/impact-receipts.json"));

test("archive permissions survive extraction under different umasks; executable changes are visible", (t) => {
  const tmp = mkdtempSync(join(tmpdir(), "grove-mode-"));
  t.after(() => rmSync(tmp, { recursive: true, force: true }));
  mkdirSync(join(tmp, "package"));
  const entry = join(tmp, "package", "cli.js");
  writeFileSync(entry, "#!/usr/bin/env node\n");
  const inventoryFor = (mode, mask) => {
    chmodSync(entry, mode);
    const dest = join(tmp, `${mode}-${mask}`);
    mkdirSync(dest);
    const archive = join(dest, "package.tgz");
    execFileSync("tar", ["-czf", archive, "-C", tmp, "package"]);
    const previous = process.umask(mask);
    try {
      return inventory.packedFiles(archive, dest);
    } finally {
      process.umask(previous);
    }
  };
  const plain = inventoryFor(0o644, 0o022),
    executable = inventoryFor(0o755, 0o077);
  assert.deepEqual(plain, inventoryFor(0o644, 0o077));
  assert.notDeepEqual(plain, executable);
  assert.deepEqual(executable, inventoryFor(0o755, 0o022));
});

test("normalization cannot conceal an independently edited package manifest", () => {
  const name = "npm:grove-server",
    before = snap(a, { [name]: { "package.json": "normalized" } }),
    after = { ...before, source: b, versions: { [name]: "1.11.25" } };
  assert.equal(
    plan(after, [before], { [name]: receipt(a, name) }).targets[name].state,
    "review",
  );
});

test("only known offline pilot tools are excluded from release input review", () => {
  for (const name of ["selected-writer.mjs", "impact-identity.mjs"])
    assert.equal(
      inventory.inputBucket(`scripts/release/${name}`, new Set()),
      null,
    );
  for (const name of [
    "impact-publish.mjs",
    "selected-writer-live.mjs",
    "publication.mjs",
  ])
    assert.equal(
      inventory.inputBucket(`scripts/release/${name}`, new Set()),
      "watch",
    );
});

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
  policy: 2,
  versions: Object.fromEntries(
    Object.entries(ledger.targets)
      .filter(([name]) => name.startsWith("npm:"))
      .map(([name, r]) => [name, r.identity.version]),
  ),
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
const receipt = (source, target = "website") => ({
  source,
  identity: ledger.targets[target].identity,
  evidence: "verified destination",
});

test("compares each channel against its own successful delivery, including pending earlier changes", () => {
  const intermediate = snap(b, {
    ...baseline.targets,
    website: candidate.targets.website,
  });
  const report = plan(candidate, [baseline, intermediate], {
    website: receipt(b),
    service: receipt(a, "service"),
    "npm:grove-server": receipt(a, "npm:grove-server"),
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
    [{ ...baseline, policy: 1 }],
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
    receipts = { [name]: receipt(a, name) },
    decision = {
      candidate: c,
      baseline: a,
      effect: "Installed worker handles expired jobs",
    };
  const result = plan(candidate, [baseline], receipts, null, {
    [name]: decision,
  }).targets[name];
  assert.equal(result.state, "selected");
  assert.equal(result.proposedIdentity.version, "1.11.25");
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

test("incomplete or unsuccessful observations cannot carry an identity forward", () => {
  for (const [name, patch] of [
    ["website", { productionSha: "" }],
    ["website", { deploymentId: "" }],
    ["service", { phase: "ERROR" }],
    ["service", { imageDigest: "sha256:bad" }],
    ["downloads", { assets: {} }],
    [
      "downloads",
      {
        assets: {
          ...ledger.targets.downloads.identity.assets,
          "grove-edge.zip": "unverified",
        },
      },
    ],
    ["npm:grove-server", { latest: "1.1.1" }],
    ["npm:grove", { integrity: "unknown" }],
  ]) {
    const snapshot = snap(a, { [name]: { file: "same" } });
    const valid = receipt(a, name);
    assert.equal(
      plan(snapshot, [snapshot], { [name]: valid }).targets[name].state,
      "unchanged",
    );
    const invalid = { ...valid, identity: { ...valid.identity, ...patch } };
    assert.equal(
      plan(snapshot, [snapshot], { [name]: invalid }).targets[name].state,
      "review",
      name,
    );
  }
});

test("renames and deletions affect shipped files; replay never asserts a provider identity", () => {
  const before = snap(a, { website: { old: "same", gone: "removed" } });
  const after = snap(c, { website: { new: "same" } });
  const result = plan(after, [before], {}, a).targets.website;
  assert.deepEqual(result.changes, ["gone", "new", "old"]);
  assert.equal(result.oldIdentity, null);
  assert.equal(result.state, "selected");
});
