import test from "node:test";
import assert from "node:assert/strict";
import * as writer from "./download-zip.mjs";

test("requires the next patch above both browser floors, independent of product tag", () => {
  assert.equal(typeof writer.nextVersion, "function");
  assert.equal(writer.nextVersion("1.11.24", "1.11.22"), "1.11.25");
  assert.equal(writer.nextVersion("1.11.24", "1.11.25"), "1.11.26");
  assert.throws(() => writer.nextVersion("1.11.24", undefined));
});

test("historical download evidence is bound separately from the live tooling ref", async () => {
  const pin = { source: "s", production: "old", artifactId: 3, sourceRun: 2 };
  const valid = {
    deploy: {
      head_sha: "old",
      status: "completed",
      conclusion: "success",
      path: ".github/workflows/deploy.yml",
      head_repository: { full_name: "miniaxolotl/grove" },
      head_branch: "production",
      event: "push",
    },
    artifact: { id: 3, expired: false, workflow_run: { id: 2, head_sha: "s" } },
    tagSha: "s",
  };
  assert.equal(typeof writer.assertEvidence, "function");
  writer.assertEvidence(pin, valid);
  const tooling = { ...valid.deploy, head_sha: "tooling" };
  writer.assertDeploy(tooling, "tooling");
  for (const run of [
    valid.deploy,
    { ...tooling, status: "in_progress" },
    { ...tooling, conclusion: "failure" },
  ])
    assert.throws(() => writer.assertDeploy(run, "tooling"));
  let writes = 0;
  for (const wrong of [
    { tagSha: "moved" },
    { deploy: { ...valid.deploy, head_sha: "new-tooling" } },
    { artifact: { ...valid.artifact, expired: true } },
    { artifact: { ...valid.artifact, id: 4 } },
  ]) {
    await assert.rejects(
      writer.reconcile("digest", {
        guard: () => writer.assertEvidence(pin, { ...valid, ...wrong }),
        read: () => null,
        upload: () => {
          writes++;
        },
      }),
    );
  }
  assert.equal(writes, 0);
});

test("accepted upload after transport failure is reconciled; retry is read only", async () => {
  let bytes,
    writes = 0;
  const io = {
    read: () => bytes,
    guard: () => {},
    upload: () => {
      bytes = "zip";
      writes++;
      throw Error("uncertain");
    },
  };
  assert.equal(typeof writer.reconcile, "function");
  await writer.reconcile("zip", io);
  await writer.reconcile("zip", io);
  assert.equal(writes, 1);
  await assert.rejects(writer.reconcile("other", io));
  assert.equal(writes, 1);
});

test("same-version store delivery requires the identical submitted ZIP", () => {
  const digest = "sha256:" + "a".repeat(64);
  const evidence = {
    previousFloor: "1.11.22",
    version: "1.11.25",
    submittedDigest: digest,
  };
  assert.equal(writer.approvedVersion("1.11.24", evidence, digest), "1.11.25");
  for (const bad of [
    { submittedDigest: undefined },
    { submittedDigest: "other" },
    { version: "1.11.26" },
  ])
    assert.throws(() =>
      writer.approvedVersion("1.11.24", { ...evidence, ...bad }, digest),
    );
});
