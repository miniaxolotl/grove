import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { zipSync, strToU8 } from "fflate";
import { publication } from "./held-state.mjs";
import * as artifacts from "./held-artifacts.mjs";

const now = Date.parse("2026-11-19T10:00:00Z");
const context = {
  repository: "miniaxolotl/grove",
  source: "a".repeat(40),
  production: "b".repeat(40),
  tree: "c".repeat(40),
  tag: "v1.11.30",
  apiVersion: "1.11.29",
  run: 123,
  attempt: 1,
  actor: "miniaxolotl",
  protected: true,
};
const p = publication(context, `sha256:${"d".repeat(64)}`, now);
function fixture(change = () => {}) {
  const zip = zipSync({ "held-state.json": strToU8(JSON.stringify(p)) });
  const data = {
    run: {
      id: 123,
      run_attempt: 1,
      head_sha: context.production,
      head_branch: "production",
      path: ".github/workflows/deploy.yml",
      event: "push",
      status: "completed",
      conclusion: "success",
      actor: { login: "miniaxolotl" },
      triggering_actor: { login: "miniaxolotl" },
      head_repository: { full_name: "miniaxolotl/grove" },
    },
    artifact: {
      id: 456,
      name: "held-publication-1",
      expired: false,
      size_in_bytes: zip.length,
      expires_at: new Date(now + 60000).toISOString(),
      workflow_run: { id: 123 },
      digest: `sha256:${createHash("sha256").update(zip).digest("hex")}`,
    },
    jobs: ["candidate", "publish"].map((name) => ({
      name,
      run_id: 123,
      run_attempt: 1,
      head_sha: context.production,
      status: "completed",
      conclusion: "success",
    })),
    zip,
  };
  change(data);
  return {
    run: async () => data.run,
    artifacts: async () => [data.artifact],
    jobs: async () => data.jobs,
    download: async () => data.zip,
  };
}
test("publication is admitted only from its exact successful protected production workflow and verified artifact bytes", async () => {
  const loaded = await artifacts.loadHeldReceipt?.(
    123,
    1,
    "published_held",
    context,
    fixture(),
    now,
  );
  assert.deepEqual(loaded, p);
});
test("foreign workflows/actors/heads, partial publication, expired/altered/oversized receipts cannot authorize resume", async () => {
  for (const change of [
    (d) => {
      d.run.path = ".github/workflows/ci.yml";
    },
    (d) => {
      d.run.actor.login = "other";
    },
    (d) => {
      d.run.event = "pull_request";
    },
    (d) => {
      d.run.head_sha = "e".repeat(40);
    },
    (d) => {
      d.jobs[1].conclusion = "failure";
    },
    (d) => {
      d.artifact.expired = true;
    },
    (d) => {
      d.artifact.expires_at = new Date(now).toISOString();
    },
    (d) => {
      d.artifact.workflow_run.id = 999;
    },
    (d) => {
      d.artifact.size_in_bytes = 10000000;
    },
    (d) => {
      d.artifact.digest = `sha256:${"f".repeat(64)}`;
    },
    (d) => {
      d.zip = zipSync({ "unexpected.json": strToU8("private-fixture") });
    },
  ]) {
    await assert.rejects(
      async () =>
        artifacts.loadHeldReceipt?.(
          123,
          1,
          "published_held",
          context,
          fixture(change),
          now,
        ),
      (error) => {
        assert.match(String(error), /receipt unavailable/i);
        assert.doesNotMatch(String(error), /private-fixture/);
        return true;
      },
    );
  }
});
