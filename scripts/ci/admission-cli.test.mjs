import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { test } from "node:test";

test("manual promotion input cannot turn a development PR into a skipped-validation green gate", () => {
  const directory = mkdtempSync(join(tmpdir(), "admission-cli-"));
  try {
    const policy = JSON.parse(
      readFileSync("scripts/release/policy.json", "utf8"),
    );
    const sha = execFileSync("git", ["rev-parse", "HEAD"], {
      encoding: "utf8",
    }).trim();
    const pr = {
      number: 1,
      base: { ref: "development" },
      head: {
        ref: "feature/test",
        sha,
        repo: { full_name: policy.repository },
      },
    };
    writeFileSync(
      join(directory, "event.json"),
      JSON.stringify({ inputs: { promotion_pr: "1" } }),
    );
    writeFileSync(
      join(directory, "gh"),
      '#!/usr/bin/env node\nprocess.stdout.write("HTTP/2.0 200 OK\\n\\n" + process.env.SYNTHETIC_PR);\n',
      { mode: 0o700 },
    );
    const result = spawnSync(
      "node",
      ["scripts/release/promotion.mjs", "admit"],
      {
        encoding: "utf8",
        timeout: 10_000,
        env: {
          ...process.env,
          PATH: `${directory}:${process.env.PATH}`,
          SYNTHETIC_PR: JSON.stringify(pr),
          GITHUB_REPOSITORY: policy.repository,
          GITHUB_EVENT_PATH: join(directory, "event.json"),
          GITHUB_REF_NAME: pr.head.ref,
        },
      },
    );
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Dispatched candidate drift/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
