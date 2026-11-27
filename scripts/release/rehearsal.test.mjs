import assert from "node:assert/strict";
import {
  mkdtempSync,
  writeFileSync,
  readFileSync,
  rmSync,
  existsSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import process from "node:process";
import { spawnSync } from "node:child_process";
import test from "node:test";

test("only the protected sandbox observer may submit the freshly verified head to GitHub", (t) => {
  const script = resolve("scripts/release/rehearse-auto-merge.sh");
  assert.ok(existsSync(script), "Expected sandbox-only rehearsal command");
  const cwd = mkdtempSync(join(tmpdir(), "grove-merge-rehearsal-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const repository = "miniaxolotl/grove-promotion-rehearsal";
  const input = {
    pullRequestId: "PR_fixture",
    expectedHeadOid: "a".repeat(40),
    mergeMethod: "MERGE",
  };
  writeFileSync(
    join(cwd, "node"),
    `#!/bin/sh\n[ "$*" = 'scripts/release/promotion.mjs preview 123' ] && [ -z "$BLOCK" ] || exit 1\necho '${JSON.stringify({ input })}'`,
    { mode: 0o700 },
  );
  writeFileSync(
    join(cwd, "gh"),
    `#!/bin/sh\n[ "$*" = 'api graphql --input -' ] || exit 1\ncat >request`,
    { mode: 0o700 },
  );
  const env = {
    PATH: `${cwd}:${process.env.PATH}`,
    GITHUB_REPOSITORY: repository,
    GITHUB_ACTIONS: "true",
    GITHUB_EVENT_NAME: "workflow_run",
    GITHUB_REF_PROTECTED: "true",
    GITHUB_WORKFLOW_REF: `${repository}/.github/workflows/promotion-preview.yml@refs/heads/development`,
  };
  const run = (patch) =>
    spawnSync("bash", [script, "123"], {
      cwd,
      env: { ...env, ...patch },
      encoding: "utf8",
    });
  for (const patch of [
    { GITHUB_REPOSITORY: "miniaxolotl/grove" },
    { GITHUB_REF_PROTECTED: "false" },
    { GITHUB_EVENT_NAME: "workflow_dispatch" },
    { BLOCK: "1" },
  ]) {
    assert.notEqual(run(patch).status, 0);
    assert.equal(existsSync(join(cwd, "request")), false);
  }
  const result = run({});
  assert.equal(result.status, 0, result.stderr);
  const body = JSON.parse(readFileSync(join(cwd, "request")));
  assert.deepEqual(body.variables, { input });
  assert.match(body.query, /enablePullRequestAutoMerge\(input: \$input\)/);
});
