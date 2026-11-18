import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import process from "node:process";
import { parseArgs } from "node:util";
import { pathToFileURL, URL } from "node:url";
import { successfulReceipt } from "./impact-identity.mjs";

const requirements = {
  website: [
    "Compatible live API and supported install/download links",
    "Vercel deployment ID, production alias and exact live /release.json",
  ],
  service: [
    "Compatible installed clients, schema and migration preflight",
    "GHCR/Docker Hub digest and ACTIVE DigitalOcean API + worker using it",
  ],
  downloads: [
    "Version valid above download and reserved store versions; verify fallback links",
    "Three final ZIP digests, manifests, checksums and GitHub readback",
  ],
  npm: [
    "Name the installer-facing change; inspect final pack and required install pins",
    "Registry version, dist.integrity and dist-tag readback for the stamped tarball",
  ],
};
const changed = (before, after) =>
  [...new Set([...Object.keys(before), ...Object.keys(after)])]
    .filter((path) => before[path] !== after[path])
    .sort();

// A website may use its existing compatible backend. Changed downloads are
// held at their previous receipt until browser reservations are reconciled.
export function selectWebsite(report, receipts, source) {
  assert.match(source, /^[0-9a-f]{40}$/);
  assert.equal(report.candidate, source);
  assert.equal(report.mode, "production-advisory");
  const inventory = ["website", "service", "downloads", ...["grove", "grove-server", "grove-claude-plugin", "grove-codex-plugin", "grove-opencode-plugin"].map(n => `npm:${n}`)].sort();
  assert.deepEqual(Object.keys(report.targets).sort(), inventory);
  assert.deepEqual(Object.keys(receipts).sort(), inventory);
  const held = [];
  for (const name of inventory) {
    const item = report.targets[name], receipt = receipts[name];
    assert(successfulReceipt(name, receipt.identity, receipt.evidence));
    assert.equal(item.baselineSource, receipt.source);
    assert.deepEqual(item.oldIdentity, receipt.identity);
    assert.equal(item.evidence, receipt.evidence);
    assert(!item.unresolved?.length);
    if (name === "website" || (name === "downloads" && item.state === "selected")) {
      assert.equal(item.state, "selected");
      assert(item.changes.length);
      assert.equal(item.proposedIdentity.source, source);
      if (name === "downloads") held.push(name);
    } else {
      assert.equal(item.state, "unchanged", `Ineligible website-only release: ${name}`);
      assert.deepEqual(item.changes, []);
      assert.deepEqual(item.proposedIdentity, receipt.identity);
    }
  }
  return {deliver:["website"], held, publish:[]};
}

export function plan(
  candidate,
  snapshots,
  receipts,
  replaySource = null,
  effects = {},
) {
  const targets = {};
  assert.equal(candidate.policy, 3);
  assert.equal(
    candidate.mode,
    "comparison",
    "Use normalized snapshots for selection",
  );
  for (const [name, inputs] of Object.entries(candidate.targets)) {
    const npm = name.startsWith("npm:"),
      kind = npm ? "npm" : name;
    const [prerequisite, proofRequired] = requirements[kind];
    const receipt = replaySource ? null : receipts[name];
    const source = replaySource ?? receipt?.source ?? null;
    const baseline = snapshots.find((s) => s.source === source);
    const result = (targets[name] = {
      state: "review",
      baselineSource: source,
      oldIdentity: receipt?.identity ?? null,
      evidence: receipt?.evidence ?? null,
      proposedIdentity: null,
      prerequisite,
      proofRequired,
      effect: null,
      changes: [],
    });
    if (
      (!replaySource &&
        !successfulReceipt(name, receipt?.identity, receipt?.evidence)) ||
      !baseline?.targets[name] ||
      baseline.mode !== "comparison" ||
      baseline.policy !== candidate.policy ||
      baseline.toolchain !== candidate.toolchain
    ) {
      result.reason = "Missing verified receipt or comparable build";
      continue;
    }
    result.changes = changed(baseline.targets[name], inputs);
    if (
      npm &&
      !replaySource &&
      (candidate.versions?.[name] !== receipt.identity.version ||
        baseline.versions?.[name] !== receipt.identity.version)
    ) {
      result.reason = "Package stamp and verified registry version disagree";
      continue;
    }
    const unresolved = changed(baseline.watch, candidate.watch);
    if (unresolved.length) {
      result.reason =
        "Resolve changed build, dependency, provider or unmapped inputs";
      result.unresolved = unresolved;
    } else if (!result.changes.length) {
      result.state = "unchanged";
      result.proposedIdentity = result.oldIdentity;
      result.reason = "No changed comparison inputs";
    } else if (npm) {
      const decision = effects[name];
      if (
        replaySource ||
        !decision?.effect?.trim() ||
        decision.candidate !== candidate.source ||
        decision.baseline !== source
      ) {
        result.reason =
          "Changed packed files require a source-bound installer effect";
        continue;
      }
      const version = receipt.identity.version;
      assert.match(version, /^\d+\.\d+\.\d+$/);
      const [major, minor, patch] = version.split(".");
      result.proposedIdentity = {
        version: `${major}.${minor}.${BigInt(patch) + 1n}`,
        subjectTo: "Explicit higher or breaking release intent review",
      };
      result.effect = decision.effect;
      result.state = "selected";
    } else {
      result.state = "selected";
      result.effect = {
        website: "Website content or build inputs changed",
        service: "Hosted API/worker inputs changed",
        downloads: "Files installed from browser ZIPs changed",
      }[kind];
      result.proposedIdentity = {
        source: candidate.source,
        pending: proofRequired,
      };
    }
  }
  return {
    mode: replaySource ? "source-replay" : "production-advisory",
    candidate: candidate.source,
    targets,
  };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      replay: { type: "boolean" },
      receipts: { type: "string" },
      effects: { type: "string" },
    },
  });
  const load = (path) => JSON.parse(readFileSync(path, "utf8"));
  assert(
    positionals.length >= 2,
    "Usage: impact-plan.mjs [--replay] candidate.json baseline.json [...]",
  );
  assert(
    !values.replay ||
      (positionals.length === 2 && !values.receipts && !values.effects),
  );
  const [candidate, ...snapshots] = positionals.map(load);
  const ledger = load(
    values.receipts ?? new URL("impact-receipts.json", import.meta.url),
  );
  assert.equal(ledger.policy, 1);
  assert.equal(ledger.environment, "production");
  assert.deepEqual(
    Object.keys(candidate.targets).sort(),
    Object.keys(ledger.targets).sort(),
    "Incomplete target inventory",
  );
  for (const snap of [candidate, ...snapshots])
    assert.match(snap.source, /^[a-f0-9]{40}$/);
  for (const snap of snapshots)
    execFileSync("git", [
      "merge-base",
      "--is-ancestor",
      snap.source,
      candidate.source,
    ]);
  const report = plan(
    candidate,
    snapshots,
    ledger.targets,
    values.replay ? snapshots[0].source : null,
    values.effects ? load(values.effects) : {},
  );
  report.storeChannels = ledger.storeChannels;
  process.stdout.write(JSON.stringify(report, null, 2) + "\n");
}
