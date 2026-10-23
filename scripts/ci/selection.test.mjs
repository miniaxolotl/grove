import assert from "node:assert/strict";
import { URL } from "node:url";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import {
  classify,
  evaluateGate,
  diffPaths,
  selectEvent,
} from "./selection.mjs";

const policy = {
  jobs: ["website", "server"],
  rules: [
    { prefix: "site/", jobs: ["website"] },
    { prefix: "api/", jobs: ["server"] },
    { prefix: "shared/", jobs: ["website", "server"] },
  ],
};
test("repository policy covers every workflow job and shared bundles", () => {
  const actual = JSON.parse(
    readFileSync(new URL("./job-policy.json", import.meta.url), "utf8"),
  );
  const workflow = readFileSync(
    new URL("../../.github/workflows/ci.yml", import.meta.url),
    "utf8",
  );
  const jobs = [
    ...workflow
      .split("\njobs:\n")[1]
      .matchAll(/^ {2}([A-Za-z_][A-Za-z0-9_-]*):$/gm),
  ].map((match) => match[1]);
  assert.deepEqual(
    jobs.sort(),
    ["changes", "promotion", "ci-gate", ...actual.jobs].sort(),
  );
  for (const path of [
    "pnpm-lock.yaml",
    ".github/workflows/ci.yml",
    "lib/shared/src/contracts.ts",
  ])
    assert.ok(Object.values(classify(actual, [path])).every(Boolean));
  assert.deepEqual(classify(actual, ["packages/website/src/page.tsx"]), {
    website: true,
    contracts: false,
    image: false,
  });
  assert.deepEqual(
    classify(actual, ["packages/grove-claude-plugin/skills/memory/SKILL.md"]),
    { website: false, contracts: true, image: true },
  );
  for (const job of actual.jobs)
    assert.ok(
      workflow.includes(`fromJSON(needs.changes.outputs.selection).${job}`),
    );
});
test("selection is conservative for empty/unknown paths and includes shared dependencies", () => {
  assert.deepEqual(classify(policy, ["documentation/runbook.md"]), {
    website: false,
    server: false,
  });
  assert.deepEqual(classify(policy, ["site/page.ts"]), {
    website: true,
    server: false,
  });
  for (const paths of [
    [],
    ["unknown"],
    ["shared/config.ts"],
    ["site/a", "api/b"],
  ])
    assert.deepEqual(classify(policy, paths), { website: true, server: true });
});
test("only admission-gated promotions reuse full independent source validation", () => {
  assert.deepEqual(
    selectEvent(policy, "pull_request", "production", false, ["shared/a"]),
    { website: false, server: false },
  );
  assert.deepEqual(selectEvent(policy, "workflow_dispatch", "", true, []), {
    website: false,
    server: false,
  });
  for (const event of ["push", "workflow_dispatch"])
    assert.deepEqual(
      selectEvent(policy, event, "", false, ["documentation/a.md"]),
      { website: true, server: true },
    );
  assert.deepEqual(
    selectEvent(policy, "pull_request", "development", false, ["site/a"]),
    { website: true, server: false },
  );
  assert.ok(
    Object.values(classify(policy, ["site/package.json"])).every(Boolean),
  );
  assert.throws(() =>
    selectEvent(policy, "pull_request_target", "production", false, []),
  );
});
test("diff reads both sides of renames and deletions and rejects malformed identities", () => {
  let args;
  assert.deepEqual(
    diffPaths("a".repeat(40), "b".repeat(40), (_command, values) => {
      args = values;
      return "site/old\0api/new\0";
    }),
    ["site/old", "api/new"],
  );
  assert.ok(args.includes("--no-renames"));
  assert.ok(args.includes("-z"));
  assert.ok(args.at(-1).includes("..."));
  assert.throws(() => diffPaths("--unsafe", "b".repeat(40)));
});
test("gate accepts only exact inventory, successful selected jobs and explicit skips", () => {
  const needs = {
    changes: {
      result: "success",
      outputs: { selection: JSON.stringify({ website: true, server: false }) },
    },
    promotion: { result: "success" },
    website: { result: "success" },
    server: { result: "skipped" },
  };
  assert.equal(evaluateGate(policy, needs), true);
  for (const state of ["failure", "cancelled", "skipped", undefined]) {
    const copy = globalThis.structuredClone(needs);
    copy.website.result = state;
    assert.throws(() => evaluateGate(policy, copy));
  }
  for (const key of ["website", "server", "changes", "promotion"]) {
    const copy = globalThis.structuredClone(needs);
    delete copy[key];
    assert.throws(() => evaluateGate(policy, copy));
  }
  assert.throws(() =>
    evaluateGate(policy, { ...needs, extra: { result: "success" } }),
  );
  for (const selection of [
    "{}",
    '{"website":"true","server":false}',
    "null",
    "{",
  ]) {
    const copy = globalThis.structuredClone(needs);
    copy.changes.outputs.selection = selection;
    assert.throws(() => evaluateGate(policy, copy));
  }
});
