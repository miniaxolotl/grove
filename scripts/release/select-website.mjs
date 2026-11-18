// Read-only CI admission. Build inventories in a separate, unprivileged job.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import process from "node:process";
import { plan, selectWebsite } from "./impact-plan.mjs";
import { snapshot } from "./impact-snapshot.mjs";

const ledger = JSON.parse(readFileSync("scripts/release/impact-receipts.json"));
const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).trim();
const source = git("rev-parse", "HEAD");
const candidate = await snapshot(source);
const baselines = [];
for (const sha of new Set(Object.values(ledger.targets).map((t) => t.source))) {
  assert.match(sha, /^[0-9a-f]{40}$/);
  git("merge-base", "--is-ancestor", sha, source);
  const baseline = await snapshot(sha);
  // The bootstrap changes the release tools themselves. Only reviewed exact
  // before/after fingerprints may be reconciled; never ignore a path prefix.
  for (const [path, pair] of Object.entries(
    ledger.reviewedReleaseInputs?.[sha] ?? {},
  )) {
    assert.equal(
      baseline.watch[path] ?? null,
      pair[0],
      `Unexpected baseline: ${path}`,
    );
    assert.equal(
      candidate.watch[path] ?? null,
      pair[1],
      `Unreviewed change: ${path}`,
    );
    if (pair[1] === null) delete baseline.watch[path];
    else baseline.watch[path] = pair[1];
  }
  baselines.push(baseline);
}
const report = plan(candidate, baselines, ledger.targets);
const decision = selectWebsite(report, ledger.targets, source);
writeFileSync(
  "website-selection.json",
  JSON.stringify({ source, decision, report }, null, 2),
);
process.stdout.write(JSON.stringify(decision) + "\n");
