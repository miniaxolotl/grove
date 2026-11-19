import assert from "node:assert/strict";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import process from "node:process";
import test from "node:test";

test("unreviewed release inputs stop before dependency fetch and inventory builds", () => {
  const workflow = readFileSync(".github/workflows/website-impact.yml", "utf8");
  const step = workflow.indexOf("node scripts/release/reviewed-inputs.mjs");
  assert.ok(step >= 0, "missing credential-free release-input preflight");
  assert.ok(step < workflow.indexOf("bash scripts/release/hydrate-impact.sh"));
  assert.ok(
    step < workflow.indexOf("pnpm install --offline --frozen-lockfile"),
  );
  assert.ok(step < workflow.indexOf("node scripts/release/select-website.mjs"));
});

test("raw fingerprints reject drift, deletion and executable changes without running build code", (t) => {
  const cwd = mkdtempSync(join(tmpdir(), "grove-inputs-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const git = (...args) =>
    execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
  git("init", "-q");
  git("config", "user.email", "fixture@example.invalid");
  git("config", "user.name", "Fixture");
  const path = "tool.sh",
    file = join(cwd, path);
  writeFileSync(file, "before\n");
  git("add", ".");
  git("commit", "-qm", "baseline");
  const baseline = git("rev-parse", "HEAD");
  const fp = (bytes) => `0:${createHash("sha256").update(bytes).digest("hex")}`;
  const ledger = {
    targets: { website: { source: baseline } },
    reviewedReleaseInputs: {
      [baseline]: { [path]: [fp("before\n"), fp("after\n")] },
    },
  };
  mkdirSync(join(cwd, "scripts/release"), { recursive: true });
  const save = () =>
    writeFileSync(
      join(cwd, "scripts/release/impact-receipts.json"),
      JSON.stringify(ledger),
    );
  const commit = () => {
    git("add", ".");
    git("commit", "-qm", "candidate");
    return git("rev-parse", "HEAD");
  };
  save();
  writeFileSync(file, "after\n");
  let source = commit();
  const run = (sha = source) =>
    spawnSync(
      process.execPath,
      [resolve("scripts/release/reviewed-inputs.mjs"), sha],
      { cwd, encoding: "utf8" },
    );
  assert.equal(run().status, 0);
  ledger.reviewedReleaseInputs[baseline][path][0] = fp("wrong baseline");
  save();
  assert.match(run().stderr, /Unexpected baseline/);
  ledger.reviewedReleaseInputs[baseline][path][0] = fp("before\n");
  save();
  assert.notEqual(run("not-a-sha").status, 0);
  assert.notEqual(run(baseline).status, 0, "stale checkout must not pass");
  chmodSync(file, 0o755);
  source = commit();
  assert.match(run().stderr, /Release held: unreviewed change/);
  ledger.reviewedReleaseInputs[baseline][path][1] = fp("after\n").replace(
    "0:",
    "73:",
  );
  save();
  assert.equal(run().status, 0, "explicit reviewed executable passes");
  ledger.reviewedReleaseInputs[baseline][path][1] = fp("after\n");
  save();
  chmodSync(file, 0o644);
  writeFileSync(file, "drift\n");
  source = commit();
  assert.match(run().stderr, /Release held: unreviewed change/);
  unlinkSync(file);
  source = commit();
  assert.match(run().stderr, /Release held: unreviewed change/);
  ledger.reviewedReleaseInputs[baseline][path][1] = null;
  save();
  assert.equal(run().status, 0, "explicit reviewed deletion passes");
  ledger.reviewedReleaseInputs[baseline]["added.sh"] = [null, fp("new\n")];
  save();
  writeFileSync(join(cwd, "added.sh"), "new\n");
  source = commit();
  assert.equal(run().status, 0, "explicit reviewed addition passes");
});
