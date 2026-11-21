import assert from "node:assert/strict";
import test from "node:test";
import process from "node:process";
import { spawnSync } from "node:child_process";
test("migration entrypoint defaults to help, and unconfigured execution fails before credential access", () => {
  const help = spawnSync(
    process.execPath,
    ["ops/held-operator/migration-cli.mjs"],
    { encoding: "utf8" },
  );
  assert.equal(help.status, 0);
  assert.match(help.stdout, /Usage:/);
  const env = { ...process.env };
  delete env.GROVE_OPERATOR_CUSTODY_ROOT;
  const execute = spawnSync(
    process.execPath,
    [
      "ops/held-operator/migration-cli.mjs",
      "execute",
      "--request",
      "/never-read",
    ],
    { encoding: "utf8", env },
  );
  assert.equal(execute.status, 1);
  assert.match(execute.stderr, /unqualified/);
  assert.doesNotMatch(
    execute.stderr,
    /doppler|password|DATABASE_URL|\/never-read/,
  );
});
