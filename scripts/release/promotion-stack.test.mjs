import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, URL } from "node:url";
import process from "node:process";
import test from "node:test";

const policy = JSON.parse(
  readFileSync(new URL("./policy.json", import.meta.url), "utf8"),
);
function admit(base, head = "fix/stack-child", repository = policy.repository) {
  const directory = mkdtempSync(join(tmpdir(), "grove-stack-admission-"));
  try {
    const event = join(directory, "event.json");
    writeFileSync(
      event,
      JSON.stringify({
        pull_request: {
          base: { ref: base, repo: { full_name: policy.repository } },
          head: { ref: head, repo: { full_name: repository } },
        },
      }),
    );
    return spawnSync(
      process.execPath,
      [fileURLToPath(new URL("./promotion.mjs", import.meta.url)), "admit"],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          GITHUB_EVENT_PATH: event,
          GITHUB_REPOSITORY: policy.repository,
          GITHUB_REF_NAME: head,
        },
      },
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

test("admission treats same-repository feature stacks as ordinary CI", () => {
  for (const base of [
    "feat/notebook-lifecycle",
    "fix/workspace-refinement",
    "feature/parent",
    "docs/parent",
    "perf/parent",
  ]) {
    const result = admit(base);
    assert.equal(result.status, 0, `${base}: ${result.stderr}`);
  }
});

test("stack routing never admits production, unknown targets, forks or promotion branches", () => {
  // Ensure the git lookup in the real CLI can run before testing rejection.
  execFileSync("git", ["rev-parse", "HEAD"]);
  for (const [base, head, repository] of [
    ["production", "fix/child"],
    ["staging", "fix/child"],
    ["feat/parent", "promote/production/v1.2.3"],
    ["feat/parent", "fix/child", "other/fork"],
  ]) {
    const result = admit(base, head, repository);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Invalid promotion target|frozen release ref/);
  }
});
