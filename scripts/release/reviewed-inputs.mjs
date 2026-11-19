// Cheap, read-only check of previously reviewed raw release-tool fingerprints.
// This does not replace the full snapshot's unknown-input or destination checks.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import process from "node:process";

const git = (...args) => execFileSync("git", args);
const source = process.argv[2];
assert.match(source ?? "", /^[a-f0-9]{40}$/, "Expected exact source SHA");
assert.equal(git("rev-parse", "HEAD").toString().trim(), source);
const ledger = JSON.parse(readFileSync("scripts/release/impact-receipts.json"));
function fingerprint(ref, path) {
  const entry = git("ls-tree", "-z", ref, "--", path).toString();
  if (!entry) return null;
  const [mode, type, oid] = entry.split(/[ \t]/);
  assert.equal(type, "blob", `Invalid reviewed input: ${path}`);
  assert.match(mode, /^100(644|755)$/, `Invalid reviewed input: ${path}`);
  return `${parseInt(mode, 8) & 0o111}:${createHash("sha256")
    .update(git("cat-file", "blob", oid))
    .digest("hex")}`;
}
for (const baseline of new Set(
  Object.values(ledger.targets).map((t) => t.source),
)) {
  assert.match(baseline, /^[a-f0-9]{40}$/);
  git("merge-base", "--is-ancestor", baseline, source);
  for (const [path, pair] of Object.entries(
    ledger.reviewedReleaseInputs?.[baseline] ?? {},
  )) {
    assert.equal(
      fingerprint(baseline, path),
      pair[0],
      `Unexpected baseline: ${path}`,
    );
    assert.equal(
      fingerprint(source, path),
      pair[1],
      `Release held: unreviewed change to ${path}. Review release inputs and destination receipts before selection; do not refresh fingerprints automatically.`,
    );
  }
}
