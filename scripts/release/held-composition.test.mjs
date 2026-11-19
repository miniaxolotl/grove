import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import test from "node:test";
import { execFileSync, spawnSync } from "node:child_process";
import process from "node:process";
test("actual operator and phase entrypoints link their imports before any credential or network access", () => {
  const help = execFileSync(
    process.execPath,
    ["scripts/release/held-operator-cli.mjs"],
    { encoding: "utf8", env: { PATH: process.env.PATH } },
  );
  assert.match(help, /Usage:/);
  const phase = spawnSync(
    process.execPath,
    ["scripts/release/held-phase.mjs"],
    { encoding: "utf8", env: { PATH: process.env.PATH } },
  );
  assert.equal(phase.status, 1);
  assert.match(phase.stderr, /Held continuation unverified/);
  assert.doesNotMatch(phase.stderr, /SyntaxError/);
});
test("protected held continuation records every actual phase and builds website afresh only after public verification", () => {
  assert(existsSync(".github/workflows/held-release.yml"));
  const workflow = readFileSync(".github/workflows/held-release.yml", "utf8");
  for (const token of [
    "refs/heads/production",
    "github.ref_protected == true",
    "group: production-release",
    "environment: production",
    "held-phase.mjs",
    "held-${{ steps.record.outputs.phase }}-",
  ])
    assert(workflow.includes(token), token);
  const phase = readFileSync("scripts/release/held-phase.mjs", "utf8");
  for (const name of [
    "loadPublication",
    "loadReceipt",
    "verifyHeld",
    "verifyLifecycle",
    "verifyHandoff",
    "verifyRuntime",
    "verifyPublic",
    "deployWebsite",
    "preflightWebsite",
  ])
    assert(phase.includes(name), name);
  assert(
    phase.indexOf("await preflightWebsite") <
      phase.indexOf("await deployWebsite"),
  );
  assert.match(phase, /parent\.phase,\s*["']public_verified/);
  assert.match(phase, /writeIdentity/);
  assert.match(phase, /vercel@65\.2\.0/);
  assert.doesNotMatch(phase, /\.put\(|--app-id|--propose/);
});
